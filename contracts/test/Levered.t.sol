// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {Leg, MarginConfig, ILeveredFactory} from "../src/interfaces/ILevered.sol";

// ---------------------------------------------------------------- mocks for the Robinhood Chain externals

contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Seeds a hookless v4 ETH/USDG pool (fee 0.01%, tick spacing 1) at ~$2,500 with deep full-range liquidity.
contract MarginPoolSeeder is IUnlockCallback {
    IPoolManager immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    function seed(PoolKey memory key) external payable {
        pm.initialize(key, TickMath.getSqrtPriceAtTick(-198_080));
        pm.unlock(abi.encode(key));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        PoolKey memory key = abi.decode(data, (PoolKey));
        (BalanceDelta d,) = pm.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -887_272, tickUpper: 887_272, liquidityDelta: 1e16, salt: 0}), ""
        );
        pm.settle{value: uint256(int256(-d.amount0()))}();
        pm.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).transfer(address(pm), uint256(int256(-d.amount1())));
        pm.settle();
        return "";
    }
}

contract MockLighter {
    address public lastTo;
    uint16 public lastAsset;
    uint8 public lastRoute;
    uint256 public lastAmount;

    function deposit(address to, uint16 assetIndex, uint8 routeType, uint256 amount) external payable {
        lastTo = to;
        lastAsset = assetIndex;
        lastRoute = routeType;
        lastAmount = amount;
    }
}

/// Exact-output swaps straight against the PoolManager, which the Levered router does not offer.
contract ExactOutSwapper is IUnlockCallback {
    IPoolManager immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) external payable returns (BalanceDelta delta) {
        delta = abi.decode(pm.unlock(abi.encode(key, zeroForOne, amountSpecified, msg.sender)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, bool zeroForOne, int256 amountSpecified, address payer) = abi.decode(data, (PoolKey, bool, int256, address));
        BalanceDelta d = pm.swap(
            key,
            SwapParams(zeroForOne, amountSpecified, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            ""
        );
        if (d.amount0() < 0) pm.settle{value: uint256(int256(-d.amount0()))}();
        if (d.amount0() > 0) pm.take(key.currency0, payer, uint256(int256(d.amount0())));
        if (d.amount1() < 0) {
            pm.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).transferFrom(payer, address(pm), uint256(int256(-d.amount1())));
            pm.settle();
        }
        if (d.amount1() > 0) pm.take(key.currency1, payer, uint256(int256(d.amount1())));
        return abi.encode(d);
    }
}

