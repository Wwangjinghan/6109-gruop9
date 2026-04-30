// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IntentAccount} from "./IntentAccount.sol";

/// @notice Deploys IntentAccount instances at deterministic addresses using CREATE2.
///         The EntryPoint calls this factory (via `initCode`) when a UserOperation
///         references an account that does not yet exist on-chain.
///
///         Determinism key: keccak256(owner, agent, salt)  →  one canonical address
///         per (owner, agent, salt) triple.
contract IntentAccountFactory {
    IEntryPoint public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner, address indexed agent, uint256 salt);

    constructor(IEntryPoint anEntryPoint) {
        entryPoint = anEntryPoint;
    }

    /// @notice Deploy a new IntentAccount, or return the existing one if already deployed.
    /// @param owner The account owner — the primary signer.
    /// @param agent The agent address permitted to co-sign UserOperations (pass address(0) for none).
    /// @param salt  Arbitrary salt; allows one owner to own multiple accounts.
    function createAccount(address owner, address agent, uint256 salt) external returns (IntentAccount account) {
        bytes32 create2Salt = _salt(owner, agent, salt);
        address predicted = _predictAddress(owner, agent, salt);

        if (predicted.code.length > 0) {
            return IntentAccount(payable(predicted));
        }

        account = new IntentAccount{salt: create2Salt}(entryPoint, owner, agent);
        emit AccountCreated(address(account), owner, agent, salt);
    }

    /// @notice Compute the counterfactual address for a not-yet-deployed IntentAccount.
    ///         The EntryPoint uses this when processing initCode.
    function getAddress(address owner, address agent, uint256 salt) external view returns (address) {
        return _predictAddress(owner, agent, salt);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────────────────────────────────

    function _salt(address owner, address agent, uint256 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, agent, salt));
    }

    function _predictAddress(address owner, address agent, uint256 salt) internal view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(IntentAccount).creationCode,
            abi.encode(entryPoint, owner, agent)
        );
        return Create2.computeAddress(_salt(owner, agent, salt), keccak256(bytecode));
    }
}
