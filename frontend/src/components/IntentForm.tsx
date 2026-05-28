"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { ArrowRightLeft, Copy, GitBranch, Loader2, Repeat, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createDcaSchedule,
  fetchDcaScheduleStatus,
  fetchIntentStatus,
  submitIntent,
  type IntentParams,
} from "@/lib/intentClient";

type ActionType = "SWAP" | "TRANSFER" | "DCA" | "REBALANCE";
type DcaSubmitMode = "single" | "schedule";
type RecentSubmission = {
  type: "intent" | "schedule";
  id: string;
  action: ActionType;
  status: string;
  createdAt: number;
  batchId?: string;
  txHash?: string;
  error?: string;
  latencyMs?: number;
  gasUsed?: number;
  remainingIntervals?: number;
  nextFireAt?: number;
  executedIntervals?: number;
  active?: boolean;
};

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

const ACTION_ACCENTS: Record<ActionType, string> = {
  SWAP: "border-cyan-500/30 bg-cyan-950/35 text-cyan-300",
  TRANSFER: "border-violet-500/30 bg-violet-950/35 text-violet-300",
  DCA: "border-amber-500/30 bg-amber-950/35 text-amber-300",
  REBALANCE: "border-emerald-500/30 bg-emerald-950/35 text-emerald-300",
};

