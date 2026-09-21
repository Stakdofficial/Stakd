// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {ILighter} from "./interfaces/IExternal.sol";
import {ILeveredFactory, Leg, MarginConfig} from "./interfaces/ILevered.sol";
import {LeveredToken} from "./LeveredToken.sol";
import {LeveredRouter} from "./LeveredRouter.sol";

/// @title LeveredTreasury
/// @notice Holds one coin's ETH on Robinhood Chain and enforces where it can go:
///         - `marginReserve` (fee income) can only be swapped to USDG on Uniswap v4 and deposited into the operator's
///           Lighter account.
///         - Creator and platform shares can only be paid to the creator and the platform recipient.
///         - Anything else (returned trading profit, as USDG or ETH) can only buy back and burn the coin.
contract LeveredTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ILeveredFactory public immutable factory;
    address public immutable creator;
    uint16 public immutable creatorShareBps;
    uint16 public immutable protocolShareBps;

    LeveredToken public token;
    Leg[] private _legs;

    uint256 public marginReserve; // ETH
    uint256 public creatorOwed; // ETH
    uint256 public protocolOwed; // ETH
    uint256 public totalFeesReceived; // ETH
    uint256 public totalCrossChainFees; // ETH, subset of totalFeesReceived that came via the cross-chain router
    uint256 public totalDefendFees; // ETH, subset of totalFeesReceived charged while the hook's defend mode was on
    uint256 public totalCreatorFees; // ETH, the creator fee on every swap; separate from totalFeesReceived, all to creator
    uint256 public totalMarginDeposited; // ETH sent to Lighter (as USDG)
    uint256 public totalUsdgDeposited;
    uint256 public totalBuybackEth;
    uint256 public totalTokensBurned;

    uint64 public lighterAccountIndex;
    bool public lighterAccountSet;

    event FeesReceived(uint256 total, uint256 toMargin, uint256 toCreator, uint256 toProtocol);
    event CrossChainFeesReceived(uint256 total, uint256 toBurn, uint256 toCreator, uint256 toProtocol);
    event CreatorFeesReceived(uint256 amount);
    event DefendFeesReceived(uint256 total, uint256 toBurn, uint256 toCreator, uint256 toProtocol);
    event MarginDeposited(uint256 eth, uint256 usdg, address indexed lighterAccount);
    event BuybackAndBurn(uint256 ethSpent, uint256 tokensBurned);
    event FeesClaimed(address indexed to, uint256 amount);
    event LighterAccountSet(uint64 accountIndex);

    error OnlyFactory();
    error OnlyHook();
    error OnlyKeeper();
    error AlreadySet();
    error ExceedsReserve();
    error NoProfitToBurn();
    error Paused();
    error MarginCapReached();
    error EthTransferFailed();

    modifier onlyKeeper() {
        if (!factory.isKeeper(msg.sender)) revert OnlyKeeper();
        _;
    }

    constructor(address creator_, uint16 creatorShareBps_, uint16 protocolShareBps_, Leg[] memory legs_) {
        factory = ILeveredFactory(msg.sender);
        creator = creator_;
        creatorShareBps = creatorShareBps_;
        protocolShareBps = protocolShareBps_;
        for (uint256 i; i < legs_.length; ++i) {
            _legs.push(legs_[i]);
        }
    }

    /// @notice Accepts returned profit (as ETH) and router refunds.
    receive() external payable {}

    function initToken(LeveredToken token_) external {
        if (msg.sender != address(factory)) revert OnlyFactory();
        if (address(token) != address(0)) revert AlreadySet();
        token = token_;
    }

    // ---------------------------------------------------------------- views

    function legs() external view returns (Leg[] memory) {
        return _legs;
    }

    /// @notice ETH that is not margin or owed fees: returned profit waiting to be burned.
    function pendingBuyback() public view returns (uint256) {
        uint256 committed = marginReserve + creatorOwed + protocolOwed;
        return address(this).balance > committed ? address(this).balance - committed : 0;
    }

    // ---------------------------------------------------------------- fee income

    /// @notice Called by the pool hook with the coin's ETH trading fees.
    function onFees() external payable {
        if (msg.sender != factory.hook()) revert OnlyHook();
        uint256 amount = msg.value;
        uint256 toCreator = (amount * creatorShareBps) / 10_000;
        uint256 toProtocol = (amount * protocolShareBps) / 10_000;
        uint256 toMargin = amount - toCreator - toProtocol;

        marginReserve += toMargin;
        creatorOwed += toCreator;
        protocolOwed += toProtocol;
        totalFeesReceived += amount;
        emit FeesReceived(amount, toMargin, toCreator, toProtocol);
    }

    /// @notice Called by the pool hook with fees from buys that came through the cross-chain router.
    ///         The trader paid the same fee as anyone else; the only difference is where the coin's share goes:
    ///         straight to buyback & burn instead of the leveraged portfolio. Creator and platform shares are
    ///         unchanged, so nobody's revenue pays for the burn.
    function onCrossChainFees() external payable {
        if (msg.sender != factory.hook()) revert OnlyHook();
        uint256 amount = msg.value;
        uint256 toCreator = (amount * creatorShareBps) / 10_000;
        uint256 toProtocol = (amount * protocolShareBps) / 10_000;
        uint256 toBurn = amount - toCreator - toProtocol;

        creatorOwed += toCreator;
        protocolOwed += toProtocol;
        totalFeesReceived += amount;
        totalCrossChainFees += amount;
        // `toBurn` stays as uncommitted balance, which is exactly what `pendingBuyback()` spends on buy & burn.
        emit CrossChainFeesReceived(amount, toBurn, toCreator, toProtocol);
    }

    /// @notice Called by the pool hook with fees charged while the coin was in defend mode (its price had fallen well
    ///         below its high). Like cross-chain fees, the coin's share goes straight to buyback & burn while the
    ///         creator and platform shares are unchanged.
    function onDefendFees() external payable {
        if (msg.sender != factory.hook()) revert OnlyHook();
        uint256 amount = msg.value;
        uint256 toCreator = (amount * creatorShareBps) / 10_000;
        uint256 toProtocol = (amount * protocolShareBps) / 10_000;
        uint256 toBurn = amount - toCreator - toProtocol;

        creatorOwed += toCreator;
        protocolOwed += toProtocol;
        totalFeesReceived += amount;
        totalDefendFees += amount;
        // Like cross-chain fees, `toBurn` stays uncommitted, so `pendingBuyback()` spends it on buy & burn.
        emit DefendFeesReceived(amount, toBurn, toCreator, toProtocol);
    }

    /// @notice Called by the pool hook with the creator fee charged on every swap. All of it is owed to the creator;
    ///         it never touches the portfolio, the platform share or burns.
    function onCreatorFees() external payable {
        if (msg.sender != factory.hook()) revert OnlyHook();
        creatorOwed += msg.value;
        totalCreatorFees += msg.value;
        emit CreatorFeesReceived(msg.value);
    }

    /// @notice Pay the creator's accrued fee share. Anyone can trigger it; ETH only ever goes to the creator.
    function claimCreatorFees() external nonReentrant {
        uint256 amount = creatorOwed;
        creatorOwed = 0;
        _sendEth(creator, amount);
        emit FeesClaimed(creator, amount);
    }

    /// @notice Pay the platform's accrued fee share to the factory's fee recipient.
    function claimProtocolFees() external nonReentrant {
        uint256 amount = protocolOwed;
        protocolOwed = 0;
        address to = factory.protocolFeeRecipient();
        _sendEth(to, amount);
        emit FeesClaimed(to, amount);
    }

    // ---------------------------------------------------------------- keeper actions

    /// @notice Record which Lighter sub-account trades this coin's basket. Set once.
    function setLighterAccount(uint64 accountIndex) external onlyKeeper {
        if (lighterAccountSet) revert AlreadySet();
        lighterAccountIndex = accountIndex;
        lighterAccountSet = true;
        emit LighterAccountSet(accountIndex);
    }

    /// @notice Swap `ethAmount` of margin to USDG on Uniswap v4 and deposit it into the operator's Lighter account.
    function depositMargin(uint256 ethAmount, uint256 minUsdgOut) external onlyKeeper nonReentrant returns (uint256 usdg) {
        if (factory.paused()) revert Paused();
        if (ethAmount > marginReserve) revert ExceedsReserve();
        if (totalMarginDeposited + ethAmount > factory.marginCapPerCoin()) revert MarginCapReached();
        MarginConfig memory cfg = factory.marginConfig();

        marginReserve -= ethAmount;
        totalMarginDeposited += ethAmount;

        usdg = _router().swap{value: ethAmount}(_marginPool(cfg), true, ethAmount, minUsdgOut, address(this));
        totalUsdgDeposited += usdg;

        IERC20(cfg.usdg).forceApprove(cfg.lighter, usdg);
        ILighter(cfg.lighter).deposit(cfg.lighterAccount, cfg.assetIndex, cfg.routeType, usdg);
        emit MarginDeposited(ethAmount, usdg, cfg.lighterAccount);
    }

    /// @notice Turn returned profit into burned coins: swap any USDG held to ETH on Uniswap v4, then spend all spare
    ///         ETH buying the coin and burn it.
    function buybackAndBurn(uint256 minEthFromUsdg, uint256 minTokensOut) external onlyKeeper nonReentrant returns (uint256 burned) {
        MarginConfig memory cfg = factory.marginConfig();
        LeveredRouter router = _router();
        uint256 usdg = IERC20(cfg.usdg).balanceOf(address(this));
        if (usdg != 0) {
            IERC20(cfg.usdg).forceApprove(address(router), usdg);
            router.swap(_marginPool(cfg), false, usdg, minEthFromUsdg, address(this));
        }

        uint256 amount = pendingBuyback();
        if (amount == 0) revert NoProfitToBurn();

        burned = router.buy{value: amount}(address(token), minTokensOut, address(this));
        token.burn(burned);
        totalBuybackEth += amount;
        totalTokensBurned += burned;
        emit BuybackAndBurn(amount, burned);
    }

    function _router() private view returns (LeveredRouter) {
        return LeveredRouter(payable(factory.router()));
    }

    function _marginPool(MarginConfig memory cfg) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(cfg.usdg),
            fee: cfg.poolFee,
            tickSpacing: cfg.poolTickSpacing,
            hooks: IHooks(cfg.poolHooks)
        });
    }

    function _sendEth(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
