"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GasSavingsPoint } from "@/lib/dashboardTypes";

interface TooltipPayload {
  payload: GasSavingsPoint;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover text-popover-foreground shadow-md p-3 text-xs space-y-1">
      <p className="font-semibold">{d.batchId.startsWith("solo") ? "Solo" : d.batchId}</p>
      <p>Intents in batch: <span className="font-mono font-semibold">{d.intentCount}</span></p>
      <p>Gas (individual): <span className="font-mono">{d.gasIndividual.toLocaleString()}</span></p>
      <p>Gas (batched): <span className="font-mono">{d.gasBatched.toLocaleString()}</span></p>
      <p className="text-emerald-600 font-semibold">
        Saved: {d.gasSavedPct.toFixed(1)}%
      </p>
    </div>
  );
}

interface Props {
  data: GasSavingsPoint[];
}

export function GasSavingsChart({ data }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gas Savings per Batch</CardTitle>
        <p className="text-xs text-muted-foreground">
          Formula: <span className="font-mono">((Gas_individual × N) − Gas_batched) / (Gas_individual × N) × 100%</span>
        </p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No batch data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="gasSavedPct" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.gasSavedPct >= 40 ? "hsl(142, 71%, 45%)" : entry.gasSavedPct >= 15 ? "hsl(38, 92%, 50%)" : "hsl(var(--muted-foreground))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
