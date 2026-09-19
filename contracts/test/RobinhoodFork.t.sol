// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolIdLibrary, PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {Leg, MarginConfig, ILeveredFactory} from "../src/interfaces/ILevered.sol";

/// Full Levered cycle against the live Robinhood Chain contracts: Uniswap v4 PoolManager, the hookless v4 ETH/USDG
/// 0.01% pool, USDG, and Lighter's zkLighter deposit contract.
///   ROBINHOOD_FORK_URL=<rpc> forge test --match-contract RobinhoodForkTest -vv
contract RobinhoodForkTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant LIGHTER = 0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d;
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;

    function test_fullCycleOnRobinhoodChain() public {
        string memory url = vm.envOr("ROBINHOOD_FORK_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);

        address keeper = makeAddr("keeper");
        address operator = makeAddr("lighterOperator");
        address creator = makeAddr("creator");
        address trader = makeAddr("trader");

        MarginConfig memory cfg = MarginConfig({
            lighter: LIGHTER,
            lighterAccount: operator,
            assetIndex: 3,
            routeType: 0,
            usdg: USDG,
            poolFee: 100,
            poolTickSpacing: 1,
            poolHooks: address(0)
        });
        LeveredFactory factory = new LeveredFactory(address(this), POOL_MANAGER, PLATFORM, 0, 4_000, -200_200, 10 ether, cfg);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        address hookAddr = address(uint160(0x5555 << 144) | flags);
        deployCodeTo("LeveredHook.sol:LeveredHook", abi.encode(POOL_MANAGER, address(factory)), hookAddr);
        LeveredHook hook = LeveredHook(payable(hookAddr));
        LeveredRouter router = new LeveredRouter(POOL_MANAGER, ILeveredFactory(address(factory)));
        factory.setPeripherals(hookAddr, address(router));
        factory.setKeeper(keeper, true);
        factory.setLaunchOpen(true);

        // Launch with zero ETH.
        Leg[] memory legs = new Leg[](3);
        legs[0] = Leg(26, true, 4_000, 20); // SPY
        legs[1] = Leg(1, true, 3_000, 20); // BTC
        legs[2] = Leg(0, true, 3_000, 20); // ETH
        vm.prank(creator);
        (, address tokenAddr, address treasuryAddr) = factory.createCoin(LeveredFactory.CreateParams("Levered", "LVRD", legs, 200));
        LeveredToken tok = LeveredToken(tokenAddr);
        LeveredTreasury t = LeveredTreasury(payable(treasuryAddr));
        PoolId id = factory.poolKeyOf(tokenAddr).toId();

        // Trade: buy 10 ETH, sell half.
        vm.deal(trader, 10 ether);
        vm.startPrank(trader);
        uint256 got = router.buy{value: 10 ether}(tokenAddr, 1, trader);
        tok.approve(address(router), got / 2);
        uint256 ethBack = router.sell(tokenAddr, got / 2, 1, trader);
        vm.stopPrank();
        assertGt(ethBack, 0);
        uint256 fees = hook.pendingFees(id);
        assertGt(fees, 0.2 ether); // 2% of 10 ETH in, plus 2% of the sell
        assertEq(tok.balanceOf(hookAddr), 0); // fees never in tokens

        // Fees → treasury, split 60% portfolio / 40% platform.
        hook.collectFees(id);
        assertEq(address(t).balance, fees);
        assertEq(t.marginReserve(), fees - (fees * 4) / 10);
        uint256 p0 = PLATFORM.balance;
        t.claimProtocolFees();
        assertEq(PLATFORM.balance - p0, (fees * 4) / 10);

        // Margin: ETH → USDG on the live v4 pool → deposited into Lighter.
        uint256 margin = t.marginReserve();
        uint256 lighterBefore = IERC20(USDG).balanceOf(LIGHTER);
        vm.prank(keeper);
        uint256 usdg = t.depositMargin(margin, 1);
        emit log_named_decimal_uint("margin ETH", margin, 18);
        emit log_named_decimal_uint("deposited USDG", usdg, 6);
        assertGt(usdg, (margin * 2_000) / 1e12); // sanity: ETH worth > $2,000
        assertEq(IERC20(USDG).balanceOf(LIGHTER) - lighterBefore, usdg);
        assertEq(IERC20(USDG).balanceOf(address(t)), 0);

        // Profit returns as USDG → swapped to ETH on v4 → buys LVRD → burned.
        deal(USDG, address(t), 100e6);
        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0.03 ether, 1);
        emit log_named_decimal_uint("burned LVRD", burned, 18);
        emit log_named_decimal_uint("buyback ETH", t.totalBuybackEth(), 18);
        assertGt(burned, 0);
        assertEq(tok.totalSupply(), supplyBefore - burned);
        assertEq(IERC20(USDG).balanceOf(address(t)), 0);
    }
}
