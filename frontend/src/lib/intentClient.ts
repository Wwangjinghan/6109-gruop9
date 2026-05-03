import {
  type Hex,
  type WalletClient,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
} from "viem";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";

// ─── Typed intent param shapes (match relayer IntentSchema) ──────────────────

export interface SwapIntentParams {
  action: "SWAP";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  recipient?: string;
}

export interface DcaIntentParams {
  action: "DCA";
  tokenIn: string;
  tokenOut: string;
  amountPerInterval: string;
  intervalSeconds: number;
  totalIntervals: number;
}

export interface RebalanceIntentParams {
  action: "REBALANCE";
  tokens: string[];
  targetWeightsBps: number[];
  toleranceBps?: number;
}

export interface TransferIntentParams {
  action: "TRANSFER";
  // Token address — use 0x0000...0000 for native ETH
  token: string;
  to: string;
  amount: string;
}

export type IntentParams =
  | SwapIntentParams
  | DcaIntentParams
  | RebalanceIntentParams
  | TransferIntentParams;

export interface SubmittedIntent {
  intentId: string;
  status: string;
}

// ─── Intent hash helpers ──────────────────────────────────────────────────────

/**
 * Produce a deterministic hash over the typed intent payload.
 * Must match the hash used on the relayer side for signature verification.
 * Format: keccak256(abi.encode(userId, action, JSON.stringify(params)))
 */
function hashIntentPayload(userId: string, params: IntentParams): Hex {
  const { action, ...rest } = params;
  const paramsJson = JSON.stringify(rest);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, string, string"),
      [userId, action, paramsJson],
    ),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Signs and submits a typed intent to the relayer.
 *
 * The signature covers: keccak256(userId || action || JSON(params))
 * The relayer validates this against the connected wallet address.
 */
export async function submitIntent(
  walletClient: WalletClient,
  params: IntentParams,
  options: { userId?: string; account?: string; deadline?: number; nonce?: number } = {},
): Promise<SubmittedIntent> {
  const address = walletClient.account!.address;
  const userId = options.userId ?? address;

  const payloadHash = hashIntentPayload(userId, params);
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: payloadHash },
  });

  const { action, ...rest } = params;
  const body = {
    userId,
    action,
    params: rest,
    signature,
    ...(options.account   && { account: options.account }),
    ...(options.deadline  && { deadline: options.deadline }),
    ...(options.nonce     !== undefined && { nonce: options.nonce }),
  };

  const res = await fetch(`${RELAYER_URL}/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Relayer error ${res.status}: ${detail}`);
  }
  return res.json();
}
