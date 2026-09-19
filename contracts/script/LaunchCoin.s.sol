// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {Leg} from "../src/interfaces/ILevered.sol";

/// @notice Launch LVRD (2x long SPY 40% / BTC 30% / ETH 30%, Lighter Robinhood market ids). No ETH needed.
///         source .env.robinhood && forge script script/LaunchCoin.s.sol --rpc-url $ROBINHOOD_RPC_URL --broadcast
contract LaunchCoin is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        LeveredFactory factory = LeveredFactory(vm.envAddress("LEVERED_FACTORY"));

        Leg[] memory legs = new Leg[](3);
        legs[0] = Leg({marketId: 26, isLong: true, weightBps: 4_000, leverageX10: 20}); // SPY
        legs[1] = Leg({marketId: 1, isLong: true, weightBps: 3_000, leverageX10: 20}); // BTC
        legs[2] = Leg({marketId: 0, isLong: true, weightBps: 3_000, leverageX10: 20}); // ETH

        vm.startBroadcast(pk);
        (uint256 id, address token, address treasury) =
            factory.createCoin(LeveredFactory.CreateParams({name: "Levered", symbol: "LVRD", legs: legs, feeBps: 200}));
        vm.stopBroadcast();

        console2.log("coin id ", id);
        console2.log("LVRD    ", token);
        console2.log("treasury", treasury);
    }
}