const ACTION_TAB_ACTIVE: Record<ActionType, string> = {
  SWAP: "border-cyan-500/35 bg-cyan-950/45 text-cyan-200",
  TRANSFER: "border-violet-500/35 bg-violet-950/45 text-violet-200",
  DCA: "border-amber-500/35 bg-amber-950/45 text-amber-200",
  REBALANCE: "border-emerald-500/35 bg-emerald-950/45 text-emerald-200",
};

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";
const DEMO_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DEMO_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DEMO_DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const RECENT_LIMIT = 5;
const STATUS_POLL_MS = 3000;

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
  const [dcaSubmitMode, setDcaSubmitMode] = useState<DcaSubmitMode>("single");

  const [status, setStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [currentSubmission, setCurrentSubmission] = useState<RecentSubmission | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const upsertSubmission = (entry: RecentSubmission) => {
    setCurrentSubmission(entry);
    setRecentSubmissions((prev) => [
      entry,
      ...prev.filter((item) => item.type !== entry.type || item.id !== entry.id),
    ].slice(0, RECENT_LIMIT));
  };

  useEffect(() => {
    const shouldPoll = recentSubmissions.some((item) => {
      if (item.type === "intent") {
        return item.status !== "executed" && item.status !== "failed";
      }
      return item.active !== false && (item.remainingIntervals ?? 1) > 0;
    });
    if (!shouldPoll) return;

    let cancelled = false;
    const refresh = async () => {
      const updates = await Promise.all(
        recentSubmissions.map(async (item): Promise<RecentSubmission> => {
          if (item.type === "intent") {
            const latest = await fetchIntentStatus(item.id);
            if (!latest) return item;
            return {
              ...item,
              action: latest.action as ActionType,
              status: latest.status,
              batchId: latest.batchId,
              txHash: latest.txHash,
              error: latest.error,
              latencyMs: latest.latencyMs,
              gasUsed: latest.gasUsed,
            };
          }

          const latest = await fetchDcaScheduleStatus(item.id);
          if (!latest) return item;
          return {
            ...item,
            status: latest.active ? "active" : "completed",
            remainingIntervals: latest.remainingIntervals,
            nextFireAt: latest.nextFireAt,
            executedIntervals: latest.executedIntervals,
            active: latest.active,
          };
        }),
      );
      if (cancelled) return;

      setRecentSubmissions((prev) =>
        prev.map((item) => {
          const update = updates.find((u) => u.type === item.type && u.id === item.id);
          return update ?? item;
        }),
      );
      setCurrentSubmission((current) => {
        if (!current) return current;
        return updates.find((u) => u.type === current.type && u.id === current.id) ?? current;
      });
    };

    const id = setInterval(refresh, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [recentSubmissions]);

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
    setCurrentSubmission(null);
    try {
      const params = buildParams();
      setStatus("submitting");
      if (params.action === "DCA" && dcaSubmitMode === "schedule") {
        const result = await createDcaSchedule(walletClient, params);
        upsertSubmission({
          type: "schedule",
          action: "DCA",
          id: result.scheduleId,
          status: "active",
          createdAt: Date.now(),
          remainingIntervals: result.remainingIntervals,
          nextFireAt: result.nextFireAt,
          active: true,
        });
      } else {
        const result = await submitIntent(walletClient, params);
        upsertSubmission({
          type: "intent",
          action: params.action,
          id: result.intentId,
          status: result.status,
          createdAt: Date.now(),
        });
      }
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const applyDemo = () => {
    setError(null);
    setCurrentSubmission(null);
    if (action === "SWAP") setSwapF(demoSwap());
    if (action === "TRANSFER") setTransferF(demoTransfer(address));
    if (action === "DCA") setDcaF(demoDca());
    if (action === "REBALANCE") setRebalanceF(demoRebalance());
  };

  const resetCurrent = () => {
    setError(null);
    setCurrentSubmission(null);
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
            onClick={() => {
              setAction(a);
              setError(null);
              setCurrentSubmission(null);
            }}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded border text-xs font-medium transition-all duration-150 ${
              action === a
                ? `${ACTION_TAB_ACTIVE[a]} shadow-sm`
                : "border-transparent text-muted-foreground hover:border-border/70 hover:text-foreground"
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
              <div className="grid grid-cols-1 gap-1.5 rounded-md bg-muted p-1 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDcaSubmitMode("single")}
                  className={`inline-flex min-h-9 items-center justify-center rounded px-3 text-xs font-medium transition-all duration-150 ${
                    dcaSubmitMode === "single"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Submit one DCA intent
                </button>
                <button
                  type="button"
                  onClick={() => setDcaSubmitMode("schedule")}
                  className={`inline-flex min-h-9 items-center justify-center rounded px-3 text-xs font-medium transition-all duration-150 ${
                    dcaSubmitMode === "schedule"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create recurring DCA schedule
                </button>
              </div>
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

          {/* Current submission */}
          {currentSubmission && status === "success" && (
            <CurrentSubmissionPanel submission={currentSubmission} />
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

          {recentSubmissions.length > 0 && (
            <RecentSubmissionsList submissions={recentSubmissions} />
          )}
        </form>
      )}
    </div>
  );
}

function shortId(id: string, head = 8, tail = 6) {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

function ActionBadge({ action, compact = false }: { action: ActionType; compact?: boolean }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded border font-medium ${ACTION_ACCENTS[action]} ${
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      }`}
    >
      {ACTION_ICONS[action]}
      {compact ? ACTION_LABELS[action].slice(0, 4).toUpperCase() : ACTION_LABELS[action]}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "executed" || status === "completed") {
    return "border-emerald-900/40 bg-emerald-950/30 text-emerald-300";
  }
  if (status === "failed") {
    return "border-red-900/40 bg-red-950/30 text-red-300";
  }
  if (status === "pending" || status === "batched" || status === "submitted" || status === "active") {
    return "border-amber-900/40 bg-amber-950/30 text-amber-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

function formatTime(ms?: number) {
  if (ms == null) return "-";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function CurrentSubmissionPanel({ submission }: { submission: RecentSubmission }) {
  const statusHref =
    submission.type === "intent"
      ? `${RELAYER_URL}/intents/${submission.id}`
      : `${RELAYER_URL}/schedules/dca/${submission.id}`;

  return (
    <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-emerald-300">
            {submission.type === "schedule" ? "DCA schedule created" : "Intent submitted"}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{submission.id}</p>
        </div>
        <a
          href={statusHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground hover:text-emerald-300"
        >
          <Copy className="h-3 w-3" />
          Status
        </a>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <SubmissionDetail label="Action" value={<ActionBadge action={submission.action} />} />
        <SubmissionDetail label="State" value={submission.status} badge />
        {submission.type === "intent" ? (
          <>
            <SubmissionDetail label="Batch" value={submission.batchId ? shortId(submission.batchId, 6, 4) : "-"} />
            <SubmissionDetail label="Tx" value={submission.txHash ? shortId(submission.txHash) : "-"} />
            <SubmissionDetail label="Latency" value={submission.latencyMs != null ? `${submission.latencyMs} ms` : "-"} />
            <SubmissionDetail label="Gas" value={submission.gasUsed != null ? submission.gasUsed.toLocaleString() : "-"} />
          </>
        ) : (
          <>
            <SubmissionDetail label="Remaining" value={submission.remainingIntervals ?? "-"} />
            <SubmissionDetail label="Executed" value={submission.executedIntervals ?? 0} />
            <SubmissionDetail label="Next run" value={formatTime(submission.nextFireAt)} />
          </>
        )}
      </div>

      {submission.error && (
        <p className="mt-2 rounded border border-red-900/40 bg-red-950/20 px-2 py-1 text-xs text-red-300">
          {submission.error}
        </p>
      )}
    </div>
  );
}

function SubmissionDetail({
  label,
  value,
  badge = false,
}: {
  label: string;
  value: React.ReactNode;
  badge?: boolean;
}) {
  return (
    <div className="min-w-0 rounded border border-border/50 bg-background/60 px-2 py-1.5">
      <p className="text-[11px] uppercase text-muted-foreground/60">{label}</p>
      {badge && typeof value === "string" ? (
        <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${statusClass(value)}`}>
          {value}
        </span>
      ) : (
        <p className="mt-1 truncate font-mono text-xs text-foreground">{value}</p>
      )}
    </div>
  );
}

function RecentSubmissionsList({ submissions }: { submissions: RecentSubmission[] }) {
  return (
    <div className="rounded-md border border-border/60">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <p className="text-xs font-medium">Recent submissions</p>
        <p className="text-xs text-muted-foreground">{submissions.length} tracked</p>
      </div>
      <div className="divide-y divide-border/40">
        {submissions.map((item) => (
          <div key={`${item.type}-${item.id}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-2 px-3 py-2">
            <ActionBadge action={item.action} compact />
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-muted-foreground">{shortId(item.id)}</p>
              {item.type === "schedule" && item.nextFireAt != null && (
                <p className="text-[11px] text-muted-foreground/60">
                  next {formatTime(item.nextFireAt)}
                </p>
              )}
            </div>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${statusClass(item.status)}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
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

