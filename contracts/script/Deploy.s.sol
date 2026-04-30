// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {IntentAccountFactory} from "../src/IntentAccountFactory.sol";

contract DeployScript is Script {
    // ERC-4337 canonical EntryPoint v0.7 — same address on all EVM chains
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        IntentRegistry registry = new IntentRegistry();
        console.log("IntentRegistry deployed at:", address(registry));

        IntentAccountFactory factory = new IntentAccountFactory(IEntryPoint(ENTRY_POINT));
        console.log("IntentAccountFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
