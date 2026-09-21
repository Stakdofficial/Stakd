// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StakdCrossChainRouter} from "./StakdCrossChainRouter.sol";

/// @dev Created and destroyed inside one transaction, purely to hand its balance to whoever created it.
///      Under EIP-6780 a contract destroyed in the same transaction it was created in still forwards its
///      balance, which is exactly the case here.
contract OrderVault {
    constructor() payable {
        selfdestruct(payable(msg.sender));
    }
}

/// @title StakdOrderFactory
/// @notice Lets someone on another chain buy a Stakd coin by doing nothing more than sending ETH to an address.
///
///         Bridges are fast when they simply move value, and slow (or unavailable) when they have to call a
///         contract on arrival. This works with the fast kind: every order gets its own one-time address,
///         derived from the order itself — which coin, who receives it, the slippage floor, the deadline. The
///         buyer bridges to that address, and the arriving ETH is all that is needed to fill the order.
///
///         The address *is* the order. Change any detail and it is a different address, so nobody — including
///         this contract's deployer — can redirect the money or alter the terms after the fact. Filling is
///         permissionless: the keeper normally does it, but the buyer can do it themselves if nobody else does,
///         and after the deadline the ETH can only go back to the refund address.
contract StakdOrderFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    StakdCrossChainRouter public immutable router;

    struct Order {
        address token; // the Stakd coin to buy
        uint256 minTokensOut; // the buyer's slippage floor
        bytes32 to; // recipient: an address on this chain when dstEid is 0, otherwise a far-chain address
        uint32 dstEid; // 0 to deliver here, or the LayerZero id of the chain to bridge on to
        uint256 bridgeFee; // ETH held back to pay for that onward bridge message
        uint256 deadline; // after this, the order can only be refunded
        address refundTo; // where the ETH goes if it is refunded
        bytes32 salt; // lets the same buyer place two otherwise identical orders
    }

    event OrderFilled(bytes32 indexed id, address indexed order, address indexed token, uint256 ethIn, uint256 tokensOut);
    event OrderRefunded(bytes32 indexed id, address indexed order, address indexed refundTo, uint256 amount);

    error NothingToFill();
    error NotExpired();
    error NoRefundAddress();
    error EthTransferFailed();

    constructor(StakdCrossChainRouter router_) {
        router = router_;
    }

    /// @notice The address to bridge to for this exact order. Computable before anything is deployed.
    function orderAddress(Order calldata o) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), _id(o), keccak256(type(OrderVault).creationCode)
            )
        );
        return address(uint160(uint256(hash)));
    }

    /// @notice A short identifier for the order, used as the CREATE2 salt and in events.
    function orderId(Order calldata o) external pure returns (bytes32) {
        return _id(o);
    }

    /// @notice How much ETH is waiting at this order's address.
    function pending(Order calldata o) external view returns (uint256) {
        return orderAddress(o).balance;
    }

    /// @notice Fill the order with whatever ETH has arrived. Anyone may call it: the terms are fixed by the
    ///         address, so the caller cannot change where the coins go or what they cost.
    function fill(Order calldata o) external nonReentrant returns (uint256 tokensOut) {
        uint256 amount = _collect(o);
        if (amount == 0) revert NothingToFill();

        tokensOut = router.buyAndDeliver{value: amount}(
            o.token, o.minTokensOut, o.to, o.dstEid, o.bridgeFee, o.deadline
        );

        // The router refunds anything the pool did not take; send it on to the buyer rather than keep it.
        uint256 left = address(this).balance;
        if (left != 0) _send(o.refundTo == address(0) ? address(uint160(uint256(o.to))) : o.refundTo, left);

        emit OrderFilled(_id(o), orderAddress(o), o.token, amount, tokensOut);
    }

    /// @notice After the deadline, return the ETH. It can only ever go to the order's refund address.
    function refund(Order calldata o) external nonReentrant returns (uint256 amount) {
        if (block.timestamp <= o.deadline) revert NotExpired();
        if (o.refundTo == address(0)) revert NoRefundAddress();

        amount = _collect(o);
        if (amount == 0) revert NothingToFill();
        _send(o.refundTo, amount);

        emit OrderRefunded(_id(o), orderAddress(o), o.refundTo, amount);
    }

    receive() external payable {
        // ETH arrives here only from an OrderVault being destroyed, or as a refund from the router.
    }

    /// @dev Deploys the vault at the order's address, which immediately forwards the ETH held there to us.
    function _collect(Order calldata o) private returns (uint256) {
        address addr = orderAddress(o);
        if (addr.balance == 0) return 0;
        uint256 before = address(this).balance;
        new OrderVault{salt: _id(o)}();
        return address(this).balance - before;
    }

    function _id(Order calldata o) private pure returns (bytes32) {
        return keccak256(
            abi.encode(o.token, o.minTokensOut, o.to, o.dstEid, o.bridgeFee, o.deadline, o.refundTo, o.salt)
        );
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
