// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Lighter's zkLighter contract on Robinhood Chain (0x94bA…FfF9d). USDG (asset 3) is perp collateral.
interface ILighter {
    function deposit(address to, uint16 assetIndex, uint8 routeType, uint256 amount) external payable;
}
