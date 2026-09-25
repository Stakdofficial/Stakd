// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {ILeveredFactory} from "./interfaces/ILevered.sol";

interface IStartTick {
    function startTick() external view returns (int24);
    function hook() external view returns (address);
}

interface ICreatorFee {
    function CREATOR_FEE_BPS() external view returns (uint16);
}

/// @title StakdLaunchQuoter
/// @notice Prices a creator's buy at launch, before the coin exists. Every coin starts on the same curve — the
///         whole supply as one-sided liquidity from the factory's start tick — so the answer only depends on how
///         much ETH goes in and what fee the coin will charge.
///
///         This lives outside the factory purely for size: the factory is already at the contract size limit.
contract StakdLaunchQuoter {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    int24 public constant MAX_USABLE_TICK = 887_200;

    IStartTick public immutable factory;

    constructor(IStartTick factory_) {
        factory = factory_;
    }

    /// @param ethIn  What the creator would send with the launch.
    /// @param feeBps The coin's own trading fee, which the creator picks; the hook's creator fee is added on top.
    function quoteLaunchBuy(uint256 ethIn, uint16 feeBps) external view returns (uint256 tokensOut) {
        if (ethIn == 0) return 0;
        int24 launchTick = -factory.startTick();
        uint160 sqrtStart = TickMath.getSqrtPriceAtTick(launchTick);
        uint160 sqrtFloor = TickMath.getSqrtPriceAtTick(-MAX_USABLE_TICK);
        uint128 liquidity = uint128(FullMath.mulDiv(TOTAL_SUPPLY - 1e12, FixedPoint96.Q96, sqrtStart - sqrtFloor));

        // The hook takes its fee out of the ETH before the swap, so quote on what actually reaches the pool.
        uint256 total = uint256(ICreatorFee(factory.hook()).CREATOR_FEE_BPS()) + feeBps;
        uint256 intoPool = ethIn - (ethIn * total) / 10_000;

        // Buying the coin with ETH walks the price down through the range: a zero-for-one swap.
        uint160 sqrtAfter = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtStart, liquidity, intoPool, true);
        tokensOut = SqrtPriceMath.getAmount1Delta(sqrtAfter, sqrtStart, liquidity, false);
    }
}
