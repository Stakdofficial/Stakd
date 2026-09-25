// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Leg} from "./interfaces/ILevered.sol";
import {LeveredTreasury} from "./LeveredTreasury.sol";

/// @title StakdTreasuryDeployer
/// @notice Deploys a coin's treasury on the factory's behalf.
///
///         A contract that writes `new LeveredTreasury(...)` carries the whole treasury's creation code inside
///         itself. Holding that in the factory took it past the 24KB contract size limit, so the one line that
///         creates a treasury lives here instead. Anyone may call this; a treasury only means anything once the
///         factory has registered it against a coin.
contract StakdTreasuryDeployer {
    function deploy(
        address factory,
        address creator,
        string calldata creatorHandle,
        uint16 creatorShareBps,
        uint16 protocolShareBps,
        Leg[] calldata legs
    ) external returns (address) {
        return address(new LeveredTreasury(factory, creator, creatorHandle, creatorShareBps, protocolShareBps, legs));
    }
}
