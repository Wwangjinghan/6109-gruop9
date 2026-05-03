export type IntentStatus = "pending" | "batched" | "executed" | "failed";
export type IntentAction = "SWAP" | "DCA" | "REBALANCE" | "TRANSFER";

export interface IntentRecord {
  intentId: string;
  userId: string;
  action: IntentAction;
  status: IntentStatus;
  submittedAt: number;    // unix ms — sent to EntryPoint
  receivedAt?: number;    // unix ms — arrived at relayer
  executedAt?: number;    // unix ms — on-chain receipt confirmed
  latencyMs?: number;     // executedAt - submittedAt (provided by relayer)
  gasUsed?: number;       // actual gas used (serialised as number from bigint string)
  batchId?: string;
  txHash?: string;
  error?: string;
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
  gasUsedReal?: number;  // present when gasBatched came from a real on-chain receipt
}

/** One point on the latency timeseries. */
export interface LatencyPoint {
  label: string;       // short label, e.g. batch index
  latencyMs: number;   // execution latency for this batch
  timestamp: number;   // unix ms
}

export interface DashboardMetrics {
  totalIntents: number;
  pendingCount: number;
  batchedCount: number;
  executedCount: number;
  failedCount: number;
  failedRatePct: number;     // failedCount / total * 100
  avgBatchSize: number;
  totalGasSavedPct: number;
  avgLatencyMs: number | null;  // null when no completed intents yet
  maxLatencyMs: number | null;
  // Real gas data from on-chain receipts (null until at least one receipt is available)
  avgGasPerBatch: number | null;
  gasDataPoints: number;        // how many batches have real gasUsed data
  tpsHistory: TpsPoint[];
  gasSavingsHistory: GasSavingsPoint[];
  latencyHistory: LatencyPoint[];
}
