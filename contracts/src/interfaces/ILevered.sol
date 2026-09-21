// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice One perpetual position in a coin's basket, traded on Lighter.
struct Leg {
    uint16 marketId; // Lighter perp market id on the Robinhood deployment (e.g. SPY = 26, BTC = 1, ETH = 0)
    bool isLong;
    uint16 weightBps; // share of the basket; all legs sum to 10_000
    uint16 leverageX10; // 20 = 2.0x
}

/// @notice Where a treasury's ETH margin goes: swapped to USDG in a Uniswap v4 ETH/USDG pool, deposited into Lighter.
struct MarginConfig {
    address lighter; // zkLighter contract
    address lighterAccount; // L1 address that owns the operator's Lighter account (credited by the deposit)
    uint16 assetIndex; // Lighter asset id of the collateral (USDG = 3)
    uint8 routeType; // 0 = perps
    address usdg; // collateral token; the v4 pool is native ETH (currency0) / USDG (currency1)
    uint24 poolFee; // v4 pool fee (100 = 0.01%)
    int24 poolTickSpacing;
    address poolHooks; // address(0) for a hookless pool
}

interface ILeveredFactory {
    function router() external view returns (address);
    function hook() external view returns (address);
    function crosschainRouter() external view returns (address);
    function isKeeper(address account) external view returns (bool);
    function protocolFeeRecipient() external view returns (address);
    function marginConfig() external view returns (MarginConfig memory);
    function paused() external view returns (bool);
    function marginCapPerCoin() external view returns (uint256);
    function poolKeyOf(address token) external view returns (PoolKey memory);
}

interface ILeveredTreasury {
    function onFees() external payable;
    function onCrossChainFees() external payable;
    function onDefendFees() external payable;
}