abstract contract LeveredTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    int24 constant START_TICK = -200_200; // ~$5k launch market cap at ETH $2,468
    uint16 constant FEE_BPS = 200;
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;

    IPoolManager pm;
    MockUSDG usdg;
    MockLighter lighter;
    LeveredFactory factory;
    LeveredHook hook;
    LeveredRouter router;
    ExactOutSwapper exactOut;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address lighterAccount = makeAddr("lighterAccount");
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");

    function setUp() public virtual {
        pm = new PoolManager(address(this));
        usdg = new MockUSDG();
        lighter = new MockLighter();

        // ETH/USDG margin pool: ~200 ETH and ~$500k USDG of full-range liquidity at $2,500.
        MarginPoolSeeder seeder = new MarginPoolSeeder(pm);
        usdg.mint(address(seeder), 10_000_000e6);
        vm.deal(address(seeder), 1_000 ether);
        seeder.seed(_marginPoolKey());

        factory = new LeveredFactory(owner, pm, PLATFORM, 0, 4_000, START_TICK, 10 ether, _marginConfig());
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        address hookAddr = address(uint160(0x4444 << 144) | flags);
        deployCodeTo("LeveredHook.sol:LeveredHook", abi.encode(pm, address(factory)), hookAddr);
        hook = LeveredHook(payable(hookAddr));
        router = new LeveredRouter(pm, ILeveredFactory(address(factory)));
        exactOut = new ExactOutSwapper(pm);

        vm.startPrank(owner);
        factory.setPeripherals(address(hook), address(router));
        factory.setKeeper(keeper, true);
        factory.setLaunchOpen(true);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _marginConfig() internal view returns (MarginConfig memory) {
        return MarginConfig({
            lighter: address(lighter),
            lighterAccount: lighterAccount,
            assetIndex: 3,
            routeType: 0,
            usdg: address(usdg),
            poolFee: 100,
            poolTickSpacing: 1,
            poolHooks: address(0)
        });
    }

    function _marginPoolKey() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(usdg)), 100, 1, IHooks(address(0)));
    }

    function _lvrdLegs() internal pure returns (Leg[] memory legs) {
        legs = new Leg[](3);
        legs[0] = Leg({marketId: 26, isLong: true, weightBps: 4_000, leverageX10: 20}); // SPY
        legs[1] = Leg({marketId: 1, isLong: true, weightBps: 3_000, leverageX10: 20}); // BTC
        legs[2] = Leg({marketId: 0, isLong: true, weightBps: 3_000, leverageX10: 20}); // ETH
    }

    function _params(Leg[] memory legs) internal pure returns (LeveredFactory.CreateParams memory) {
        return LeveredFactory.CreateParams({name: "Levered", symbol: "LVRD", legs: legs, feeBps: FEE_BPS});
    }

    function _create() internal returns (LeveredToken tok, LeveredTreasury t) {
        vm.prank(creator);
        (, address tokenAddr, address treasuryAddr) = factory.createCoin(_params(_lvrdLegs()));
        tok = LeveredToken(tokenAddr);
        t = LeveredTreasury(payable(treasuryAddr));
    }

    function _buy(address who, LeveredToken tok, uint256 ethIn) internal returns (uint256 out) {
        vm.deal(who, who.balance + ethIn);
        vm.prank(who);
        out = router.buy{value: ethIn}(address(tok), 0, who);
    }

    function _sell(address who, LeveredToken tok, uint256 tokensIn) internal returns (uint256 out) {
        vm.startPrank(who);
        tok.approve(address(router), tokensIn);
        out = router.sell(address(tok), tokensIn, 0, who);
        vm.stopPrank();
    }

    function _poolId(LeveredToken tok) internal view returns (PoolId) {
        return factory.poolKeyOf(address(tok)).toId();
    }

    /// Launch market cap in wei of ETH (price of one whole token × 1B).
    function _mcapWei(LeveredToken tok) internal view returns (uint256) {
        (uint160 sqrtP,,,) = pm.getSlot0(_poolId(tok));
        // price = token per ETH (raw) = sqrtP² / 2^192; ETH per token = 2^192 / sqrtP²
        uint256 tokensPerEthQ96 = (uint256(sqrtP) * uint256(sqrtP)) >> 96;
        return (uint256(1) << 96) * factory.TOTAL_SUPPLY() / tokensPerEthQ96;
    }

    // ---------------------------------------------------------------- launch

    function test_launch_needsNoEth_andPairsWithNativeEth() public {
        uint256 creatorBefore = creator.balance;
        uint256 pmEthBefore = address(pm).balance;
        (LeveredToken tok,) = _create();
        PoolKey memory key = factory.poolKeyOf(address(tok));

        assertEq(Currency.unwrap(key.currency0), address(0)); // native ETH
        assertEq(Currency.unwrap(key.currency1), address(tok));
        assertEq(creator.balance, creatorBefore);
        assertEq(address(pm).balance, pmEthBefore); // launching adds no ETH
        assertApproxEqRel(tok.balanceOf(address(pm)), factory.TOTAL_SUPPLY(), 1e12);
        assertEq(tok.balanceOf(address(factory)), 0);
        assertApproxEqRel(_mcapWei(tok), 2.02 ether, 0.01e18); // ≈ $5k at $2,468
    }

    function test_onlyFactoryCanCreatePools() public {
        (LeveredToken tok,) = _create();
        PoolKey memory key = factory.poolKeyOf(address(tok));
        key.tickSpacing = 60;
        vm.expectRevert();
        pm.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    // ---------------------------------------------------------------- fees in ETH

    function test_buyChargesEthFee_neverTokens() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        uint256 mcapBefore = _mcapWei(tok);
        uint256 got = _buy(trader, tok, 1 ether);

        assertEq(tok.balanceOf(trader), got);
        assertEq(hook.pendingFees(_poolId(tok)), 0.02 ether);
        assertEq(tok.balanceOf(address(hook)), 0);
        assertGt(_mcapWei(tok), mcapBefore);

        hook.collectFees(_poolId(tok));
        assertEq(address(t).balance, 0.02 ether);
        assertEq(t.totalFeesReceived(), 0.02 ether);
        assertEq(t.marginReserve(), 0.012 ether); // 60% portfolio
        assertEq(t.protocolOwed(), 0.008 ether); // 40% platform
        assertEq(t.creatorOwed(), 0); // no creator share
        assertEq(t.pendingBuyback(), 0);
    }

    function test_platformGetsFortyPercent() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 1 ether);
        hook.collectFees(_poolId(tok));

        uint256 c0 = creator.balance;
        uint256 p0 = PLATFORM.balance;
        vm.prank(trader); // anyone can trigger; money only goes to the right place
        t.claimCreatorFees();
        t.claimProtocolFees();
        assertEq(creator.balance - c0, 0);
        assertEq(PLATFORM.balance - p0, 0.008 ether);
        assertEq(t.creatorOwed(), 0);
        assertEq(t.protocolOwed(), 0);
        assertEq(address(t).balance, t.marginReserve());
    }

    function test_sellChargesEthFee() public {
        (LeveredToken tok,) = _create();
        uint256 got = _buy(trader, tok, 1 ether);
        uint256 afterBuy = hook.pendingFees(_poolId(tok));
        vm.warp(block.timestamp + 1 days); // past the quick-flip window, with the buy's price move faded out

        uint256 ethOut = _sell(trader, tok, got);
        uint256 sellFee = hook.pendingFees(_poolId(tok)) - afterBuy;
        assertApproxEqAbs(sellFee, (ethOut + sellFee) * FEE_BPS / 10_000, 1);
        assertApproxEqRel(ethOut, 1 ether * 98 / 100 * 98 / 100, 0.001e18);
    }

    function test_exactOutputSwapsAlsoPayFeeInEth() public {
        (LeveredToken tok,) = _create();
        PoolKey memory key = factory.poolKeyOf(address(tok));

        // Exact-out buy: receive exactly 1M tokens; fee is on the ETH paid (afterSwap path).
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        BalanceDelta d = exactOut.swap{value: 1 ether}(key, true, int256(1_000_000e18));
        uint256 paid = uint256(int256(-d.amount0()));
        assertEq(tok.balanceOf(trader), 1_000_000e18);
        uint256 buyFee = hook.pendingFees(key.toId());
        assertApproxEqAbs(buyFee, (paid - buyFee) * FEE_BPS / 10_000, 1);

        // Exact-out sell: receive exactly 0.001 ETH; fee is 2% of that (beforeSwap path).
        vm.warp(block.timestamp + 1 days); // past the quick-flip window, with the buy's price move faded out
        vm.startPrank(trader);
        tok.approve(address(exactOut), type(uint256).max);
        uint256 ethBefore = trader.balance;
        exactOut.swap(key, false, int256(0.001 ether));
        vm.stopPrank();
        assertEq(trader.balance - ethBefore, 0.001 ether);
        assertEq(hook.pendingFees(key.toId()) - buyFee, 0.00002 ether);
    }

    function test_onlyHookCanPayFees() public {
        (, LeveredTreasury t) = _create();
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert(LeveredTreasury.OnlyHook.selector);
        t.onFees{value: 1 ether}();
    }

    // ---------------------------------------------------------------- margin and buyback

    function test_depositMargin_swapsToUsdgOnV4AndDepositsIntoLighter() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 10 ether);
        hook.collectFees(_poolId(tok));
        uint256 margin = t.marginReserve();
        assertEq(margin, 0.12 ether);

        vm.prank(keeper);
        uint256 got = t.depositMargin(margin, 290e6);
        assertApproxEqRel(got, 300e6, 0.005e18); // 0.12 ETH × ~$2,500, less the 0.01% pool fee and impact
        assertEq(lighter.lastTo(), lighterAccount);
        assertEq(lighter.lastAsset(), 3);
        assertEq(lighter.lastRoute(), 0);
        assertEq(lighter.lastAmount(), got);
        assertEq(usdg.balanceOf(address(t)), got); // the mock Lighter doesn't pull; the real one does
        assertEq(t.marginReserve(), 0);
        assertEq(t.totalMarginDeposited(), margin);
        assertEq(t.totalUsdgDeposited(), got);
    }

    function test_depositMarginSlippageGuard() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 10 ether);
        hook.collectFees(_poolId(tok));
        uint256 margin = t.marginReserve();
        vm.prank(keeper);
        vm.expectRevert();
        t.depositMargin(margin, 1_000e6);
        assertEq(t.marginReserve(), margin);
    }

    function test_buybackAndBurn_fromReturnedUsdgProfit() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 1 ether);
        hook.collectFees(_poolId(tok));
        uint256 reserved = t.marginReserve() + t.creatorOwed() + t.protocolOwed();

        // Profit comes back from Lighter as USDG.
        usdg.mint(address(t), 250e6); // $250 ≈ 0.1 ETH
        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0.099 ether, 1);

        assertGt(burned, 0);
        assertEq(tok.totalSupply(), supplyBefore - burned);
        assertApproxEqRel(t.totalBuybackEth(), 0.1 ether, 0.005e18);
        assertEq(usdg.balanceOf(address(t)), 0);
        assertEq(address(t).balance, reserved); // margin and owed fees untouched
    }

    function test_buybackCannotSpendMarginOrOwedFees() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 1 ether);
        hook.collectFees(_poolId(tok));
        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.NoProfitToBurn.selector);
        t.buybackAndBurn(0, 0);
    }

    function test_depositCannotExceedReserve() public {
        (, LeveredTreasury t) = _create();
        vm.deal(address(t), 1 ether); // profit, not margin
        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.ExceedsReserve.selector);
        t.depositMargin(1, 0);
    }

    function test_routerRefundsAndSlippageGuard() public {
        (LeveredToken tok,) = _create();
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert();
        router.buy{value: 1 ether}(address(tok), type(uint256).max, trader);
        assertEq(trader.balance, 1 ether);
    }

    // ---------------------------------------------------------------- access and guardrails

    function test_onlyKeeper() public {
        (, LeveredTreasury t) = _create();
        vm.startPrank(trader);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.depositMargin(0, 0);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.buybackAndBurn(0, 0);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.setLighterAccount(7);
        vm.stopPrank();
    }

    function test_launchAllowlist() public {
        vm.prank(owner);
        factory.setLaunchOpen(false);
        vm.prank(creator);
        vm.expectRevert(LeveredFactory.NotAllowedToLaunch.selector);
        factory.createCoin(_params(_lvrdLegs()));

        vm.prank(owner);
        factory.setLauncher(creator, true);
        vm.prank(creator);
        factory.createCoin(_params(_lvrdLegs()));
        assertEq(factory.coinCount(), 1);
    }

    function test_pauseBlocksLaunchAndMarginButNotTradingOrBurns() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 1 ether);
        hook.collectFees(_poolId(tok));

        vm.prank(owner);
        factory.setPaused(true);

        uint256 reserve = t.marginReserve();
        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.Paused.selector);
        t.depositMargin(reserve, 0);

        vm.prank(creator);
        vm.expectRevert(LeveredFactory.LaunchesPaused.selector);
        factory.createCoin(_params(_lvrdLegs()));

        vm.deal(address(t), address(t).balance + 0.01 ether);
        vm.prank(keeper);
        t.buybackAndBurn(0, 1);
        _buy(trader, tok, 0.01 ether);
    }

    function test_marginCapPerCoin() public {
        (LeveredToken tok, LeveredTreasury t) = _create();
        _buy(trader, tok, 10 ether);
        hook.collectFees(_poolId(tok));
        vm.prank(owner);
        factory.setMarginCapPerCoin(0.05 ether);
        vm.startPrank(keeper);
        t.depositMargin(0.05 ether, 0);
        vm.expectRevert(LeveredTreasury.MarginCapReached.selector);
        t.depositMargin(1, 0);
        vm.stopPrank();
    }

    function test_marginConfigTimelock() public {
        MarginConfig memory next = _marginConfig();
        next.lighterAccount = address(0xBAD);
        vm.startPrank(owner);
        factory.proposeMarginConfig(next);
        vm.expectRevert(LeveredFactory.TooEarly.selector);
        factory.executeMarginConfig();
        vm.warp(block.timestamp + factory.MARGIN_CONFIG_DELAY());
        factory.executeMarginConfig();
        assertEq(factory.marginConfig().lighterAccount, address(0xBAD));

        factory.proposeMarginConfig(_marginConfig());
        factory.cancelMarginConfig();
        vm.expectRevert(LeveredFactory.NoPendingConfig.selector);
        factory.executeMarginConfig();
        vm.stopPrank();
    }

    function test_feeSharesCappedAtHalf() public {
        vm.prank(owner);
        vm.expectRevert(LeveredFactory.InvalidShares.selector);
        factory.setFeeShares(PLATFORM, 2_500, 2_501);
    }

    function test_peripheralsSetOnce() public {
        vm.prank(owner);
        vm.expectRevert(LeveredFactory.AlreadySet.selector);
        factory.setPeripherals(address(hook), address(router));
    }

    function test_rejectsInvalidBaskets() public {
        vm.startPrank(creator);
        Leg[] memory legs = new Leg[](7);
        for (uint16 i; i < 7; ++i) {
            legs[i] = Leg(i, true, i == 6 ? 4_000 : 1_000, 20);
        }
        vm.expectRevert(LeveredFactory.InvalidLegs.selector);
        factory.createCoin(_params(legs));

        legs = _lvrdLegs();
        legs[0].weightBps = 3_999;
        vm.expectRevert(LeveredFactory.InvalidLegs.selector);
        factory.createCoin(_params(legs));

        legs = _lvrdLegs();
        legs[1].leverageX10 = 101;
        vm.expectRevert(LeveredFactory.InvalidLegs.selector);
        factory.createCoin(_params(legs));

        LeveredFactory.CreateParams memory p = _params(_lvrdLegs());
        p.feeBps = 501; // above 5%
        vm.expectRevert(LeveredFactory.InvalidFee.selector);
        factory.createCoin(p);

        p.feeBps = 99; // below 1%
        vm.expectRevert(LeveredFactory.InvalidFee.selector);
        factory.createCoin(p);

        p.feeBps = 0;
        vm.expectRevert(LeveredFactory.InvalidFee.selector);
        factory.createCoin(p);
        vm.stopPrank();
    }

    function test_manyCoinsKeepSeparateFees() public {
        (LeveredToken a, LeveredTreasury ta) = _create();
        (LeveredToken b, LeveredTreasury tb) = _create();
        _buy(trader, a, 1 ether);
        _buy(trader, b, 3 ether);
        hook.collectFees(_poolId(a));
        hook.collectFees(_poolId(b));
        assertEq(ta.totalFeesReceived(), 0.02 ether);
        assertEq(tb.totalFeesReceived(), 0.06 ether);
    }

    function testFuzz_buySellNeverProfitsTrader(uint96 ethIn) public {
        ethIn = uint96(bound(ethIn, 0.0001 ether, 500 ether));
        (LeveredToken tok,) = _create();
        uint256 got = _buy(trader, tok, ethIn);
        uint256 back = _sell(trader, tok, got);
        assertLt(back, ethIn);
    }
}

/// @dev Concrete runner for the base suite; `CrossChain.t.sol` reuses the same setup.
contract LeveredTest is LeveredTestBase {}
