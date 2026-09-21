// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredHook} from "../src/LeveredHook.sol";
import {LeveredRouter} from "../src/LeveredRouter.sol";
import {StakdCrossChainRouter} from "../src/StakdCrossChainRouter.sol";
import {MarginConfig, ILeveredFactory} from "../src/interfaces/ILevered.sol";
import {HookMiner} from "./HookMiner.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for USDG, which is not deployed on Robinhood testnet. Only its `balanceOf` is exercised
///         here: the buyback path reads it before spending, and the margin leg itself is covered by the
///         mainnet-fork tests where the real USDG and Lighter exist.
contract TestnetUSDG is ERC20 {
    constructor() ERC20("Test Global Dollar", "tUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @notice The whole Stakd stack plus the cross-chain router, on **Robinhood Chain testnet** (46630), for the
///         pre-mainnet dress rehearsal. USDG and Lighter do not exist on testnet, so the margin leg cannot run
///         here — it is covered by the mainnet-fork tests instead. Everything else is exercised for real.
///
///         source crosschain/stakd-oft/.env && DEPLOYER_PRIVATE_KEY=$PRIVATE_KEY \
///           forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
contract DeployTestnet is Script {
    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;

    function run() external {
        require(block.chainid == 46630, "not Robinhood testnet");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // Lighter has no testnet deployment, so the margin leg cannot run here; USDG needs to be a real contract
        // though, because the buyback path reads its balance before spending.
        TestnetUSDG usdg = new TestnetUSDG();
        MarginConfig memory margin = MarginConfig({
            lighter: deployer,
            lighterAccount: deployer,
            assetIndex: 3,
            routeType: 0,
            usdg: address(usdg),
            poolFee: 100,
            poolTickSpacing: 1,
            poolHooks: address(0)
        });

        LeveredFactory factory =
            new LeveredFactory(deployer, POOL_MANAGER, PLATFORM, 0, 4_000, -200_200, 1 ether, margin);

        bytes memory args = abi.encode(POOL_MANAGER, address(factory));
        bytes32 salt = HookMiner.find(keccak256(abi.encodePacked(type(LeveredHook).creationCode, args)));
        LeveredHook hook = new LeveredHook{salt: salt}(POOL_MANAGER, address(factory));
        LeveredRouter router = new LeveredRouter(POOL_MANAGER, ILeveredFactory(address(factory)));
        StakdCrossChainRouter xRouter =
            new StakdCrossChainRouter(POOL_MANAGER, ILeveredFactory(address(factory)), deployer);

        factory.setPeripherals(address(hook), address(router));
        factory.setCrosschainRouter(address(xRouter));
        factory.setKeeper(deployer, true);
        factory.setLaunchOpen(true);
        // The deployer stands in for the bridge composer during the rehearsal.
        xRouter.setTrustedSource(deployer, true);

        vm.stopBroadcast();

        console2.log("chainId      ", block.chainid);
        console2.log("factory      ", address(factory));
        console2.log("hook         ", address(hook));
        console2.log("router       ", address(router));
        console2.log("xRouter      ", address(xRouter));
        console2.log("testnet USDG ", address(usdg));
    }
}
