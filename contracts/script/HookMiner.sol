// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @notice Finds a CREATE2 salt that gives the Levered hook an address carrying exactly its permission flags.
library HookMiner {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function flags() internal pure returns (uint160) {
        return Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    }

    function find(bytes32 initCodeHash) internal pure returns (bytes32) {
        uint160 wanted = flags();
        for (uint256 i; i < 1_000_000; ++i) {
            bytes32 salt = bytes32(i);
            address addr = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash)))));
            if (uint160(addr) & Hooks.ALL_HOOK_MASK == wanted) return salt;
        }
        revert("no hook salt found");
    }
}
