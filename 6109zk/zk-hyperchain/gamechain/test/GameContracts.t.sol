// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/GameLeaderboard.sol";
import "../src/GameItems.sol";
import "../src/ExecutionVerifier.sol";

contract GameContractsTest is Test {
    GameLeaderboard leaderboard;
    GameItems       items;
    ExecutionVerifier verifier;

    address owner    = address(this);
    address player1  = address(0xA1);
    address player2  = address(0xA2);
    address player3  = address(0xA3);

    function setUp() public {
        leaderboard = new GameLeaderboard("Test Arena");
        items       = new GameItems();
        verifier    = new ExecutionVerifier(owner);
    }

    // ── Leaderboard tests ────────────────────────────────────────────────────

    function test_submitScore_basic() public {
        vm.prank(player1);
        leaderboard.submitScore(100);
        assertEq(leaderboard.playerBestScore(player1), 100);
        assertEq(leaderboard.rankOf(player1), 1);
    }

    function test_submitScore_onlyBestRecorded() public {
        vm.startPrank(player1);
        leaderboard.submitScore(100);
        leaderboard.submitScore(50);   // lower — should be ignored
        vm.stopPrank();
        assertEq(leaderboard.playerBestScore(player1), 100);
    }

    function test_leaderboard_ordering() public {
        vm.prank(player1); leaderboard.submitScore(300);
        vm.prank(player2); leaderboard.submitScore(500);
        vm.prank(player3); leaderboard.submitScore(400);

        // rank 1 = 500 (player2), rank 2 = 400 (player3), rank 3 = 300 (player1)
        assertEq(leaderboard.rankOf(player2), 1);
        assertEq(leaderboard.rankOf(player3), 2);
        assertEq(leaderboard.rankOf(player1), 3);
    }

    function test_leaderboard_update_moves_player() public {
        vm.prank(player1); leaderboard.submitScore(100);
        vm.prank(player2); leaderboard.submitScore(200);

        assertEq(leaderboard.rankOf(player1), 2);

        vm.prank(player1); leaderboard.submitScore(300);  // now #1
        assertEq(leaderboard.rankOf(player1), 1);
        assertEq(leaderboard.rankOf(player2), 2);
    }

    function test_leaderboard_top10_capped() public {
        for (uint256 i = 1; i <= 12; i++) {
            address p = address(uint160(0x1000 + i));
            vm.prank(p);
            leaderboard.submitScore(i * 100);
        }
        assertEq(leaderboard.entryCount(), 10);
    }

    // ── GameItems tests ──────────────────────────────────────────────────────

    function test_createItemType() public {
        uint256 id = items.createItemType("Sword", GameItems.Rarity.Common, 100);
        assertEq(id, 0);
        GameItems.ItemType memory t = items.getItemType(id);
        assertEq(t.name, "Sword");
        assertEq(t.maxSupply, 100);
        assertEq(t.totalMinted, 0);
    }

    function test_mint_and_balance() public {
        uint256 id = items.createItemType("Shield", GameItems.Rarity.Rare, 0);
        items.mint(player1, id, 5);
        assertEq(items.balances(player1, id), 5);
    }

    function test_mint_respects_maxSupply() public {
        uint256 id = items.createItemType("Gem", GameItems.Rarity.Legendary, 3);
        items.mint(player1, id, 3);
        vm.expectRevert(abi.encodeWithSelector(GameItems.MaxSupplyReached.selector, id));
        items.mint(player1, id, 1);
    }

    function test_burn() public {
        uint256 id = items.createItemType("Arrow", GameItems.Rarity.Common, 0);
        items.mint(player1, id, 10);
        vm.prank(player1);
        items.burn(id, 4);
        assertEq(items.balances(player1, id), 6);
    }

    function test_only_gameMaster_can_mint() public {
        uint256 id = items.createItemType("Axe", GameItems.Rarity.Common, 0);
        vm.prank(player1);
        vm.expectRevert(GameItems.NotGameMaster.selector);
        items.mint(player2, id, 1);
    }

    function test_balanceOfBatch() public {
        uint256 id0 = items.createItemType("A", GameItems.Rarity.Common, 0);
        uint256 id1 = items.createItemType("B", GameItems.Rarity.Rare,   0);
        items.mint(player1, id0, 3);
        items.mint(player2, id1, 7);

        address[] memory accs = new address[](2);
        uint256[] memory ids  = new uint256[](2);
        accs[0] = player1; ids[0] = id0;
        accs[1] = player2; ids[1] = id1;

        uint256[] memory bals = items.balanceOfBatch(accs, ids);
        assertEq(bals[0], 3);
        assertEq(bals[1], 7);
    }

    // ── ExecutionVerifier tests ──────────────────────────────────────────────

    function test_postCommitment() public {
        bytes32 sr  = keccak256("state_root");
        bytes32 dar = keccak256("da_ref");
        verifier.postCommitment(sr, dar);
        assertEq(verifier.latestBatch(), 1);
        assertTrue(verifier.verifyCommitment(1, sr, dar));
    }

    function test_verify_wrong_data_returns_false() public {
        bytes32 sr  = keccak256("state_root");
        bytes32 dar = keccak256("da_ref");
        verifier.postCommitment(sr, dar);
        assertFalse(verifier.verifyCommitment(1, keccak256("wrong"), dar));
    }

    function test_only_sequencer_can_post() public {
        vm.prank(player1);
        vm.expectRevert(ExecutionVerifier.NotSequencer.selector);
        verifier.postCommitment(bytes32(0), bytes32(0));
    }

    function test_sequential_batches() public {
        for (uint256 i = 0; i < 5; i++) {
            bytes32 sr  = keccak256(abi.encodePacked("sr", i));
            bytes32 dar = keccak256(abi.encodePacked("dar", i));
            verifier.postCommitment(sr, dar);
        }
        assertEq(verifier.latestBatch(), 5);
        ExecutionVerifier.ExecutionCommitment memory c = verifier.getLatestCommitment();
        assertEq(c.batchNumber, 5);
    }
}
