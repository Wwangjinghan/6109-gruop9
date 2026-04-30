"use client";

import { useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { type Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildAndSubmitIntent } from "@/lib/intentClient";

export function IntentForm() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [target, setTarget] = useState("");
  const [callData, setCallData] = useState("0x");
  const [value, setValue] = useState("0");
  const [status, setStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletClient || !isConnected) return;

    setStatus("signing");
    setError(null);

    try {
      setStatus("submitting");
      const result = await buildAndSubmitIntent(walletClient, {
        target: target as Hex,
        callData: callData as Hex,
        value: BigInt(value),
      }, nonce);

      setIntentId(result.intentId);
      setNonce((n) => n + 1);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const statusBadge = {
    idle: null,
    signing: <Badge variant="secondary">Signing...</Badge>,
    submitting: <Badge variant="secondary">Submitting to relayer...</Badge>,
    success: <Badge variant="default">Submitted</Badge>,
    error: <Badge variant="destructive">Error</Badge>,
  }[status];

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
              <label className="text-sm font-medium">Connected: <span className="font-mono text-xs">{address}</span></label>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Target Address</label>
              <Input
                placeholder="0x..."
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
                pattern="^0x[0-9a-fA-F]{40}$"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Call Data</label>
              <Input
                placeholder="0x..."
                value={callData}
                onChange={(e) => setCallData(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Value (wei)</label>
              <Input
                type="number"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {intentId && (
              <p className="text-sm text-muted-foreground break-all">
                Intent ID: <span className="font-mono">{intentId}</span>
              </p>
            )}
            <Button type="submit" className="w-full" disabled={status === "signing" || status === "submitting"}>
              Sign & Submit Intent
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
