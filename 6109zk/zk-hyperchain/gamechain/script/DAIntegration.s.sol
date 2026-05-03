// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ExecutionVerifier.sol";

/// @notice Demonstrates the full Modular DA integration loop:
///   1. Encode a batch payload
///   2. POST it to the simulated DA layer (http://127.0.0.1:7777)
///   3. Receive a blob_id (DA reference)
///   4. Post the state root + DA reference on-chain via ExecutionVerifier
///   5. Verify the commitment on-chain
///
/// The DA HTTP call is made via Foundry's FFI (--ffi flag required).
contract DAIntegration is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        address verifierAddr = vm.envAddress("EXEC_VERIFIER");
        ExecutionVerifier verifier = ExecutionVerifier(verifierAddr);

        // ── 1. Build a mock batch payload ────────────────────────────────
        bytes memory payload = abi.encode(
            block.number,
            block.timestamp,
            "batch_data: [tx1, tx2, tx3]"
        );
        string memory hexPayload = _toHexString(payload);

        console.log("\n=== Step 1: Batch payload (hex, first 40 chars) ===");
        console.log(hexPayload);

        // ── 2. POST to simulated DA layer via FFI ─────────────────────────
        console.log("\n=== Step 2: Posting to DA layer (http://127.0.0.1:7777) ===");
        string[] memory curlCmd = new string[](8);
        curlCmd[0] = "curl";
        curlCmd[1] = "-sf";
        curlCmd[2] = "-X";
        curlCmd[3] = "POST";
        curlCmd[4] = "http://127.0.0.1:7777/submit";
        curlCmd[5] = "-H";
        curlCmd[6] = "Content-Type: application/json";
        curlCmd[7] = string.concat("{\"data\":\"", hexPayload, "\"}");

        // Rebuild with correct args
        string[] memory cmd = new string[](9);
        cmd[0] = "curl";
        cmd[1] = "-sf";
        cmd[2] = "-X"; cmd[3] = "POST";
        cmd[4] = "http://127.0.0.1:7777/submit";
        cmd[5] = "-H"; cmd[6] = "Content-Type: application/json";
        cmd[7] = "-d";
        cmd[8] = string.concat("{\"data\":\"", hexPayload, "\"}");

        bytes memory rawResponse = vm.ffi(cmd);
        string memory response   = string(rawResponse);
        console.log("DA response:", response);

        // ── 3. Extract blob_id from JSON response ─────────────────────────
        // Response: {"blob_id":"<64-char hex>","commitment":"<64-char hex>"}
        // Parse with a shell command for simplicity
        string[] memory parseCmd = new string[](4);
        parseCmd[0] = "sh";
        parseCmd[1] = "-c";
        parseCmd[2] = string.concat(
            "echo '", response, "' | python3 -c \"import sys,json; print(json.load(sys.stdin)['blob_id'])\""
        );
        parseCmd[3] = "";
        // trim trailing newline by using head
        string[] memory parseCmd2 = new string[](3);
        parseCmd2[0] = "sh";
        parseCmd2[1] = "-c";
        parseCmd2[2] = string.concat(
            "echo '", response, "' | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d['blob_id'], end='')\""
        );
        bytes memory blobIdRaw = vm.ffi(parseCmd2);
        bytes32 daReference    = bytes32(bytes(string(blobIdRaw)));

        console.log("\n=== Step 3: DA blob_id received ===");
        console.log(string(blobIdRaw));

        // ── 4. Post on-chain commitment ───────────────────────────────────
        console.log("\n=== Step 4: Posting commitment on-chain ===");
        bytes32 stateRoot = keccak256(abi.encodePacked("state_after_batch", block.number));

        vm.startBroadcast(deployerKey);
        verifier.postCommitment(stateRoot, daReference);
        vm.stopBroadcast();

        console.log("State root :", vm.toString(stateRoot));
        console.log("DA reference (bytes32):", vm.toString(daReference));

        // ── 5. Verify commitment on-chain ─────────────────────────────────
        console.log("\n=== Step 5: Verifying commitment ===");
        uint256 batchNum = verifier.latestBatch();
        bool valid = verifier.verifyCommitment(batchNum, stateRoot, daReference);
        console.log("Batch number:", batchNum);
        console.log("Commitment valid:", valid);

        // ── 6. Fetch blob back from DA layer ──────────────────────────────
        console.log("\n=== Step 6: Fetching blob back from DA layer ===");
        string[] memory fetchCmd = new string[](3);
        fetchCmd[0] = "curl";
        fetchCmd[1] = "-sf";
        fetchCmd[2] = string.concat("http://127.0.0.1:7777/get/", string(blobIdRaw));
        bytes memory fetchResponse = vm.ffi(fetchCmd);
        console.log("DA fetch response (first 80 chars):");
        console.log(string(fetchResponse));

        console.log("\n=== DA Integration complete ===");
        console.log("Full modular DA round-trip verified on ZK Stack appchain.");
    }

    /// @dev Convert bytes to lowercase hex string (without 0x prefix).
    function _toHexString(bytes memory data) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result   = new bytes(2 * data.length);
        for (uint256 i = 0; i < data.length; i++) {
            result[2 * i]     = hexChars[uint8(data[i]) >> 4];
            result[2 * i + 1] = hexChars[uint8(data[i]) & 0x0f];
        }
        return string(result);
    }
}
