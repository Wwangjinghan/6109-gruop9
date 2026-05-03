"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntentRecord, IntentStatus } from "@/lib/dashboardTypes";

const STATUS_VARIANT: Record<IntentStatus, "secondary" | "default" | "outline" | "destructive"> = {
  pending: "secondary",
  batched: "outline",
  executed: "default",
  failed: "destructive",
};

const STATUS_LABEL: Record<IntentStatus, string> = {
  pending: "Pending",
  batched: "Batched",
  executed: "Completed",
  failed: "Failed",
};

function truncate(hex: string, chars = 8) {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}…${hex.slice(-chars)}`;
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
  const sorted = [...records].sort((a, b) => b.submittedAt - a.submittedAt);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Intent Queue</span>
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="flex items-center gap-1 text-xs font-normal text-emerald-600">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
            <Badge variant="secondary" className="font-mono text-xs">
              {records.length}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">No intents yet.</p>
        ) : (
          <div className="overflow-y-auto max-h-[420px] divide-y">
            {sorted.map((r) => (
              <div key={r.intentId} className="flex items-start justify-between px-6 py-3 hover:bg-muted/40 transition-colors">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{r.action}</span>
                    <span className="text-xs text-muted-foreground font-mono">{truncate(r.intentId)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.userId}
                    {r.batchId && (
                      <span className="ml-2 text-muted-foreground/60 font-mono">
                        batch: {truncate(r.batchId, 4)}
                      </span>
                    )}
                    {r.latencyMs != null && r.status === "executed" && (
                      <span className="ml-2 text-emerald-600/80">{r.latencyMs} ms</span>
                    )}
                  </div>
                  {r.status === "failed" && r.error && (
                    <div className="text-xs text-destructive/80 truncate max-w-[260px]" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-4">
                  <Badge variant={STATUS_VARIANT[r.status]} className="text-xs">
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{timeAgo(r.submittedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
