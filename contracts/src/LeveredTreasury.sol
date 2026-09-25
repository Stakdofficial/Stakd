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
interface IClaimVerifier {
    function isValid(
        address signer,
        address treasury,
        string calldata handle,
        bytes32 subject,
        address payout,
        uint256 deadline,
        bytes calldata proof
    ) external view returns (bool);
}

contract LeveredTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ILeveredFactory public immutable factory;
    /// @notice Who the creator fee belongs to. Zero while a coin's fee is pointed at a social handle nobody has
    ///         claimed yet: the ETH keeps accruing, but there is nowhere to send it until someone proves they are
    ///         that person.
    address public creator;
    /// @notice "x:someone", "github:someone", "discord:someone" — empty when the creator is a plain wallet.
    string public creatorHandle;
    /// @notice The platform's own immutable id for whoever claimed the handle. Usernames change and get recycled;
    ///         this does not. Once set, only this id can ever move the payout address again.
    bytes32 public creatorSubject;
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
    uint256 public totalVolatilityFees; // ETH, subset of totalFeesReceived charged as the volatility surcharge
    uint256 public totalStakdBurnFunded; // ETH, the half of the volatility surcharge sent on to burn official $STAKD
    uint256 public totalMarginDeposited; // ETH sent to Lighter (as USDG)
    uint256 public totalUsdgDeposited;
    uint256 public totalBuybackEth;
    uint256 public totalTokensBurned;

    uint64 public lighterAccountIndex;
    bool public lighterAccountSet;

    event FeesReceived(uint256 total, uint256 toMargin, uint256 toCreator, uint256 toProtocol);
    event CrossChainFeesReceived(uint256 total, uint256 toBurn, uint256 toCreator, uint256 toProtocol);
    event CreatorFeesReceived(uint256 amount);
    event CreatorHandleClaimed(string handle, bytes32 indexed subject, address indexed payout);
    event CreatorPayoutSet(bytes32 indexed subject, address indexed payout);
    event DefendFeesReceived(uint256 total, uint256 toBurn, uint256 toCreator, uint256 toProtocol);
    event VolatilityFeesReceived(uint256 total, uint256 toBurn, uint256 toStakd, uint256 toCreator, uint256 toProtocol);
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
    error NotClaimedYet();
    error WrongAccount();
    error BadProof();
    error ProofExpired();

    modifier onlyKeeper() {
        if (!factory.isKeeper(msg.sender)) revert OnlyKeeper();
        _;
    }

    constructor(
        address factory_,
        address creator_,
        string memory creatorHandle_,
        uint16 creatorShareBps_,
        uint16 protocolShareBps_,
        Leg[] memory legs_
    ) {
        factory = ILeveredFactory(factory_);
        // Pointing the fee at a handle means the launcher keeps none of it, so there is no address yet.
        creatorHandle = creatorHandle_;
        creator = bytes(creatorHandle_).length == 0 ? creator_ : address(0);
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

    /// @notice Called by the pool hook with the volatility surcharge part of the fees. The creator and platform take
    ///         their usual shares, exactly as on any other fee; the coin's share is then split in half: half buys back
    ///         and burns this coin, half is sent on to buy back and burn official $STAKD. This happens whatever mode
    ///         the coin is in, defend mode included.
    function onVolatilityFees() external payable {
        if (msg.sender != factory.hook()) revert OnlyHook();
        uint256 amount = msg.value;
        uint256 toCreator = (amount * creatorShareBps) / 10_000;
        uint256 toProtocol = (amount * protocolShareBps) / 10_000;
        uint256 coinShare = amount - toCreator - toProtocol;
        uint256 toStakd = coinShare / 2;

        creatorOwed += toCreator;
        protocolOwed += toProtocol;
        totalFeesReceived += amount;
        totalVolatilityFees += amount;

        // Until the burner is deployed and wired up, the whole coin share burns this coin instead.
        address burner = factory.stakdBurner();
        if (toStakd != 0 && burner != address(0)) {
            totalStakdBurnFunded += toStakd;
            (bool ok,) = burner.call{value: toStakd}("");
            if (!ok) {
                totalStakdBurnFunded -= toStakd;
                toStakd = 0;
            }
        } else {
            toStakd = 0;
        }
        // Whatever is left over stays as uncommitted balance, which `pendingBuyback()` spends on buy & burn.
        emit VolatilityFeesReceived(amount, coinShare - toStakd, toStakd, toCreator, toProtocol);
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
    ///         While a handle is unclaimed there is no creator, so the fees simply keep waiting.
    function claimCreatorFees() external nonReentrant {
        if (creator == address(0)) revert NotClaimedYet();
        uint256 amount = creatorOwed;
        creatorOwed = 0;
        _sendEth(creator, amount);
        emit FeesClaimed(creator, amount);
    }

    /// @notice Prove you are the handle this coin's fee was pointed at, and name the wallet to be paid.
    /// @param payout   Where the creator fee should go from now on.
    /// @param subject  The platform's immutable id for the account that logged in.
    /// @param deadline When this proof stops being accepted.
    /// @param proof    Signed by the platform's claim signer after it verified the login.
    ///
    ///         The first account to prove the handle keeps it for good: afterwards only that same id can move the
    ///         payout address, so a rename or a recycled username cannot take the fees away.
    function bindCreator(address payout, bytes32 subject, uint256 deadline, bytes calldata proof)
        external
        nonReentrant
    {
        if (bytes(creatorHandle).length == 0) revert AlreadySet(); // a plain-wallet coin has nothing to claim
        if (payout == address(0)) revert BadProof();
        if (block.timestamp > deadline) revert ProofExpired();
        if (creatorSubject != bytes32(0) && subject != creatorSubject) revert WrongAccount();

        bool ok = IClaimVerifier(factory.claimVerifier()).isValid(
            factory.claimSigner(), address(this), creatorHandle, subject, payout, deadline, proof
        );
        if (!ok) revert BadProof();

        if (creatorSubject == bytes32(0)) {
            creatorSubject = subject;
            emit CreatorHandleClaimed(creatorHandle, subject, payout);
        }
        creator = payout;
        emit CreatorPayoutSet(subject, payout);
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
