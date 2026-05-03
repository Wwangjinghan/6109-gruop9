"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import type { TpsPoint } from "@/lib/dashboardTypes";

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-border bg-card shadow-md p-3 text-xs space-y-0.5">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground font-semibold font-mono">{payload[0].value.toFixed(3)} tps</p>
    </div>
  );
}

interface Props { data: TpsPoint[]; }

export function ThroughputChart({ data }: Props) {
  return (
    <div className="bg-card border border-border/60 rounded-md p-4 space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground">Throughput</p>
        <p className="text-xs text-muted-foreground mt-0.5">intents per second · 10s windows</p>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-44 text-xs text-muted-foreground">
          Awaiting intents…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0 0% 70%)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(0 0% 70%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 18%)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              tickLine={false} axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => v.toFixed(1)}
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              tickLine={false} axisLine={false} width={28}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone" dataKey="tps"
              stroke="hsl(0 0% 65%)" strokeWidth={1.5}
              fill="url(#tpsGrad)" dot={false}
              activeDot={{ r: 3, fill: "hsl(0 0% 80%)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
