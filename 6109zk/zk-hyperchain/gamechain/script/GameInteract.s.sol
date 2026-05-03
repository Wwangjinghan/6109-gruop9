// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/GameLeaderboard.sol";
import "../src/GameItems.sol";
import "../src/ExecutionVerifier.sol";

/// @notice Simulates a full gaming session on the appchain:
///   1. Create item types (Sword, Shield, Legendary Gem)
///   2. Mint items to players
///   3. Submit scores to leaderboard
///   4. Post execution commitment to DA verifier
///   5. Print final state
contract GameInteract is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        address deployer    = vm.addr(deployerKey);

        address leaderboardAddr = vm.envAddress("LEADERBOARD");
        address itemsAddr       = vm.envAddress("GAME_ITEMS");
        address verifierAddr    = vm.envAddress("EXEC_VERIFIER");

        GameLeaderboard leaderboard = GameLeaderboard(leaderboardAddr);
        GameItems       items       = GameItems(itemsAddr);
        ExecutionVerifier verifier  = ExecutionVerifier(verifierAddr);

        // Generate deterministic player addresses for demo
        address player1 = vm.addr(0xA11CE);
        address player2 = vm.addr(0xB0B);
        address player3 = vm.addr(0xCAFE);

        vm.startBroadcast(deployerKey);

        // ── 1. Create item types ──────────────────────────────────────────
        console.log("\n=== Creating Item Types ===");
        uint256 swordId  = items.createItemType("Iron Sword",    GameItems.Rarity.Common,    1000);
        uint256 shieldId = items.createItemType("Magic Shield",  GameItems.Rarity.Rare,      500);
        uint256 gemId    = items.createItemType("Legendary Gem", GameItems.Rarity.Legendary, 10);
        console.log("Iron Sword   id:", swordId);
        console.log("Magic Shield id:", shieldId);
        console.log("Legendary Gem id:", gemId);

        // ── 2. Mint items to players ──────────────────────────────────────
        console.log("\n=== Minting Items ===");
        items.mint(player1, swordId,  3);
        items.mint(player1, gemId,    1);
        items.mint(player2, swordId,  2);
        items.mint(player2, shieldId, 1);
        items.mint(player3, shieldId, 2);
        console.log("Minted: player1 -> 3x Sword, 1x Legendary Gem");
        console.log("Minted: player2 -> 2x Sword, 1x Shield");
        console.log("Minted: player3 -> 2x Shield");

        // ── 3. Submit scores to leaderboard ──────────────────────────────
        console.log("\n=== Submitting Scores ===");
        // Use low-level calls so we can submit from different addresses
        vm.stopBroadcast();

        vm.startBroadcast(0xA11CE);
        leaderboard.submitScore(9500);
        vm.stopBroadcast();

        vm.startBroadcast(0xB0B);
        leaderboard.submitScore(8200);
        vm.stopBroadcast();

        vm.startBroadcast(0xCAFE);
        leaderboard.submitScore(9800);   // top score
        vm.stopBroadcast();

        vm.startBroadcast(0xA11CE);
        leaderboard.submitScore(9900);   // beats player3
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);

        // ── 4. Post DA commitment ─────────────────────────────────────────
        console.log("\n=== Posting Execution Commitment (DA) ===");
        bytes32 mockStateRoot  = keccak256(abi.encodePacked("state_root_batch_1", block.number));
        bytes32 mockDaRef      = keccak256(abi.encodePacked("da_blob_id_batch_1"));
        verifier.postCommitment(mockStateRoot, mockDaRef);
        console.log("State root  :", vm.toString(mockStateRoot));
        console.log("DA reference:", vm.toString(mockDaRef));

        vm.stopBroadcast();

        // ── 5. Print final state ──────────────────────────────────────────
        console.log("\n=== Final Leaderboard ===");
        GameLeaderboard.Entry[10] memory board = leaderboard.getLeaderboard();
        for (uint256 i = 0; i < leaderboard.entryCount(); i++) {
            console.log(
                string.concat("#", vm.toString(i + 1)),
                board[i].player,
                "score:", board[i].score
            );
        }

        console.log("\n=== Item Balances ===");
        console.log("player1 swords:", items.balances(player1, swordId));
        console.log("player1 gems:  ", items.balances(player1, gemId));
        console.log("player2 swords:", items.balances(player2, swordId));

        ExecutionVerifier.ExecutionCommitment memory c = verifier.getLatestCommitment();
        console.log("\n=== Latest DA Commitment ===");
        console.log("Batch       :", c.batchNumber);
        console.log("Sequencer   :", c.sequencer);
    }
}
