// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {RateLimiter} from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import {SendParam, MessagingFee, MessagingReceipt, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {IStakdBridgeAdapter} from "./StakdCrossChainRouter.sol";

/// @title StakdOFTAdapter
/// @notice The lockbox that lets one Stakd coin exist on another chain without changing its supply.
///
///         Coins sent across are **locked here**, and the same number is minted on the far chain; coins coming
///         back are burned there and unlocked here. So the two chains always share one total supply, which is
///         what makes a burn on either side a real reduction.
///
///         The coin itself is untouched: no new mint function, no change to its fee, its pool or its portfolio.
///         This contract only ever holds coins that someone deliberately bridged.
///
///         Per-chain rate limits cap how much can cross in a rolling window. Outbound and inbound have
///         **separate** budgets, so a burst of departures cannot block people bringing coins home. The limits
///         fail closed: until the owner sets one for a chain, nothing crosses in that direction, so a freshly
///         deployed adapter cannot move a coin by accident.
///
///         What the limits DO bound: a bug, a broken verifier, or a hostile far-chain peer — the damage is one
///         window's worth, not the whole lockbox.
///         What they DO NOT bound: this contract's own owner. The owner is also the LayerZero delegate, so it
///         can raise a limit, add a peer and configure the verifier, and then unlock everything here. That is
///         inherent to every OFT adapter, not something this code adds — which is exactly why ownership must be
///         a multisig (ideally timelocked) before a single real coin is bridged.
contract StakdOFTAdapter is OFTAdapter, RateLimiter, IStakdBridgeAdapter {
    using SafeERC20 for IERC20;

    /// @notice Inbound budget, kept separate from LayerZero's outbound `rateLimits` so that coins leaving cannot
    ///         starve coins coming home. Same decay shape as LayerZero's limiter.
    struct InboundLimit {
        uint256 amountInFlight;
        uint256 lastUpdated;
        uint256 limit;
        uint256 window;
    }

    mapping(uint32 srcEid => InboundLimit) public inboundLimits;

    error WrongToken();
    error InboundRateLimitExceeded();
    error NoEnforcedOptions();
    error BadCreditRecipient();
    error InsufficientBridgeFee(uint256 sent, uint256 required);
    error EthTransferFailed();

    event BridgedOut(address indexed by, uint32 indexed dstEid, bytes32 indexed to, uint256 amount, uint256 fee);
    event InboundRateLimitSet(uint32 indexed srcEid, uint256 limit, uint256 window);

    /// @notice Cap how much of this coin may LEAVE to each chain per window. Owner only.
    function setRateLimits(RateLimitConfig[] calldata configs) external onlyOwner {
        _setRateLimits(configs);
    }

    /// @notice Cap how much may ARRIVE from each chain per window, on its own budget. Owner only.
    function setInboundRateLimit(uint32 srcEid, uint256 limit, uint256 window) external onlyOwner {
        InboundLimit storage l = inboundLimits[srcEid];
        (l.limit, l.window, l.amountInFlight, l.lastUpdated) = (limit, window, 0, block.timestamp);
        emit InboundRateLimitSet(srcEid, limit, window);
    }

    /// @notice What can still arrive from `srcEid` in this window.
    function inboundCapacity(uint32 srcEid) public view returns (uint256) {
        InboundLimit storage l = inboundLimits[srcEid];
        uint256 elapsed = block.timestamp - l.lastUpdated;
        uint256 inFlight =
            elapsed >= l.window ? 0 : l.amountInFlight - (l.amountInFlight * elapsed) / l.window;
        return l.limit > inFlight ? l.limit - inFlight : 0;
    }

    /// @param token_ the Stakd coin this adapter bridges
    /// @param lzEndpoint_ LayerZero's EndpointV2 on this chain
    /// @param delegate_ the address allowed to configure this OApp in the endpoint (peers, DVNs, rate limits)
    constructor(address token_, address lzEndpoint_, address delegate_)
        OFTAdapter(token_, lzEndpoint_, delegate_)
        Ownable(delegate_)
    {}

    /// @notice Quote what the onward LayerZero message costs, in native ETH.
    function quoteBridge(uint256 amount, bytes32 to, uint32 dstEid) public view returns (uint256 nativeFee) {
        return this.quoteSend(_param(amount, to, dstEid), false).nativeFee;
    }

    /// @inheritdoc IStakdBridgeAdapter
    /// @dev Called by `StakdCrossChainRouter` right after it bought the coins. The caller must have approved
    ///      this contract for `amount`. Any ETH sent beyond the LayerZero fee is returned to the caller.
    function sendTokens(address token_, uint256 amount, bytes32 to, uint32 dstEid) external payable override {
        if (token_ != address(innerToken)) revert WrongToken();

        // Without execution options nobody pays to deliver the message: the coins would lock here and never
        // appear on the far chain, and the quote would look almost free. Refuse rather than strand them.
        if (enforcedOptions[dstEid][SEND].length == 0) revert NoEnforcedOptions();

        // Check the message is affordable before touching anyone's coins.
        SendParam memory param = _param(amount, to, dstEid);
        uint256 nativeFee = this.quoteSend(param, false).nativeFee;
        if (msg.value < nativeFee) revert InsufficientBridgeFee(msg.value, nativeFee);

        // Then take custody, so the amount locked here is exactly what is minted on the far chain.
        innerToken.safeTransferFrom(msg.sender, address(this), param.amountLD);

        // Self-call so `_debit` sees `_from == address(this)` and skips a second transfer (see the override below).
        this.send{value: nativeFee}(param, MessagingFee(nativeFee, 0), msg.sender);

        uint256 refund = msg.value - nativeFee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert EthTransferFailed();
        }

        emit BridgedOut(msg.sender, dstEid, to, amount, nativeFee);
    }

    /// @dev Identical to LayerZero's adapter, except that coins already held by this contract are not pulled
    ///      again. That only applies to the self-call in `sendTokens`, where custody was taken one step earlier;
    ///      every other caller still has its coins transferred in, exactly as the standard adapter does.
    function _debit(address _from, uint256 _amountLD, uint256 _minAmountLD, uint32 _dstEid)
        internal
        virtual
        override
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        (amountSentLD, amountReceivedLD) = _debitView(_amountLD, _minAmountLD, _dstEid);
        _outflow(_dstEid, amountSentLD); // reverts if this window's cap is used up
        if (_from != address(this)) {
            innerToken.safeTransferFrom(_from, address(this), amountSentLD);
        }
    }

    /// @dev Coins arriving from the far chain draw on their own budget, so a break on that side cannot empty the
    ///      lockbox in one go, and heavy outbound traffic cannot block redemptions.
    function _credit(address _to, uint256 _amountLD, uint32 _srcEid)
        internal
        virtual
        override
        returns (uint256 amountReceivedLD)
    {
        // Coins credited to this contract would be burned on the far chain and stuck here forever, and would
        // silently back someone else's redemption. Refuse; the message can be retried with a real recipient.
        if (_to == address(this)) revert BadCreditRecipient();

        InboundLimit storage l = inboundLimits[_srcEid];
        uint256 elapsed = block.timestamp - l.lastUpdated;
        uint256 inFlight =
            elapsed >= l.window ? 0 : l.amountInFlight - (l.amountInFlight * elapsed) / l.window;
        if (inFlight + _amountLD > l.limit) revert InboundRateLimitExceeded();
        (l.amountInFlight, l.lastUpdated) = (inFlight + _amountLD, block.timestamp);

        return super._credit(_to, _amountLD, _srcEid);
    }

    function _param(uint256 amount, bytes32 to, uint32 dstEid) internal view returns (SendParam memory) {
        // Dust below the shared-decimals precision cannot cross; sending the rounded amount keeps
        // "what left here" and "what arrives there" equal, so the two chains never disagree on supply.
        uint256 amountLD = _removeDust(amount);
        return SendParam({
            dstEid: dstEid,
            to: to,
            amountLD: amountLD,
            minAmountLD: amountLD,
            extraOptions: "", // execution options come from the enforced options set on this OApp
            composeMsg: "",
            oftCmd: ""
        });
    }
}
