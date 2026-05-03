import { z } from "zod";
import type { Hex, Address } from "viem";

// ─── Per-action param schemas ────────────────────────────────────────────────

export const SwapParamsSchema = z.object({
  tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountIn: z.string().regex(/^\d+$/),     // uint256 as decimal string
  minAmountOut: z.string().regex(/^\d+$/),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

export const DcaParamsSchema = z.object({
  tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amountPerInterval: z.string().regex(/^\d+$/),
  intervalSeconds: z.number().int().positive(),
  totalIntervals: z.number().int().positive().max(52),
});

export const RebalanceParamsSchema = z.object({
  tokens: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).min(2).max(8),
  // Target weights in basis points; must sum to 10_000
  targetWeightsBps: z.array(z.number().int().min(0).max(10_000)).min(2).max(8),
  toleranceBps: z.number().int().min(0).max(500).default(50),
});

export const TransferParamsSchema = z.object({
  // Token address — use zero address (0x000...000) for native ETH
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d+$/), // uint256 as decimal string
});

// ─── Top-level Intent schema (what the API accepts) ─────────────────────────

export const IntentSchema = z.discriminatedUnion("action", [
  z.object({
    userId: z.string().min(1),
    action: z.literal("SWAP"),
    params: SwapParamsSchema,
    // EIP-191 signature over keccak256(abi.encode(userId, action, params))
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid 65-byte signature"),
    // Optional hints — relayer uses these when building the UserOp
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    deadline: z.number().int().positive().optional(),
    nonce: z.number().int().nonnegative().optional(),
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal("DCA"),
    params: DcaParamsSchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid 65-byte signature"),
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    deadline: z.number().int().positive().optional(),
    nonce: z.number().int().nonnegative().optional(),
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal("REBALANCE"),
    params: RebalanceParamsSchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid 65-byte signature"),
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    deadline: z.number().int().positive().optional(),
    nonce: z.number().int().nonnegative().optional(),
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal("TRANSFER"),
    params: TransferParamsSchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid 65-byte signature"),
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    deadline: z.number().int().positive().optional(),
    nonce: z.number().int().nonnegative().optional(),
  }),
]);

export type IntentPayload = z.infer<typeof IntentSchema>;
export type SwapParams = z.infer<typeof SwapParamsSchema>;
export type DcaParams = z.infer<typeof DcaParamsSchema>;
export type RebalanceParams = z.infer<typeof RebalanceParamsSchema>;
export type TransferParams = z.infer<typeof TransferParamsSchema>;

// ─── Internal tracking record ─────────────────────────────────────────────────

export type IntentStatus = "pending" | "batched" | "submitted" | "executed" | "failed";

export interface IntentRecord {
  id: string;
  payload: IntentPayload;
  status: IntentStatus;
  receivedAt: number;   // ms — intent arrived at relayer
  submittedAt?: number; // ms — UserOp sent to EntryPoint
  executedAt?: number;  // ms — on-chain receipt confirmed
  gasUsed?: bigint;     // actual gas used by the batch transaction (from receipt)
  batchId?: string;
  userOpHash?: Hex;
  txHash?: Hex;
  error?: string;
}

// ─── Combined batch produced by the combiner ─────────────────────────────────

export interface CombinedSwap {
  // Intents merged into this swap route
  intentIds: string[];
  // Encoded call data for the account's executeBatch
  calls: Array<{ target: Address; value: bigint; data: Hex }>;
}

export interface CombinedBatch {
  batchId: string;
  // The smart account that will execute this UserOp
  account: Address;
  combinedSwaps: CombinedSwap[];
  // Individual non-combinable intents packaged as single calls
  singleCalls: Array<{ intentId: string; target: Address; value: bigint; data: Hex }>;
  // All intent records in this batch (for status updates)
  records: IntentRecord[];
  createdAt: number;
}
