// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {MarginConfig, ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice Deploy Levered on Robinhood Chain (4663).
///         source .env.robinhood && forge script script/Deploy.s.sol --rpc-url $ROBINHOOD_RPC_URL --broadcast
contract Deploy is Script {
    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant LIGHTER = 0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d;
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address owner = vm.envOr("OWNER", deployer);
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address platform = vm.envOr("PROTOCOL_FEE_RECIPIENT", PLATFORM);
        uint16 creatorShareBps = uint16(vm.envOr("CREATOR_SHARE_BPS", uint256(0)));
        uint16 protocolShareBps = uint16(vm.envOr("PROTOCOL_SHARE_BPS", uint256(4_000))); // 40% platform; 60% funds the portfolio
        int24 startTick = int24(vm.envOr("START_TICK", int256(-200_200))); // ~$5k launch market cap at ETH ≈ $2,470
        uint256 marginCap = vm.envOr("MARGIN_CAP_PER_COIN", uint256(1 ether));

        MarginConfig memory margin = MarginConfig({
            lighter: LIGHTER,
            lighterAccount: vm.envOr("LIGHTER_ACCOUNT", keeper), // L1 wallet that owns the operator's Lighter account
            assetIndex: 3, // USDG
            routeType: 0, // perps
            usdg: USDG,
            poolFee: 100, // hookless v4 ETH/USDG 0.01% pool, the deepest on Robinhood Chain
            poolTickSpacing: 1,
            poolHooks: address(0)
        });

        vm.startBroadcast(pk);
        LeveredFactory factory =
            new LeveredFactory(deployer, POOL_MANAGER, platform, creatorShareBps, protocolShareBps, startTick, marginCap, margin);
        bytes memory args = abi.encode(POOL_MANAGER, address(factory));
        bytes32 salt = HookMiner.find(keccak256(abi.encodePacked(type(LeveredHook).creationCode, args)));
        LeveredHook hook = new LeveredHook{salt: salt}(POOL_MANAGER, address(factory));
        LeveredRouter router = new LeveredRouter(POOL_MANAGER, ILeveredFactory(address(factory)));

        factory.setPeripherals(address(hook), address(router));
        factory.setKeeper(keeper, true);
        if (vm.envOr("LAUNCH_OPEN", true)) factory.setLaunchOpen(true);
        if (owner != deployer) {
            factory.setLauncher(owner, true);
            factory.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("chainId       ", block.chainid);
        console2.log("LeveredFactory", address(factory));
        console2.log("LeveredHook   ", address(hook));
        console2.log("LeveredRouter ", address(router));
        console2.log("platform      ", platform);
        console2.log("lighter acct  ", margin.lighterAccount);
    }
}
