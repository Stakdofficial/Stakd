// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ILeveredFactory} from "./interfaces/ILevered.sol";

/// @notice Thin wrapper around a coin's LayerZero OFT adapter. Keeps LayerZero's plumbing out of the router.
interface IStakdBridgeAdapter {
    /// @notice Lock `amount` of `token` here and mint it to `to` on the chain identified by `dstEid`.
    function sendTokens(address token, uint256 amount, bytes32 to, uint32 dstEid) external payable;
}

/// @title StakdCrossChainRouter
/// @notice The one contract that buys a Stakd coin on behalf of a buyer arriving from another chain.
///
///         Why it exists: the coin's hook charges the *same* fee no matter where a buy comes from, but it routes
///         that fee differently depending on which contract made the swap. Buys through this router send the
///         coin's share to buyback & burn instead of its leveraged portfolio, while the creator and platform
///         shares are untouched. So the trader never pays twice, and nobody's revenue subsidises the burn.
///
///         Flow: a buyer on Solana pays in SOL -> the bridge swaps and delivers ETH here with a message ->
///         `buyAndDeliver` spends that ETH in the coin's Uniswap v4 pool -> the coins are bridged on to the
///         buyer's wallet on the far chain (or delivered here if no bridge adapter is configured yet).
///
///         Only bridge contracts the owner has trusted may call it, so ordinary same-chain buys cannot opt
///         themselves out of funding the portfolio.
contract StakdCrossChainRouter is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    ILeveredFactory public immutable factory;

    /// @notice Bridge endpoints allowed to route buys (e.g. the LayerZero composer that delivers the ETH).
    mapping(address source => bool trusted) public isTrustedSource;
    /// @notice Per-coin bridge adapter used to forward the bought coins to the far chain.
    mapping(address token => address adapter) public adapterOf;
    /// @dev Adapters refund unused bridge fees, so they are allowed to send ETH here. Counted, because one
    ///      adapter may serve several coins and must stay allowed until the last of them stops using it.
    mapping(address adapter => uint256 coinsUsing) public adapterUses;

    struct SwapData {
        PoolKey key;
        uint256 amountIn;
        address to;
    }

    event TrustedSourceSet(address indexed source, bool trusted);
    event AdapterSet(address indexed token, address indexed adapter);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event CrossChainBuy(
        address indexed token, uint256 ethIn, uint256 tokensOut, uint32 dstEid, bytes32 indexed to, address indexed source
    );

    error OnlyPoolManager();
    error UntrustedSource();
    error UnknownCoin();
    error NoAdapter();
    error BadRecipient();
    error Expired();
    error InsufficientOutput(uint256 out, uint256 minOut);
    error BadValue();
    error EthTransferFailed();

    constructor(IPoolManager poolManager_, ILeveredFactory factory_, address owner_) Ownable(owner_) {
        poolManager = poolManager_;
        factory = factory_;
    }

    receive() external payable {
        // The PoolManager pays out swap proceeds; adapters refund whatever the bridge message did not cost.
        if (msg.sender != address(poolManager) && adapterUses[msg.sender] == 0) revert OnlyPoolManager();
    }

    // ---------------------------------------------------------------- admin

    function setTrustedSource(address source, bool trusted) external onlyOwner {
        isTrustedSource[source] = trusted;
        emit TrustedSourceSet(source, trusted);
    }

    function setAdapter(address token, address adapter) external onlyOwner {
        address old = adapterOf[token];
        if (old == adapter) return;
        if (old != address(0)) adapterUses[old] -= 1;
        adapterOf[token] = adapter;
        if (adapter != address(0)) adapterUses[adapter] += 1;
        emit AdapterSet(token, adapter);
    }

    /// @notice Recover coins sent here by mistake. Cannot touch ETH, and cannot take coins mid-buy, because
    ///         every buy ends with this contract empty.
    function sweep(address token, address to) external onlyOwner {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount != 0) IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    // ---------------------------------------------------------------- the cross-chain buy

    /// @notice Buy `token` with the ETH sent here and deliver it to `to` on chain `dstEid`.
    /// @param minTokensOut the buyer's slippage floor. A cross-chain message can arrive minutes after it was
    ///        sent, and these pools are thin, so passing 0 hands the buyer to whoever is watching. The bridge
    ///        must carry the buyer's own figure.
    /// @param deadline after this timestamp the buy is refused rather than filled at a stale price; the bridge's
    ///        refund path then returns the buyer's funds. Pass 0 only when the caller accepts any delay.
    /// @param bridgeFee ETH held back from the buy to pay the onward bridge message; the rest is spent on the coin.
    /// @dev Reverts as a whole if anything fails, so the bridge's own refund path returns the buyer's funds.
    function buyAndDeliver(
        address token,
        uint256 minTokensOut,
        bytes32 to,
        uint32 dstEid,
        uint256 bridgeFee,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 tokensOut) {
        if (!isTrustedSource[msg.sender]) revert UntrustedSource();
        if (deadline != 0 && block.timestamp > deadline) revert Expired();
        if (bridgeFee > msg.value) revert BadValue();

        PoolKey memory key = factory.poolKeyOf(token);
        if (address(key.hooks) == address(0)) revert UnknownCoin();

        uint256 ethIn = msg.value - bridgeFee;
        if (ethIn == 0) revert BadValue();

        // This contract is the one calling the PoolManager, which is how the hook recognises a cross-chain buy.
        uint256 paid;
        (paid, tokensOut) = abi.decode(
            poolManager.unlock(abi.encode(SwapData(key, ethIn, address(this)))), (uint256, uint256)
        );
        if (tokensOut < minTokensOut) revert InsufficientOutput(tokensOut, minTokensOut);

        if (dstEid == 0) {
            // Deliver on this chain. The recipient must therefore be an address on this chain: a far-chain
            // address would not fit in 20 bytes and must never be silently truncated.
            if (uint256(to) >> 160 != 0) revert BadRecipient();
            if (bridgeFee != 0) _sendEth(msg.sender, bridgeFee);
            IERC20(token).safeTransfer(address(uint160(uint256(to))), tokensOut);
        } else {
            address adapter = adapterOf[token];
            if (adapter == address(0)) revert NoAdapter();
            IERC20(token).forceApprove(adapter, tokensOut);
            IStakdBridgeAdapter(adapter).sendTokens{value: bridgeFee}(token, tokensOut, to, dstEid);
            // Leave no standing allowance behind.
            IERC20(token).forceApprove(adapter, 0);
            // Bridges cannot carry amounts below their own precision (a millionth of a coin at 6 shared
            // decimals). That remainder is the buyer's, but it cannot follow them to the far chain, so it is
            // parked with the owner to be returned or donated rather than left to rot behind an allowance.
            uint256 leftover = IERC20(token).balanceOf(address(this));
            if (leftover != 0) IERC20(token).safeTransfer(owner(), leftover);
        }

        // Refund every wei that was not spent: unused swap input plus any bridge fee the adapter handed back.
        uint256 dust = address(this).balance;
        if (dust != 0) _sendEth(msg.sender, dust);

        emit CrossChainBuy(token, paid, tokensOut, dstEid, to, msg.sender);
    }

    // ---------------------------------------------------------------- v4 plumbing

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        SwapData memory s = abi.decode(data, (SwapData));

        BalanceDelta delta = poolManager.swap(
            s.key,
            SwapParams({
                zeroForOne: true, // ETH (currency0) in, coin out
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        uint256 paid = uint256(int256(-delta.amount0()));
        uint256 received = uint256(int256(delta.amount1()));

        poolManager.settle{value: paid}();
        poolManager.take(s.key.currency1, s.to, received);
        return abi.encode(paid, received);
    }

    function _sendEth(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
