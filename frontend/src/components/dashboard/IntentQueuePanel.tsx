"use client";

import { ArrowRightLeft, GitBranch, Repeat, Send } from "lucide-react";
import type { IntentAction, IntentRecord, IntentStatus } from "@/lib/dashboardTypes";

const STATUS_STYLES: Record<IntentStatus, string> = {
  pending: "text-amber-400 bg-amber-950/40",
  batched: "text-zinc-300 bg-zinc-800",
  executed: "text-emerald-400 bg-emerald-950/40",
  failed: "text-red-400 bg-red-950/40",
};

const STATUS_LABEL: Record<IntentStatus, string> = {
  pending: "Pending",
  batched: "Batched",
  executed: "Done",
  failed: "Failed",
};

const ACTION_LABELS: Record<IntentAction, string> = {
  SWAP: "Swap",
  TRANSFER: "Send",
  DCA: "DCA",
  REBALANCE: "Rebal",
};

const ACTION_STYLES: Record<IntentAction, string> = {
  SWAP: "border-cyan-500/30 bg-cyan-950/35 text-cyan-300",
  TRANSFER: "border-violet-500/30 bg-violet-950/35 text-violet-300",
  DCA: "border-amber-500/30 bg-amber-950/35 text-amber-300",
  REBALANCE: "border-emerald-500/30 bg-emerald-950/35 text-emerald-300",
};

const ACTION_ICONS: Record<IntentAction, React.ReactNode> = {
  SWAP: <ArrowRightLeft className="h-3 w-3" />,
  TRANSFER: <Send className="h-3 w-3" />,
  DCA: <Repeat className="h-3 w-3" />,
  REBALANCE: <GitBranch className="h-3 w-3" />,
};

function truncate(value: string, chars = 6) {
  if (value.length <= chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}...${value.slice(-4)}`;
}

function ActionBadge({ action }: { action: IntentAction }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${ACTION_STYLES[action]}`}>
      {ACTION_ICONS[action]}
      {ACTION_LABELS[action]}
    </span>
  );
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
    <div className="overflow-hidden rounded-md border border-border/60">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Intent Queue</span>
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live
            </span>
          )}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{records.length} total</span>
      </div>

      <div className="grid grid-cols-[92px_1fr_100px_80px_80px_70px] gap-4 border-b border-border/40 bg-muted/20 px-4 py-1.5">
        {["Action", "Intent ID", "Batch", "Latency", "Gas", "Status"].map((h) => (
          <span key={h} className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
            {h}
          </span>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">No intents yet.</div>
      ) : (
        <div className="max-h-[380px] divide-y divide-border/30 overflow-y-auto">
          {sorted.map((r) => (
            <div
              key={r.intentId}
              className="grid grid-cols-[92px_1fr_100px_80px_80px_70px] items-center gap-4 px-4 py-2.5 transition-colors hover:bg-muted/20"
            >
              <ActionBadge action={r.action} />

              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-zinc-300">{truncate(r.intentId)}</p>
                <p className="truncate text-xs text-muted-foreground/60">{r.userId}</p>
                {r.status === "failed" && r.error && (
                  <p className="mt-0.5 truncate text-xs text-red-400/80" title={r.error}>
                    {r.error}
                  </p>
                )}
              </div>

              <span className="truncate font-mono text-xs text-muted-foreground">
                {r.batchId ? truncate(r.batchId, 4) : "-"}
              </span>

              <span
                className={`text-xs tabular-nums ${
                  r.latencyMs != null && r.status === "executed"
                    ? r.latencyMs < 2000
                      ? "text-emerald-400"
                      : r.latencyMs < 5000
                        ? "text-amber-400"
                        : "text-red-400"
                    : "text-muted-foreground/40"
                }`}
              >
                {r.latencyMs != null && r.status === "executed" ? `${r.latencyMs} ms` : "-"}
              </span>

              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {r.gasUsed != null && r.status === "executed" ? r.gasUsed.toLocaleString() : "-"}
              </span>

              <span className={`w-fit rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
