// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {StakdBurner} from "../src/StakdBurner.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice The volatility surcharge is the only part of a fee that also burns official $STAKD: the creator still takes
///         1% and the platform still takes its 40% of everything, and what is left of the surcharge is split in half
///         between burning the coin and burning $STAKD. Whatever mode the coin is in, defend mode included.
contract StakdBurnTest is LeveredTestBase {
    using PoolIdLibrary for PoolKey;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    LeveredToken stakd;
    StakdBurner burner;

    /// Official $STAKD is just another coin, launched on its own factory in production. Here the same factory stands
    /// in for it, which is all the burner needs: a router that can trade its pool. Launched on demand so the base
    /// suite's own tests still see a fresh factory.
    function _wireStakd() internal {
        if (address(burner) != address(0)) return;
        LeveredFactory.CreateParams memory p = _params(_lvrdLegs());
        p.name = "Stakd";
        p.symbol = "STAKD";
        vm.prank(creator);
        (, address tokenAddr,) = factory.createCoin(p);
        stakd = LeveredToken(tokenAddr);
        _buy(bob, stakd, 5 ether); // give its pool a working price

        burner = new StakdBurner(ILeveredFactory(address(factory)), router, ERC20Burnable(tokenAddr));
        vm.prank(owner);
        factory.setStakdBurner(address(burner));
    }

    // ---------------------------------------------------------------- helpers

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

    /// A coin whose price has just moved, so the next swap pays a volatility surcharge.
    function _volatileCoin() internal returns (LeveredToken tok, LeveredTreasury t, uint16 volBps) {
        _wireStakd();
        (tok, t) = _create();
        _buyAs(alice, tok, 2 ether); // a pump on a fresh coin
        vm.warp(block.timestamp + 1); // the move is sampled from the next second
        (, volBps,) = hook.currentFeeParts(_poolId(tok), false, bob);
        assertGt(volBps, 0, "the coin should be volatile now");
    }

    // ---------------------------------------------------------------- the hook's bucket

    function test_volatilityPartIsKeptInItsOwnBucket() public {
        (LeveredToken tok,, uint16 volBps) = _volatileCoin();
        PoolId id = _poolId(tok);
        uint256 volBefore = hook.pendingVolatilityFees(id);
        uint256 feesBefore = hook.pendingFees(id);
        uint256 creatorBefore = hook.pendingCreatorFees(id);

        _buyAs(bob, tok, 1 ether);

        assertEq(hook.pendingVolatilityFees(id) - volBefore, 1 ether * uint256(volBps) / 10_000, "the surcharge, on its own");
        assertEq(hook.pendingFees(id) - feesBefore, 1 ether * uint256(FEE_BPS) / 10_000, "the coin's own fee, as always");
        assertEq(hook.pendingCreatorFees(id) - creatorBefore, 0.01 ether, "the creator's 1%, untouched");
    }

    function test_calmCoinAccruesNothingToBurnStakd() public {
        (LeveredToken tok,) = _create();
        PoolId id = _poolId(tok);
        _buyAs(alice, tok, 0.05 ether);
        vm.warp(block.timestamp + 30 days); // any move has long faded

        _buyAs(bob, tok, 0.05 ether);
        assertEq(hook.pendingVolatilityFees(id), 0, "no surcharge, nothing earmarked for $STAKD");
        assertEq(hook.pendingFees(id), 0.05 ether * 2 * uint256(FEE_BPS) / 10_000);
    }

    function test_defendModeStillSplitsTheSurcharge() public {
        (LeveredToken tok,, ) = _volatileCoin();
        PoolId id = _poolId(tok);

        // Crash the coin to put it in defend mode, then trade while the price is still moving.
        _sellAs(alice, tok, tok.balanceOf(alice) * 90 / 100);
        vm.warp(block.timestamp + 1);
        (, uint16 volBps, bool defending) = hook.currentFeeParts(id, false, bob);
        assertTrue(defending, "defend mode should be on after that drop");
        assertGt(volBps, 0, "and the market is still moving");

        uint256 volBefore = hook.pendingVolatilityFees(id);
        uint256 defendBefore = hook.pendingDefendFees(id);
        _buyAs(bob, tok, 1 ether);

        assertEq(hook.pendingVolatilityFees(id) - volBefore, 1 ether * uint256(volBps) / 10_000, "surcharge still splits");
        assertEq(hook.pendingDefendFees(id) - defendBefore, 1 ether * uint256(FEE_BPS) / 10_000, "the rest defends the coin");
    }

    // ---------------------------------------------------------------- the treasury's split

    function test_treasurySplitsTheSurchargeInHalf() public {
        (LeveredToken tok, LeveredTreasury t,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);

        uint256 amount = hook.pendingVolatilityFees(id);
        assertGt(amount, 0);
        uint256 protocolBefore = t.protocolOwed();
        uint256 burnFuelBefore = t.pendingBuyback();

        hook.collectVolatilityFees(id);

        uint256 toProtocol = amount * 4_000 / 10_000;
        uint256 coinShare = amount - toProtocol;
        assertEq(t.protocolOwed() - protocolBefore, toProtocol, "the platform's 40%, exactly as on any other fee");
        assertEq(address(burner).balance, coinShare / 2, "half of what is left buys and burns $STAKD");
        assertEq(t.pendingBuyback() - burnFuelBefore, coinShare - coinShare / 2, "the other half burns the coin");
        assertEq(t.totalVolatilityFees(), amount);
        assertEq(t.totalStakdBurnFunded(), coinShare / 2);
        assertEq(t.marginReserve(), 0, "the surcharge never goes to the portfolio");
    }

    function test_platformStillEarnsFortyPercentOfEverything() public {
        (LeveredToken tok, LeveredTreasury t,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);

        uint256 coinFees = hook.pendingFees(id);
        uint256 volFees = hook.pendingVolatilityFees(id);
        hook.collectFees(id);
        hook.collectVolatilityFees(id);

        assertEq(t.protocolOwed(), (coinFees + volFees) * 4_000 / 10_000, "40% of the whole fee, surcharge included");
        assertEq(t.totalFeesReceived(), coinFees + volFees);
    }

    function test_creatorFeeIsUnaffected() public {
        (LeveredToken tok, LeveredTreasury t,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);
        hook.collectCreatorFees(id);
        hook.collectVolatilityFees(id);

        assertEq(t.totalCreatorFees(), 0.01 ether + 0.02 ether, "1% of each of the two buys");
        uint256 owed = t.creatorOwed();
        t.claimCreatorFees();
        assertEq(creator.balance, owed);
    }

    function test_withoutABurnerTheWholeShareBurnsTheCoin() public {
        // A factory that was never wired to a burner (or an older one) keeps behaving exactly as before.
        LeveredFactory bare = new LeveredFactory(owner, pm, PLATFORM, 0, 4_000, START_TICK, 10 ether, _marginConfig());
        assertEq(bare.stakdBurner(), address(0));

        (LeveredToken tok, LeveredTreasury t,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);
        uint256 amount = hook.pendingVolatilityFees(id);

        vm.mockCall(address(factory), abi.encodeWithSignature("stakdBurner()"), abi.encode(address(0)));
        hook.collectVolatilityFees(id);
        vm.clearMockedCalls();

        uint256 coinShare = amount - amount * 4_000 / 10_000;
        assertEq(address(burner).balance, 0, "nothing was sent anywhere");
        assertEq(t.pendingBuyback(), coinShare, "all of it burns the coin instead");
        assertEq(t.totalStakdBurnFunded(), 0);
    }

    function test_collectIsIdempotent() public {
        (LeveredToken tok,,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);
        assertGt(hook.collectVolatilityFees(id), 0);
        assertEq(hook.collectVolatilityFees(id), 0, "nothing left to collect");
        assertEq(hook.pendingVolatilityFees(id), 0);
    }

    function test_hookClaimsCoverEveryBucket() public {
        (LeveredToken tok,,) = _volatileCoin();
        PoolId id = _poolId(tok);
        uint256 claimsBefore = pm.balanceOf(address(hook), 0); // the hook holds claims for every pool it serves
        uint256 owedBefore = _owed(id);

        _buyAs(bob, tok, 1 ether);
        _sellAs(bob, tok, 1_000e18);

        assertGt(hook.pendingVolatilityFees(id), 0);
        assertEq(pm.balanceOf(address(hook), 0) - claimsBefore, _owed(id) - owedBefore, "every bucket has a claim");

        hook.collectVolatilityFees(id);
        assertEq(pm.balanceOf(address(hook), 0) - claimsBefore, _owed(id) - owedBefore, "and collecting spends it");
    }

    function _owed(PoolId id) internal view returns (uint256) {
        return hook.pendingFees(id) + hook.pendingDefendFees(id) + hook.pendingCrossChainFees(id)
            + hook.pendingCreatorFees(id) + hook.pendingVolatilityFees(id);
    }

    // ---------------------------------------------------------------- the burner

    function test_burnerBuysAndBurnsStakd() public {
        _wireStakd();
        uint256 supplyBefore = stakd.totalSupply();
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(burner).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(burner.totalEthReceived(), 1 ether);

        vm.prank(keeper);
        uint256 burned = burner.burn(0);

        assertGt(burned, 0, "it bought $STAKD");
        assertEq(stakd.totalSupply(), supplyBefore - burned, "and burned every coin it bought");
        assertEq(stakd.balanceOf(address(burner)), 0);
        assertEq(address(burner).balance, 0, "it spends everything it holds");
        assertEq(burner.totalEthSpent(), 1 ether);
        assertEq(burner.totalBurned(), burned);
    }

    function test_burnerIsKeeperOnlyAndRespectsSlippage() public {
        _wireStakd();
        vm.deal(address(burner), 1 ether);
        vm.expectRevert(StakdBurner.OnlyKeeper.selector);
        burner.burn(0);

        vm.prank(keeper);
        vm.expectRevert();
        burner.burn(type(uint256).max); // an impossible slippage bound stops the burn

        vm.prank(keeper);
        burner.burn(0);
    }

    function test_burnerRevertsWhenEmpty() public {
        _wireStakd();
        vm.prank(keeper);
        vm.expectRevert(StakdBurner.NothingToBurn.selector);
        burner.burn(0);
    }

    function test_feesFlowAllTheWayFromASwapToABurnedStakd() public {
        (LeveredToken tok,,) = _volatileCoin();
        PoolId id = _poolId(tok);
        _buyAs(bob, tok, 1 ether);
        hook.collectVolatilityFees(id);

        uint256 supplyBefore = stakd.totalSupply();
        vm.prank(keeper);
        burner.burn(0);
        assertLt(stakd.totalSupply(), supplyBefore, "a trade on one coin burned official $STAKD");
    }

    // ---------------------------------------------------------------- wiring

    function test_stakdBurnerIsSetOnceByTheOwner() public {
        _wireStakd();
        LeveredFactory f = new LeveredFactory(owner, pm, PLATFORM, 0, 4_000, START_TICK, 10 ether, _marginConfig());

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        f.setStakdBurner(address(burner));

        vm.startPrank(owner);
        vm.expectRevert(LeveredFactory.BadPeripheral.selector);
        f.setStakdBurner(address(0));

        f.setStakdBurner(address(burner));
        assertEq(f.stakdBurner(), address(burner));

        vm.expectRevert(LeveredFactory.AlreadySet.selector);
        f.setStakdBurner(address(burner));
        vm.stopPrank();
    }

    function test_onlyTheHookCanPayVolatilityFees() public {
        (, LeveredTreasury t,) = _volatileCoin();
        vm.deal(address(this), 1 ether);
        vm.expectRevert(LeveredTreasury.OnlyHook.selector);
        t.onVolatilityFees{value: 1 ether}();
    }

    /// However the market moves, the platform's 40% and the creator's 1% come out the same, and the coin's remaining
    /// share is split evenly between the two burns.
    function testFuzz_sharesHoldWhateverTheMarketDoes(uint256 seed) public {
        (LeveredToken tok, LeveredTreasury t,) = _volatileCoin();
        PoolId id = _poolId(tok);
        uint256 gross;

        for (uint256 i; i < 8; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = r & 1 == 0 ? alice : bob;
            vm.warp(block.timestamp + (r >> 8) % 20 minutes);
            if ((r >> 1) % 3 == 1) {
                uint256 bal = tok.balanceOf(who);
                if (bal == 0) continue;
                _sellAs(who, tok, bal * (1 + (r >> 32) % 50) / 100);
            } else {
                _buyAs(who, tok, 0.01 ether + (r >> 32) % 1 ether);
            }
            gross = hook.pendingFees(id) + hook.pendingDefendFees(id) + hook.pendingVolatilityFees(id);
        }

        uint256 vol = hook.pendingVolatilityFees(id);
        hook.collectFees(id);
        hook.collectDefendFees(id);
        hook.collectVolatilityFees(id);

        assertApproxEqAbs(t.protocolOwed(), gross * 4_000 / 10_000, 3, "the platform always takes 40%");
        uint256 coinShare = vol - vol * 4_000 / 10_000;
        assertEq(address(burner).balance, coinShare / 2, "half the surcharge's coin share burns $STAKD");
        assertEq(t.totalVolatilityFees(), vol);
    }
}
