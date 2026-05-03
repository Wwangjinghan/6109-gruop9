"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { IntentRecord, DashboardMetrics, TpsPoint, GasSavingsPoint, LatencyPoint } from "./dashboardTypes";

const RELAYER_URL =
  process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";

// Estimated gas per individual intent execution (fixed-cost model matching relayer defaults)
const GAS_PER_INTENT = 100_000;
// Fixed overhead for a batched UserOperation regardless of call count
const GAS_BATCH_OVERHEAD = 120_000;
// Marginal gas per extra call in a batch
const GAS_PER_EXTRA_CALL = 80_000;

function estimateBatchGas(intentCount: number): number {
  if (intentCount <= 1) return GAS_PER_INTENT;
  return GAS_BATCH_OVERHEAD + intentCount * GAS_PER_EXTRA_CALL;
}

function gasSavedPct(intentCount: number): number {
  if (intentCount <= 1) return 0;
  const individual = intentCount * GAS_PER_INTENT;
  const batched = estimateBatchGas(intentCount);
  return ((individual - batched) / individual) * 100;
}

async function fetchIntentStatus(intentId: string): Promise<IntentRecord | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/intents/${intentId}`);
    if (!res.ok) return null;
    const raw = await res.json();
    // gasUsed arrives as a decimal string (bigint serialisation) — coerce to number
    if (raw.gasUsed != null) raw.gasUsed = Number(raw.gasUsed);
    return raw as IntentRecord;
  } catch {
    return null;
  }
}

// --- Intent Queue hook ---

export function useIntentQueue(intentIds: string[], pollIntervalMs = 3000) {
  const [records, setRecords] = useState<IntentRecord[]>([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (intentIds.length === 0) return;
    const results = await Promise.all(intentIds.map(fetchIntentStatus));
    if (!mountedRef.current) return;
    setRecords(
      results.filter((r): r is IntentRecord => r !== null)
    );
  }, [intentIds]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh, pollIntervalMs]);

  return records;
}

// --- Metrics hook ---
// Derives metrics from a local in-memory history of submitted intents.
// In a production setup this would come from a /metrics endpoint on the relayer.

function buildTpsHistory(records: IntentRecord[]): TpsPoint[] {
  if (records.length === 0) return [];

  const WINDOW_MS = 10_000;
  const buckets = new Map<number, number>();
  for (const r of records) {
    const ts = r.receivedAt ?? r.submittedAt;
    const bucket = Math.floor(ts / WINDOW_MS) * WINDOW_MS;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .slice(-20)
    .map(([ts, count]) => {
      const d = new Date(ts);
      const label = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
      return { time: label, tps: parseFloat((count / (WINDOW_MS / 1000)).toFixed(3)), timestamp: ts };
    });
}

function buildLatencyHistory(records: IntentRecord[]): LatencyPoint[] {
  // Use real latencyMs when available (from relayer), fall back to client-side calculation
  const withLatency = records
    .filter((r) => r.status === "executed")
    .filter((r) => r.latencyMs != null || (r.submittedAt != null && r.executedAt != null))
    .slice(-20);

  return withLatency.map((r, i) => {
    const latencyMs =
      r.latencyMs ??
      (r.submittedAt != null && r.executedAt != null ? r.executedAt - r.submittedAt : 0);
    return {
      label: `#${i + 1}`,
      latencyMs,
      timestamp: r.executedAt ?? r.submittedAt,
    };
  });
}

