// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Leg, MarginConfig} from "./interfaces/ILevered.sol";
import {LeveredToken} from "./LeveredToken.sol";
import {LeveredTreasury} from "./LeveredTreasury.sol";
import {LeveredHook} from "./LeveredHook.sol";

/// @title LeveredFactory
/// @notice Launches a coin, its treasury and a Uniswap v4 ETH/COIN pool on Robinhood Chain. The creator puts in no ETH:
///         the whole supply is added as single-sided liquidity starting at the launch price, owned by this contract
///         with no way to remove it, so it is locked forever.
contract LeveredFactory is Ownable, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant MAX_LEGS = 6;
    uint16 public constant MIN_LEVERAGE_X10 = 10; // 1x
    uint16 public constant MAX_LEVERAGE_X10 = 100; // 10x
    uint16 public constant MIN_FEE_BPS = 100; // 1%
    uint16 public constant MAX_FEE_BPS = 500; // 5%
    /// @notice Creator + platform together may take at most half of every fee; the rest always funds the portfolio.
    uint16 public constant MAX_NON_MARGIN_BPS = 5_000;
    int24 public constant TICK_SPACING = 200;
    int24 public constant MAX_USABLE_TICK = 887_200;
    /// @notice Changing where margin goes takes effect only after this delay, so holders can react.
    uint256 public constant MARGIN_CONFIG_DELAY = 2 days;

    struct CreateParams {
        string name;
        string symbol;
        Leg[] legs;
        uint16 feeBps; // trading fee in ETH on every buy and sell, chosen by the creator: 1%–5%
    }

    struct Coin {
        address token;
        address treasury;
        bytes32 poolId;
        address creator;
        uint64 createdAt;
    }

    IPoolManager public immutable poolManager;

    address public hook;
    address public router;
    /// @notice Buys arriving through this contract pay the same fee, but the coin's share buys back and burns.
    address public crosschainRouter;

    /// @notice Launch price as a tick of ETH-per-token (raw units).
    int24 public startTick;
    uint16 public creatorShareBps;
    uint16 public protocolShareBps;
    address public protocolFeeRecipient;
    uint256 public marginCapPerCoin; // lifetime ETH (wei) a single coin may send to Lighter as margin
    bool public paused; // blocks launches and new margin; trading, fees and buybacks keep working
    bool public launchOpen; // false = only allowlisted creators may launch
    mapping(address => bool) public isKeeper;
    mapping(address => bool) public isLauncher;

    MarginConfig private _marginConfig;
    MarginConfig private _pendingMarginConfig;
    uint256 public pendingMarginConfigEta;
    Coin[] private _coins;
    mapping(address => uint256) public coinIdOf; // token => index + 1
    mapping(address => PoolKey) private _poolKeys;

    event CoinCreated(
        uint256 indexed id,
        address indexed token,
        address indexed creator,
        address treasury,
        bytes32 poolId,
        string name,
        string symbol,
        Leg[] legs
    );
    event PeripheralsSet(address hook, address router);
    event CrosschainRouterSet(address router);
    event KeeperSet(address indexed keeper, bool allowed);
    event MarginConfigSet(MarginConfig config);
    event MarginConfigProposed(MarginConfig config, uint256 eta);
    event MarginConfigCancelled();
    event FeeSharesSet(address protocolRecipient, uint16 creatorShareBps, uint16 protocolShareBps);
    event StartTickSet(int24 tick);
    event MarginCapSet(uint256 amount);
    event PausedSet(bool paused);
    event LaunchOpenSet(bool open);
    event LauncherSet(address indexed launcher, bool allowed);

    error InvalidLegs();
    error InvalidShares();
    error InvalidFee();
    error InvalidTick();
    error EmptyName();
    error LaunchesPaused();
    error NotAllowedToLaunch();
    error NotConfigured();
    error AlreadySet();
    error BadPeripheral();
    error InvalidMarginConfig();
    error NoPendingConfig();
    error TooEarly();
    error OnlyPoolManager();

    constructor(
        address owner_,
        IPoolManager poolManager_,
        address protocolFeeRecipient_,
        uint16 creatorShareBps_,
        uint16 protocolShareBps_,
        int24 startTick_,
        uint256 marginCapPerCoin_,
        MarginConfig memory marginConfig_
    ) Ownable(owner_) {
        if (uint256(creatorShareBps_) + protocolShareBps_ > MAX_NON_MARGIN_BPS) revert InvalidShares();
        _checkStartTick(startTick_);
        _checkMarginConfig(marginConfig_);
        poolManager = poolManager_;
        protocolFeeRecipient = protocolFeeRecipient_;
        creatorShareBps = creatorShareBps_;
        protocolShareBps = protocolShareBps_;
        startTick = startTick_;
        marginCapPerCoin = marginCapPerCoin_;
        _marginConfig = marginConfig_;
        isLauncher[owner_] = true;
        emit MarginConfigSet(marginConfig_);
    }

    // ---------------------------------------------------------------- launch

    function createCoin(CreateParams calldata p) external returns (uint256 id, address token, address treasury) {
        if (hook == address(0)) revert NotConfigured();
        if (paused) revert LaunchesPaused();
        if (!launchOpen && !isLauncher[msg.sender]) revert NotAllowedToLaunch();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert EmptyName();
        if (p.feeBps < MIN_FEE_BPS || p.feeBps > MAX_FEE_BPS) revert InvalidFee();
        _validateLegs(p.legs);

        LeveredTreasury t = new LeveredTreasury(msg.sender, creatorShareBps, protocolShareBps, p.legs);
        LeveredToken tok = new LeveredToken(p.name, p.symbol, TOTAL_SUPPLY);
        t.initToken(tok);
        token = address(tok);
        treasury = address(t);

        // Native ETH (address 0) always sorts first, so the coin is currency1.
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: 0, // the hook charges the fee in ETH; LPs earn nothing because the liquidity is locked
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        LeveredHook(payable(hook)).register(key, treasury, p.feeBps);

        // Pool price is coin per ETH, the inverse of `startTick`. Liquidity covers every higher coin price.
        int24 launchTick = -startTick;
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(launchTick));
        poolManager.unlock(abi.encode(key, launchTick));

        // Rounding leaves dust of the supply behind; burn it so this contract holds nothing.
        uint256 dust = tok.balanceOf(address(this));
        if (dust != 0) tok.burn(dust);

        PoolId poolId = key.toId();
        _poolKeys[token] = key;
        _coins.push(Coin(token, treasury, PoolId.unwrap(poolId), msg.sender, uint64(block.timestamp)));
        id = _coins.length - 1;
        coinIdOf[token] = id + 1;

        emit CoinCreated(id, token, msg.sender, treasury, PoolId.unwrap(poolId), p.name, p.symbol, p.legs);
    }

    /// @dev Adds the single-sided position. There is no function to remove it.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (PoolKey memory key, int24 launchTick) = abi.decode(data, (PoolKey, int24));

        // Leave a little headroom so rounding up inside the pool can never ask for more than the supply.
        uint256 amount = TOTAL_SUPPLY - 1e12;
        int24 tickLower = -MAX_USABLE_TICK;
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(launchTick);
        uint256 liquidity = FullMath.mulDiv(amount, FixedPoint96.Q96, sqrtB - sqrtA);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: launchTick, liquidityDelta: int256(liquidity), salt: 0}),
            ""
        );

        uint256 owed = uint256(int256(-delta.amount1()));
        poolManager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
        return "";
    }

    function _validateLegs(Leg[] calldata legs) internal pure {
        uint256 n = legs.length;
        if (n == 0 || n > MAX_LEGS) revert InvalidLegs();
        uint256 totalWeight;
        for (uint256 i; i < n; ++i) {
            Leg calldata leg = legs[i];
            if (leg.weightBps == 0) revert InvalidLegs();
            if (leg.leverageX10 < MIN_LEVERAGE_X10 || leg.leverageX10 > MAX_LEVERAGE_X10) revert InvalidLegs();
            for (uint256 j; j < i; ++j) {
                if (legs[j].marketId == leg.marketId) revert InvalidLegs();
            }
            totalWeight += leg.weightBps;
        }
        if (totalWeight != 10_000) revert InvalidLegs();
    }

    // ---------------------------------------------------------------- views

    function coinCount() external view returns (uint256) {
        return _coins.length;
    }

    function coin(uint256 id) external view returns (Coin memory) {
        return _coins[id];
    }

    /// @notice Newest-first page of coins.
    function coins(uint256 offset, uint256 limit) external view returns (Coin[] memory page) {
        uint256 n = _coins.length;
        if (offset >= n) return new Coin[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Coin[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = _coins[n - 1 - offset - i];
        }
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        return _poolKeys[token];
    }

    function marginConfig() external view returns (MarginConfig memory) {
        return _marginConfig;
    }

    function pendingMarginConfig() external view returns (MarginConfig memory) {
        return _pendingMarginConfig;
    }

    // ---------------------------------------------------------------- admin

    /// @notice One-time wiring of the hook (deployed at a flag-mined address) and the router.
    function setPeripherals(address hook_, address router_) external onlyOwner {
        if (hook != address(0)) revert AlreadySet();
        LeveredHook h = LeveredHook(payable(hook_));
        if (h.factory() != address(this) || address(h.poolManager()) != address(poolManager)) revert BadPeripheral();
        hook = hook_;
        router = router_;
        emit PeripheralsSet(hook_, router_);
    }

    /// @notice Set the cross-chain router: the one contract whose buys route a coin's fee share to buyback & burn
    ///         instead of its leveraged portfolio. Set once, then fixed forever, like the peripherals.
    function setCrosschainRouter(address router_) external onlyOwner {
        if (crosschainRouter != address(0)) revert AlreadySet();
        if (router_ == address(0)) revert BadPeripheral();
        // Pointing this at the ordinary router would send *every* coin's fees to burns and leave every
        // portfolio unfunded, so refuse it outright rather than trust a careful hand.
        if (router_ == router) revert BadPeripheral();
        crosschainRouter = router_;
        emit CrosschainRouterSet(router_);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    /// @notice Queue a new margin destination. It can be executed after `MARGIN_CONFIG_DELAY`.
    function proposeMarginConfig(MarginConfig calldata config) external onlyOwner {
        _checkMarginConfig(config);
        _pendingMarginConfig = config;
        pendingMarginConfigEta = block.timestamp + MARGIN_CONFIG_DELAY;
        emit MarginConfigProposed(config, pendingMarginConfigEta);
    }

    function executeMarginConfig() external onlyOwner {
        if (pendingMarginConfigEta == 0) revert NoPendingConfig();
        if (block.timestamp < pendingMarginConfigEta) revert TooEarly();
        _marginConfig = _pendingMarginConfig;
        delete _pendingMarginConfig;
        pendingMarginConfigEta = 0;
        emit MarginConfigSet(_marginConfig);
    }

    function cancelMarginConfig() external onlyOwner {
        delete _pendingMarginConfig;
        pendingMarginConfigEta = 0;
        emit MarginConfigCancelled();
    }

    function setStartTick(int24 tick) external onlyOwner {
        _checkStartTick(tick);
        startTick = tick;
        emit StartTickSet(tick);
    }

    function setMarginCapPerCoin(uint256 amount) external onlyOwner {
        marginCapPerCoin = amount;
        emit MarginCapSet(amount);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setLaunchOpen(bool open) external onlyOwner {
        launchOpen = open;
        emit LaunchOpenSet(open);
    }

    function setLauncher(address launcher, bool allowed) external onlyOwner {
        isLauncher[launcher] = allowed;
        emit LauncherSet(launcher, allowed);
    }

    /// @dev Only affects coins created afterwards; existing treasuries keep their shares.
    function setFeeShares(address recipient, uint16 creatorShareBps_, uint16 protocolShareBps_) external onlyOwner {
        if (uint256(creatorShareBps_) + protocolShareBps_ > MAX_NON_MARGIN_BPS) revert InvalidShares();
        protocolFeeRecipient = recipient;
        creatorShareBps = creatorShareBps_;
        protocolShareBps = protocolShareBps_;
        emit FeeSharesSet(recipient, creatorShareBps_, protocolShareBps_);
    }

    function _checkStartTick(int24 tick) internal pure {
        if (tick % TICK_SPACING != 0 || tick <= -MAX_USABLE_TICK || tick >= MAX_USABLE_TICK) revert InvalidTick();
    }

    function _checkMarginConfig(MarginConfig memory config) internal pure {
        if (
            config.lighter == address(0) || config.lighterAccount == address(0) || config.usdg == address(0)
                || config.poolTickSpacing <= 0
        ) revert InvalidMarginConfig();
    }
}
