// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Intent, IntentStatus} from "../types/IntentTypes.sol";

interface IIntentRegistry {
    function registerIntent(Intent calldata intent, bytes calldata signature) external returns (bytes32 intentId);
    function markExecuted(bytes32 intentId) external;
    function cancelIntent(bytes32 intentId) external;
    function getIntent(bytes32 intentId) external view returns (Intent memory);
    function intentStatus(bytes32 intentId) external view returns (IntentStatus);
}
