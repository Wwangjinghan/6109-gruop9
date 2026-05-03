// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {IntentAccountFactory} from "../src/IntentAccountFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract DeployScript is Script {
    // ERC-4337 canonical EntryPoint v0.7 — same address on all EVM chains
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        // Optional: trust a relayer/bundler address at deploy time via BUNDLER_ADDRESS env var
        address bundler = vm.envOr("BUNDLER_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        IntentRegistry registry = new IntentRegistry();
        console.log("IntentRegistry deployed at:", address(registry));

        if (bundler != address(0)) {
            registry.setBundler(bundler, true);
            console.log("Trusted bundler set:", bundler);
        }

        IntentAccountFactory factory = new IntentAccountFactory(IEntryPoint(ENTRY_POINT));
        console.log("IntentAccountFactory deployed at:", address(factory));

        AgentRegistry agentRegistry = new AgentRegistry();
        console.log("AgentRegistry deployed at:      ", address(agentRegistry));

        vm.stopBroadcast();
    }
}
