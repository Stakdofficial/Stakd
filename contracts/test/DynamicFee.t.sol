// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice The hook's market-aware fee: volatility fee, quick-flip fee and defend mode.
///         Traders here act as their own transaction sender (`vm.prank(who, who)`), because the quick-flip fee is
///         tracked per `tx.origin`.
contract DynamicFeeTest is LeveredTestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    LeveredRouter xRouter;

    function setUp() public override {
        super.setUp();
        xRouter = new LeveredRouter(pm, ILeveredFactory(address(factory)));
        vm.prank(owner);
        factory.setCrosschainRouter(address(xRouter));
    }

    // ---------------------------------------------------------------- helpers

    function _createWithFee(uint16 feeBps) internal returns (LeveredToken tok, LeveredTreasury t) {
        LeveredFactory.CreateParams memory p = _params(_lvrdLegs());
        p.feeBps = feeBps;
        vm.prank(creator);
        (, address tokenAddr, address treasuryAddr) = factory.createCoin(p);
        tok = LeveredToken(tokenAddr);
        t = LeveredTreasury(payable(treasuryAddr));
    }

    function _buyAs(address who, LeveredToken tok, uint256 ethIn) internal returns (uint256 out) {
        vm.deal(who, who.balance + ethIn);
        vm.prank(who, who);
        out = router.buy{value: ethIn}(address(tok), 0, who);
    }

    function _sellAs(address who, LeveredToken tok, uint256 tokensIn) internal returns (uint256 out) {
        vm.startPrank(who, who);
        tok.approve(address(router), tokensIn);
        out = router.sell(address(tok), tokensIn, 0, who);
        vm.stopPrank();
    }

    /// The coin's own fee (bps): what `currentFee` quotes, minus the fixed creator fee on top.
    function _fee(LeveredToken tok, bool isSell, address who) internal view returns (uint16 fee) {
        (fee,) = hook.currentFee(_poolId(tok), isSell, who);
        fee -= hook.CREATOR_FEE_BPS();
    }

    function _defending(LeveredToken tok) internal view returns (bool on) {
        (, on) = hook.currentFee(_poolId(tok), false, address(0));
    }

    /// Coin price in ETH as a tick (the pool tick negated).
    function _coinTick(LeveredToken tok) internal view returns (int24) {
        (, int24 tick,,) = pm.getSlot0(_poolId(tok));
        return -tick;
    }

    function _allPending(PoolId id) internal view returns (uint256) {
        return hook.pendingFees(id) + hook.pendingCrossChainFees(id) + hook.pendingDefendFees(id) + hook.pendingCreatorFees(id);
    }

    /// Reference copy of the hook's decay, to check its numbers independently of its storage.
    function _decayRef(uint256 v, uint256 elapsed) internal view returns (uint256) {
        uint256 hl = hook.VOL_HALF_LIFE();
        uint256 halvings = elapsed / hl;
        if (halvings >= 32) return 0;
        v >>= halvings;
        return v - (v * (elapsed % hl)) / (2 * hl);
    }

    function _surchargeRef(uint256 volTicks) internal view returns (uint256 s) {
        s = volTicks / hook.VOL_TICKS_PER_BP();
        if (s > hook.MAX_VOL_SURCHARGE_BPS()) s = hook.MAX_VOL_SURCHARGE_BPS();
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }

    /// Pump the coin with a buy, then let a day pass so the pump no longer counts as recent movement.
    function _pumpAndSettle(LeveredToken tok, uint256 ethIn) internal returns (uint256 tokens) {
        tokens = _buyAs(alice, tok, ethIn);
        vm.warp(block.timestamp + 1 days);
    }

    // ---------------------------------------------------------------- baseline

    function test_calmMarketChargesTheCreatorsFee() public {
        (LeveredToken tok,) = _create();
        assertEq(_fee(tok, false, alice), FEE_BPS);
        assertEq(_fee(tok, true, alice), FEE_BPS);
        _buyAs(alice, tok, 1 ether);
        assertEq(hook.pendingFees(_poolId(tok)), 0.02 ether, "first trade: no history, base fee");
    }

    // ---------------------------------------------------------------- quick-flip fee

    function test_quickFlip_sellRightAfterBuyPaysMaxFee() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        uint256 got = _buyAs(alice, tok, 1 ether);
        vm.warp(block.timestamp + 10);

        assertEq(_fee(tok, true, alice), hook.MAX_FEE_BPS());
        uint256 before = hook.pendingFees(id);
        uint256 creatorBefore = hook.pendingCreatorFees(id);
        uint256 ethOut = _sellAs(alice, tok, got / 2);
        uint256 sellFee = hook.pendingFees(id) - before;
        uint256 creatorFee = hook.pendingCreatorFees(id) - creatorBefore;
        uint256 gross = ethOut + sellFee + creatorFee;
        assertApproxEqAbs(sellFee, gross * 500 / 10_000, 1, "5% of the ETH the sale is worth");
        assertApproxEqAbs(creatorFee, gross / 100, 1, "plus the creator's 1%");
    }

    function test_quickFlip_sameBlockSandwichBackLegPaysMaxFee() public {
        (LeveredToken tok,) = _create();
        _pumpAndSettle(tok, 1 ether);
        // Front-run, victim buy and back-run all land in one block.
        uint256 botTokens = _buyAs(bob, tok, 2 ether);
        _buyAs(alice, tok, 1 ether);
        assertEq(_fee(tok, true, bob), hook.MAX_FEE_BPS(), "the bot's exit pays the max fee");
        _sellAs(bob, tok, botTokens);
    }

    function test_quickFlip_windowBoundary() public {
        (LeveredToken tok,) = _create();
        _buyAs(alice, tok, 1 ether);
        uint256 boughtAt = block.timestamp;

        vm.warp(boughtAt + hook.FLIP_WINDOW());
        assertEq(_fee(tok, true, alice), hook.MAX_FEE_BPS(), "last second of the window");
        vm.warp(boughtAt + hook.FLIP_WINDOW() + 1);
        assertLt(_fee(tok, true, alice), hook.MAX_FEE_BPS(), "window over");
        assertLt(_fee(tok, false, alice), hook.MAX_FEE_BPS(), "buys never pay the flip fee");
    }

    function test_quickFlip_onlyChargesTheWalletThatJustBought() public {
        (LeveredToken tok,) = _create();
        uint256 bobTokens = _buyAs(bob, tok, 1 ether);
        vm.warp(block.timestamp + 1 days);

        _buyAs(alice, tok, 1 ether);
        // Bob bought a day ago; Alice's buy this second is not sampled yet, so Bob pays exactly the base fee.
        assertEq(_fee(tok, true, bob), FEE_BPS);
        PoolId id = _poolId(tok);
        uint256 before = hook.pendingFees(id);
        uint256 creatorBefore = hook.pendingCreatorFees(id);
        uint256 ethOut = _sellAs(bob, tok, bobTokens);
        uint256 sellFee = hook.pendingFees(id) - before;
        uint256 gross = ethOut + sellFee + hook.pendingCreatorFees(id) - creatorBefore;
        assertApproxEqAbs(sellFee, gross * FEE_BPS / 10_000, 1);
    }

    function test_quickFlip_isTrackedPerCoin() public {
        (LeveredToken a,) = _create();
        (LeveredToken b,) = _create();
        uint256 bTokens = _buyAs(alice, b, 1 ether);
        vm.warp(block.timestamp + 1 days);

        _buyAs(alice, a, 1 ether);
        assertEq(_fee(b, true, alice), FEE_BPS, "buying coin A does not tax selling coin B");
        assertEq(_fee(a, true, alice), hook.MAX_FEE_BPS());
        _sellAs(alice, b, bTokens);
    }

    function test_quickFlip_crossChainBuysAreNotTracked() public {
        (LeveredToken tok,) = _create();
        vm.deal(alice, 1 ether);
        vm.prank(alice, alice);
        xRouter.buy{value: 1 ether}(address(tok), 0, alice);
        assertEq(hook.lastBuyAt(_poolId(tok), alice), 0);
    }

    // ---------------------------------------------------------------- volatility fee

    function test_vol_movementRaisesTheFeeFromTheNextSecond() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _buyAs(alice, tok, 0.05 ether); // first trade sets the starting point
        vm.warp(block.timestamp + 1 days);

        int24 t0 = _coinTick(tok);
        _buyAs(alice, tok, 0.1 ether);
        uint256 moved = _abs(int256(_coinTick(tok)) - t0);
        assertGt(moved, 0);
        assertEq(_fee(tok, false, bob), FEE_BPS, "same second: the move is not sampled yet");

        vm.warp(block.timestamp + 1);
        (, , , , uint32 volBefore) = hook.marketState(id);
        uint256 expected = FEE_BPS + _surchargeRef(_decayRef(volBefore + moved, 1));
        assertGt(expected, FEE_BPS);
        assertEq(_fee(tok, false, bob), expected);

        uint256 before = hook.pendingFees(id);
        _buyAs(bob, tok, 1 ether);
        assertEq(hook.pendingFees(id) - before, 1 ether * expected / 10_000, "charged what the view quoted");
    }

    function test_vol_surchargeIsCapped() public {
        (LeveredToken tok,) = _create();
        _buyAs(alice, tok, 5 ether); // a huge pump on a fresh coin
        vm.warp(block.timestamp + 1);
        assertEq(_fee(tok, false, bob), FEE_BPS + hook.MAX_VOL_SURCHARGE_BPS());
    }

    function test_vol_totalNeverAboveFivePercent() public {
        (LeveredToken tok,) = _createWithFee(450);
        _buyAs(alice, tok, 5 ether);
        vm.warp(block.timestamp + 1);
        assertEq(_fee(tok, false, bob), 500);
        PoolId id = _poolId(tok);
        uint256 before = hook.pendingFees(id);
        _buyAs(bob, tok, 1 ether);
        assertEq(hook.pendingFees(id) - before, 0.05 ether);
    }

    function test_vol_fadesAsTheMarketCalms() public {
        (LeveredToken tok,) = _create();
        _buyAs(alice, tok, 0.05 ether);
        vm.warp(block.timestamp + 1 days);
        int24 t0 = _coinTick(tok);
        _buyAs(alice, tok, 0.1 ether);
        uint256 moved = _abs(int256(_coinTick(tok)) - t0);
        uint256 pumpedAt = block.timestamp;

        vm.warp(pumpedAt + 1);
        uint256 fresh = _fee(tok, false, bob) - FEE_BPS;
        vm.warp(pumpedAt + hook.VOL_HALF_LIFE());
        uint256 half = _fee(tok, false, bob) - FEE_BPS;
        assertEq(half, _surchargeRef(moved / 2));
        assertLt(half, fresh);
        vm.warp(pumpedAt + 12 hours);
        assertEq(_fee(tok, false, bob), FEE_BPS, "calm again");
    }

    function test_vol_pumpThenSilenceReadsAsCalm() public {
        (LeveredToken tok,) = _create();
        _buyAs(alice, tok, 0.05 ether);
        vm.warp(block.timestamp + 1 days);
        _buyAs(alice, tok, 2 ether); // big move, then nobody trades for a day
        vm.warp(block.timestamp + 1 days);
        assertEq(_fee(tok, false, bob), FEE_BPS);
    }

    function test_vol_sameSecondRoundTripAddsNothing() public {
        (LeveredToken tok,) = _create();
        _pumpAndSettle(tok, 1 ether);
        int24 t0 = _coinTick(tok);
        uint256 got = _buyAs(bob, tok, 3 ether);
        _sellAs(bob, tok, got); // pushed up and pulled back within the second
        assertLe(_abs(int256(_coinTick(tok)) - t0), 1);
        vm.warp(block.timestamp + 1);
        assertEq(_fee(tok, false, alice), FEE_BPS);
    }

    // ---------------------------------------------------------------- defend mode

    /// Pump, settle, then dump `sellBps` of Alice's tokens. Returns the fall in ticks.
    function _crash(LeveredToken tok, uint256 sellBps) internal returns (uint256 fall) {
        uint256 tokens = _pumpAndSettle(tok, 2 ether);
        int24 high = _coinTick(tok);
        _sellAs(alice, tok, tokens * sellBps / 10_000);
        fall = _abs(int256(high) - _coinTick(tok));
        vm.warp(block.timestamp + 1 days); // let the crash's volatility fade so fees below are exact
    }

    function test_defend_turnsOnAfterATwentyPercentFall() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(tok);
        uint256 fall = _crash(tok, 5_000);
        assertGe(fall, uint256(hook.DEFEND_DROP_TICKS()), "the test crash is at least 20%");

        assertTrue(_defending(tok), "the next swap will start defend mode");
        (, int24 high,,,) = hook.marketState(id);
        int24 low = _coinTick(tok);
        vm.expectEmit(true, false, false, true, address(hook));
        emit LeveredHook.DefendModeStarted(id, uint40(block.timestamp + hook.DEFEND_DURATION()), high, low);
        _buyAs(bob, tok, 1 ether);

        assertEq(hook.pendingDefendFees(id), 0.02 ether, "same 2% fee, routed to defend");
        uint256 marginBefore = t.marginReserve();
        uint256 platformBefore = t.protocolOwed();
        uint256 burnFuelBefore = t.pendingBuyback();

        hook.collectDefendFees(id);
        assertEq(hook.pendingDefendFees(id), 0);
        assertEq(t.marginReserve(), marginBefore, "portfolio gets nothing while defending");
        assertEq(t.protocolOwed() - platformBefore, 0.008 ether, "platform share unchanged");
        assertEq(t.pendingBuyback() - burnFuelBefore, 0.012 ether, "coin's share is burn fuel");
        assertEq(t.totalDefendFees(), 0.02 ether);

        uint256 supply = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 1);
        assertGt(burned, 0);
        assertEq(tok.totalSupply(), supply - burned);
    }

    function test_defend_endsAfterSixHours() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _crash(tok, 5_000);
        _buyAs(bob, tok, 0.1 ether); // starts defend mode
        (, , , uint40 until,) = hook.marketState(id);
        assertGt(until, block.timestamp);

        vm.warp(uint256(until) - 1);
        assertTrue(_defending(tok));
        vm.warp(until);
        assertFalse(_defending(tok));

        uint256 normalBefore = hook.pendingFees(id);
        uint256 defendBefore = hook.pendingDefendFees(id);
        _buyAs(bob, tok, 1 ether);
        assertEq(hook.pendingDefendFees(id), defendBefore, "defend is over");
        assertEq(hook.pendingFees(id) - normalBefore, 0.02 ether, "fees fund the portfolio again");
    }

    function test_defend_smallDipDoesNothing() public {
        (LeveredToken tok,) = _create();
        uint256 fall = _crash(tok, 500);
        assertLt(fall, uint256(hook.DEFEND_DROP_TICKS()));
        assertFalse(_defending(tok));
        _buyAs(bob, tok, 1 ether);
        assertEq(hook.pendingDefendFees(_poolId(tok)), 0);
    }

    function test_defend_needsAFreshFallToStartAgain() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _crash(tok, 5_000);
        _buyAs(bob, tok, 0.001 ether); // starts defend mode at the crashed price
        vm.warp(block.timestamp + hook.DEFEND_DURATION());
        assertFalse(_defending(tok), "still low, but the fall was already defended");

        // Another 20%+ fall from the new level starts it again.
        uint256 aliceTokens = tok.balanceOf(alice);
        int24 level = _coinTick(tok);
        _sellAs(alice, tok, aliceTokens * 6_000 / 10_000);
        assertGe(_abs(int256(level) - _coinTick(tok)), uint256(hook.DEFEND_DROP_TICKS()));
        vm.warp(block.timestamp + 1);
        assertTrue(_defending(tok));
        _buyAs(bob, tok, 0.001 ether);
        (, , , uint40 until,) = hook.marketState(id);
        assertEq(until, block.timestamp + hook.DEFEND_DURATION());
    }

    function test_defend_crossChainBuysStillGoToTheirOwnBucket() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _crash(tok, 5_000);
        _buyAs(bob, tok, 0.001 ether); // starts defend mode
        uint256 defendBefore = hook.pendingDefendFees(id);

        vm.deal(bob, 1 ether);
        vm.prank(bob, bob);
        xRouter.buy{value: 1 ether}(address(tok), 0, bob);
        assertEq(hook.pendingCrossChainFees(id), 0.02 ether);
        assertEq(hook.pendingDefendFees(id), defendBefore);
    }

    function test_defend_onlyHookCanPayDefendFees() public {
        (, LeveredTreasury t) = _create();
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert(LeveredTreasury.OnlyHook.selector);
        t.onDefendFees{value: 1 ether}();
    }

    function test_defend_collectWithNothingPendingIsANoop() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        assertEq(hook.collectDefendFees(_poolId(tok)), 0);
        assertEq(t.totalFeesReceived(), 0);
    }

    // ---------------------------------------------------------------- creator fee

    function test_creator_getsOnePercentOfEveryTradeInEth() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        PoolId id = _poolId(tok);
        uint256 got = _buyAs(alice, tok, 1 ether);
        assertEq(hook.pendingCreatorFees(id), 0.01 ether, "1% of the buy");
        assertEq(hook.pendingFees(id), 0.02 ether, "the coin's 2% is unchanged");
        assertEq(tok.balanceOf(address(hook)), 0, "no fee is ever taken in the coin");

        vm.warp(block.timestamp + 1 days);
        uint256 ethOut = _sellAs(alice, tok, got);
        uint256 onSell = hook.pendingCreatorFees(id) - 0.01 ether;
        uint256 coinOnSell = hook.pendingFees(id) - 0.02 ether;
        assertApproxEqAbs(onSell, (ethOut + onSell + coinOnSell) / 100, 1, "1% of the sale too");

        uint256 creatorFees = hook.pendingCreatorFees(id);
        hook.collectCreatorFees(id);
        hook.collectFees(id);
        assertEq(t.totalCreatorFees(), creatorFees);
        // The creator's 1% is all theirs; the coin's fee still splits 60/40 with nothing to the creator.
        assertEq(t.creatorOwed(), creatorFees);
        assertEq(t.marginReserve() + t.protocolOwed(), t.totalFeesReceived());

        uint256 before = creator.balance;
        vm.prank(trader); // anyone may trigger the payout; it can only go to the creator
        t.claimCreatorFees();
        assertEq(creator.balance - before, creatorFees);
        assertEq(t.creatorOwed(), 0);
    }

    function test_creator_paidOnSolanaBuysToo() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        vm.deal(bob, 1 ether);
        vm.prank(bob, bob);
        xRouter.buy{value: 1 ether}(address(tok), 0, bob);
        assertEq(hook.pendingCreatorFees(id), 0.01 ether, "creator gets 1% of a cross-chain buy");
        assertEq(hook.pendingCrossChainFees(id), 0.02 ether, "the coin's 2% still goes to burn");
    }

    function test_creator_paidDuringDefendMode() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _crash(tok, 5_000);
        uint256 creatorBefore = hook.pendingCreatorFees(id);
        uint256 defendBefore = hook.pendingDefendFees(id);
        _buyAs(bob, tok, 1 ether);
        assertEq(hook.pendingCreatorFees(id) - creatorBefore, 0.01 ether);
        assertEq(hook.pendingDefendFees(id) - defendBefore, 0.02 ether);
    }

    function test_creator_totalNeverAboveSixPercent() public {
        (LeveredToken tok,) = _createWithFee(500);
        PoolId id = _poolId(tok);
        uint256 got = _buyAs(alice, tok, 5 ether); // pump, and Alice can quick-flip
        vm.warp(block.timestamp + 1);
        (uint16 buyFee,) = hook.currentFee(id, false, bob);
        (uint16 flipFee,) = hook.currentFee(id, true, alice);
        assertEq(buyFee, 600, "5% coin cap + 1% creator");
        assertEq(flipFee, 600, "quick flip is 5% + 1% too");

        uint256 before = _allPending(id);
        uint256 ethOut = _sellAs(alice, tok, got / 10);
        uint256 fee = _allPending(id) - before;
        assertApproxEqAbs(fee, (ethOut + fee) * 600 / 10_000, 1);
    }

    function test_creator_onlyHookCanPayCreatorFees() public {
        (, LeveredTreasury t) = _create();
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert(LeveredTreasury.OnlyHook.selector);
        t.onCreatorFees{value: 1 ether}();
    }

    function test_creator_collectWithNothingPendingIsANoop() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        assertEq(hook.collectCreatorFees(_poolId(tok)), 0);
        assertEq(t.creatorOwed(), 0);
    }

    // ---------------------------------------------------------------- invariants under random trading

    /// Random buys, sells and pauses by two traders. After every step:
    /// - the fee the view quotes is exactly what the swap charges,
    /// - every fee is between the coin's fee + 1% and 6%,
    /// - the hook's ETH claims equal the fees it owes treasuries.
    function testFuzz_feesStayBoundedAndAccounted(uint256 seed, uint16 baseFee) public {
        baseFee = uint16(bound(baseFee, 100, 500));
        (LeveredToken tok,) = _createWithFee(baseFee);
        PoolId id = _poolId(tok);
        _buyAs(alice, tok, 0.5 ether);
        _buyAs(bob, tok, 0.5 ether);

        for (uint256 i; i < 24; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = r & 1 == 0 ? alice : bob;
            uint256 action = (r >> 1) % 3;
            vm.warp(block.timestamp + (r >> 8) % 3 hours);

            (uint16 quoted,) = hook.currentFee(id, action == 1, who);
            assertGe(quoted, baseFee + 100, "at least the coin's fee plus the creator's 1%");
            assertLe(quoted, 600, "never above 5% + the creator's 1%");

            uint256 before = _allPending(id);
            if (action == 1) {
                uint256 bal = tok.balanceOf(who);
                uint256 amount = bal * (1 + (r >> 32) % 90) / 100;
                if (amount == 0) continue;
                uint256 ethOut = _sellAs(who, tok, amount);
                uint256 fee = _allPending(id) - before;
                assertApproxEqAbs(fee, (ethOut + fee) * quoted / 10_000, 1, "sell fee matches quote");
            } else {
                uint256 ethIn = 0.001 ether + (r >> 32) % 2 ether;
                _buyAs(who, tok, ethIn);
                assertEq(_allPending(id) - before, ethIn * quoted / 10_000, "buy fee matches quote");
            }
            assertEq(pm.balanceOf(address(hook), 0), _allPending(id), "claims back every owed fee");
        }
    }
}
