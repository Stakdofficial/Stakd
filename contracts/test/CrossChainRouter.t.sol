// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {StakdCrossChainRouter, IStakdBridgeAdapter} from "../src/StakdCrossChainRouter.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice Stands in for a coin's LayerZero OFT adapter: records what it was asked to bridge.
contract MockBridgeAdapter is IStakdBridgeAdapter {
    address public lastToken;
    uint256 public lastAmount;
    bytes32 public lastTo;
    uint32 public lastEid;
    uint256 public lastFee;
    bool public shouldRevert;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    uint256 public fee = 0.003 ether; // what the LayerZero message actually costs
    uint256 public dustUnit = 1e12; // amounts below the bridge's precision cannot cross

    function setFee(uint256 v) external {
        fee = v;
    }

    function sendTokens(address token, uint256 amount, bytes32 to, uint32 dstEid) external payable {
        if (shouldRevert) revert("bridge down");
        require(msg.value >= fee, "fee too low");
        uint256 carried = (amount / dustUnit) * dustUnit; // drop dust, like a real OFT adapter
        IERC20(token).transferFrom(msg.sender, address(this), carried);
        (lastToken, lastAmount, lastTo, lastEid, lastFee) = (token, carried, to, dstEid, fee);
        uint256 refund = msg.value - fee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }
    }
}

