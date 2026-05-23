"use client";

import type { IntentRecord, IntentStatus } from "@/lib/dashboardTypes";

const STATUS_STYLES: Record<IntentStatus, string> = {
  pending:  "text-amber-400 bg-amber-950/40",
  batched:  "text-zinc-300 bg-zinc-800",
  executed: "text-emerald-400 bg-emerald-950/40",
  failed:   "text-red-400 bg-red-950/40",
};

const STATUS_LABEL: Record<IntentStatus, string> = {
  pending:  "Pending",
  batched:  "Batched",
  executed: "Done",
  failed:   "Failed",
};

const ACTION_STYLES: Record<string, string> = {
  SWAP:      "text-zinc-200",
  TRANSFER:  "text-zinc-200",
  DCA:       "text-zinc-200",
  REBALANCE: "text-zinc-200",
};

function truncate(hex: string, chars = 6) {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}…${hex.slice(-4)}`;
}

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

interface Props {
  records: IntentRecord[];
  isLive?: boolean;
}

export function IntentQueuePanel({ records, isLive = false }: Props) {
  const sorted = [...records].sort(
    (a, b) => (b.receivedAt ?? b.submittedAt ?? 0) - (a.receivedAt ?? a.submittedAt ?? 0),
  );

  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      {/* Table header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Intent Queue</span>
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
              Live
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{records.length} total</span>
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-[80px_1fr_100px_80px_80px_70px] gap-4 px-4 py-1.5 border-b border-border/40 bg-muted/20">
        {["Action", "Intent ID", "Batch", "Latency", "Gas", "Status"].map((h) => (
          <span key={h} className="text-xs text-muted-foreground/60 font-medium uppercase tracking-wider">{h}</span>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">No intents yet.</div>
      ) : (
        <div className="overflow-y-auto max-h-[380px] divide-y divide-border/30">
          {sorted.map((r) => (
            <div
              key={r.intentId}
              className="grid grid-cols-[80px_1fr_100px_80px_80px_70px] gap-4 items-center px-4 py-2.5 hover:bg-muted/20 transition-colors"
            >
              {/* Action */}
              <span className={`text-xs font-semibold ${ACTION_STYLES[r.action] ?? "text-zinc-200"}`}>
                {r.action}
              </span>

              {/* Intent ID + user */}
              <div className="min-w-0">
                <p className="text-xs font-mono text-zinc-300 truncate">{truncate(r.intentId)}</p>
                <p className="text-xs text-muted-foreground/60 truncate">{r.userId}</p>
                {r.status === "failed" && r.error && (
                  <p className="text-xs text-red-400/80 truncate mt-0.5" title={r.error}>{r.error}</p>
                )}
              </div>

              {/* Batch */}
              <span className="text-xs font-mono text-muted-foreground truncate">
                {r.batchId ? truncate(r.batchId, 4) : "—"}
              </span>

              {/* Latency */}
              <span className={`text-xs tabular-nums ${
                r.latencyMs != null && r.status === "executed"
                  ? r.latencyMs < 2000 ? "text-emerald-400" : r.latencyMs < 5000 ? "text-amber-400" : "text-red-400"
                  : "text-muted-foreground/40"
              }`}>
                {r.latencyMs != null && r.status === "executed" ? `${r.latencyMs} ms` : "—"}
              </span>

              {/* Gas */}
              <span className="text-xs font-mono tabular-nums text-muted-foreground">
                {r.gasUsed != null && r.status === "executed" ? r.gasUsed.toLocaleString() : "—"}
              </span>

              {/* Status badge */}
              <span className={`text-xs px-2 py-0.5 rounded font-medium w-fit ${STATUS_STYLES[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
