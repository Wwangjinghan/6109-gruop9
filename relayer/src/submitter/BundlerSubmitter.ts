import {
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
} from "viem";
import { ENTRY_POINT_ABI, ENTRY_POINT_ADDRESS } from "../abi/entryPoint.js";
import { UserOpBuilder, type PackedUserOperation } from "../userop/UserOpBuilder.js";
import type { CombinedBatch } from "../types/intent.js";
import { logger } from "../utils/logger.js";

export interface SubmitterConfig {
  walletClient: WalletClient;
  publicClient: PublicClient;
  agentAddress: Address;
  entryPointAddress?: Address;
}

export class BundlerSubmitter {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly agentAddress: Address;
  private readonly entryPointAddress: Address;
  private readonly builder: UserOpBuilder;

  constructor(config: SubmitterConfig) {
    this.walletClient = config.walletClient;
    this.publicClient = config.publicClient;
    this.agentAddress = config.agentAddress;
    this.entryPointAddress = config.entryPointAddress ?? ENTRY_POINT_ADDRESS;
    this.builder = new UserOpBuilder(this.publicClient, this.entryPointAddress);
  }

  /**
   * Full pipeline for a CombinedBatch:
   *   1. Build the unsigned PackedUserOperation (calls merged via UserOpBuilder)
   *   2. Fetch the userOpHash from the EntryPoint
   *   3. Sign the hash with the agent key (EIP-191)
   *   4. Attach the signature and submit via EntryPoint.handleOps
   *   5. Wait for receipt and update intent record statuses
   */
  async submitBatch(batch: CombinedBatch): Promise<Hex> {
    logger.info({ batchId: batch.batchId, account: batch.account }, "Building UserOp");

    // 1. Build unsigned op
    const userOp = await this.builder.build(batch);

    // 2. Get hash from EntryPoint
    const userOpHash = await this.builder.getUserOpHash(userOp);
    logger.debug({ batchId: batch.batchId, userOpHash }, "UserOp hash obtained");

    // 3. Sign with agent key (EIP-191 personal_sign wraps the hash)
    const signature = await this._signUserOpHash(userOpHash);
    const signedOp: PackedUserOperation = { ...userOp, signature };

    // 4. Submit via EntryPoint.handleOps
    const txHash = await this._handleOps(signedOp);
    logger.info({ batchId: batch.batchId, txHash }, "UserOp submitted — waiting for receipt");

    // 5. Wait for inclusion
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const success = receipt.status === "success";

    logger.info(
      { batchId: batch.batchId, txHash, success, gasUsed: receipt.gasUsed.toString() },
      success ? "Batch executed" : "Batch transaction reverted",
    );

    // Update all intent records in the batch
    const nextStatus = success ? "executed" : "failed";
    batch.records.forEach((r) => {
      r.status = nextStatus;
      r.txHash = txHash;
      r.userOpHash = userOpHash;
    });

    return txHash;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Sign the userOpHash with EIP-191.
   * IntentAccount._validateSignature wraps the raw userOpHash with toEthSignedMessageHash
   * before recovering — so we must sign the raw bytes32 hash here and let the
   * contract do the prefix.
   */
  private async _signUserOpHash(userOpHash: Hex): Promise<Hex> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account attached");

    // personal_sign = EIP-191: prefix + hash
    return this.walletClient.signMessage({
      account,
      message: { raw: userOpHash },
    });
  }

  private async _handleOps(userOp: PackedUserOperation): Promise<Hex> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account attached");

    // Beneficiary receives unused gas refunds — set to the agent address
    const beneficiary: Address = this.agentAddress;

    return this.walletClient.writeContract({
      address: this.entryPointAddress,
      abi: ENTRY_POINT_ABI,
      functionName: "handleOps",
      args: [[userOp], beneficiary],
      account,
      chain: this.walletClient.chain ?? null,
    });
  }
}
