export type IntentStatus = "pending" | "batched" | "executed" | "failed";
export type IntentAction = "SWAP" | "DCA" | "REBALANCE";

export interface IntentRecord {
  intentId: string;
  userId: string;
  action: IntentAction;
  status: IntentStatus;
  submittedAt: number;   // unix ms
  executedAt?: number;
  batchId?: string;
  txHash?: string;
}

export interface BatchRecord {
  batchId: string;
  intentCount: number;
  combinedCount: number; // how many were actually combined (< intentCount means some were solo)
  createdAt: number;
  executedAt?: number;
  gasUsed?: bigint;
  txHash?: string;
}

/** One point on the throughput timeseries. */
export interface TpsPoint {
  time: string;         // HH:MM:SS label
  tps: number;          // intents per second in this window
  timestamp: number;    // unix ms, for sorting
}

/** One bar in the gas savings chart. */
export interface GasSavingsPoint {
  batchId: string;
  label: string;        // short label, e.g. "Batch 1"
  intentCount: number;
  gasSavedPct: number;  // 0–100
  gasIndividual: number; // hypothetical (intentCount * GAS_PER_INTENT)
  gasBatched: number;    // actual or estimated
}

export interface DashboardMetrics {
  totalIntents: number;
  pendingCount: number;
  batchedCount: number;
  executedCount: number;
  failedCount: number;
  avgBatchSize: number;
  totalGasSavedPct: number;  // weighted average across all batches
  tpsHistory: TpsPoint[];
  gasSavingsHistory: GasSavingsPoint[];
}
