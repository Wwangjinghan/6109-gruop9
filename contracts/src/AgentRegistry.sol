// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Protocol-level registry for autonomous agents.
///         Any address can register itself as an agent and declare what capability
///         categories it supports (e.g. "SWAP", "DCA", "REBALANCE", "TRANSFER").
///         Registration is permissionless; callers decide which agents to trust.
contract AgentRegistry {
    // ─── Types ────────────────────────────────────────────────────────────────

    struct AgentInfo {
        address agent;
        string[] capabilities;
        uint256 registeredAt;
        bool active;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(address => AgentInfo) private _agents;
    address[] private _agentList;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string[] capabilities);
    event AgentUpdated(address indexed agent, string[] capabilities);
    event AgentDeregistered(address indexed agent);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error Unauthorized();
    error EmptyCapabilities();

    // ─── Mutative ─────────────────────────────────────────────────────────────

    /// @notice Register the caller as an agent with the given capability list.
    /// @param capabilities Non-empty list of capability strings (e.g. ["SWAP","DCA"]).
    function register(string[] calldata capabilities) external {
        if (capabilities.length == 0) revert EmptyCapabilities();
        if (_agents[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        _agents[msg.sender] = AgentInfo({
            agent: msg.sender,
            capabilities: capabilities,
            registeredAt: block.timestamp,
            active: true
        });
        _agentList.push(msg.sender);

        emit AgentRegistered(msg.sender, capabilities);
    }

    /// @notice Update the capability list for an already-registered agent.
    function updateCapabilities(string[] calldata capabilities) external {
        if (_agents[msg.sender].registeredAt == 0) revert NotRegistered();
        if (capabilities.length == 0) revert EmptyCapabilities();

        _agents[msg.sender].capabilities = capabilities;
        emit AgentUpdated(msg.sender, capabilities);
    }

    /// @notice Deregister the caller, marking it inactive.
    ///         The entry is kept in storage so on-chain history is preserved.
    function deregister() external {
        if (_agents[msg.sender].registeredAt == 0) revert NotRegistered();
        _agents[msg.sender].active = false;
        emit AgentDeregistered(msg.sender);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Returns true if the address is an active registered agent.
    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].active;
    }

    /// @notice Returns full info for a specific agent address.
    function getAgent(address agent) external view returns (AgentInfo memory) {
        return _agents[agent];
    }

    /// @notice Returns all registered agent addresses (active and inactive).
    ///         Consumers should filter by `active` if needed.
    function getAgents() external view returns (address[] memory) {
        return _agentList;
    }

    /// @notice Returns AgentInfo for every agent in the registry.
    ///         Not intended for large registries — use getAgents() + getAgent() for pagination.
    function getAllAgentInfo() external view returns (AgentInfo[] memory) {
        AgentInfo[] memory all = new AgentInfo[](_agentList.length);
        for (uint256 i = 0; i < _agentList.length; i++) {
            all[i] = _agents[_agentList[i]];
        }
        return all;
    }
}
