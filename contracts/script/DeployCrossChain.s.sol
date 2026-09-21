// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {StakdCrossChainRouter} from "../src/StakdCrossChainRouter.sol";
import {StakdOFTAdapter} from "../src/StakdOFTAdapter.sol";
import {ILeveredFactory} from "../src/interfaces/ILevered.sol";

/// @notice Deploy the cross-chain pieces: the router that buys on behalf of far-chain buyers, and optionally an
///         OFT adapter (lockbox) for one coin so it can exist on another chain without changing its supply.
///
///         source .env.robinhood && forge script script/DeployCrossChain.s.sol --rpc-url $ROBINHOOD_RPC_URL --broadcast
///
///         Env:
///           FACTORY              the Stakd factory whose coins this router serves
///           LZ_ENDPOINT          LayerZero EndpointV2 on this chain (Robinhood mainnet: 0x6F475...; see docs)
///           COIN                 optional: deploy an adapter for this coin
///           TRUSTED_SOURCE       optional: the bridge/composer address allowed to route buys
///
///         After deploying, and BEFORE any real value moves:
///           1. factory.setCrosschainRouter(router)   — one-time, then fixed forever
///           2. router.setTrustedSource(bridge, true) — only real bridges may route buys
///           3. adapter.setPeer(dstEid, solanaOftStore)
///           4. adapter.setEnforcedOptions(...) and set inbound/outbound RATE LIMITS
///           5. audit before step 1 on mainnet
contract DeployCrossChain is Script {
    /// @dev The Stakd platform wallet — the same address the coins' 40% fee share is paid to.
    address constant PLATFORM = 0x2DD3f57B811aB39832F202Af27367B1B04fE27b2;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        // Both the router and the adapter are owned by the platform wallet, not the deploying key.
        address owner = vm.envOr("OWNER", PLATFORM);

        LeveredFactory factory = LeveredFactory(vm.envAddress("FACTORY"));
        IPoolManager poolManager = IPoolManager(address(factory.poolManager()));

        vm.startBroadcast(pk);

        // Reuse an existing router when one is given: `factory.setCrosschainRouter` is one-time, so a second
        // router deployed by accident could never be wired in anyway.
        address existing = vm.envOr("ROUTER", address(0));
        StakdCrossChainRouter router = existing != address(0)
            ? StakdCrossChainRouter(payable(existing))
            : new StakdCrossChainRouter(poolManager, ILeveredFactory(address(factory)), owner);
        console2.log("StakdCrossChainRouter", address(router));
        console2.log("  owner", owner);
        console2.log("  reused", existing != address(0));

        address trusted = vm.envOr("TRUSTED_SOURCE", address(0));
        if (trusted != address(0) && owner == deployer) {
            router.setTrustedSource(trusted, true);
            console2.log("trusted source set", trusted);
        }

        address coin = vm.envOr("COIN", address(0));
        if (coin != address(0)) {
            address endpoint = vm.envAddress("LZ_ENDPOINT");
            StakdOFTAdapter adapter = new StakdOFTAdapter(coin, endpoint, owner);
            console2.log("StakdOFTAdapter", address(adapter));
            console2.log("  for coin", coin);
            if (owner == deployer) {
                router.setAdapter(coin, address(adapter));
                console2.log("  wired into the router");
            }
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("NEXT, in order:");
        console2.log("  factory.setCrosschainRouter(%s)  <-- one-time, irreversible", address(router));
        console2.log("  adapter.setPeer(dstEid, solanaOftStore)");
        console2.log("  adapter.setRateLimits(...)  <-- REQUIRED: nothing can bridge until this is set");
        console2.log("  adapter.setEnforcedOptions(...)");
        console2.log("  audit before any of this touches a live coin");
        console2.log("");
        console2.log("OWNERSHIP: both contracts are owned by %s", owner);
        console2.log("  Whoever holds that key can re-point the adapter's peer, and a hostile peer can");
        console2.log("  unlock everything in the lockbox. Use a multisig before real coins are bridged.");
    }
}
