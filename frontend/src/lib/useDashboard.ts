"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { IntentRecord, DashboardMetrics, TpsPoint, GasSavingsPoint } from "./dashboardTypes";

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
    return (await res.json()) as IntentRecord;
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

  // Bucket by 10-second windows
  const WINDOW_MS = 10_000;
  const buckets = new Map<number, number>();
  for (const r of records) {
    const bucket = Math.floor(r.submittedAt / WINDOW_MS) * WINDOW_MS;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .slice(-20) // keep last 20 windows
    .map(([ts, count]) => {
      const d = new Date(ts);
      const label = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
      return { time: label, tps: parseFloat((count / (WINDOW_MS / 1000)).toFixed(3)), timestamp: ts };
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
      const batched = estimateBatchGas(n);
      return {
        batchId,
        label: `B${i + 1}`,
        intentCount: n,
        gasSavedPct: parseFloat(gasSavedPct(n).toFixed(1)),
        gasIndividual: individual,
        gasBatched: batched,
      } satisfies GasSavingsPoint;
    });
}

export function useDashboardMetrics(records: IntentRecord[]): DashboardMetrics {
  const pending = records.filter((r) => r.status === "pending").length;
  const batched = records.filter((r) => r.status === "batched").length;
  const executed = records.filter((r) => r.status === "executed").length;
  const failed = records.filter((r) => r.status === "failed").length;

  const executedRecords = records.filter((r) => r.batchId);
  const groups = new Map<string, number>();
  for (const r of executedRecords) {
    if (r.batchId) groups.set(r.batchId, (groups.get(r.batchId) ?? 0) + 1);
  }
  const avgBatchSize =
    groups.size > 0
      ? Array.from(groups.values()).reduce((s, v) => s + v, 0) / groups.size
      : 0;

  const totalIndividual = records.length * GAS_PER_INTENT;
  const totalBatched = Array.from(groups.entries()).reduce((sum, [, n]) => {
    return sum + estimateBatchGas(n);
  }, 0) + (records.length - executedRecords.length) * GAS_PER_INTENT;

  const totalGasSavedPct =
    totalIndividual > 0
      ? parseFloat((((totalIndividual - totalBatched) / totalIndividual) * 100).toFixed(1))
      : 0;

  return {
    totalIntents: records.length,
    pendingCount: pending,
    batchedCount: batched,
    executedCount: executed,
    failedCount: failed,
    avgBatchSize: parseFloat(avgBatchSize.toFixed(1)),
    totalGasSavedPct,
    tpsHistory: buildTpsHistory(records),
    gasSavingsHistory: buildGasSavingsHistory(records),
  };
}

// --- Demo data generator for when no live relayer is available ---

let _demoSeed = 0;
function nextId() {
  return `0x${(++_demoSeed).toString(16).padStart(64, "0")}`;
}

export function generateDemoRecords(count = 40): IntentRecord[] {
  const actions: IntentRecord["action"][] = ["SWAP", "DCA", "REBALANCE"];
  const statuses: IntentRecord["status"][] = ["pending", "batched", "executed", "executed", "executed"];
  const now = Date.now();
  const batches = ["batch-aaa", "batch-bbb", "batch-ccc", "batch-ddd"];
  const records: IntentRecord[] = [];

  for (let i = 0; i < count; i++) {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const batchIdx = Math.floor(i / 4);
    const batchId = status !== "pending" ? batches[batchIdx % batches.length] : undefined;
    records.push({
      intentId: nextId(),
      userId: `user-${(i % 5) + 1}`,
      action: actions[i % 3],
      status,
      submittedAt: now - (count - i) * 8_000 + Math.random() * 2000,
      batchId,
      executedAt: status === "executed" ? now - (count - i) * 7_000 : undefined,
    });
  }
  return records;
}
