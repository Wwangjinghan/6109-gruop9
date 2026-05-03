"use client";

import { useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { submitIntent, type IntentParams } from "@/lib/intentClient";

type ActionType = "SWAP" | "TRANSFER" | "DCA" | "REBALANCE";

const ACTION_LABELS: Record<ActionType, string> = {
  SWAP: "Swap",
  TRANSFER: "Transfer",
  DCA: "DCA",
  REBALANCE: "Rebalance",
};

// ─── Per-action field state shapes ───────────────────────────────────────────

interface SwapFields {
  tokenIn: string; tokenOut: string; amountIn: string; minAmountOut: string; recipient: string;
}
interface TransferFields {
  token: string; to: string; amount: string;
}
interface DcaFields {
  tokenIn: string; tokenOut: string; amountPerInterval: string;
  intervalSeconds: string; totalIntervals: string;
}
interface RebalanceFields {
  tokens: string; targetWeightsBps: string; toleranceBps: string;
}

function defaultSwap(): SwapFields {
  return { tokenIn: "", tokenOut: "", amountIn: "", minAmountOut: "0", recipient: "" };
}
function defaultTransfer(): TransferFields {
  return { token: "0x0000000000000000000000000000000000000000", to: "", amount: "" };
}
function defaultDca(): DcaFields {
  return { tokenIn: "", tokenOut: "", amountPerInterval: "", intervalSeconds: "86400", totalIntervals: "7" };
}
function defaultRebalance(): RebalanceFields {
  return { tokens: "", targetWeightsBps: "", toleranceBps: "50" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function IntentForm() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [action, setAction] = useState<ActionType>("SWAP");
  const [swapF, setSwapF] = useState<SwapFields>(defaultSwap());
  const [transferF, setTransferF] = useState<TransferFields>(defaultTransfer());
  const [dcaF, setDcaF] = useState<DcaFields>(defaultDca());
  const [rebalanceF, setRebalanceF] = useState<RebalanceFields>(defaultRebalance());

  const [status, setStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildParams = (): IntentParams => {
    if (action === "SWAP") {
      return {
        action: "SWAP",
        tokenIn: swapF.tokenIn,
        tokenOut: swapF.tokenOut,
        amountIn: swapF.amountIn,
        minAmountOut: swapF.minAmountOut || "0",
        ...(swapF.recipient && { recipient: swapF.recipient }),
      };
    }
    if (action === "TRANSFER") {
      return {
        action: "TRANSFER",
        token: transferF.token,
        to: transferF.to,
        amount: transferF.amount,
      };
    }
    if (action === "DCA") {
      return {
        action: "DCA",
        tokenIn: dcaF.tokenIn,
        tokenOut: dcaF.tokenOut,
        amountPerInterval: dcaF.amountPerInterval,
        intervalSeconds: parseInt(dcaF.intervalSeconds, 10),
        totalIntervals: parseInt(dcaF.totalIntervals, 10),
      };
    }
    // REBALANCE
    return {
      action: "REBALANCE",
      tokens: rebalanceF.tokens.split(",").map((t) => t.trim()),
      targetWeightsBps: rebalanceF.targetWeightsBps.split(",").map((w) => parseInt(w.trim(), 10)),
      ...(rebalanceF.toleranceBps && { toleranceBps: parseInt(rebalanceF.toleranceBps, 10) }),
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletClient || !isConnected) return;
    setStatus("signing");
    setError(null);
    try {
      const params = buildParams();
      setStatus("submitting");
      const result = await submitIntent(walletClient, params);
      setIntentId(result.intentId);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const statusBadge = {
    idle: null,
    signing: <Badge variant="secondary">Signing…</Badge>,
    submitting: <Badge variant="secondary">Submitting…</Badge>,
    success: <Badge variant="default">Submitted</Badge>,
    error: <Badge variant="destructive">Error</Badge>,
  }[status];

  const busy = status === "signing" || status === "submitting";

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Submit Intent
          {statusBadge}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <p className="text-muted-foreground text-sm">Connect your wallet to submit intents.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Connected: <span className="font-mono text-xs">{address}</span>
              </label>
            </div>

            {/* Action type selector */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Action</label>
              <div className="flex gap-2 flex-wrap">
                {(["SWAP", "TRANSFER", "DCA", "REBALANCE"] as ActionType[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAction(a)}
                    className={`px-3 py-1 rounded text-sm border transition-colors ${
                      action === a
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>

            {/* SWAP fields */}
            {action === "SWAP" && (
              <>
                <Field label="Token In (address)" value={swapF.tokenIn} onChange={(v) => setSwapF((f) => ({ ...f, tokenIn: v }))} placeholder="0x..." required />
                <Field label="Token Out (address)" value={swapF.tokenOut} onChange={(v) => setSwapF((f) => ({ ...f, tokenOut: v }))} placeholder="0x..." required />
                <Field label="Amount In (wei)" value={swapF.amountIn} onChange={(v) => setSwapF((f) => ({ ...f, amountIn: v }))} placeholder="1000000" required />
                <Field label="Min Amount Out (wei)" value={swapF.minAmountOut} onChange={(v) => setSwapF((f) => ({ ...f, minAmountOut: v }))} placeholder="0" />
                <Field label="Recipient (optional)" value={swapF.recipient} onChange={(v) => setSwapF((f) => ({ ...f, recipient: v }))} placeholder="0x… (defaults to account)" />
              </>
            )}

            {/* TRANSFER fields */}
            {action === "TRANSFER" && (
              <>
                <Field label="Token (0x000…000 for ETH)" value={transferF.token} onChange={(v) => setTransferF((f) => ({ ...f, token: v }))} placeholder="0x…" required />
                <Field label="Recipient" value={transferF.to} onChange={(v) => setTransferF((f) => ({ ...f, to: v }))} placeholder="0x…" required />
                <Field label="Amount (wei)" value={transferF.amount} onChange={(v) => setTransferF((f) => ({ ...f, amount: v }))} placeholder="1000000000000000000" required />
              </>
            )}

            {/* DCA fields */}
            {action === "DCA" && (
              <>
                <Field label="Token In (address)" value={dcaF.tokenIn} onChange={(v) => setDcaF((f) => ({ ...f, tokenIn: v }))} placeholder="0x…" required />
                <Field label="Token Out (address)" value={dcaF.tokenOut} onChange={(v) => setDcaF((f) => ({ ...f, tokenOut: v }))} placeholder="0x…" required />
                <Field label="Amount Per Interval (wei)" value={dcaF.amountPerInterval} onChange={(v) => setDcaF((f) => ({ ...f, amountPerInterval: v }))} placeholder="1000000" required />
                <Field label="Interval (seconds)" value={dcaF.intervalSeconds} onChange={(v) => setDcaF((f) => ({ ...f, intervalSeconds: v }))} placeholder="86400" required />
                <Field label="Total Intervals" value={dcaF.totalIntervals} onChange={(v) => setDcaF((f) => ({ ...f, totalIntervals: v }))} placeholder="7" required />
              </>
            )}

            {/* REBALANCE fields */}
            {action === "REBALANCE" && (
              <>
                <Field label="Token addresses (comma-separated)" value={rebalanceF.tokens} onChange={(v) => setRebalanceF((f) => ({ ...f, tokens: v }))} placeholder="0xA…, 0xB…" required />
                <Field label="Target weights bps (comma-separated, sum=10000)" value={rebalanceF.targetWeightsBps} onChange={(v) => setRebalanceF((f) => ({ ...f, targetWeightsBps: v }))} placeholder="5000, 5000" required />
                <Field label="Tolerance bps" value={rebalanceF.toleranceBps} onChange={(v) => setRebalanceF((f) => ({ ...f, toleranceBps: v }))} placeholder="50" />
              </>
            )}

            {error && <p className="text-destructive text-sm">{error}</p>}
            {intentId && (
              <p className="text-sm text-muted-foreground break-all">
                Intent ID: <span className="font-mono">{intentId}</span>
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              Sign &amp; Submit Intent
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Small field helper ───────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
