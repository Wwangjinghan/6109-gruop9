// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIntentRegistry} from "./interfaces/IIntentRegistry.sol";
import {Intent, IntentStatus} from "./types/IntentTypes.sol";

/// @notice On-chain registry that stores and tracks signed user intents.
///         The relayer submits batched intents here before the bundler executes them.
contract IntentRegistry is IIntentRegistry {
    mapping(bytes32 => IntentStatus) public intentStatus;
    mapping(bytes32 => Intent) private _intents;

    address public owner;
    mapping(address => bool) public trustedBundlers;

    uint256 private _nonce;

    event IntentRegistered(bytes32 indexed intentId, address indexed sender, uint256 deadline);
    event IntentExecuted(bytes32 indexed intentId);
    event IntentCancelled(bytes32 indexed intentId);
    event BundlerUpdated(address indexed bundler, bool trusted);
    event BatchRecorded(bytes32[] intentIds, uint256 executedAt);

    // Off-chain intent audit trail: keccak256(UUID) → execution timestamp
    mapping(bytes32 => uint256) public offChainIntentExecutedAt;

    error IntentAlreadyRegistered();
    error IntentNotFound();
    error IntentExpired();
    error Unauthorized();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyTrustedBundler() {
        if (!trustedBundlers[msg.sender]) revert Unauthorized();
        _;
    }

    /// @notice Grant or revoke bundler trust. Only callable by the registry owner.
    function setBundler(address bundler, bool trusted) external onlyOwner {
        trustedBundlers[bundler] = trusted;
        emit BundlerUpdated(bundler, trusted);
    }

    function registerIntent(Intent calldata intent, bytes calldata signature) external returns (bytes32 intentId) {
        intentId = _hashIntent(intent);

        if (intentStatus[intentId] != IntentStatus.Unknown) revert IntentAlreadyRegistered();
        if (block.timestamp > intent.deadline) revert IntentExpired();

        _verifySignature(intentId, intent.sender, signature);

        _intents[intentId] = intent;
        intentStatus[intentId] = IntentStatus.Pending;

        emit IntentRegistered(intentId, intent.sender, intent.deadline);
    }

    function markExecuted(bytes32 intentId) external onlyTrustedBundler {
        if (_intents[intentId].sender == address(0)) revert IntentNotFound();
        intentStatus[intentId] = IntentStatus.Executed;
        emit IntentExecuted(intentId);
    }

    function cancelIntent(bytes32 intentId) external {
        Intent storage intent = _intents[intentId];
        if (intent.sender == address(0)) revert IntentNotFound();
        if (intent.sender != msg.sender) revert Unauthorized();
        intentStatus[intentId] = IntentStatus.Cancelled;
        emit IntentCancelled(intentId);
    }

    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        return _intents[intentId];
    }

    function _hashIntent(Intent calldata intent) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            intent.sender,
            intent.target,
            intent.callData,
            intent.value,
            intent.deadline,
            intent.nonce
        ));
    }

    function _verifySignature(bytes32 intentId, address expectedSigner, bytes calldata signature) internal pure {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", intentId));
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recovered = ecrecover(ethSignedHash, v, r, s);
        if (recovered != expectedSigner) revert Unauthorized();
    }

    function _splitSignature(bytes calldata sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "Invalid signature length");
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
    }

    /// @notice Record that a batch of off-chain intents was executed on-chain.
    ///         Called by the relayer after a successful UserOp receipt.
    ///         intentIds are keccak256(abi.encodePacked(uuid)) of the relayer's internal IDs.
    function recordBatchExecution(bytes32[] calldata intentIds) external onlyTrustedBundler {
        uint256 ts = block.timestamp;
        for (uint256 i = 0; i < intentIds.length; i++) {
            offChainIntentExecutedAt[intentIds[i]] = ts;
        }
        emit BatchRecorded(intentIds, ts);
    }
}
