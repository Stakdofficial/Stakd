// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {StakdMetadata, ILeveredCoins} from "../src/StakdMetadata.sol";

/// @notice source .env.robinhood && forge script script/DeployMetadata.s.sol --rpc-url $ROBINHOOD_RPC_URL --broadcast
contract DeployMetadata is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address factory = vm.envAddress("LEVERED_FACTORY");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast(pk);
        StakdMetadata md = new StakdMetadata(ILeveredCoins(factory), owner);
        vm.stopBroadcast();

        console2.log("StakdMetadata", address(md));
    }
}
