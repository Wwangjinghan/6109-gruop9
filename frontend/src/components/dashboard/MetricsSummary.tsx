"use client";

import type { DashboardMetrics } from "@/lib/dashboardTypes";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "yellow" | "red" | "default";
}

function StatCard({ label, value, sub, accent = "default" }: StatCardProps) {
  const valueColor =
    accent === "green"  ? "text-emerald-400" :
    accent === "yellow" ? "text-amber-400"   :
    accent === "red"    ? "text-red-400"      :
    "text-foreground";

  return (
    <div className="bg-card border border-border/60 rounded-md px-4 py-3 space-y-1">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums leading-none ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

interface Props {
  metrics: DashboardMetrics;
}

export function MetricsSummary({ metrics }: Props) {
  const {
    totalIntents, pendingCount, executedCount, failedCount,
    failedRatePct, avgBatchSize, totalGasSavedPct,
    avgLatencyMs, maxLatencyMs, avgGasPerBatch, gasDataPoints,
  } = metrics;

  const latencyLabel = avgLatencyMs != null ? `${avgLatencyMs} ms` : "—";
  const latencySub   = maxLatencyMs != null ? `max ${maxLatencyMs} ms` : "no data yet";

  const gasSavedSub = gasDataPoints > 0
    ? `${gasDataPoints} batch${gasDataPoints > 1 ? "es" : ""} · real receipts`
    : `avg batch ${avgBatchSize > 0 ? `${avgBatchSize}x` : "—"} · estimated`;

  const gasPerBatchLabel = avgGasPerBatch != null ? avgGasPerBatch.toLocaleString() : "—";
  const gasPerBatchSub   = avgGasPerBatch != null
    ? `${gasDataPoints} sample${gasDataPoints !== 1 ? "s" : ""}`
    : "awaiting receipts";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <StatCard label="Total" value={totalIntents} sub="all time" />
      <StatCard
        label="Pending"
        value={pendingCount}
        sub="in queue"
        accent={pendingCount > 0 ? "yellow" : "default"}
      />
      <StatCard label="Completed" value={executedCount} sub="on-chain" accent="green" />
      <StatCard
        label="Failed"
        value={failedCount > 0 ? `${failedCount} (${failedRatePct}%)` : "0"}
        sub={failedRatePct > 5 ? "high failure rate" : "failure rate"}
        accent={failedRatePct > 10 ? "red" : failedRatePct > 0 ? "yellow" : "default"}
      />
      <StatCard
        label="Avg Latency"
        value={latencyLabel}
        sub={latencySub}
        accent={
          avgLatencyMs == null ? "default"
          : avgLatencyMs < 2000 ? "green"
          : avgLatencyMs < 5000 ? "yellow"
          : "red"
        }
      />
      <StatCard
        label="Gas Saved"
        value={totalGasSavedPct > 0 ? `${totalGasSavedPct}%` : "—"}
        sub={gasSavedSub}
        accent={totalGasSavedPct >= 30 ? "green" : totalGasSavedPct > 0 ? "yellow" : "default"}
      />
      <StatCard
        label="Avg Gas / Batch"
        value={gasPerBatchLabel}
        sub={gasPerBatchSub}
      />
    </div>
  );
}
