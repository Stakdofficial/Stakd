// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ILeveredTreasury} from "./interfaces/ILevered.sol";

/// @title LeveredHook
/// @notice Uniswap v4 hook shared by every Levered pool. Pools pair each coin with native ETH (always currency0),
///         and the hook charges the coin's trading fee in ETH on buys and sells, never in tokens.
/// @dev The fee is taken from the ETH leg: before the swap when ETH is the specified amount, after the swap when it
///      is the unspecified amount. Fees are held as PoolManager ERC-6909 claims (a pool may hold no ETH mid-swap)
///      and paid to the coin's treasury by `collectFees`, which anyone can call.
contract LeveredHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    uint16 public constant MAX_FEE_BPS = 500;
    Currency public constant ETH = CurrencyLibrary.ADDRESS_ZERO;

    struct PoolInfo {
        address treasury;
        uint16 feeBps;
    }

    IPoolManager public immutable poolManager;
    address public immutable factory;

    mapping(PoolId => PoolInfo) public pools;
    mapping(PoolId => uint256) public pendingFees;

    event PoolRegistered(PoolId indexed id, address treasury, uint16 feeBps);
    event FeeAccrued(PoolId indexed id, uint256 amount);
    event FeesCollected(PoolId indexed id, address indexed treasury, uint256 amount);

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

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (_ethIsSpecified(params)) {
            PoolId id = key.toId();
            uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            uint256 fee = (amount * pools[id].feeBps) / 10_000;
            if (fee != 0) {
                _accrue(id, fee);
                return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        if (!_ethIsSpecified(params)) {
            PoolId id = key.toId();
            int128 ethDelta = delta.amount0();
            uint256 amount = ethDelta < 0 ? uint256(int256(-ethDelta)) : uint256(int256(ethDelta));
            uint256 fee = (amount * pools[id].feeBps) / 10_000;
            if (fee != 0) {
                _accrue(id, fee);
                return (IHooks.afterSwap.selector, int128(int256(fee)));
            }
        }
        return (IHooks.afterSwap.selector, 0);
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

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        uint256 amount = abi.decode(data, (uint256));
        poolManager.burn(address(this), ETH.toId(), amount);
        poolManager.take(ETH, address(this), amount);
        return "";
    }

    function _accrue(PoolId id, uint256 fee) internal {
        // Mint an ETH claim to this hook; it offsets the delta the hook returns to the PoolManager.
        poolManager.mint(address(this), ETH.toId(), fee);
        pendingFees[id] += fee;
        emit FeeAccrued(id, fee);
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
