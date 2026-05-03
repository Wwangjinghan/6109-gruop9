"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricsSummary } from "@/components/dashboard/MetricsSummary";
import { IntentQueuePanel } from "@/components/dashboard/IntentQueuePanel";
import { GasSavingsChart } from "@/components/dashboard/GasSavingsChart";
import { ThroughputChart } from "@/components/dashboard/ThroughputChart";
import { LatencyChart } from "@/components/dashboard/LatencyChart";
import { useDashboardMetrics, generateDemoRecords } from "@/lib/useDashboard";
import type { IntentRecord, DashboardMetrics } from "@/lib/dashboardTypes";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";
const DEMO_TOTAL = 40;
const LIVE_POLL_MS = 3_000;

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

function loadStoredIds(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try { return JSON.parse(sessionStorage.getItem("intentIds") ?? "[]"); }
  catch { return []; }
}

async function fetchRecord(intentId: string): Promise<IntentRecord | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/intents/${intentId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const raw = await res.json();
    if (raw.gasUsed != null) raw.gasUsed = Number(raw.gasUsed);
    return raw as IntentRecord;
  } catch { return null; }
}

async function fetchRelayerMetrics(): Promise<RelayerMetrics | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/metrics`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RelayerMetrics;
  } catch { return null; }
}

async function probeRelayer(): Promise<boolean> {
  try {
    const res = await fetch(`${RELAYER_URL}/health`, { cache: "no-store" });
    return res.ok;
  } catch { return false; }
}

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

function useLiveData(): { records: IntentRecord[]; serverMetrics: RelayerMetrics | null } {
  const [records, setRecords] = useState<IntentRecord[]>([]);
  const [serverMetrics, setServerMetrics] = useState<RelayerMetrics | null>(null);
  const refresh = useCallback(async () => {
    const ids = loadStoredIds();
    const [results, metrics] = await Promise.all([
      ids.length > 0 ? Promise.all(ids.map(fetchRecord)) : Promise.resolve([]),
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
    function onStorage(e: StorageEvent) { if (e.key === "intentIds") refresh(); }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);
  return { records, serverMetrics };
}

function mergeServerMetrics(computed: DashboardMetrics, server: RelayerMetrics | null): DashboardMetrics {
  if (!server) return computed;
  return {
    ...computed,
    totalIntents:   server.total,
    executedCount:  server.executedCount,
    failedCount:    server.failedCount,
    failedRatePct:  server.failedRatePct,
    avgLatencyMs:   server.avgLatencyMs ?? computed.avgLatencyMs,
    maxLatencyMs:   server.maxLatencyMs ?? computed.maxLatencyMs,
    avgGasPerBatch: server.avgGasPerBatch ?? computed.avgGasPerBatch,
    gasDataPoints:  server.gasDataPoints ?? computed.gasDataPoints,
    tpsHistory: computed.tpsHistory.length > 0
      ? computed.tpsHistory
      : [{ time: "now", tps: server.peakTps, timestamp: Date.now() }],
  };
}

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
    <div className="w-full max-w-7xl mx-auto space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Intent queue, execution status, and efficiency metrics
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {mode === "checking" && (
            <span className="text-muted-foreground">Connecting…</span>
          )}
          {mode === "live" && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Live
              {serverMetrics && (
                <span className="text-muted-foreground ml-1">{serverMetrics.total} intents</span>
              )}
            </span>
          )}
          {mode === "demo" && (
            <span className="text-muted-foreground">Demo mode</span>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <MetricsSummary metrics={metrics} />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <GasSavingsChart data={metrics.gasSavingsHistory} />
        <ThroughputChart data={metrics.tpsHistory} />
        <LatencyChart data={metrics.latencyHistory} avgLatencyMs={metrics.avgLatencyMs} />
      </div>

      {/* Intent queue */}
      <IntentQueuePanel records={records} isLive={mode === "live"} />
    </div>
  );
}
