"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { LatencyPoint } from "@/lib/dashboardTypes";

interface TooltipPayload { payload: LatencyPoint; value: number; }

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: TooltipPayload[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const ms = payload[0].value;
  return (
    <div className="rounded border border-border bg-card shadow-md p-3 text-xs space-y-0.5">
      <p className="text-muted-foreground">{label}</p>
      <p className={`font-semibold font-mono ${
        ms < 2000 ? "text-emerald-400" : ms < 5000 ? "text-amber-400" : "text-red-400"
      }`}>
        {ms.toLocaleString()} ms
      </p>
      <p className="text-muted-foreground/60">
        {ms < 2000 ? "Fast" : ms < 5000 ? "Moderate" : "Slow"}
      </p>
    </div>
  );
}

interface Props {
  data: LatencyPoint[];
  avgLatencyMs?: number | null;
}

export function LatencyChart({ data, avgLatencyMs }: Props) {
  const maxMs = data.length > 0 ? Math.max(...data.map((d) => d.latencyMs)) : 5000;
  const yMax = Math.max(5000, Math.ceil(maxMs * 1.2 / 1000) * 1000);

  return (
    <div className="bg-card border border-border/60 rounded-md p-4 space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground">Latency</p>
        <p className="text-xs text-muted-foreground mt-0.5">broadcast → on-chain confirmation</p>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-44 text-xs text-muted-foreground">
          Awaiting executed intents…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 18%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, yMax]}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}s`}
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              tickLine={false} axisLine={false} width={28}
            />
            <Tooltip content={<CustomTooltip />} />
            {avgLatencyMs != null && (
              <ReferenceLine
                y={avgLatencyMs}
                stroke="hsl(38 70% 50%)"
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                label={{ value: `avg`, position: "insideTopRight", fontSize: 9, fill: "hsl(38 70% 55%)" }}
              />
            )}
            <ReferenceLine
              y={3000}
              stroke="hsl(0 60% 50%)"
              strokeDasharray="2 4"
              strokeOpacity={0.4}
              label={{ value: "3s SLA", position: "insideBottomRight", fontSize: 9, fill: "hsl(0 60% 55%)", opacity: 0.7 }}
            />
            <Line
              type="monotone" dataKey="latencyMs"
              stroke="hsl(0 0% 70%)" strokeWidth={1.5}
              dot={{ r: 2.5, fill: "hsl(0 0% 70%)" }}
              activeDot={{ r: 4, fill: "hsl(0 0% 90%)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
