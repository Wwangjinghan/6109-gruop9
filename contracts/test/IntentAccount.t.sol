// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {BaseAccount} from "account-abstraction/core/BaseAccount.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IntentAccount} from "../src/IntentAccount.sol";
import {IntentAccountFactory} from "../src/IntentAccountFactory.sol";

contract IntentAccountTest is Test {
    EntryPoint entryPoint;
    IntentAccountFactory factory;

    // Owner key pair (Anvil account #0)
    uint256 ownerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address owner;

    // Agent key pair (Anvil account #1)
    uint256 agentPk = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address agent;

    IntentAccount account;

    // A simple recipient for transfer tests
    address payable recipient = payable(address(0xBEEF));

    function setUp() public {
        owner = vm.addr(ownerPk);
        agent = vm.addr(agentPk);

        entryPoint = new EntryPoint();
        factory = new IntentAccountFactory(IEntryPoint(address(entryPoint)));

        // Deploy the account (salt = 0)
        account = factory.createAccount(owner, agent, 0);

        // Fund the account and its EntryPoint deposit
        vm.deal(address(account), 10 ether);
        vm.prank(address(account));
        account.depositToEntryPoint{value: 2 ether}();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helper: build a PackedUserOperation
    // ──────────────────────────────────────────────────────────────────────────

    function _buildUserOp(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = PackedUserOperation({
            sender: address(account),
            nonce: entryPoint.getNonce(address(account), 0),
            initCode: "",
            callData: callData,
            // verificationGasLimit (high 128) = 200_000 | callGasLimit (low 128) = 200_000
            accountGasLimits: bytes32((uint256(200_000) << 128) | uint256(200_000)),
            preVerificationGas: 50_000,
            // maxPriorityFeePerGas (high 128) = 1 gwei | maxFeePerGas (low 128) = 1 gwei
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)),
            paymasterAndData: "",
            signature: ""
        });
    }

    function _signOp(PackedUserOperation memory op, uint256 pk) internal view returns (PackedUserOperation memory) {
        bytes32 opHash = entryPoint.getUserOpHash(op);
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(opHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        op.signature = abi.encodePacked(r, s, v);
        return op;
    }

    function _submitOp(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(address(this)));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Factory / deployment tests
    // ──────────────────────────────────────────────────────────────────────────

    function test_FactoryDeterminsticAddress() public view {
        address predicted = factory.getAddress(owner, agent, 0);
        assertEq(predicted, address(account), "predicted address mismatch");
    }

    function test_FactoryIdempotent() public {
        IntentAccount second = factory.createAccount(owner, agent, 0);
        assertEq(address(second), address(account), "factory must be idempotent");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Direct execution by owner (bypasses EntryPoint)
    // ──────────────────────────────────────────────────────────────────────────

    function test_OwnerCanExecuteTransferDirectly() public {
        uint256 before = recipient.balance;

        vm.prank(owner);
        account.execute(recipient, 1 ether, "");

        assertEq(recipient.balance, before + 1 ether, "ETH not transferred");
    }

    function test_OwnerCanExecuteBatchDirectly() public {
        address payable r2 = payable(address(0xCAFE));
        uint256 b1 = recipient.balance;
        uint256 b2 = r2.balance;

        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = BaseAccount.Call({target: recipient, value: 0.5 ether, data: ""});
        calls[1] = BaseAccount.Call({target: r2,        value: 0.3 ether, data: ""});

        vm.prank(owner);
        account.executeBatch(calls);

        assertEq(recipient.balance, b1 + 0.5 ether);
        assertEq(r2.balance,        b2 + 0.3 ether);
    }

    function test_RandomAddressCannotExecute() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(IntentAccount.NotEntryPointOrOwner.selector);
        account.execute(recipient, 1 ether, "");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ERC-4337: owner-signed UserOperation → ETH transfer
    // ──────────────────────────────────────────────────────────────────────────

    function test_OwnerSignedUserOpExecutesTransfer() public {
        bytes memory callData = abi.encodeCall(IntentAccount.execute, (recipient, 1 ether, ""));
        PackedUserOperation memory op = _signOp(_buildUserOp(callData), ownerPk);

        uint256 before = recipient.balance;
        _submitOp(op);
        assertEq(recipient.balance, before + 1 ether, "ETH not transferred via UserOp");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ERC-4337: agent-signed UserOperation → ETH transfer
    // ──────────────────────────────────────────────────────────────────────────

    function test_AgentSignedUserOpExecutesTransfer() public {
        bytes memory callData = abi.encodeCall(IntentAccount.execute, (recipient, 0.5 ether, ""));
        PackedUserOperation memory op = _signOp(_buildUserOp(callData), agentPk);

        uint256 before = recipient.balance;
        _submitOp(op);
        assertEq(recipient.balance, before + 0.5 ether, "ETH not transferred via agent UserOp");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ERC-4337: agent-signed batch UserOperation
    // ──────────────────────────────────────────────────────────────────────────

    function test_AgentSignedBatchUserOp() public {
        address payable r2 = payable(address(0xCAFE));

        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = BaseAccount.Call({target: recipient, value: 0.1 ether, data: ""});
        calls[1] = BaseAccount.Call({target: r2,        value: 0.2 ether, data: ""});

        bytes memory callData = abi.encodeCall(IntentAccount.executeBatch, (calls));
        PackedUserOperation memory op = _signOp(_buildUserOp(callData), agentPk);

        uint256 b1 = recipient.balance;
        uint256 b2 = r2.balance;
        _submitOp(op);

        assertEq(recipient.balance, b1 + 0.1 ether, "batch call[0] failed");
        assertEq(r2.balance,        b2 + 0.2 ether, "batch call[1] failed");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Signature validation: invalid signer is rejected
    // ──────────────────────────────────────────────────────────────────────────

    function test_UnknownSignerUserOpFails() public {
        uint256 rogue = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;
        bytes memory callData = abi.encodeCall(IntentAccount.execute, (recipient, 1 ether, ""));
        PackedUserOperation memory op = _signOp(_buildUserOp(callData), rogue);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;

        // EntryPoint reverts with FailedOp when signature validation returns FAILED
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Agent management
    // ──────────────────────────────────────────────────────────────────────────

    function test_OwnerCanRemoveAgent() public {
        vm.prank(owner);
        account.setAgent(address(0));
        assertEq(account.agent(), address(0));

        // Agent-signed op must now fail
        bytes memory callData = abi.encodeCall(IntentAccount.execute, (recipient, 0.1 ether, ""));
        PackedUserOperation memory op = _signOp(_buildUserOp(callData), agentPk);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));
    }

    function test_OnlyOwnerCanSetAgent() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        account.setAgent(address(0xDEAD));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Utilities
    // ──────────────────────────────────────────────────────────────────────────

    // Allow this contract to receive ETH from EntryPoint fee refunds
    receive() external payable {}
}
