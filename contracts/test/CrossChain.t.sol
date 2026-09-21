// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice The cross-chain fee split: buys that arrive through the cross-chain router pay the *same* fee as any
///         other buy, but the coin's share buys back and burns instead of funding its leveraged portfolio.
///         Creator and platform shares are untouched, so no one's revenue subsidises the burn.
contract CrossChainFeeTest is LeveredTestBase {
    using PoolIdLibrary for PoolKey;

    LeveredRouter xRouter; // stands in for the Solana-routed buy path

    function setUp() public override {
        super.setUp();
        // A second router instance: same code, but it is the address the factory designates as cross-chain.
        xRouter = new LeveredRouter(pm, ILeveredFactory(address(factory)));
        vm.prank(owner);
        factory.setCrosschainRouter(address(xRouter));
    }

    function _poolId(address token) internal view returns (PoolId) {
        return factory.poolKeyOf(token).toId();
    }

    function test_crosschainRouterIsSetOnce() public {
        vm.prank(owner);
        vm.expectRevert();
        factory.setCrosschainRouter(address(router));
    }

    function test_normalBuyStillFundsThePortfolio() public {
        (LeveredToken tok, LeveredTreasury t) = _create();

        vm.deal(trader, 10 ether);
        vm.prank(trader);
        router.buy{value: 5 ether}(address(tok), 0, trader);

        hook.collectFees(_poolId(address(tok)));

        // 2% fee on 5 ETH = 0.1 ETH; 60% of it is margin for the coin's portfolio.
        assertEq(t.marginReserve(), 0.06 ether, "portfolio share");
        assertEq(t.protocolOwed(), 0.04 ether, "platform share");
        assertEq(t.totalCrossChainFees(), 0, "not a cross-chain buy");
        assertEq(t.pendingBuyback(), 0, "nothing to burn yet");
    }

    function test_crossChainBuyBurnsInsteadOfFundingThePortfolio() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(address(tok));

        vm.deal(trader, 10 ether);
        vm.prank(trader);
        xRouter.buy{value: 5 ether}(address(tok), 0, trader);

        // The fee is the same 2%, but it lands in the cross-chain bucket.
        assertEq(hook.pendingFees(id), 0, "no normal fees");
        assertEq(hook.pendingCrossChainFees(id), 0.1 ether, "cross-chain fees accrued");

        hook.collectCrossChainFees(id);

        assertEq(t.marginReserve(), 0, "portfolio gets nothing from a cross-chain buy");
        assertEq(t.protocolOwed(), 0.04 ether, "platform keeps its share");
        assertEq(t.totalCrossChainFees(), 0.1 ether, "tracked");
        assertEq(t.pendingBuyback(), 0.06 ether, "the coin's share is buyback fuel");
    }

    function test_crossChainFeesActuallyBurnSupply() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(address(tok));

        vm.deal(trader, 20 ether);
        vm.prank(trader);
        xRouter.buy{value: 5 ether}(address(tok), 0, trader);
        hook.collectCrossChainFees(id);

        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 0);

        assertGt(burned, 0, "burned something");
        assertEq(tok.totalSupply(), supplyBefore - burned, "supply fell by the burn");
        assertEq(t.totalTokensBurned(), burned, "tracked");
        assertEq(t.pendingBuyback(), 0, "fuel spent");
    }

    function test_traderPaysTheSameFeeEitherWay() public {
        (LeveredToken a,) = _create();

        vm.deal(trader, 20 ether);
        vm.prank(trader);
        uint256 viaNormal = router.buy{value: 5 ether}(address(a), 0, trader);

        // Same coin, same size, through the cross-chain router: the trader must not be charged more.
        (LeveredToken b,) = _create();
        vm.prank(trader);
        uint256 viaCrossChain = xRouter.buy{value: 5 ether}(address(b), 0, trader);

        assertEq(viaNormal, viaCrossChain, "identical cost to the trader");
    }

    function test_bothBucketsAreKeptApart() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(address(tok));

        vm.deal(trader, 20 ether);
        vm.startPrank(trader);
        router.buy{value: 2 ether}(address(tok), 0, trader);
        xRouter.buy{value: 3 ether}(address(tok), 0, trader);
        vm.stopPrank();

        assertEq(hook.pendingFees(id), 0.04 ether, "normal bucket");
        assertEq(hook.pendingCrossChainFees(id), 0.06 ether, "cross-chain bucket");

        hook.collectFees(id);
        hook.collectCrossChainFees(id);

        assertEq(t.marginReserve(), 0.024 ether, "only the normal buy funds the portfolio");
        assertEq(t.pendingBuyback(), 0.036 ether, "only the cross-chain buy funds burns");
        assertEq(t.protocolOwed(), 0.04 ether, "platform share from both");
    }
}
