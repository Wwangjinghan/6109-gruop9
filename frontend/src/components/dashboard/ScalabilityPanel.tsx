"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

// Gas prices in gwei for each execution environment (approximate 2024-2025 averages)
const ENVIRONMENTS = [
  { name: "Ethereum L1",  gasPriceGwei: 20,    color: "hsl(220 55% 55%)", type: "Monolithic" },
  { name: "Arbitrum",     gasPriceGwei: 0.1,   color: "hsl(38  70% 50%)", type: "Optimistic Rollup" },
  { name: "Optimism",     gasPriceGwei: 0.1,   color: "hsl(0   65% 55%)", type: "Optimistic Rollup" },
  { name: "zkSync Era",   gasPriceGwei: 0.025, color: "hsl(270 55% 60%)", type: "ZK Rollup" },
];

const ETH_PRICE_USD = 2500;
const FALLBACK_GAS  = 500_000; // used when no real receipt data yet

function costUSD(gasUsed: number, gasPriceGwei: number): number {
  return gasUsed * gasPriceGwei * 1e-9 * ETH_PRICE_USD;
}

interface TooltipPayload {
  payload: { name: string; costUSD: number; type: string; gasPriceGwei: number; gasUsed: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-border bg-card shadow-md p-3 text-xs space-y-1 min-w-[180px]">
      <p className="font-medium text-foreground">{d.name}</p>
      <p className="text-muted-foreground">{d.type}</p>
      <div className="pt-1 space-y-0.5 text-muted-foreground">
        <p>Gas price: <span className="text-foreground font-mono">{d.gasPriceGwei} gwei</span></p>
        <p>Gas used: <span className="text-foreground font-mono">{d.gasUsed.toLocaleString()}</span></p>
        <p>Cost: <span className="text-emerald-400 font-semibold">${d.costUSD.toFixed(4)}</span></p>
      </div>
    </div>
  );
}

interface Props {
  avgGasPerBatch: number | null;
}

export function ScalabilityPanel({ avgGasPerBatch }: Props) {
  const gasUsed  = avgGasPerBatch ?? FALLBACK_GAS;
  const isReal   = avgGasPerBatch != null;

  const data = ENVIRONMENTS.map((env) => ({
    name:         env.name,
    type:         env.type,
    color:        env.color,
    gasPriceGwei: env.gasPriceGwei,
    gasUsed,
    costUSD:      costUSD(gasUsed, env.gasPriceGwei),
  }));

  const l1Cost  = data[0].costUSD;
  const zkCost  = data[data.length - 1].costUSD;
  const savings = l1Cost > 0 ? Math.round((1 - zkCost / l1Cost) * 100) : 0;

  return (
    <div className="bg-card border border-border/60 rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Modular vs Monolithic</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            cost per batch · {isReal ? "real on-chain gas" : `est. ${(FALLBACK_GAS / 1000).toFixed(0)}k gas`}
          </p>
        </div>
        <span className="text-xs text-emerald-400 font-semibold tabular-nums">
          ZK saves ~{savings}% vs L1
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(0 0% 18%)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: "hsl(0 0% 45%)" }}
            tickLine={false} axisLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`}
            tick={{ fontSize: 9, fill: "hsl(0 0% 45%)" }}
            tickLine={false} axisLine={false} width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(0 0% 14%)" }} />
          <ReferenceLine y={0} stroke="hsl(0 0% 20%)" />
          <Bar dataKey="costUSD" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.map((env) => (
          <div key={env.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: env.color }} />
            <span>{env.name}</span>
            <span className="font-mono text-foreground/70">${env.costUSD.toFixed(env.costUSD < 0.01 ? 4 : 2)}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground/50 pt-1 border-t border-border/30">
        Gas prices: L1 ~20 gwei · Arbitrum/OP ~0.1 gwei · zkSync ~0.025 gwei · ETH=$2,500
      </p>
    </div>
  );
}