contract CrossChainRouterTest is LeveredTestBase {
    using PoolIdLibrary for PoolKey;

    StakdCrossChainRouter xRouter;
    MockBridgeAdapter adapter;

    address bridge = makeAddr("bridge"); // the trusted LayerZero composer
    address solanaBuyer = makeAddr("solanaBuyer");

    function setUp() public override {
        super.setUp();
        xRouter = new StakdCrossChainRouter(pm, ILeveredFactory(address(factory)), owner);
        adapter = new MockBridgeAdapter();

        vm.prank(owner);
        factory.setCrosschainRouter(address(xRouter));
        vm.prank(owner);
        xRouter.setTrustedSource(bridge, true);
    }

    function _poolId(address token) internal view returns (PoolId) {
        return factory.poolKeyOf(token).toId();
    }

    function _to32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function test_onlyTrustedBridgesCanRoute() public {
        (LeveredToken tok,) = _create();
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(StakdCrossChainRouter.UntrustedSource.selector);
        xRouter.buyAndDeliver{value: 1 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0, block.timestamp + 1 hours);
    }

    function test_crossChainBuyDeliversCoinsAndBurnsTheFee() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(address(tok));

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        uint256 out = xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);

        // Coins went to the buyer (no adapter wired yet, so they land on this chain).
        assertGt(out, 0, "bought something");
        assertEq(tok.balanceOf(solanaBuyer), out, "buyer received the coins");

        // The fee landed in the cross-chain bucket, not the normal one.
        assertEq(hook.pendingFees(id), 0, "portfolio bucket empty");
        assertEq(hook.pendingCrossChainFees(id), 0.1 ether, "2% of 5 ETH");

        hook.collectCrossChainFees(id);
        assertEq(t.marginReserve(), 0, "portfolio unfunded by a cross-chain buy");
        assertEq(t.protocolOwed(), 0.04 ether, "platform keeps its 40%");
        assertEq(t.pendingBuyback(), 0.06 ether, "the coin's 60% is burn fuel");

        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 0);
        assertEq(tok.totalSupply(), supplyBefore - burned, "supply actually fell");
    }

    function test_bridgesCoinsOnwardWhenAnAdapterIsSet() public {
        (LeveredToken tok,) = _create();
        vm.prank(owner);
        xRouter.setAdapter(address(tok), address(adapter));

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        uint256 out = xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0.01 ether, block.timestamp + 1 hours);

        assertEq(adapter.lastToken(), address(tok), "bridged the right coin");
        assertEq(adapter.lastAmount(), (out / 1e12) * 1e12, "bridged everything the bridge could carry");
        assertEq(adapter.lastTo(), _to32(solanaBuyer), "to the buyer's far-chain wallet");
        assertEq(adapter.lastEid(), 30168, "to Solana");
        assertEq(adapter.lastFee(), 0.003 ether, "only the real message cost was spent");
        assertEq(tok.balanceOf(address(xRouter)), 0, "router keeps nothing");
    }

    function test_bridgeFeeIsNotSpentOnTheCoin() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(address(tok));

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 0, 1 ether, block.timestamp + 1 hours);

        // Only the 4 ETH after the held-back fee was traded, so the fee is 2% of 4 ETH.
        assertEq(hook.pendingCrossChainFees(id), 0.08 ether, "fee charged on the traded amount only");
        assertEq(bridge.balance, 1 ether, "held-back bridge fee returned when unused");
    }

    function test_slippageGuardProtectsTheBuyer() public {
        (LeveredToken tok,) = _create();
        vm.deal(bridge, 5 ether);

        vm.prank(bridge);
        vm.expectRevert();
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), type(uint256).max, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);
    }

    function test_everythingRevertsIfTheBridgeFails() public {
        (LeveredToken tok,) = _create();
        vm.prank(owner);
        xRouter.setAdapter(address(tok), address(adapter));
        adapter.setShouldRevert(true);

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        vm.expectRevert(bytes("bridge down"));
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0.01 ether, block.timestamp + 1 hours);

        // Nothing half-done: the buyer's ETH is still with the bridge to refund.
        assertEq(bridge.balance, 5 ether, "buyer's funds untouched");
        assertEq(tok.balanceOf(address(xRouter)), 0, "no coins stranded in the router");
    }

    function test_unknownCoinIsRejected() public {
        vm.deal(bridge, 1 ether);
        vm.prank(bridge);
        vm.expectRevert(StakdCrossChainRouter.UnknownCoin.selector);
        xRouter.buyAndDeliver{value: 1 ether}(makeAddr("notACoin"), 0, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);
    }

    function test_routerHoldsNothingAfterwards() public {
        (LeveredToken tok,) = _create();
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);

        assertEq(address(xRouter).balance, 0, "no ETH left behind");
        assertEq(tok.balanceOf(address(xRouter)), 0, "no coins left behind");
    }

    // ---------------------------------------------------------------- hardening

    /// A real adapter hands back the bridge fee it did not spend. The router must be able to receive it.
    function test_acceptsTheAdaptersFeeRefund() public {
        (LeveredToken tok,) = _create();
        vm.prank(owner);
        xRouter.setAdapter(address(tok), address(adapter));

        vm.deal(bridge, 5 ether);
        uint256 before = bridge.balance;
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0.05 ether, block.timestamp + 1 hours);

        // Only the real fee was spent; the rest of the held-back ETH came back to the bridge.
        assertEq(adapter.lastFee(), 0.003 ether, "adapter charged its fee");
        assertEq(bridge.balance, before - 5 ether + (0.05 ether - 0.003 ether), "overpaid fee refunded");
        assertEq(address(xRouter).balance, 0, "router keeps no ETH");
    }

    /// A Solana address does not fit in 20 bytes. Truncating it would send the coins into a black hole.
    function test_refusesToTruncateAFarChainAddress() public {
        (LeveredToken tok,) = _create();
        bytes32 solanaPubkey = keccak256("a real solana address"); // uses the full 32 bytes

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        vm.expectRevert(StakdCrossChainRouter.BadRecipient.selector);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, solanaPubkey, 0, 0, block.timestamp + 1 hours);
    }

    /// Asking for delivery to another chain with no bridge wired up must fail loudly, not deliver here.
    function test_refusesFarChainDeliveryWithoutAnAdapter() public {
        (LeveredToken tok,) = _create();
        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        vm.expectRevert(StakdCrossChainRouter.NoAdapter.selector);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0.01 ether, block.timestamp + 1 hours);
    }

    /// Dust the bridge cannot carry must not pile up behind a standing allowance.
    function test_leavesNoStandingAllowanceAndNoStuckDust() public {
        (LeveredToken tok,) = _create();
        vm.prank(owner);
        xRouter.setAdapter(address(tok), address(adapter));

        vm.deal(bridge, 5 ether);
        vm.prank(bridge);
        uint256 out = xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 30168, 0.01 ether, block.timestamp + 1 hours);

        assertGt(out % 1e12, 0, "this buy really does leave dust");
        assertEq(tok.balanceOf(address(xRouter)), 0, "no dust stuck in the router");
        assertEq(tok.allowance(address(xRouter), address(adapter)), 0, "no standing allowance");
        assertEq(tok.balanceOf(owner), out - adapter.lastAmount(), "dust recovered, not lost");
    }

    /// The cross-chain router must never be the ordinary router, or every coin's portfolio goes unfunded.
    function test_cannotPointCrossChainRouterAtTheNormalRouter() public {
        // A fresh factory, so the one-time setter is still open.
        vm.prank(owner);
        vm.expectRevert();
        factory.setCrosschainRouter(address(router));
    }

    // ------------------------------------------- findings from the pre-mainnet review

    /// One adapter may serve several coins. Registering it for a second coin must not brick the first.
    function test_oneAdapterCanServeTwoCoins() public {
        (LeveredToken a,) = _create();
        (LeveredToken b,) = _create();
        vm.startPrank(owner);
        xRouter.setAdapter(address(a), address(adapter));
        xRouter.setAdapter(address(b), address(adapter)); // used to clear the allowance flag for coin A
        vm.stopPrank();

        vm.deal(bridge, 10 ether);
        // Coin A still works: the adapter's fee refund must still be accepted.
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(a), 0, _to32(solanaBuyer), 30168, 0.05 ether, block.timestamp + 1 hours);
        assertEq(adapter.lastToken(), address(a), "coin A bridged fine");

        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(b), 0, _to32(solanaBuyer), 30168, 0.05 ether, block.timestamp + 1 hours);
        assertEq(adapter.lastToken(), address(b), "coin B bridged fine");
    }

    /// A cross-chain message can land long after it was sent. A stale delivery must be refused, not filled.
    function test_staleDeliveryIsRefused() public {
        (LeveredToken tok,) = _create();
        vm.deal(bridge, 5 ether);
        uint256 deadline = block.timestamp + 10 minutes;
        skip(11 minutes);

        vm.expectRevert(StakdCrossChainRouter.Expired.selector);
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 5 ether}(address(tok), 0, _to32(solanaBuyer), 0, 0, deadline);
    }

    /// The buyer's slippage floor must be honoured on a delayed fill, not silently ignored.
    function test_slippageFloorHoldsAfterThePriceMoves() public {
        (LeveredToken tok,) = _create();

        // Quote what 1 ETH buys today, then let someone else move the price first.
        vm.deal(bridge, 20 ether);
        vm.prank(bridge);
        uint256 quotedNow = xRouter.buyAndDeliver{value: 1 ether}(address(tok), 0, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);

        vm.deal(trader, 50 ether);
        vm.prank(trader);
        router.buy{value: 30 ether}(address(tok), 0, trader); // the front-run

        // The buyer's floor now fails, so their funds go back through the bridge instead of filling badly.
        vm.expectRevert();
        vm.prank(bridge);
        xRouter.buyAndDeliver{value: 1 ether}(address(tok), quotedNow, _to32(solanaBuyer), 0, 0, block.timestamp + 1 hours);
    }
}
