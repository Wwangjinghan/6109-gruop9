// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

struct Intent {
    address sender;
    address target;
    bytes callData;
    uint256 value;
    uint256 deadline;
    uint256 nonce;
}

enum IntentStatus {
    Unknown,
    Pending,
    Executed,
    Cancelled
}
