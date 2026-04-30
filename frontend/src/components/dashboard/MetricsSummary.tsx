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
    batchedCount,
    executedCount,
    failedCount,
    avgBatchSize,
    totalGasSavedPct,
  } = metrics;

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
        label="Batched"
        value={batchedCount}
        sub="awaiting execution"
        accent="yellow"
      />
      <StatCard
        label="Completed"
        value={executedCount}
        sub="on-chain"
        accent="green"
      />
      <StatCard
        label="Avg Batch Size"
        value={avgBatchSize > 0 ? `${avgBatchSize}x` : "—"}
        sub="intents per batch"
        accent="blue"
      />
      <StatCard
        label="Gas Saved"
        value={totalGasSavedPct > 0 ? `${totalGasSavedPct}%` : "—"}
        sub="vs individual txns"
        accent={totalGasSavedPct >= 30 ? "green" : totalGasSavedPct > 0 ? "yellow" : "default"}
      />
    </div>
  );
}
