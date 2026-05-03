import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type WalletClient,
  type Address,
} from "viem";
import type { DcaParams, RebalanceParams, IntentPayload } from "../types/intent.js";

// ─── Payload builders ─────────────────────────────────────────────────────────

export interface DcaIntentInput {
  userId: string;
  tokenIn: Address;
  tokenOut: Address;
  amountPerInterval: bigint;  // in token-smallest-unit
  intervalSeconds: number;
  totalIntervals: number;
  account?: Address;
  deadline?: number;          // Unix seconds; defaults to now + 1 hour
  nonce?: number;
}

/**
 * Build and sign a DCA intent payload ready to POST to /intents.
 *
 * Signing flow (must mirror what IntentRegistry / relayer verifies):
 *   1. Encode the intent fields with ABI encoding
 *   2. keccak256 the encoded bytes → intentHash
 *   3. EIP-191 personal_sign the hash → 65-byte signature
 */
export async function buildSignedDcaIntent(
  input: DcaIntentInput,
  walletClient: WalletClient,
): Promise<IntentPayload> {
  const params: DcaParams = {
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountPerInterval: input.amountPerInterval.toString(),
    intervalSeconds: input.intervalSeconds,
    totalIntervals: input.totalIntervals,
  };

  const intentHash = hashDcaIntent(input.userId, params);
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: intentHash },
  });

  return {
    userId: input.userId,
    action: "DCA",
    params,
    signature,
    account: input.account,
    deadline: input.deadline ?? Math.floor(Date.now() / 1000) + 3600,
    nonce: input.nonce ?? 0,
  };
}

/**
 * Deterministic hash of a DCA intent.
 * keccak256(abi.encode(userId, action, tokenIn, tokenOut, amountPerInterval, intervalSeconds, totalIntervals))
 */
export function hashDcaIntent(userId: string, params: DcaParams): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string userId, string action, address tokenIn, address tokenOut, uint256 amountPerInterval, uint256 intervalSeconds, uint256 totalIntervals",
      ),
      [
        userId,
        "DCA",
        params.tokenIn as Address,
        params.tokenOut as Address,
        BigInt(params.amountPerInterval),
        BigInt(params.intervalSeconds),
        BigInt(params.totalIntervals),
      ],
    ),
  );
}

// ─── Rebalance intent ─────────────────────────────────────────────────────────

export interface RebalanceIntentInput {
  userId: string;
  tokens: Address[];
  targetWeightsBps: number[];  // must sum to 10_000
  toleranceBps?: number;       // default 50 (0.5%)
  account?: Address;
  deadline?: number;
  nonce?: number;
}

/**
 * Build and sign a REBALANCE intent payload ready to POST to /intents.
 */
export async function buildSignedRebalanceIntent(
  input: RebalanceIntentInput,
  walletClient: WalletClient,
): Promise<IntentPayload> {
  const params: RebalanceParams = {
    tokens: input.tokens,
    targetWeightsBps: input.targetWeightsBps,
    toleranceBps: input.toleranceBps ?? 50,
  };

  const intentHash = hashRebalanceIntent(input.userId, params);
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: intentHash },
  });

  return {
    userId: input.userId,
    action: "REBALANCE",
    params,
    signature,
    account: input.account,
    deadline: input.deadline ?? Math.floor(Date.now() / 1000) + 3600,
    nonce: input.nonce ?? 0,
  };
}

/**
 * Deterministic hash of a REBALANCE intent.
 * keccak256(abi.encode(userId, action, tokens[], targetWeightsBps[], toleranceBps))
 */
export function hashRebalanceIntent(userId: string, params: RebalanceParams): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string userId, string action, address[] tokens, uint256[] targetWeightsBps, uint256 toleranceBps",
      ),
      [
        userId,
        "REBALANCE",
        params.tokens as Address[],
        params.targetWeightsBps.map(BigInt),
        BigInt(params.toleranceBps ?? 50),
      ],
    ),
  );
}
