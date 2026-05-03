// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GameLeaderboard
/// @notice On-chain leaderboard for a modular appchain gaming use case.
///         Players submit scores; top-N rankings are maintained on-chain.
contract GameLeaderboard {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct Entry {
        address player;
        uint256 score;
        uint256 timestamp;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    string  public  gameName;
    address public  owner;
    uint256 public  constant TOP_SIZE = 10;

    Entry[TOP_SIZE] public topEntries;   // fixed-size top-10 (sorted descending)
    uint256         public entryCount;   // how many slots are filled

    mapping(address => uint256) public playerBestScore;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ScoreSubmitted(address indexed player, uint256 score, uint256 rank);
    event LeaderboardUpdated(address indexed player, uint256 score);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(string memory _gameName) {
        gameName = _gameName;
        owner    = msg.sender;
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Submit a score. Only records if it beats the player's personal best.
    function submitScore(uint256 score) external {
        address player = msg.sender;

        if (score <= playerBestScore[player]) return;
        playerBestScore[player] = score;

        _updateTop(player, score);
        emit ScoreSubmitted(player, score, _rankOf(player));
    }

    /// @notice Return the full top-10 leaderboard.
    function getLeaderboard() external view returns (Entry[TOP_SIZE] memory) {
        return topEntries;
    }

    /// @notice Return the rank (1-based) of a player, 0 if not in top-10.
    function rankOf(address player) external view returns (uint256) {
        return _rankOf(player);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _updateTop(address player, uint256 score) internal {
        // find insertion position (descending order)
        uint256 pos = entryCount;
        for (uint256 i = 0; i < entryCount; i++) {
            if (topEntries[i].player == player) {
                // remove old entry first
                _removeAt(i);
                pos = entryCount;
                break;
            }
        }

        // find where score fits
        uint256 insertAt = pos < TOP_SIZE ? pos : TOP_SIZE;
        for (uint256 i = 0; i < (pos < TOP_SIZE ? pos : TOP_SIZE); i++) {
            if (score > topEntries[i].score) {
                insertAt = i;
                break;
            }
        }

        if (insertAt >= TOP_SIZE) return; // score too low for top-10

        // shift entries down to make room
        uint256 last = entryCount < TOP_SIZE ? entryCount : TOP_SIZE - 1;
        for (uint256 i = last; i > insertAt; i--) {
            topEntries[i] = topEntries[i - 1];
        }
        topEntries[insertAt] = Entry(player, score, block.timestamp);
        if (entryCount < TOP_SIZE) entryCount++;

        emit LeaderboardUpdated(player, score);
    }

    function _removeAt(uint256 index) internal {
        for (uint256 i = index; i + 1 < entryCount; i++) {
            topEntries[i] = topEntries[i + 1];
        }
        delete topEntries[entryCount - 1];
        entryCount--;
    }

    function _rankOf(address player) internal view returns (uint256) {
        for (uint256 i = 0; i < entryCount; i++) {
            if (topEntries[i].player == player) return i + 1;
        }
        return 0;
    }
}
