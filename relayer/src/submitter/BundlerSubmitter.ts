import {
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  keccak256,
  toBytes,
} from "viem";
import { ENTRY_POINT_ABI, ENTRY_POINT_ADDRESS } from "../abi/entryPoint.js";
import { INTENT_REGISTRY_ABI } from "../abi/intentRegistry.js";
import { UserOpBuilder, type PackedUserOperation } from "../userop/UserOpBuilder.js";
import type { CombinedBatch } from "../types/intent.js";
import { logger } from "../utils/logger.js";

export interface SubmitterConfig {
  walletClient: WalletClient;
  publicClient: PublicClient;
  agentAddress: Address;
  entryPointAddress?: Address;
  /**
   * Maximum number of batches that can be in flight simultaneously.
   * Default: 3
   */
  maxConcurrent?: number;
  /**
   * Maximum submission attempts per batch before marking as permanently failed.
   * Each retry waits 2^attempt * retryBaseMs milliseconds (exponential backoff).
   * Default: 3
   */
  maxRetries?: number;
  /** Base backoff delay in ms. Default: 1000 */
  retryBaseMs?: number;
  /** Optional paymaster address. When set, paymasterAndData is populated. */
  paymasterAddress?: Address;
  /** Optional IntentRegistry address. When set, recordBatchExecution is called after success. */
  registryAddress?: Address;
}

/**
 * Minimal semaphore — limits how many async tasks run simultaneously.
 */
class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

export class BundlerSubmitter {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly agentAddress: Address;
  private readonly entryPointAddress: Address;
  private readonly builder: UserOpBuilder;
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  readonly paymasterAddress: Address | undefined;
  readonly registryAddress: Address | undefined;

  constructor(config: SubmitterConfig) {
    this.walletClient = config.walletClient;
    this.publicClient = config.publicClient;
    this.agentAddress = config.agentAddress;
    this.entryPointAddress = config.entryPointAddress ?? ENTRY_POINT_ADDRESS;
    this.builder = new UserOpBuilder(this.publicClient, this.entryPointAddress);
    this.semaphore = new Semaphore(config.maxConcurrent ?? 3);
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 1_000;
    this.paymasterAddress = config.paymasterAddress;
    this.registryAddress = config.registryAddress;
  }

  /**
   * Full pipeline for a CombinedBatch, with exponential-backoff retry.
   * Concurrent calls are gated by the Semaphore so nonce ordering is preserved.
   *
   *   1. Build the unsigned PackedUserOperation (gas estimated via RPC or constants)
   *   2. Populate paymasterAndData if a paymaster address is configured
   *   3. Fetch the userOpHash from the EntryPoint
   *   4. Sign the hash with the agent key (EIP-191)
   *   5. Submit via EntryPoint.handleOps
   *   6. Wait for receipt and update intent records
   *   7. On transient failure, retry up to maxRetries with exponential backoff
   */
  async submitBatch(batch: CombinedBatch): Promise<Hex> {
    await this.semaphore.acquire();
    try {
      return await this._withRetry(batch);
    } finally {
      this.semaphore.release();
    }
  }

  private async _withRetry(batch: CombinedBatch): Promise<Hex> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this._submitBatchInner(batch);
      } catch (err) {
        lastErr = err;
        const isLast = attempt === this.maxRetries - 1;
        if (isLast) break;

        const delayMs = this.retryBaseMs * Math.pow(2, attempt);
        logger.warn(
          { batchId: batch.batchId, attempt: attempt + 1, maxRetries: this.maxRetries, delayMs, err },
          "Batch submission failed — retrying",
        );
        await new Promise((res) => setTimeout(res, delayMs));

        // Reset record statuses to pending before the next attempt
        batch.records.forEach((r) => {
          r.status = "pending";
          r.submittedAt = undefined;
          r.executedAt = undefined;
          r.txHash = undefined;
          r.userOpHash = undefined;
          r.error = undefined;
        });
      }
    }
    throw lastErr;
  }

  private async _submitBatchInner(batch: CombinedBatch): Promise<Hex> {
    logger.info(
      { batchId: batch.batchId, account: batch.account, paymaster: this.paymasterAddress ?? "none" },
      "Building UserOp",
    );

    // 1. Build unsigned op (gas estimated via RPC or constants)
    let userOp = await this.builder.build(batch);

    // 2. Populate paymasterAndData when a VerifyingPaymaster is configured.
    //    Format for ERC-4337 v0.7 VerifyingPaymaster (no signature — open mode):
    //      paymaster address (20 bytes) + validUntil (6 bytes) + validAfter (6 bytes)
    //    A real deployment would also append the paymaster's ECDSA signature.
    if (this.paymasterAddress) {
      const validUntil = Math.floor(Date.now() / 1000) + 600; // valid for 10 minutes
      const validAfter = 0;
      userOp = {
        ...userOp,
        paymasterAndData: (
          this.paymasterAddress +
          validUntil.toString(16).padStart(12, "0") +
          validAfter.toString(16).padStart(12, "0")
        ) as Hex,
      };
      logger.debug({ batchId: batch.batchId, paymasterAndData: userOp.paymasterAndData }, "Paymaster data attached");
    }

    // 3. Get hash from EntryPoint
    const userOpHash = await this.builder.getUserOpHash(userOp);
    logger.debug({ batchId: batch.batchId, userOpHash }, "UserOp hash obtained");

    // 4. Sign with agent key (EIP-191 personal_sign wraps the hash)
    const signature = await this._signUserOpHash(userOpHash);
    const signedOp: PackedUserOperation = { ...userOp, signature };

    // 5. Submit via EntryPoint.handleOps
    const submittedAt = Date.now();
    const txHash = await this._handleOps(signedOp);
    logger.info({ batchId: batch.batchId, txHash }, "UserOp submitted — waiting for receipt");

    // Mark submittedAt on all records the moment the tx is broadcast
    batch.records.forEach((r) => { r.submittedAt = submittedAt; });

    // 6. Wait for inclusion
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const executedAt = Date.now();
    const success = receipt.status === "success";

    logger.info(
      {
        batchId: batch.batchId,
        txHash,
        success,
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: executedAt - submittedAt,
      },
      success ? "Batch executed" : "Batch transaction reverted",
    );

    // Update all intent records in the batch
    const nextStatus = success ? "executed" : "failed";
    batch.records.forEach((r) => {
      r.status = nextStatus;
      r.txHash = txHash;
      r.userOpHash = userOpHash;
      r.executedAt = executedAt;
      r.gasUsed = receipt.gasUsed;
    });

    // Record executed intents in the on-chain IntentRegistry (fire-and-forget)
    if (success && this.registryAddress) {
      this._recordBatchOnChain(batch).catch((err) => {
        logger.warn({ batchId: batch.batchId, err }, "Registry record failed (non-fatal)");
      });
    }

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

  private async _recordBatchOnChain(batch: CombinedBatch): Promise<void> {
    if (!this.registryAddress) return;
    const account = this.walletClient.account;
    if (!account) return;

    // Derive deterministic bytes32 IDs from the relayer's UUID strings
    const intentIds = batch.records.map(
      (r) => keccak256(toBytes(r.id)) as Hex,
    );

    await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: INTENT_REGISTRY_ABI,
      functionName: "recordBatchExecution",
      args: [intentIds],
      account,
      chain: this.walletClient.chain ?? null,
    });

    logger.info(
      { batchId: batch.batchId, count: intentIds.length },
      "Batch recorded on-chain in IntentRegistry",
    );
  }
}
