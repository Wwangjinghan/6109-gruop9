import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type WalletClient,
  type Address,
} from "viem";
import type { DcaParams, IntentPayload } from "../types/intent.js";

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
 *
 * Kept as a separate export so tests and the relayer verifier can reproduce
 * the hash without a live wallet.
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
