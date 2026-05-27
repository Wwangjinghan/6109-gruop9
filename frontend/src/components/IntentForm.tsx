"use client";

import { useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { ArrowRightLeft, Copy, GitBranch, Loader2, Repeat, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitIntent, type IntentParams } from "@/lib/intentClient";

type ActionType = "SWAP" | "TRANSFER" | "DCA" | "REBALANCE";

const ACTION_LABELS: Record<ActionType, string> = {
  SWAP: "Swap",
  TRANSFER: "Transfer",
  DCA: "DCA",
  REBALANCE: "Rebalance",
};

const ACTION_DESC: Record<ActionType, string> = {
  SWAP: "Exchange one token for another via the DEX router",
  TRANSFER: "Send ERC-20 tokens or native ETH to an address",
  DCA: "Recurring swap at fixed intervals",
  REBALANCE: "Rebalance a portfolio to target weights",
};

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  SWAP: <ArrowRightLeft className="h-3.5 w-3.5" />,
  TRANSFER: <Send className="h-3.5 w-3.5" />,
  DCA: <Repeat className="h-3.5 w-3.5" />,
  REBALANCE: <GitBranch className="h-3.5 w-3.5" />,
};

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";
const DEMO_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DEMO_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DEMO_DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function demoSwap(): SwapFields {
  return { tokenIn: DEMO_USDC, tokenOut: DEMO_WETH, amountIn: "1000000", minAmountOut: "0", recipient: "" };
}
function demoTransfer(address?: string): TransferFields {
  return { token: ZERO_ADDRESS, to: address ?? "", amount: "1000000000000000" };
}
function demoDca(): DcaFields {
  return { tokenIn: DEMO_USDC, tokenOut: DEMO_WETH, amountPerInterval: "1000000", intervalSeconds: "60", totalIntervals: "3" };
}
function demoRebalance(): RebalanceFields {
  return { tokens: `${DEMO_USDC}, ${DEMO_WETH}, ${DEMO_DAI}`, targetWeightsBps: "5000, 3000, 2000", toleranceBps: "50" };
}

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

  const rebalanceWeights = rebalanceF.targetWeightsBps
    .split(",")
    .map((w) => parseInt(w.trim(), 10))
    .filter((n) => !isNaN(n));
  const rebalanceWeightSum = rebalanceWeights.reduce((s, n) => s + n, 0);
  const rebalanceWeightError =
    action === "REBALANCE" && rebalanceF.targetWeightsBps.trim() !== "" && rebalanceWeightSum !== 10000
      ? `Weights sum to ${rebalanceWeightSum}, must equal 10000`
      : null;

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
      return { action: "TRANSFER", token: transferF.token, to: transferF.to, amount: transferF.amount };
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
    return {
      action: "REBALANCE",
      tokens: rebalanceF.tokens.split(",").map((t) => t.trim()),
      targetWeightsBps: rebalanceWeights,
      ...(rebalanceF.toleranceBps && { toleranceBps: parseInt(rebalanceF.toleranceBps, 10) }),
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletClient || !isConnected) return;
    if (rebalanceWeightError) {
      setError(rebalanceWeightError);
      return;
    }
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

  const applyDemo = () => {
    setError(null);
    setIntentId(null);
    if (action === "SWAP") setSwapF(demoSwap());
    if (action === "TRANSFER") setTransferF(demoTransfer(address));
    if (action === "DCA") setDcaF(demoDca());
    if (action === "REBALANCE") setRebalanceF(demoRebalance());
  };

  const resetCurrent = () => {
    setError(null);
    setIntentId(null);
    if (action === "SWAP") setSwapF(defaultSwap());
    if (action === "TRANSFER") setTransferF(defaultTransfer());
    if (action === "DCA") setDcaF(defaultDca());
    if (action === "REBALANCE") setRebalanceF(defaultRebalance());
  };

  const busy = status === "signing" || status === "submitting";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Submit Intent</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Relayer: <span className="font-mono text-foreground/80">{RELAYER_URL}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={applyDemo}>
            Fill demo
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={resetCurrent}>
            Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-md bg-muted p-1 sm:grid-cols-4">
        {(["SWAP", "TRANSFER", "DCA", "REBALANCE"] as ActionType[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAction(a)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-all duration-150 ${
              action === a
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {ACTION_ICONS[a]}
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
        <p className="text-xs leading-5 text-muted-foreground">{ACTION_DESC[action]}</p>
      </div>

      {!isConnected ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-border px-4 py-8 text-center">
          <Wallet className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">Wallet required</p>
          <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
            Connect from the header to sign and submit typed intents.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <span>Connected</span>
            <span className="font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
          </div>

          {action === "SWAP" && (
            <div className="space-y-3">
              <Field label="Token In" value={swapF.tokenIn} onChange={(v) => setSwapF((f) => ({ ...f, tokenIn: v }))} placeholder="0x…" required />
              <Field label="Token Out" value={swapF.tokenOut} onChange={(v) => setSwapF((f) => ({ ...f, tokenOut: v }))} placeholder="0x…" required />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount In (wei)" value={swapF.amountIn} onChange={(v) => setSwapF((f) => ({ ...f, amountIn: v }))} placeholder="1000000" required />
                <Field label="Min Out (wei)" value={swapF.minAmountOut} onChange={(v) => setSwapF((f) => ({ ...f, minAmountOut: v }))} placeholder="0" />
              </div>
              <Field label="Recipient (optional)" value={swapF.recipient} onChange={(v) => setSwapF((f) => ({ ...f, recipient: v }))} placeholder="0x… defaults to account" />
            </div>
          )}

          {action === "TRANSFER" && (
            <div className="space-y-3">
              <Field label="Token (0x000…000 for ETH)" value={transferF.token} onChange={(v) => setTransferF((f) => ({ ...f, token: v }))} placeholder="0x…" required />
              <Field label="Recipient" value={transferF.to} onChange={(v) => setTransferF((f) => ({ ...f, to: v }))} placeholder="0x…" required />
              <Field label="Amount (wei)" value={transferF.amount} onChange={(v) => setTransferF((f) => ({ ...f, amount: v }))} placeholder="1000000000000000000" required />
            </div>
          )}

          {/* DCA fields */}
          {action === "DCA" && (
            <div className="space-y-3">
              <Field label="Token In" value={dcaF.tokenIn} onChange={(v) => setDcaF((f) => ({ ...f, tokenIn: v }))} placeholder="0x…" required />
              <Field label="Token Out" value={dcaF.tokenOut} onChange={(v) => setDcaF((f) => ({ ...f, tokenOut: v }))} placeholder="0x…" required />
              <Field label="Amount Per Interval (wei)" value={dcaF.amountPerInterval} onChange={(v) => setDcaF((f) => ({ ...f, amountPerInterval: v }))} placeholder="1000000" required />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Interval (s)" value={dcaF.intervalSeconds} onChange={(v) => setDcaF((f) => ({ ...f, intervalSeconds: v }))} placeholder="86400" required />
                <Field label="Intervals" value={dcaF.totalIntervals} onChange={(v) => setDcaF((f) => ({ ...f, totalIntervals: v }))} placeholder="7" required />
              </div>
            </div>
          )}

          {/* REBALANCE fields */}
          {action === "REBALANCE" && (
            <div className="space-y-3">
              <Field label="Tokens (comma-separated)" value={rebalanceF.tokens} onChange={(v) => setRebalanceF((f) => ({ ...f, tokens: v }))} placeholder="0xA…, 0xB…" required />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Target weights bps <span className="text-muted-foreground/60">(sum = 10000)</span>
                  </label>
                  {rebalanceF.targetWeightsBps.trim() !== "" && (
                    <span className={`text-xs font-mono ${rebalanceWeightSum === 10000 ? "text-emerald-400" : "text-red-400"}`}>
                      {rebalanceWeightSum} / 10000
                    </span>
                  )}
                </div>
                <input
                  value={rebalanceF.targetWeightsBps}
                  onChange={(e) => setRebalanceF((f) => ({ ...f, targetWeightsBps: e.target.value }))}
                  placeholder="5000, 5000"
                  required
                  className={`w-full h-8 rounded-md border px-3 text-sm bg-muted placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 ${
                    rebalanceWeightError
                      ? "border-red-500/60 focus:ring-red-500/40"
                      : "border-border/60 focus:border-border focus:ring-border/40"
                  }`}
                />
                {rebalanceWeightError && (
                  <p className="text-xs text-red-400">{rebalanceWeightError}</p>
                )}
              </div>
              <Field label="Tolerance bps" value={rebalanceF.toleranceBps} onChange={(v) => setRebalanceF((f) => ({ ...f, toleranceBps: v }))} placeholder="50" />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 border border-red-900/40 bg-red-950/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* Success */}
          {intentId && status === "success" && (
            <div className="border border-emerald-900/40 bg-emerald-950/20 rounded px-3 py-2 space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-emerald-400 font-medium">Intent submitted</p>
                <a
                  href={`${RELAYER_URL}/intents/${intentId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:text-emerald-300"
                >
                  <Copy className="h-3 w-3" />
                  Status
                </a>
              </div>
              <p className="text-xs text-muted-foreground font-mono break-all">{intentId}</p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-9 text-sm font-medium"
            disabled={busy}
          >
            {busy
              ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status === "signing" ? "Waiting for signature..." : "Submitting..."}
                </span>
              )
              : "Sign & Submit"}
          </Button>
        </form>
      )}
    </div>
  );
}

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
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-8 text-sm bg-muted border-border/60 focus:border-border placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

