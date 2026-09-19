// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {Leg} from "../src/interfaces/ILevered.sol";

/// @notice Throwaway end-to-end test coin. NOT Stakd's own token.
///         One leg (ETH perp, 2x long) and the maximum 5% fee so margin accrues as fast as possible.
///         source .env.robinhood && forge script script/LaunchTestCoin.s.sol --rpc-url $ROBINHOOD_RPC_URL --broadcast
contract LaunchTestCoin is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        LeveredFactory factory = LeveredFactory(vm.envAddress("LEVERED_FACTORY"));

        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({marketId: 0, isLong: true, weightBps: 10_000, leverageX10: 20}); // ETH perp, 2x long

        vm.startBroadcast(pk);
        (uint256 id, address token, address treasury) = factory.createCoin(
            LeveredFactory.CreateParams({name: "Stakd Test", symbol: "STKTEST", legs: legs, feeBps: 500})
        );
        vm.stopBroadcast();

        console2.log("coin id ", id);
        console2.log("token   ", token);
        console2.log("treasury", treasury);
    }
}
