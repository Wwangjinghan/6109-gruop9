"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import type { GasSavingsPoint } from "@/lib/dashboardTypes";

interface TooltipPayload { payload: GasSavingsPoint; }

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isReal = d.gasUsedReal != null;
  return (
    <div className="rounded border border-border bg-card shadow-md p-3 text-xs space-y-1 min-w-[160px]">
      <p className="font-medium text-foreground">{d.batchId.startsWith("solo") ? "Solo" : d.batchId}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>Intents: <span className="text-foreground font-mono">{d.intentCount}</span></p>
        <p>Individual: <span className="font-mono">{d.gasIndividual.toLocaleString()}</span></p>
        <p>Batched: <span className="font-mono">{d.gasBatched.toLocaleString()}</span></p>
      </div>
      <p className="text-emerald-400 font-semibold pt-0.5">−{d.gasSavedPct.toFixed(1)}%</p>
      <p className={`text-xs ${isReal ? "text-emerald-400/70" : "text-muted-foreground/50"}`}>
        {isReal ? "on-chain receipt" : "estimate"}
      </p>
    </div>
  );
}

interface Props { data: GasSavingsPoint[]; }

export function GasSavingsChart({ data }: Props) {
  return (
    <div className="bg-card border border-border/60 rounded-md p-4 space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground">Gas Savings</p>
        <p className="text-xs text-muted-foreground mt-0.5">per batch vs. individual execution</p>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-44 text-xs text-muted-foreground">
          No batch data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 18%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              tickLine={false} axisLine={false} width={32}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(0 0% 14%)" }} />
            <ReferenceLine y={0} stroke="hsl(0 0% 20%)" />
            <Bar dataKey="gasSavedPct" radius={[3, 3, 0, 0]} maxBarSize={40}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.gasSavedPct >= 40 ? "hsl(152 60% 40%)" :
                    entry.gasSavedPct >= 15 ? "hsl(38 70% 45%)" :
                    "hsl(0 0% 30%)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
