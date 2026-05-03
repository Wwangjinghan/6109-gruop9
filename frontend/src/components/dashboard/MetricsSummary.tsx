"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { DashboardMetrics } from "@/lib/dashboardTypes";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "yellow" | "red" | "blue" | "default";
}

const ACCENT_CLASSES: Record<NonNullable<StatCardProps["accent"]>, string> = {
  green: "text-emerald-600",
  yellow: "text-amber-500",
  red: "text-destructive",
  blue: "text-blue-600",
  default: "text-foreground",
};

function StatCard({ label, value, sub, accent = "default" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${ACCENT_CLASSES[accent]}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface Props {
  metrics: DashboardMetrics;
}

export function MetricsSummary({ metrics }: Props) {
  const {
    totalIntents,
    pendingCount,
    executedCount,
    failedCount,
    failedRatePct,
    avgBatchSize,
    totalGasSavedPct,
    avgLatencyMs,
    maxLatencyMs,
  } = metrics;

  const latencyLabel =
    avgLatencyMs != null ? `${avgLatencyMs} ms` : "—";
  const latencySub =
    maxLatencyMs != null ? `max ${maxLatencyMs} ms` : "no data yet";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard
        label="Total Intents"
        value={totalIntents}
        sub="all time"
        accent="blue"
      />
      <StatCard
        label="Pending"
        value={pendingCount}
        sub="in queue"
        accent={pendingCount > 0 ? "yellow" : "default"}
      />
      <StatCard
        label="Completed"
        value={executedCount}
        sub="on-chain"
        accent="green"
      />
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
        sub={`avg batch ${avgBatchSize > 0 ? `${avgBatchSize}x` : "—"}`}
        accent={totalGasSavedPct >= 30 ? "green" : totalGasSavedPct > 0 ? "yellow" : "default"}
      />
    </div>
  );
}
