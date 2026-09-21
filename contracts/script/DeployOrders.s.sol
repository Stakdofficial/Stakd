// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {StakdCrossChainRouter} from "../src/StakdCrossChainRouter.sol";
import {StakdOrderFactory} from "../src/StakdOrderFactory.sol";

/// @notice Deploys the order factory that lets a fast bridge buy a coin by sending ETH to an address.
contract DeployOrders is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        StakdCrossChainRouter router = StakdCrossChainRouter(payable(vm.envAddress("ROUTER")));
        vm.startBroadcast(pk);
        StakdOrderFactory orders = new StakdOrderFactory(router);
        vm.stopBroadcast();
        console2.log("StakdOrderFactory", address(orders));
        console2.log("NEXT: router.setTrustedSource(%s, true)", address(orders));
    }
}
