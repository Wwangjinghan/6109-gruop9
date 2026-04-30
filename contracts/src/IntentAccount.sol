// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseAccount} from "account-abstraction/core/BaseAccount.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {SIG_VALIDATION_SUCCESS, SIG_VALIDATION_FAILED} from "account-abstraction/core/Helpers.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice ERC-4337 smart account that accepts UserOperations signed by either
///         the owner OR a designated agent address. The agent role is intended for
///         relayer-side signers that execute batched intents on the owner's behalf.
contract IntentAccount is BaseAccount, Ownable {
    using ECDSA for bytes32;

    IEntryPoint private immutable _entryPoint;

    /// @notice Address permitted to co-sign UserOperations alongside the owner.
    address public agent;

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    error NotEntryPointOrOwner();

    constructor(IEntryPoint anEntryPoint, address anOwner, address anAgent)
        Ownable(anOwner)
    {
        _entryPoint = anEntryPoint;
        agent = anAgent;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BaseAccount overrides
    // ──────────────────────────────────────────────────────────────────────────

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @dev Validates that the UserOperation was signed by the owner or the agent.
    ///      Returns SIG_VALIDATION_SUCCESS (0) or SIG_VALIDATION_FAILED (1).
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        address recovered = ethHash.recover(userOp.signature);

        if (recovered == owner() || (agent != address(0) && recovered == agent)) {
            return SIG_VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }

    /// @dev Allow the EntryPoint OR the owner to call execute / executeBatch directly.
    function _requireForExecute() internal view override {
        if (msg.sender != address(_entryPoint) && msg.sender != owner()) {
            revert NotEntryPointOrOwner();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Execution
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Execute a single call. Callable by the EntryPoint or the owner.
    function execute(address target, uint256 value, bytes calldata data) external override {
        _requireForExecute();
        (bool ok, bytes memory result) = target.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(result, 32), mload(result)) }
        }
    }

    /// @notice Execute a batch of calls. Callable by the EntryPoint or the owner.
    function executeBatch(Call[] calldata calls) external override {
        _requireForExecute();
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory result) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                assembly { revert(add(result, 32), mload(result)) }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Replace the agent. Pass address(0) to remove the agent role.
    function setAgent(address newAgent) external onlyOwner {
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Funding helpers
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Deposit ETH to the EntryPoint on behalf of this account.
    function depositToEntryPoint() external payable {
        _entryPoint.depositTo{value: msg.value}(address(this));
    }

    receive() external payable {}
}
