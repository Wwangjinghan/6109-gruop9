"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricsSummary } from "@/components/dashboard/MetricsSummary";
import { IntentQueuePanel } from "@/components/dashboard/IntentQueuePanel";
import { GasSavingsChart } from "@/components/dashboard/GasSavingsChart";
import { ThroughputChart } from "@/components/dashboard/ThroughputChart";
import { useDashboardMetrics, generateDemoRecords } from "@/lib/useDashboard";
import type { IntentRecord, DashboardMetrics } from "@/lib/dashboardTypes";
import { Badge } from "@/components/ui/badge";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";
const DEMO_TOTAL = 40;
const LIVE_POLL_MS = 3_000;

// ── Relayer /metrics response shape ───────────────────────────────────────────
interface RelayerMetrics {
  total: number;
  executedCount: number;
  failedCount: number;
  failedRatePct: number;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  peakTps: number;
  avgGasPerBatch: number | null;
  gasDataPoints: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadStoredIds(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    return JSON.parse(sessionStorage.getItem("intentIds") ?? "[]");
  } catch {
    return [];
  }
}

async function fetchRecord(intentId: string): Promise<IntentRecord | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/intents/${intentId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const raw = await res.json();
    // gasUsed arrives as decimal string from bigint serialisation
    if (raw.gasUsed != null) raw.gasUsed = Number(raw.gasUsed);
    // latencyMs may be computed server-side; keep it if present
    return raw as IntentRecord;
  } catch {
    return null;
  }
}

async function fetchRelayerMetrics(): Promise<RelayerMetrics | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/metrics`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RelayerMetrics;
  } catch {
    return null;
  }
}

async function probeRelayer(): Promise<boolean> {
  try {
    const res = await fetch(`${RELAYER_URL}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Demo mode ─────────────────────────────────────────────────────────────────
function useDemoRecords() {
  const [records, setRecords] = useState<IntentRecord[]>([]);

  useEffect(() => {
    const initial = generateDemoRecords(Math.floor(DEMO_TOTAL / 2));
    setRecords(initial);

    let remaining = DEMO_TOTAL - initial.length;
    const interval = setInterval(() => {
      if (remaining <= 0) { clearInterval(interval); return; }
      const batch = generateDemoRecords(Math.min(3, remaining));
      remaining -= batch.length;
      setRecords((prev) => [...prev, ...batch]);
    }, 2_000);

    return () => clearInterval(interval);
  }, []);

  return records;
}

// ── Live mode — polls both /intents/:id AND /metrics ──────────────────────────
function useLiveData(): { records: IntentRecord[]; serverMetrics: RelayerMetrics | null } {
  const [records, setRecords] = useState<IntentRecord[]>([]);
  const [serverMetrics, setServerMetrics] = useState<RelayerMetrics | null>(null);

  const refresh = useCallback(async () => {
    // Fetch both in parallel
    const ids = loadStoredIds();
    const [results, metrics] = await Promise.all([
      ids.length > 0
        ? Promise.all(ids.map(fetchRecord))
        : Promise.resolve([]),
      fetchRelayerMetrics(),
    ]);

    setRecords(results.filter((r): r is IntentRecord => r !== null));
    if (metrics) setServerMetrics(metrics);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "intentIds") refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  return { records, serverMetrics };
}

// ── Merge server metrics into computed DashboardMetrics ───────────────────────
// Server-side aggregates (covering ALL intents, incl. Simulator) override
// the client-side calculations that only see sessionStorage intents.
function mergeServerMetrics(
  computed: DashboardMetrics,
  server: RelayerMetrics | null,
): DashboardMetrics {
  if (!server) return computed;
  return {
    ...computed,
    // Use server totals — these include Simulator-submitted intents too
    totalIntents:   server.total,
    executedCount:  server.executedCount,
    failedCount:    server.failedCount,
    failedRatePct:  server.failedRatePct,
    // Server latency is authoritative (computed across all batches)
    avgLatencyMs:   server.avgLatencyMs ?? computed.avgLatencyMs,
    maxLatencyMs:   server.maxLatencyMs ?? computed.maxLatencyMs,
    // Real gas from on-chain receipts — server deduplicates by batchId
    avgGasPerBatch: server.avgGasPerBatch ?? computed.avgGasPerBatch,
    gasDataPoints:  server.gasDataPoints ?? computed.gasDataPoints,
    // peakTps from server is global; override client-side TPS chart peak
    tpsHistory: computed.tpsHistory.length > 0
      ? computed.tpsHistory
      : [{ time: "now", tps: server.peakTps, timestamp: Date.now() }],
  };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DashboardClient() {
  const [mode, setMode] = useState<"checking" | "live" | "demo">("checking");

  useEffect(() => {
    probeRelayer().then((ok) => setMode(ok ? "live" : "demo"));
  }, []);

  const demoRecords = useDemoRecords();
  const { records: liveRecords, serverMetrics } = useLiveData();

  const records: IntentRecord[] = mode === "live" ? liveRecords : demoRecords;
  const computed = useDashboardMetrics(records);
  const metrics = mode === "live" ? mergeServerMetrics(computed, serverMetrics) : computed;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time intent queue, execution status, and efficiency metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "checking" && <Badge variant="secondary">Connecting…</Badge>}
          {mode === "live" && (
            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
              Live — {RELAYER_URL}
              {serverMetrics && (
                <span className="ml-2 opacity-75 font-normal">
                  {serverMetrics.total} intents
                </span>
              )}
            </Badge>
          )}
          {mode === "demo" && (
            <Badge variant="outline">Demo mode (relayer offline)</Badge>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <MetricsSummary metrics={metrics} />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GasSavingsChart data={metrics.gasSavingsHistory} />
        <ThroughputChart data={metrics.tpsHistory} />
      </div>

      {/* Intent queue */}
      <IntentQueuePanel records={records} isLive={mode === "live"} />
    </div>
  );
}
