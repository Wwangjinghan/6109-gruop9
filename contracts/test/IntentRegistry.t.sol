// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Intent, IntentStatus} from "../src/types/IntentTypes.sol";

contract IntentRegistryTest is Test {
    IntentRegistry registry;
    uint256 signerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address signer;

    function setUp() public {
        registry = new IntentRegistry();
        signer = vm.addr(signerPk);
    }

    function _makeIntent(uint256 deadline, uint256 nonce) internal view returns (Intent memory) {
        return Intent({
            sender: signer,
            target: address(0xBEEF),
            callData: hex"deadbeef",
            value: 0,
            deadline: deadline,
            nonce: nonce
        });
    }

    function _signIntent(Intent memory intent) internal view returns (bytes memory) {
        bytes32 intentId = keccak256(abi.encode(
            intent.sender, intent.target, intent.callData,
            intent.value, intent.deadline, intent.nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", intentId));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function test_RegisterIntent() public {
        Intent memory intent = _makeIntent(block.timestamp + 1 hours, 0);
        bytes memory sig = _signIntent(intent);

        bytes32 id = registry.registerIntent(intent, sig);
        assertEq(uint8(registry.intentStatus(id)), uint8(IntentStatus.Pending));
    }

    function test_CannotRegisterExpiredIntent() public {
        Intent memory intent = _makeIntent(block.timestamp - 1, 0);
        bytes memory sig = _signIntent(intent);

        vm.expectRevert(IntentRegistry.IntentExpired.selector);
        registry.registerIntent(intent, sig);
    }

    function test_CannotRegisterDuplicate() public {
        Intent memory intent = _makeIntent(block.timestamp + 1 hours, 0);
        bytes memory sig = _signIntent(intent);
        registry.registerIntent(intent, sig);

        vm.expectRevert(IntentRegistry.IntentAlreadyRegistered.selector);
        registry.registerIntent(intent, sig);
    }

    function test_CancelIntent() public {
        Intent memory intent = _makeIntent(block.timestamp + 1 hours, 1);
        bytes memory sig = _signIntent(intent);
        bytes32 id = registry.registerIntent(intent, sig);

        vm.prank(signer);
        registry.cancelIntent(id);
        assertEq(uint8(registry.intentStatus(id)), uint8(IntentStatus.Cancelled));
    }

    function testFuzz_RegisterMultipleIntents(uint256 nonce) public {
        vm.assume(nonce < type(uint128).max);
        Intent memory intent = _makeIntent(block.timestamp + 1 hours, nonce);
        bytes memory sig = _signIntent(intent);
        bytes32 id = registry.registerIntent(intent, sig);
        assertEq(uint8(registry.intentStatus(id)), uint8(IntentStatus.Pending));
    }
}
