import { randomUUID } from "crypto";
import type { Address } from "viem";
import type { IntentPayload, IntentRecord, CombinedBatch } from "../types/intent.js";
import { combineIntents } from "./combiner.js";
import { logger } from "../utils/logger.js";

export interface BatcherConfig {
  maxBatchSize: number;
  batchWindowMs: number;
  // Address of the user's IntentAccount (smart account)
  defaultAccount: Address;
  // Address of the DEX swap router
  swapRouter: Address;
  onBatchReady: (batch: CombinedBatch) => Promise<void>;
}

/**
 * Collects IntentRecords and flushes a CombinedBatch when either
 * maxBatchSize is reached or batchWindowMs elapses.
 *
 * Before flushing the combiner groups compatible SWAP intents so they
 * share a single multi-call within the UserOperation.
 */
export class IntentBatcher {
  private queue: IntentRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly config: BatcherConfig;
  // In-memory status store (intentId → record) — replace with Redis in production
  private readonly store = new Map<string, IntentRecord>();

  constructor(config: BatcherConfig) {
    this.config = config;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  add(payload: IntentPayload): IntentRecord {
    const record: IntentRecord = {
      id: randomUUID(),
      payload,
      status: "pending",
      receivedAt: Date.now(),
    };

    this.store.set(record.id, record);
    this.queue.push(record);
    logger.info({ intentId: record.id, action: payload.action, queueSize: this.queue.length }, "Intent queued");

    if (this.queue.length >= this.config.maxBatchSize) {
      this._flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this._flush(), this.config.batchWindowMs);
    }

    return record;
  }

  getRecord(intentId: string): IntentRecord | undefined {
    return this.store.get(intentId);
  }

  getAllRecords(): IntentRecord[] {
    return Array.from(this.store.values());
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get queueLength(): number {
    return this.queue.length;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;

    const records = this.queue.splice(0, this.config.maxBatchSize);
    records.forEach((r) => { r.status = "batched"; });

    const { combinedSwaps } = combineIntents(
      records,
      this.config.swapRouter,
      this.config.defaultAccount,
    );

    const batchId = randomUUID();

    const batch: CombinedBatch = {
      batchId,
      account: this.config.defaultAccount,
      combinedSwaps,
      singleCalls: [],
      records,
      createdAt: Date.now(),
    };

    records.forEach((r) => { r.batchId = batchId; });

    logger.info(
      { batchId, total: records.length, combinedSwapGroups: combinedSwaps.length },
      "Flushing combined batch",
    );

    this.config.onBatchReady(batch).catch((err) => {
      logger.error({ err, batchId }, "Batch submission failed");
      records.forEach((r) => { r.status = "failed"; r.error = String(err); });
    });
  }
}
