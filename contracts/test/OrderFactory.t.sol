// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {StakdCrossChainRouter} from "../src/StakdCrossChainRouter.sol";
import {StakdOrderFactory} from "../src/StakdOrderFactory.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice Buying from another chain by sending ETH to an address, with no contract call on arrival — the way
///         fast bridges actually work.
contract OrderFactoryTest is LeveredTestBase {
    using PoolIdLibrary for PoolKey;

    StakdCrossChainRouter xRouter;
    StakdOrderFactory orders;

    address buyer = makeAddr("buyer"); // where the coins should land on this chain
    address bridge = makeAddr("relaySolver"); // stands in for the bridge paying out
    address anyone = makeAddr("anyone"); // proves filling is permissionless

    function setUp() public override {
        super.setUp();
        xRouter = new StakdCrossChainRouter(pm, ILeveredFactory(address(factory)), owner);
        orders = new StakdOrderFactory(xRouter);

        vm.prank(owner);
        factory.setCrosschainRouter(address(xRouter));
        vm.prank(owner);
        xRouter.setTrustedSource(address(orders), true); // orders are the trusted caller, not the bridge
    }

    function _order(address token) internal view returns (StakdOrderFactory.Order memory) {
        return StakdOrderFactory.Order({
            token: token,
            minTokensOut: 0,
            to: bytes32(uint256(uint160(buyer))),
            dstEid: 0,
            bridgeFee: 0,
            deadline: block.timestamp + 1 hours,
            refundTo: buyer,
            salt: bytes32(uint256(1))
        });
    }

    function _poolId(address token) internal view returns (PoolId) {
        return factory.poolKeyOf(token).toId();
    }

    function test_theAddressIsTheOrder() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory a = _order(address(tok));
        address addrA = orders.orderAddress(a);

        // Change any single term and it is a different address, so nobody can alter an order after it is quoted.
        // Note: a memory struct assigned to another memory variable is a reference, not a copy, so each
        // variant below is built fresh.
        StakdOrderFactory.Order memory b = _order(address(tok));
        b.minTokensOut = 1;
        assertTrue(orders.orderAddress(b) != addrA, "slippage floor changes the address");

        StakdOrderFactory.Order memory c = _order(address(tok));
        c.to = bytes32(uint256(uint160(anyone)));
        assertTrue(orders.orderAddress(c) != addrA, "recipient changes the address");

        StakdOrderFactory.Order memory d = _order(address(tok));
        d.deadline = d.deadline + 1;
        assertTrue(orders.orderAddress(d) != addrA, "deadline changes the address");

        // And it is stable: quoting twice gives the same address.
        assertEq(orders.orderAddress(a), addrA, "same order, same address");
    }

    function test_bridgedEthFillsTheOrderAndBurnsTheFee() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        address addr = orders.orderAddress(o);

        // The bridge simply sends ETH to the address. No calldata, no cooperation needed.
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        (bool ok,) = addr.call{value: 5 ether}("");
        assertTrue(ok, "plain transfer to the order address");
        assertEq(orders.pending(o), 5 ether, "order is funded");

        uint256 out = orders.fill(o);

        assertGt(out, 0, "bought coins");
        assertEq(tok.balanceOf(buyer), out, "coins went to the buyer");
        assertEq(addr.balance, 0, "order address emptied");

        // The fee went to burns, not the portfolio, because the router made the swap.
        PoolId id = _poolId(address(tok));
        assertEq(hook.pendingFees(id), 0, "portfolio bucket untouched");
        assertEq(hook.pendingCrossChainFees(id), 0.1 ether, "2% of 5 ETH in the burn bucket");

        hook.collectCrossChainFees(id);
        assertEq(t.pendingBuyback(), 0.06 ether, "the coin's share is burn fuel");

        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 0);
        assertEq(tok.totalSupply(), supplyBefore - burned, "supply fell");
    }

    function test_anyoneCanFillButTermsCannotChange() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        payable(orders.orderAddress(o)).transfer(5 ether);

        // A stranger fills it. The coins still go to the buyer named in the order.
        vm.prank(anyone);
        uint256 out = orders.fill(o);
        assertEq(tok.balanceOf(buyer), out, "coins to the buyer, not the filler");
        assertEq(tok.balanceOf(anyone), 0, "filler gets nothing");
    }

    function test_refundOnlyAfterTheDeadlineAndOnlyToTheBuyer() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        payable(orders.orderAddress(o)).transfer(5 ether);

        vm.expectRevert(StakdOrderFactory.NotExpired.selector);
        orders.refund(o);

        skip(2 hours);
        uint256 before = buyer.balance;
        vm.prank(anyone); // even a stranger triggering it can only send the ETH to the refund address
        uint256 amount = orders.refund(o);
        assertEq(amount, 5 ether, "full amount refunded");
        assertEq(buyer.balance - before, 5 ether, "to the buyer");
    }

    function test_cannotFillTwice() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        payable(orders.orderAddress(o)).transfer(5 ether);

        orders.fill(o);
        vm.expectRevert(StakdOrderFactory.NothingToFill.selector);
        orders.fill(o);
    }

    function test_unfundedOrderCannotBeFilled() public {
        (LeveredToken tok,) = _create();
        vm.expectRevert(StakdOrderFactory.NothingToFill.selector);
        orders.fill(_order(address(tok)));
    }

    function test_slippageFloorIsHonoured() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        o.minTokensOut = type(uint128).max; // impossible floor
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        payable(orders.orderAddress(o)).transfer(5 ether);

        vm.expectRevert();
        orders.fill(o);
        // The ETH is still recoverable afterwards.
        skip(2 hours);
        assertEq(orders.refund(o), 5 ether, "refundable after a failed fill");
    }

    function test_lateFillIsRefusedByTheRouterNotFilledBadly() public {
        (LeveredToken tok,) = _create();
        StakdOrderFactory.Order memory o = _order(address(tok));
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        payable(orders.orderAddress(o)).transfer(5 ether);

        skip(2 hours); // the bridge was slow
        vm.expectRevert(StakdCrossChainRouter.Expired.selector);
        orders.fill(o);
    }
}
