// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {IntentAccountFactory} from "../src/IntentAccountFactory.sol";
import {IntentAccount} from "../src/IntentAccount.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract DeployScript is Script {
    address constant CANONICAL_EP = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address bundler     = vm.envOr("BUNDLER_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        // Deploy EntryPoint locally if not present (Anvil / local devnet)
        IEntryPoint entryPoint;
        if (CANONICAL_EP.code.length > 0) {
            entryPoint = IEntryPoint(CANONICAL_EP);
            console.log("EntryPoint (canonical):", CANONICAL_EP);
        } else {
            entryPoint = new EntryPoint();
            console.log("EntryPoint:            ", address(entryPoint));
        }

        IntentRegistry registry = new IntentRegistry();
        console.log("IntentRegistry:        ", address(registry));

        if (bundler != address(0)) {
            registry.setBundler(bundler, true);
            console.log("Trusted bundler:       ", bundler);
        }

        IntentAccountFactory factory = new IntentAccountFactory(entryPoint);
        console.log("IntentAccountFactory:  ", address(factory));

        AgentRegistry agentRegistry = new AgentRegistry();
        console.log("AgentRegistry:         ", address(agentRegistry));

        address agentAddr = bundler != address(0) ? bundler : deployer;
        IntentAccount account = factory.createAccount(deployer, agentAddr, 0);
        console.log("IntentAccount:         ", address(account));

        vm.stopBroadcast();

        console.log("ENTRY_POINT_ADDRESS=", address(entryPoint));
        console.log("ACCOUNT_ADDRESS=", address(account));
        console.log("REGISTRY_ADDRESS=", address(registry));
        console.log("AGENT_REGISTRY_ADDRESS=", address(agentRegistry));
    }
}
