// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ILeveredFactory} from "./interfaces/ILevered.sol";

/// @title LeveredRouter
/// @notice Minimal exact-input swaps on Uniswap v4. `buy`/`sell` trade a Levered coin against native ETH;
///         `swap` trades any v4 pool (treasuries use it for ETH ⇄ USDG margin).
contract LeveredRouter is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    ILeveredFactory public immutable factory;

    struct SwapData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        address to;
    }

    error OnlyPoolManager();
    error InsufficientOutput(uint256 out, uint256 minOut);
    error UnknownCoin();
    error BadValue();
    error EthTransferFailed();

    constructor(IPoolManager poolManager_, ILeveredFactory factory_) {
        poolManager = poolManager_;
        factory = factory_;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
    }

    /// @notice Spend all `msg.value` ETH on `token`.
    function buy(address token, uint256 minTokensOut, address to) external payable returns (uint256) {
        PoolKey memory key = factory.poolKeyOf(token);
        if (address(key.hooks) == address(0)) revert UnknownCoin();
        return _swap(key, true, msg.value, minTokensOut, to);
    }

    /// @notice Sell `tokensIn` of `token` for ETH.
    function sell(address token, uint256 tokensIn, uint256 minEthOut, address to) external returns (uint256) {
        PoolKey memory key = factory.poolKeyOf(token);
        if (address(key.hooks) == address(0)) revert UnknownCoin();
        return _swap(key, false, tokensIn, minEthOut, to);
    }

    /// @notice Exact-input swap on any v4 pool. Send ETH as `msg.value` when the input is native ETH.
    function swap(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        returns (uint256)
    {
        return _swap(key, zeroForOne, amountIn, minOut, to);
    }

    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint256 minOut, address to)
        internal
        returns (uint256 received)
    {
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        if (input.isAddressZero()) {
            if (msg.value != amountIn) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(Currency.unwrap(input)).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        uint256 paid;
        (paid, received) = abi.decode(poolManager.unlock(abi.encode(SwapData(key, zeroForOne, amountIn, to))), (uint256, uint256));
        if (received < minOut) revert InsufficientOutput(received, minOut);

        if (paid < amountIn) {
            if (input.isAddressZero()) _sendEth(msg.sender, amountIn - paid);
            else IERC20(Currency.unwrap(input)).safeTransfer(msg.sender, amountIn - paid);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        SwapData memory s = abi.decode(data, (SwapData));

        BalanceDelta delta = poolManager.swap(
            s.key,
            SwapParams({
                zeroForOne: s.zeroForOne,
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: s.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        (int128 inDelta, int128 outDelta) = s.zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        (Currency input, Currency output) = s.zeroForOne ? (s.key.currency0, s.key.currency1) : (s.key.currency1, s.key.currency0);
        uint256 paid = uint256(int256(-inDelta));
        uint256 received = uint256(int256(outDelta));

        if (input.isAddressZero()) {
            poolManager.settle{value: paid}();
        } else {
            poolManager.sync(input);
            IERC20(Currency.unwrap(input)).safeTransfer(address(poolManager), paid);
            poolManager.settle();
        }
        poolManager.take(output, s.to, received);
        return abi.encode(paid, received);
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
