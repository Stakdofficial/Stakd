// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ILeveredFactory} from "./interfaces/ILevered.sol";
import {LeveredRouter} from "./LeveredRouter.sol";

/// @title StakdBurner
/// @notice Collects the half of every coin's volatility surcharge that is earmarked for official $STAKD, and spends it
///         buying $STAKD on its own pool and burning it.
///
///         The contract is a one-way street on purpose: ETH goes in from coin treasuries, and the only thing that can
///         ever leave is a buy of $STAKD that is burned in the same transaction. There is no owner, no withdrawal and
///         no way to point it at a different token.
contract StakdBurner {
    /// @notice The factory whose keepers may trigger a burn (they set the slippage bound).
    ILeveredFactory public immutable authority;
    /// @notice The router that can trade the $STAKD pool (the factory $STAKD was launched on).
    LeveredRouter public immutable router;
    /// @notice Official $STAKD.
    ERC20Burnable public immutable stakd;

    uint256 public totalEthReceived;
    uint256 public totalEthSpent;
    uint256 public totalBurned;

    event Funded(address indexed from, uint256 amount);
    event Burned(uint256 ethSpent, uint256 tokensBurned);

    error OnlyKeeper();
    error NothingToBurn();

    constructor(ILeveredFactory authority_, LeveredRouter router_, ERC20Burnable stakd_) {
        authority = authority_;
        router = router_;
        stakd = stakd_;
    }

    /// @notice Any coin treasury (or anyone else) can send ETH here to be burned into $STAKD.
    receive() external payable {
        totalEthReceived += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Spend everything held on $STAKD and burn it.
    /// @param minTokensOut Slippage bound for the buy.
    function burn(uint256 minTokensOut) external returns (uint256 burned) {
        if (!authority.isKeeper(msg.sender)) revert OnlyKeeper();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToBurn();

        burned = router.buy{value: amount}(address(stakd), minTokensOut, address(this));
        stakd.burn(burned);

        totalEthSpent += amount;
        totalBurned += burned;
        emit Burned(amount, burned);
    }
}