function buildGasSavingsHistory(records: IntentRecord[]): GasSavingsPoint[] {
  // Group records by batchId (records without a batchId are treated as solo)
  const groups = new Map<string, IntentRecord[]>();
  let soloIdx = 0;
  for (const r of records) {
    const key = r.batchId ?? `solo-${soloIdx++}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  return Array.from(groups.entries())
    .slice(-10) // last 10 batches
    .map(([batchId, recs], i) => {
      const n = recs.length;
      const individual = n * GAS_PER_INTENT;
      // Use real gasUsed if any record in the batch has it (they all share the same receipt)
      const realGas = recs.find((r) => r.gasUsed != null)?.gasUsed;
      const batched = realGas ?? estimateBatchGas(n);
      const savedPct =
        individual > 0
          ? parseFloat((((individual - batched) / individual) * 100).toFixed(1))
          : 0;
      return {
        batchId,
        label: `B${i + 1}`,
        intentCount: n,
        gasSavedPct: savedPct,
        gasIndividual: individual,
        gasBatched: batched,
        ...(realGas != null ? { gasUsedReal: realGas } : {}),
      } satisfies GasSavingsPoint;
    });
}

export function useDashboardMetrics(records: IntentRecord[]): DashboardMetrics {
  const pending = records.filter((r) => r.status === "pending").length;
  const batched = records.filter((r) => r.status === "batched").length;
  const executed = records.filter((r) => r.status === "executed").length;
  const failed = records.filter((r) => r.status === "failed").length;
  const total = records.length;

  const failedRatePct =
    total > 0 ? parseFloat(((failed / total) * 100).toFixed(1)) : 0;

  const batchedRecords = records.filter((r) => r.batchId);
  const groups = new Map<string, number>();
  for (const r of batchedRecords) {
    if (r.batchId) groups.set(r.batchId, (groups.get(r.batchId) ?? 0) + 1);
  }
  const avgBatchSize =
    groups.size > 0
      ? Array.from(groups.values()).reduce((s, v) => s + v, 0) / groups.size
      : 0;

  const totalIndividual = records.length * GAS_PER_INTENT;
  // Prefer real gasUsed per batch; fall back to estimate when unavailable
  const totalBatched =
    Array.from(groups.entries()).reduce((sum, [batchId, n]) => {
      const batchRecords = batchedRecords.filter((r) => r.batchId === batchId);
      const realGas = batchRecords.find((r) => r.gasUsed != null)?.gasUsed;
      return sum + (realGas ?? estimateBatchGas(n));
    }, 0) +
    (records.length - batchedRecords.length) * GAS_PER_INTENT;

  const totalGasSavedPct =
    totalIndividual > 0
      ? parseFloat((((totalIndividual - totalBatched) / totalIndividual) * 100).toFixed(1))
      : 0;

  // Real avgGasPerBatch: deduplicate by batchId, average the receipt gas
  const batchGasMap = new Map<string, number>();
  for (const r of batchedRecords) {
    if (r.batchId && r.gasUsed != null && !batchGasMap.has(r.batchId)) {
      batchGasMap.set(r.batchId, r.gasUsed);
    }
  }
  const avgGasPerBatch =
    batchGasMap.size > 0
      ? Math.round(
          Array.from(batchGasMap.values()).reduce((s, v) => s + v, 0) / batchGasMap.size,
        )
      : null;
  const gasDataPoints = batchGasMap.size;

  // Real latency from relayer-provided latencyMs field
  const withLatency = records.filter(
    (r): r is IntentRecord & { latencyMs: number } => r.latencyMs != null,
  );
  const avgLatencyMs =
    withLatency.length > 0
      ? Math.round(withLatency.reduce((s, r) => s + r.latencyMs, 0) / withLatency.length)
      : null;
  const maxLatencyMs =
    withLatency.length > 0 ? Math.max(...withLatency.map((r) => r.latencyMs)) : null;

  return {
    totalIntents: total,
    pendingCount: pending,
    batchedCount: batched,
    executedCount: executed,
    failedCount: failed,
    failedRatePct,
    avgBatchSize: parseFloat(avgBatchSize.toFixed(1)),
    totalGasSavedPct,
    avgLatencyMs,
    maxLatencyMs,
    avgGasPerBatch,
    gasDataPoints,
    tpsHistory: buildTpsHistory(records),
    gasSavingsHistory: buildGasSavingsHistory(records),
    latencyHistory: buildLatencyHistory(records),
  };
}

// --- Demo data generator for when no live relayer is available ---

let _demoSeed = 0;
function nextId() {
  return `0x${(++_demoSeed).toString(16).padStart(64, "0")}`;
}

export function generateDemoRecords(count = 40): IntentRecord[] {
  const actions: IntentRecord["action"][] = ["SWAP", "DCA", "REBALANCE", "TRANSFER"];
  // ~60% executed, ~15% batched, ~15% pending, ~10% failed
  const statuses: IntentRecord["status"][] = [
    "pending", "batched", "executed", "executed", "executed", "executed", "failed",
  ];
  const now = Date.now();
  const batches = ["batch-aaa", "batch-bbb", "batch-ccc", "batch-ddd"];
  const failureReasons = [
    "UserOp reverted: insufficient balance",
    "Slippage exceeded: minAmountOut not met",
    "EntryPoint: AA21 didn't pay prefund",
  ];
  const records: IntentRecord[] = [];

  for (let i = 0; i < count; i++) {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const batchIdx = Math.floor(i / 4);
    const batchId = status !== "pending" ? batches[batchIdx % batches.length] : undefined;
    const receivedAt = now - (count - i) * 8_000 + Math.random() * 2000;
    const submittedAt = receivedAt + 200 + Math.random() * 300;
    const executedAt =
      status === "executed" || status === "failed"
        ? submittedAt + 800 + Math.random() * 3200
        : undefined;
    const latencyMs = executedAt != null ? Math.round(executedAt - submittedAt) : undefined;
    // Fixed representative gasUsed per batch (4 intents batched together)
    // Based on: EntryPoint overhead ~120k + 4 × ~80k calls = ~440k
    // vs 4 × individual ~180k = ~720k  →  ~39% savings
    // Values cycle through 4 realistic batch sizes so the chart shows variance
    const GAS_SAMPLES = [248_000, 312_000, 195_000, 410_000];
    const gasUsed =
      status === "executed" ? GAS_SAMPLES[batchIdx % GAS_SAMPLES.length] : undefined;

    records.push({
      intentId: nextId(),
      userId: `user-${(i % 5) + 1}`,
      action: actions[i % 4],
      status,
      receivedAt,
      submittedAt,
      executedAt,
      latencyMs,
      gasUsed,
      batchId,
      error:
        status === "failed"
          ? failureReasons[i % failureReasons.length]
          : undefined,
    });
  }
  return records;
}
