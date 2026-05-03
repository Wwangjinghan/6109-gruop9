// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GameLeaderboard.sol";
import "../src/GameItems.sol";
import "../src/ExecutionVerifier.sol";

/// @notice Benchmarks gas consumption for all key operations.
///         Run with --gas-report to get per-function breakdown.
contract Benchmark is Script {
    GameLeaderboard leaderboard;
    GameItems       items;
    ExecutionVerifier verifier;

    uint256 constant ROUNDS = 20;   // number of score submissions to benchmark

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");

        address leaderboardAddr = vm.envAddress("LEADERBOARD");
        address itemsAddr       = vm.envAddress("GAME_ITEMS");
        address verifierAddr    = vm.envAddress("EXEC_VERIFIER");

        leaderboard = GameLeaderboard(leaderboardAddr);
        items       = GameItems(itemsAddr);
        verifier    = ExecutionVerifier(verifierAddr);

        vm.startBroadcast(deployerKey);

        console.log("\n=== Benchmark: Item Minting ===");
        uint256 gasStart = gasleft();
        uint256 itemId = items.createItemType("Bench Sword", GameItems.Rarity.Common, 0);
        console.log("createItemType gas:", gasStart - gasleft());

        address target = vm.addr(0xDEAD);
        gasStart = gasleft();
        items.mint(target, itemId, 1);
        console.log("mint(x1) gas:", gasStart - gasleft());

        gasStart = gasleft();
        items.mint(target, itemId, 100);
        console.log("mint(x100) gas:", gasStart - gasleft());

        console.log("\n=== Benchmark: Score Submissions ===");
        uint256 totalGas;
        for (uint256 i = 0; i < ROUNDS; i++) {
            // Use different private keys to simulate different players
            uint256 playerKey = uint256(keccak256(abi.encodePacked("bench_player", i))) % (2**128);
            vm.stopBroadcast();
            vm.startBroadcast(playerKey);
            uint256 score = (i + 1) * 500;
            gasStart = gasleft();
            leaderboard.submitScore(score);
            uint256 used = gasStart - gasleft();
            totalGas += used;
            if (i < 3 || i == ROUNDS - 1) {
                console.log(string.concat("  round ", vm.toString(i), " gas: ", vm.toString(used)));
            }
        }
        console.log("Average submitScore gas:", totalGas / ROUNDS);

        vm.stopBroadcast();
        vm.startBroadcast(deployerKey);

        console.log("\n=== Benchmark: DA Commitment Posting ===");
        for (uint256 b = 0; b < 3; b++) {
            bytes32 sr  = keccak256(abi.encodePacked("sr", b));
            bytes32 dar = keccak256(abi.encodePacked("da", b));
            gasStart = gasleft();
            verifier.postCommitment(sr, dar);
            console.log(string.concat("  batch ", vm.toString(b + 1), " gas: ", vm.toString(gasStart - gasleft())));
        }

        vm.stopBroadcast();

        console.log("\n=== Benchmark complete ===");
        console.log("L2 RPC: http://127.0.0.1:3050 (chain 271)");
    }
}
