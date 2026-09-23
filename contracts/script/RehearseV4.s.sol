// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {StakdBurner} from "../src/StakdBurner.sol";
import {ILeveredFactory, Leg} from "../src/interfaces/ILevered.sol";

/// @notice Testnet rehearsal for the v4 volatility split: launch a stand-in $STAKD, wire the burner to it, and
///         launch a coin to trade against.
///         source crosschain/stakd-oft/.env && DEPLOYER_PRIVATE_KEY=$PRIVATE_KEY FACTORY=0x… \
///           forge script script/RehearseV4.s.sol --tc RehearseV4 --rpc-url $RPC_URL_ROBINHOOD_TESTNET --broadcast
contract RehearseV4 is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        LeveredFactory factory = LeveredFactory(payable(vm.envAddress("FACTORY")));

        Leg[] memory legs = new Leg[](3);
        legs[0] = Leg({marketId: 26, isLong: true, weightBps: 4_000, leverageX10: 20});
        legs[1] = Leg({marketId: 1, isLong: true, weightBps: 3_000, leverageX10: 20});
        legs[2] = Leg({marketId: 0, isLong: true, weightBps: 3_000, leverageX10: 20});

        vm.startBroadcast(pk);

        // A stand-in for official $STAKD, on this same factory so the burner has a router that can trade it.
        // Skipped once the factory already points at a burner, so this script can be re-run for more coins.
        address stakd = factory.stakdBurner();
        StakdBurner burner = StakdBurner(payable(stakd));
        if (stakd == address(0)) {
            (, address stakdToken,) = factory.createCoin(
                LeveredFactory.CreateParams({name: "Stakd Testnet", symbol: "STAKD", legs: legs, feeBps: 200})
            );
            burner = new StakdBurner(
                ILeveredFactory(address(factory)), LeveredRouter(payable(factory.router())), ERC20Burnable(stakdToken)
            );
            factory.setStakdBurner(address(burner));
            stakd = stakdToken;
        }

        // The coin we will actually trade to make the volatility fee fire.
        (, address coin, address treasury) = factory.createCoin(
            LeveredFactory.CreateParams({name: "Volatile Test", symbol: vm.envOr("SYMBOL", string("VOLT")), legs: legs, feeBps: 200})
        );

        vm.stopBroadcast();

        console2.log("stakd stand-in", stakd);
        console2.log("burner        ", address(burner));
        console2.log("coin          ", coin);
        console2.log("treasury      ", treasury);
    }
}
