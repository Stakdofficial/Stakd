// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolIdLibrary, PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {RateLimiter} from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {StakdCrossChainRouter} from "../src/StakdCrossChainRouter.sol";
import {StakdOFTAdapter} from "../src/StakdOFTAdapter.sol";
import {Leg, MarginConfig, ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {MessagingFee, MessagingReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

/// @notice The cross-chain flow against the **live** Robinhood Chain contracts: the real Uniswap v4 PoolManager
///         and the real LayerZero EndpointV2 — not mocks. This is the dress rehearsal that local tests cannot do:
///         a real pool with real liquidity, a real fee quote from LayerZero, real gas.
///
///         ROBINHOOD_FORK_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract CrossChainFork -vv
contract CrossChainForkTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant LIGHTER = 0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d;
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;
    /// LayerZero EndpointV2 on Robinhood Chain (same address on mainnet and testnet per LayerZero's metadata).
    address constant LZ_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant SOLANA_EID = 30168;
    bytes32 constant PEER = bytes32(uint256(0xBEEF));

    LeveredFactory factory;
    LeveredHook hook;
    LeveredRouter router;
    StakdCrossChainRouter xRouter;
    address keeper = makeAddr("keeper");
    address bridge = makeAddr("bridge");
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");

    function _fork() internal returns (bool) {
        string memory url = vm.envOr("ROBINHOOD_FORK_URL", string(""));
        if (bytes(url).length == 0) return false;
        vm.createSelectFork(url);
        return true;
    }

    function _deploy() internal {
        MarginConfig memory cfg = MarginConfig({
            lighter: LIGHTER,
            lighterAccount: makeAddr("operator"),
            assetIndex: 3,
            routeType: 0,
            usdg: USDG,
            poolFee: 100,
            poolTickSpacing: 1,
            poolHooks: address(0)
        });
        factory = new LeveredFactory(address(this), POOL_MANAGER, PLATFORM, 0, 4_000, -200_200, 10 ether, cfg);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        address hookAddr = address(uint160(0x6666 << 144) | flags);
        deployCodeTo("LeveredHook.sol:LeveredHook", abi.encode(POOL_MANAGER, address(factory)), hookAddr);
        hook = LeveredHook(payable(hookAddr));
        router = new LeveredRouter(POOL_MANAGER, ILeveredFactory(address(factory)));
        xRouter = new StakdCrossChainRouter(POOL_MANAGER, ILeveredFactory(address(factory)), address(this));

        factory.setPeripherals(hookAddr, address(router));
        factory.setCrosschainRouter(address(xRouter));
        factory.setKeeper(keeper, true);
        factory.setLaunchOpen(true);
        xRouter.setTrustedSource(bridge, true);
    }

    function _launch() internal returns (LeveredToken tok, LeveredTreasury t, PoolId id) {
        Leg[] memory legs = new Leg[](3);
        legs[0] = Leg(26, true, 4_000, 20);
        legs[1] = Leg(1, true, 3_000, 20);
        legs[2] = Leg(0, true, 3_000, 20);
        vm.prank(creator);
        (, address tokenAddr, address treasuryAddr) =
            factory.createCoin(LeveredFactory.CreateParams("Alpha", "ALPHA", legs, 200));
        tok = LeveredToken(tokenAddr);
        t = LeveredTreasury(payable(treasuryAddr));
        id = factory.poolKeyOf(tokenAddr).toId();
    }

    /// The whole point: on a real pool, a cross-chain buy must burn supply while a normal buy funds the portfolio,
    /// and the trader must pay the same either way.
    function test_liveChain_crossChainBuyBurns_normalBuyFundsPortfolio() public {
        if (!_fork()) return;
        _deploy();
        (LeveredToken tok, LeveredTreasury t, PoolId id) = _launch();

        // --- a normal buy, straight from a wallet
        vm.deal(trader, 20 ether);
        vm.prank(trader);
        uint256 normalOut = router.buy{value: 5 ether}(address(tok), 1, trader);
        hook.collectFees(id);
        uint256 marginAfterNormal = t.marginReserve();
        assertGt(marginAfterNormal, 0, "normal buy funded the portfolio");
        assertEq(t.pendingBuyback(), 0, "and burned nothing");

        // --- the same size buy arriving from another chain
        vm.deal(bridge, 20 ether);
        vm.prank(bridge);
        uint256 xOut = xRouter.buyAndDeliver{value: 5 ether}(address(tok), 1, bytes32(uint256(uint160(trader))), 0, 0, block.timestamp + 1 hours);
        assertGt(xOut, 0, "cross-chain buy delivered coins");

        assertEq(hook.pendingFees(id), 0, "nothing new in the portfolio bucket");
        assertEq(hook.pendingCrossChainFees(id), 0.1 ether, "2% of 5 ETH in the burn bucket");

        hook.collectCrossChainFees(id);
        assertEq(t.marginReserve(), marginAfterNormal, "portfolio untouched by the cross-chain buy");
        assertEq(t.pendingBuyback(), 0.06 ether, "the coin's share is burn fuel");

        // --- and it really burns, buying from the live pool
        uint256 supplyBefore = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 1);
        assertGt(burned, 0, "burned coins");
        assertEq(tok.totalSupply(), supplyBefore - burned, "supply fell by exactly the burn");

        emit log_named_decimal_uint("normal buy   coins", normalOut, 18);
        emit log_named_decimal_uint("crosschain   coins", xOut, 18);
        emit log_named_decimal_uint("burned       coins", burned, 18);
        // Second buy is always slightly smaller (price moved), never larger: the trader is not charged extra.
        assertLt(xOut, normalOut, "same fee, price simply moved along the curve");
    }

    /// The adapter against the real LayerZero endpoint: a real quote, a real rate limit, real supply conservation.
    function test_liveChain_adapterQuotesAndLocksAgainstRealEndpoint() public {
        if (!_fork()) return;
        _deploy();
        (LeveredToken tok,,) = _launch();

        StakdOFTAdapter adapter = new StakdOFTAdapter(address(tok), LZ_ENDPOINT, address(this));
        assertEq(adapter.token(), address(tok), "adapter points at the coin");

        // Fails closed: with no rate limit set, nothing may cross.
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](1);
        limits[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: 1_000_000e18, window: 1 hours});
        adapter.setRateLimits(limits);

        // A real quote needs a peer; without one the endpoint refuses, which is the behaviour we want to confirm.
        vm.expectRevert();
        adapter.quoteBridge(1_000e18, bytes32(uint256(1)), SOLANA_EID);

        adapter.setPeer(SOLANA_EID, bytes32(uint256(1)));

        // The live endpoint rejects empty execution options outright (LZ_ULN_InvalidWorkerOptions), which is why
        // the adapter refuses to send without them rather than locking coins behind an undeliverable message.
        EnforcedOptionParam[] memory opts = new EnforcedOptionParam[](1);
        opts[0] = EnforcedOptionParam({eid: SOLANA_EID, msgType: 1, options: hex"00030100110100000000000000000000000000030d40"});
        adapter.setEnforcedOptions(opts);
        adapter.setInboundRateLimit(SOLANA_EID, 1_000_000e18, 1 hours);

        // Even with peer, options and limits set, the live endpoint still refuses to quote until this
        // pathway's DVNs and executor are configured on the endpoint itself (`endpoint.setConfig`). That is a
        // deployment step, and finding it here is the point of running against the real chain.
        vm.expectRevert(bytes("Please set your OApp's DVNs and/or Executor"));
        adapter.quoteBridge(1_000e18, bytes32(uint256(1)), SOLANA_EID);

        // Until it is configured, nothing can be locked either — coins cannot be stranded by a half-set-up bridge.
        vm.deal(trader, 10 ether);
        vm.prank(trader);
        uint256 got = router.buy{value: 1 ether}(address(tok), 1, trader);
        uint256 supplyBefore = tok.totalSupply();

        vm.startPrank(trader);
        tok.approve(address(adapter), got);
        vm.expectRevert();
        adapter.sendTokens{value: 0.01 ether}(address(tok), got, bytes32(uint256(uint160(trader))), SOLANA_EID);
        vm.stopPrank();

        assertEq(tok.totalSupply(), supplyBefore, "supply untouched");
        assertEq(tok.balanceOf(address(adapter)), 0, "nothing locked behind an unusable pathway");
        assertEq(tok.balanceOf(trader), got, "the buyer still holds their coins");
    }

    /// The whole journey on the live chain, in one test:
    ///   normal buy -> fee funds the leveraged portfolio -> margin really reaches Lighter (as USDG)
    ///   cross-chain buy -> fee burns supply instead
    ///   RH -> Solana: coins locked here, supply unchanged (they are minted over there)
    ///   Solana -> RH: coins unlocked here against a message from the peer
    ///   and the books balance at every step.
    function test_liveChain_fullRoundTrip_bothDirections_andLeverage() public {
        if (!_fork()) return;
        _deploy();
        (LeveredToken tok, LeveredTreasury t, PoolId id) = _launch();

        StakdOFTAdapter adapter = new StakdOFTAdapter(address(tok), LZ_ENDPOINT, address(this));
        adapter.setPeer(SOLANA_EID, PEER);
        EnforcedOptionParam[] memory opts = new EnforcedOptionParam[](1);
        opts[0] = EnforcedOptionParam({eid: SOLANA_EID, msgType: 1, options: hex"00030100110100000000000000000000000000030d40"});
        adapter.setEnforcedOptions(opts);
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](1);
        limits[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: 1_000_000_000e18, window: 1 hours});
        adapter.setRateLimits(limits);
        adapter.setInboundRateLimit(SOLANA_EID, 1_000_000_000e18, 1 hours);
        xRouter.setAdapter(address(tok), address(adapter));

        // LayerZero's own messaging needs DVNs configured on the endpoint, which is a deployment step, not code.
        // Everything below it — custody, accounting, supply — is the real contract against the real pool.
        vm.mockCall(LZ_ENDPOINT, abi.encodeWithSignature("quote((uint32,bytes32,bytes,bytes,bool),address)"), abi.encode(MessagingFee(0.001 ether, 0)));
        vm.mockCall(LZ_ENDPOINT, abi.encodeWithSignature("send((uint32,bytes32,bytes,bytes,bool),address)"), abi.encode(MessagingReceipt(bytes32("guid"), 1, MessagingFee(0.001 ether, 0))));

        uint256 startSupply = tok.totalSupply();

        // ---------------------------------------------------------------- 1. a normal buy funds leverage
        vm.deal(trader, 50 ether);
        vm.prank(trader);
        uint256 bought = router.buy{value: 10 ether}(address(tok), 1, trader);
        hook.collectFees(id);
        uint256 margin = t.marginReserve();
        assertEq(margin, 0.2 ether - 0.08 ether, "60% of the 2% fee is portfolio margin");

        uint256 lighterUsdgBefore = IERC20(USDG).balanceOf(LIGHTER);
        vm.prank(keeper);
        uint256 usdg = t.depositMargin(margin, 1);
        assertGt(usdg, 0, "margin swapped to USDG on the live pool");
        assertEq(IERC20(USDG).balanceOf(LIGHTER) - lighterUsdgBefore, usdg, "and landed in Lighter");
        emit log_named_uint("margin deposited (USDG, 6dp)", usdg);

        // ---------------------------------------------------------------- 2. a cross-chain buy burns instead
        vm.deal(bridge, 20 ether);
        vm.prank(bridge);
        uint256 xOut = xRouter.buyAndDeliver{value: 5 ether}(
            address(tok), 1, bytes32(uint256(uint160(trader))), 0, 0, block.timestamp + 1 hours
        );
        hook.collectCrossChainFees(id);
        assertEq(t.marginReserve(), 0, "portfolio not funded by a cross-chain buy");
        assertEq(t.pendingBuyback(), 0.06 ether, "its share is burn fuel");

        uint256 beforeBurn = tok.totalSupply();
        vm.prank(keeper);
        uint256 burned = t.buybackAndBurn(0, 1);
        assertEq(tok.totalSupply(), beforeBurn - burned, "supply fell by the burn");
        emit log_named_decimal_uint("burned from a cross-chain buy", burned, 18);

        // ---------------------------------------------------------------- 3. RH -> Solana: lock, supply unchanged
        uint256 toBridge = 1_000_000e18;
        uint256 supplyBeforeBridge = tok.totalSupply();
        vm.startPrank(trader);
        tok.approve(address(adapter), toBridge);
        adapter.sendTokens{value: 0.001 ether}(address(tok), toBridge, bytes32(uint256(uint160(trader))), SOLANA_EID);
        vm.stopPrank();

        assertEq(tok.balanceOf(address(adapter)), toBridge, "locked in the lockbox");
        assertEq(tok.totalSupply(), supplyBeforeBridge, "bridging out does not change supply here");

        // ---------------------------------------------------------------- 4. Solana -> RH: unlock against a message
        address returner = makeAddr("returner");
        uint64 amountSD = uint64(400_000e6); // 400k coins, in the OFT's 6 shared decimals
        vm.prank(LZ_ENDPOINT);
        adapter.lzReceive(
            Origin({srcEid: SOLANA_EID, sender: PEER, nonce: 1}),
            bytes32("guid2"),
            abi.encodePacked(bytes32(uint256(uint160(returner))), amountSD),
            address(0),
            ""
        );

        assertEq(tok.balanceOf(returner), 400_000e18, "unlocked to the returning holder");
        assertEq(tok.balanceOf(address(adapter)), toBridge - 400_000e18, "the rest stays locked");
        assertEq(tok.totalSupply(), supplyBeforeBridge, "still no supply change from bridging");

        // ---------------------------------------------------------------- 5. the books
        // Everything that ever left circulation did so by being burned; bridging only moved custody.
        assertEq(startSupply - tok.totalSupply(), burned, "the only supply lost is what was burned");
        emit log_named_decimal_uint("start supply", startSupply, 18);
        emit log_named_decimal_uint("end supply  ", tok.totalSupply(), 18);
        emit log_named_decimal_uint("locked here ", tok.balanceOf(address(adapter)), 18);
        emit log_named_decimal_uint("bought      ", bought + xOut, 18);
    }
}
