"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricsSummary } from "@/components/dashboard/MetricsSummary";
import { IntentQueuePanel } from "@/components/dashboard/IntentQueuePanel";
import { GasSavingsChart } from "@/components/dashboard/GasSavingsChart";
import { ThroughputChart } from "@/components/dashboard/ThroughputChart";
import { useDashboardMetrics, generateDemoRecords } from "@/lib/useDashboard";
import type { IntentRecord } from "@/lib/dashboardTypes";
import { Badge } from "@/components/ui/badge";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";
const DEMO_TOTAL = 40;
const LIVE_POLL_MS = 3_000;

// ── Live mode ──────────────────────────────────────────────────────────────────
// The relayer exposes GET /intents/:id.  In a real deployment the dashboard
// would consume a paginated GET /intents endpoint; here we use a local registry
// kept in sessionStorage so a page refresh doesn't lose the submitted IDs.

function loadStoredIds(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    return JSON.parse(sessionStorage.getItem("intentIds") ?? "[]");
  } catch {
    return [];
  }
}

function storeIds(ids: string[]) {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("intentIds", JSON.stringify(ids));
  }
}

async function fetchRecord(intentId: string): Promise<IntentRecord | null> {
  try {
    const res = await fetch(`${RELAYER_URL}/intents/${intentId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as IntentRecord;
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

// ── Demo mode: add simulated intents over time ─────────────────────────────────
function useDemoRecords() {
  const [records, setRecords] = useState<IntentRecord[]>([]);

  useEffect(() => {
    // Start with half the dataset already visible
    const initial = generateDemoRecords(Math.floor(DEMO_TOTAL / 2));
    setRecords(initial);

    // Trickle in new intents every ~2s to simulate live activity
    let remaining = DEMO_TOTAL - initial.length;
    const interval = setInterval(() => {
      if (remaining <= 0) {
        clearInterval(interval);
        return;
      }
      const batch = generateDemoRecords(Math.min(3, remaining));
      remaining -= batch.length;
      setRecords((prev) => [...prev, ...batch]);
    }, 2_000);

    return () => clearInterval(interval);
  }, []);

  return records;
}

// ── Live mode: poll known intent IDs from the relayer ──────────────────────────
function useLiveRecords() {
  const [records, setRecords] = useState<IntentRecord[]>([]);

  const refresh = useCallback(async () => {
    const ids = loadStoredIds();
    if (ids.length === 0) return;
    const results = await Promise.all(ids.map(fetchRecord));
    setRecords(results.filter((r): r is IntentRecord => r !== null));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Expose a way for the page to register a newly submitted intentId
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "intentIds") refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  return records;
}

// ── Main client component ──────────────────────────────────────────────────────

export function DashboardClient() {
  const [mode, setMode] = useState<"checking" | "live" | "demo">("checking");

  useEffect(() => {
    probeRelayer().then((ok) => setMode(ok ? "live" : "demo"));
  }, []);

  const demoRecords = useDemoRecords();
  const liveRecords = useLiveRecords();

  const records: IntentRecord[] = mode === "live" ? liveRecords : demoRecords;
  const metrics = useDashboardMetrics(records);

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
          {mode === "checking" && (
            <Badge variant="secondary">Connecting…</Badge>
          )}
          {mode === "live" && (
            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
              Live — {RELAYER_URL}
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
