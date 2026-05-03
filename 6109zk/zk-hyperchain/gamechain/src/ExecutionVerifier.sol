// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ExecutionVerifier
/// @notice Lightweight execution layer adapter for the modular appchain.
///         Records execution commitments (state roots + DA references) on L2,
///         providing an on-chain audit trail for the modular DA integration.
contract ExecutionVerifier {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct ExecutionCommitment {
        bytes32 stateRoot;      // L2 state root after batch
        bytes32 daReference;    // Hash of DA blob submitted to DA layer
        uint256 batchNumber;
        uint256 timestamp;
        address sequencer;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public sequencer;
    uint256 public latestBatch;

    mapping(uint256 => ExecutionCommitment) public commitments;

    // ─── Events ───────────────────────────────────────────────────────────────

    event CommitmentPosted(
        uint256 indexed batchNumber,
        bytes32 stateRoot,
        bytes32 daReference,
        address sequencer
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotSequencer();
    error BatchAlreadyCommitted(uint256 batchNumber);
    error InvalidBatchOrder(uint256 expected, uint256 got);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _sequencer) {
        sequencer = _sequencer;
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Post an execution commitment for a batch.
    ///         stateRoot  – the post-execution state root
    ///         daReference – blob_id returned by the DA layer (simulated or real)
    function postCommitment(bytes32 stateRoot, bytes32 daReference) external {
        if (msg.sender != sequencer) revert NotSequencer();
        uint256 batch = latestBatch + 1;
        commitments[batch] = ExecutionCommitment(
            stateRoot,
            daReference,
            batch,
            block.timestamp,
            msg.sender
        );
        latestBatch = batch;
        emit CommitmentPosted(batch, stateRoot, daReference, msg.sender);
    }

    /// @notice Verify that a commitment exists for the given batch.
    function verifyCommitment(
        uint256 batchNumber,
        bytes32 stateRoot,
        bytes32 daReference
    ) external view returns (bool) {
        ExecutionCommitment storage c = commitments[batchNumber];
        return c.stateRoot == stateRoot && c.daReference == daReference;
    }

    /// @notice Return the latest commitment.
    function getLatestCommitment() external view returns (ExecutionCommitment memory) {
        return commitments[latestBatch];
    }
}
