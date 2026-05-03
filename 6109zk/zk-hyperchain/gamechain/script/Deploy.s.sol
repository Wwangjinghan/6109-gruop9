// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GameLeaderboard.sol";
import "../src/GameItems.sol";
import "../src/ExecutionVerifier.sol";

/// @notice Deploys all three core contracts to the ZK Stack L2.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        GameLeaderboard leaderboard = new GameLeaderboard("ZK Appchain Arena");
        console.log("GameLeaderboard :", address(leaderboard));

        GameItems items = new GameItems();
        console.log("GameItems        :", address(items));

        ExecutionVerifier verifier = new ExecutionVerifier(deployer);
        console.log("ExecutionVerifier:", address(verifier));

        vm.stopBroadcast();

        // Write addresses to file for other scripts
        string memory out = string.concat(
            "LEADERBOARD=",  vm.toString(address(leaderboard)),  "\n",
            "GAME_ITEMS=",   vm.toString(address(items)),         "\n",
            "EXEC_VERIFIER=",vm.toString(address(verifier)),      "\n"
        );
        vm.writeFile(".env.contracts", out);
        console.log("\nAddresses written to .env.contracts");
    }
}
