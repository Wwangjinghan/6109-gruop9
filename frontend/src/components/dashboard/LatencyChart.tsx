"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LatencyPoint } from "@/lib/dashboardTypes";

interface TooltipPayload {
  payload: LatencyPoint;
  value: number;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const ms = payload[0].value;
  return (
    <div className="rounded-lg border bg-popover text-popover-foreground shadow-md p-3 text-xs space-y-1">
      <p className="font-semibold text-muted-foreground">{label}</p>
      <p>
        Latency:{" "}
        <span className={`font-mono font-semibold ${
          ms < 2000 ? "text-emerald-600" : ms < 5000 ? "text-amber-500" : "text-destructive"
        }`}>
          {ms.toLocaleString()} ms
        </span>
      </p>
      <p className="text-muted-foreground/70">
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
  // Dynamic Y-axis ceiling: max + 20% headroom, minimum 5000ms
  const maxMs = data.length > 0 ? Math.max(...data.map((d) => d.latencyMs)) : 5000;
  const yMax = Math.max(5000, Math.ceil(maxMs * 1.2 / 1000) * 1000);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Execution Latency</CardTitle>
        <p className="text-xs text-muted-foreground">
          Time from UserOp broadcast to on-chain receipt confirmation (ms)
        </p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Awaiting executed intents…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, yMax]}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}s`}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} />
              {/* Average reference line */}
              {avgLatencyMs != null && (
                <ReferenceLine
                  y={avgLatencyMs}
                  stroke="hsl(38, 92%, 50%)"
                  strokeDasharray="4 3"
                  label={{
                    value: `avg ${avgLatencyMs.toLocaleString()}ms`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "hsl(38, 92%, 50%)",
                  }}
                />
              )}
              {/* Target SLA line at 3s */}
              <ReferenceLine
                y={3000}
                stroke="hsl(var(--destructive))"
                strokeDasharray="2 4"
                strokeOpacity={0.4}
                label={{
                  value: "3s SLA",
                  position: "insideBottomRight",
                  fontSize: 9,
                  fill: "hsl(var(--destructive))",
                  opacity: 0.6,
                }}
              />
              <Line
                type="monotone"
                dataKey="latencyMs"
                stroke="hsl(222, 47%, 45%)"
                strokeWidth={2}
                dot={{ r: 3, fill: "hsl(222, 47%, 45%)" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
