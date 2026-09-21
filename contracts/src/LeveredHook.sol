// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ILeveredTreasury, ILeveredFactory} from "./interfaces/ILevered.sol";

/// @title LeveredHook
/// @notice Uniswap v4 hook shared by every Levered pool. Pools pair each coin with native ETH (always currency0),
///         and the hook charges the coin's trading fee in ETH on buys and sells, never in tokens.
///
///         The fee a swap pays reacts to the market, always within the 5% cap:
///         - Volatility fee: the creator's fee is the base; recent price movement adds up to `MAX_VOL_SURCHARGE_BPS`
///           on top, fading as the market calms (movement halves every `VOL_HALF_LIFE`).
///         - Quick-flip fee: selling within `FLIP_WINDOW` of buying (same transaction sender) pays `MAX_FEE_BPS`, so
///           sandwich and round-trip bots pay the most.
///         - Defend mode: once the coin's price falls `DEFEND_DROP_TICKS` below its high, the coin's share of fees goes to
///           buyback & burn instead of its portfolio for `DEFEND_DURATION`. Traders pay nothing extra for it.
/// @dev The fee is taken from the ETH leg: before the swap when ETH is the specified amount, after the swap when it
///      is the unspecified amount. Fees are held as PoolManager ERC-6909 claims (a pool may hold no ETH mid-swap)
///      and paid to the coin's treasury by `collectFees`, which anyone can call.
contract LeveredHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint16 public constant MAX_FEE_BPS = 500;
    Currency public constant ETH = CurrencyLibrary.ADDRESS_ZERO;

    /// @notice Recent movement halves over this period.
    uint256 public constant VOL_HALF_LIFE = 15 minutes;
    /// @notice Each this many ticks of recent movement (1 tick = 0.01% of price) add 1 bp of fee.
    uint256 public constant VOL_TICKS_PER_BP = 20;
    /// @notice The most the volatility fee can add to a coin's base fee.
    uint16 public constant MAX_VOL_SURCHARGE_BPS = 200;
    /// @notice A sell this soon after the same sender's buy pays the maximum fee.
    uint256 public constant FLIP_WINDOW = 15 seconds;
    /// @notice A fall this far below the coin's high turns on defend mode (2,231 ticks = 20%).
    int256 public constant DEFEND_DROP_TICKS = 2_231;
    uint256 public constant DEFEND_DURATION = 6 hours;

    /// @dev Transient slot holding the fee (bps) of the swap in progress, set in beforeSwap and read in afterSwap.
    bytes32 private constant SWAP_FEE_SLOT = keccak256("stakd.hook.swapFeeBps");

    struct PoolInfo {
        address treasury;
        uint16 feeBps;
    }

    IPoolManager public immutable poolManager;
    address public immutable factory;

    mapping(PoolId => PoolInfo) public pools;
    mapping(PoolId => uint256) public pendingFees;
    /// @notice Fees from buys that arrived through the factory's cross-chain router. Same fee the trader always
    ///         pays; the coin's share buys back and burns instead of funding its leveraged portfolio.
    mapping(PoolId => uint256) public pendingCrossChainFees;
    /// @notice Fees charged while defend mode was on. The coin's share buys back and burns instead of funding its
    ///         portfolio; creator and platform shares are unchanged.
    mapping(PoolId => uint256) public pendingDefendFees;

    /// @notice What the hook has seen of a pool's price. Ticks are the coin's price in ETH (the pool tick negated), so
    ///         a higher tick is a more expensive coin.
    struct MarketState {
        int24 lastTick; // price at the last volatility sample
        int24 peakTick; // highest price since defend mode last started
        uint40 lastSample; // timestamp of the last volatility sample (0 = no trade yet)
        uint40 defendUntil; // defend mode is on while block.timestamp < defendUntil
        uint32 volTicks; // recent movement in ticks, decayed over time
    }

    mapping(PoolId => MarketState) public marketState;
    /// @notice Last buy per pool and transaction sender, for the quick-flip fee.
    mapping(PoolId => mapping(address => uint40)) public lastBuyAt;

    event PoolRegistered(PoolId indexed id, address treasury, uint16 feeBps);
    event FeeAccrued(PoolId indexed id, uint256 amount);
    event FeesCollected(PoolId indexed id, address indexed treasury, uint256 amount);
    event CrossChainFeeAccrued(PoolId indexed id, uint256 amount);
    event CrossChainFeesCollected(PoolId indexed id, address indexed treasury, uint256 amount);
    event DefendFeeAccrued(PoolId indexed id, uint256 amount);
    event DefendFeesCollected(PoolId indexed id, address indexed treasury, uint256 amount);
    event DefendModeStarted(PoolId indexed id, uint40 until, int24 peakTick, int24 tick);

    error OnlyPoolManager();
    error OnlyFactory();
    error NotLeveredPool();
    error FeeTooHigh();
    error HookNotImplemented();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_, address factory_) {
        poolManager = poolManager_;
        factory = factory_;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    /// @notice ETH arrives here from the PoolManager during `collectFees`.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
    }

    function register(PoolKey calldata key, address treasury, uint16 feeBps) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (!(key.currency0 == ETH)) revert NotLeveredPool();
        PoolId id = key.toId();
        pools[id] = PoolInfo(treasury, feeBps);
        emit PoolRegistered(id, treasury, feeBps);
    }

    // ---------------------------------------------------------------- hook callbacks

    /// @dev Only the factory can create pools that use this hook.
    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != factory || pools[key.toId()].treasury == address(0)) revert NotLeveredPool();
        return IHooks.beforeInitialize.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        uint256 feeBps = _startSwap(id, sender, params.zeroForOne);
        if (_ethIsSpecified(params)) {
            uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            uint256 fee = (amount * feeBps) / 10_000;
            if (fee != 0) {
                _accrue(id, fee, sender);
                return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        if (!_ethIsSpecified(params)) {
            PoolId id = key.toId();
            int128 ethDelta = delta.amount0();
            uint256 amount = ethDelta < 0 ? uint256(int256(-ethDelta)) : uint256(int256(ethDelta));
            uint256 fee = (amount * _swapFeeBps()) / 10_000;
            if (fee != 0) {
                _accrue(id, fee, sender);
                return (IHooks.afterSwap.selector, int128(int256(fee)));
            }
        }
        return (IHooks.afterSwap.selector, 0);
    }

    // ---------------------------------------------------------------- dynamic fee

    /// @notice The fee (bps) a swap would pay right now, and whether defend mode would take the coin's share.
    /// @param trader The transaction sender (EOA) the quick-flip fee is tracked against.
    function currentFee(PoolId id, bool isSell, address trader) external view returns (uint16 feeBps, bool defending) {
        MarketState memory m = _observe(marketState[id], _coinTick(id), block.timestamp);
        feeBps = _feeBps(id, m, isSell, trader);
        defending = block.timestamp < m.defendUntil;
    }

    /// @dev Updates the pool's market state with the price before this swap, prices the swap, and remembers buys.
    function _startSwap(PoolId id, address sender, bool isBuy) internal returns (uint256 feeBps) {
        MarketState memory m = marketState[id];
        // `_observe` updates `m` in place, so keep what the event reports from before.
        (uint40 prevUntil, int24 prevPeak) = (m.defendUntil, m.peakTick);
        m = _observe(m, _coinTick(id), block.timestamp);
        marketState[id] = m;
        if (m.defendUntil != prevUntil) emit DefendModeStarted(id, m.defendUntil, prevPeak, m.peakTick);

        feeBps = _feeBps(id, m, !isBuy, tx.origin);
        // Buys arriving over a bridge share one relayer as sender; they never sell, so there is nothing to track.
        if (isBuy && sender != ILeveredFactory(factory).crosschainRouter()) lastBuyAt[id][tx.origin] = uint40(block.timestamp);
        bytes32 slot = SWAP_FEE_SLOT;
        assembly ("memory-safe") {
            tstore(slot, feeBps)
        }
    }

    function _swapFeeBps() internal view returns (uint256 feeBps) {
        bytes32 slot = SWAP_FEE_SLOT;
        assembly ("memory-safe") {
            feeBps := tload(slot)
        }
    }

    function _feeBps(PoolId id, MarketState memory m, bool isSell, address trader) internal view returns (uint16) {
        if (isSell) {
            uint256 boughtAt = lastBuyAt[id][trader];
            if (boughtAt != 0 && block.timestamp <= boughtAt + FLIP_WINDOW) return MAX_FEE_BPS;
        }
        uint256 surcharge = m.volTicks / VOL_TICKS_PER_BP;
        if (surcharge > MAX_VOL_SURCHARGE_BPS) surcharge = MAX_VOL_SURCHARGE_BPS;
        uint256 fee = pools[id].feeBps + surcharge;
        return uint16(fee > MAX_FEE_BPS ? MAX_FEE_BPS : fee);
    }

    /// @dev Folds the current price into the market state. Movement is sampled at most once per second, so trades
    ///      that push the price and pull it back within the same second add nothing. Only swaps move the price, and
    ///      a swap in a later second takes a new sample first, so all movement since the last sample was made in that
    ///      sample's second: it decays from then, and a pump followed by hours of silence reads as calm.
    function _observe(MarketState memory m, int24 tick, uint256 now_) internal pure returns (MarketState memory) {
        if (m.lastSample == 0) {
            m.lastTick = tick;
            m.peakTick = tick;
            m.lastSample = uint40(now_);
            return m;
        }
        if (now_ > m.lastSample) {
            uint256 moved = tick > m.lastTick ? uint256(int256(tick) - m.lastTick) : uint256(int256(m.lastTick) - tick);
            uint256 vol = _decay(uint256(m.volTicks) + moved, now_ - m.lastSample);
            m.volTicks = uint32(vol > type(uint32).max ? type(uint32).max : vol);
            m.lastTick = tick;
            m.lastSample = uint40(now_);
        }
        if (tick > m.peakTick) m.peakTick = tick;
        if (now_ >= m.defendUntil && int256(m.peakTick) - tick >= DEFEND_DROP_TICKS) {
            m.defendUntil = uint40(now_ + DEFEND_DURATION);
            // The next defend needs a fresh 20% fall from here.
            m.peakTick = tick;
        }
        return m;
    }

    /// @dev Halves `v` every `VOL_HALF_LIFE`, easing linearly within each half-life.
    function _decay(uint256 v, uint256 elapsed) internal pure returns (uint256) {
        uint256 halvings = elapsed / VOL_HALF_LIFE;
        if (halvings >= 32) return 0;
        v >>= halvings;
        return v - (v * (elapsed % VOL_HALF_LIFE)) / (2 * VOL_HALF_LIFE);
    }

    /// @dev The coin's price in ETH as a tick. The pool prices the coin (currency1) per ETH (currency0), so negate.
    function _coinTick(PoolId id) internal view returns (int24) {
        (, int24 tick,,) = poolManager.getSlot0(id);
        return -tick;
    }

    // ---------------------------------------------------------------- fee payout

    /// @notice Pay a pool's accrued ETH fees to its treasury. Callable by anyone.
    function collectFees(PoolId id) external returns (uint256 amount) {
        amount = pendingFees[id];
        if (amount == 0) return 0;
        pendingFees[id] = 0;
        poolManager.unlock(abi.encode(amount));
        address treasury = pools[id].treasury;
        ILeveredTreasury(treasury).onFees{value: amount}();
        emit FeesCollected(id, treasury, amount);
    }

    /// @notice Pay a pool's accrued cross-chain fees to its treasury, where the coin's share becomes buyback fuel
    ///         instead of portfolio margin. Callable by anyone.
    function collectCrossChainFees(PoolId id) external returns (uint256 amount) {
        amount = pendingCrossChainFees[id];
        if (amount == 0) return 0;
        pendingCrossChainFees[id] = 0;
        poolManager.unlock(abi.encode(amount));
        address treasury = pools[id].treasury;
        ILeveredTreasury(treasury).onCrossChainFees{value: amount}();
        emit CrossChainFeesCollected(id, treasury, amount);
    }

    /// @notice Pay a pool's fees from defend mode to its treasury, where the coin's share becomes buyback fuel.
    ///         Callable by anyone.
    function collectDefendFees(PoolId id) external returns (uint256 amount) {
        amount = pendingDefendFees[id];
        if (amount == 0) return 0;
        pendingDefendFees[id] = 0;
        poolManager.unlock(abi.encode(amount));
        address treasury = pools[id].treasury;
        ILeveredTreasury(treasury).onDefendFees{value: amount}();
        emit DefendFeesCollected(id, treasury, amount);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        uint256 amount = abi.decode(data, (uint256));
        poolManager.burn(address(this), ETH.toId(), amount);
        poolManager.take(ETH, address(this), amount);
        return "";
    }

    function _accrue(PoolId id, uint256 fee, address sender) internal {
        // Mint an ETH claim to this hook; it offsets the delta the hook returns to the PoolManager.
        poolManager.mint(address(this), ETH.toId(), fee);
        address xRouter = ILeveredFactory(factory).crosschainRouter();
        if (xRouter != address(0) && sender == xRouter) {
            pendingCrossChainFees[id] += fee;
            emit CrossChainFeeAccrued(id, fee);
        } else if (block.timestamp < marketState[id].defendUntil) {
            pendingDefendFees[id] += fee;
            emit DefendFeeAccrued(id, fee);
        } else {
            pendingFees[id] += fee;
            emit FeeAccrued(id, fee);
        }
    }

    /// @dev ETH is currency0. The specified currency is the input for exact-in swaps and the output for exact-out.
    function _ethIsSpecified(SwapParams calldata params) internal pure returns (bool) {
        return params.zeroForOne == (params.amountSpecified < 0);
    }

    // ---------------------------------------------------------------- unused callbacks

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
