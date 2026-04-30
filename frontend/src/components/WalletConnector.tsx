"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";

export function WalletConnector() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>Disconnect</Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.map((connector) => (
        <Button key={connector.uid} size="sm" onClick={() => connect({ connector })}>
          {connector.name}
        </Button>
      ))}
    </div>
  );
}
