import { encodeFunctionData, type Address, type Hex } from "viem";
import { INTENT_ACCOUNT_ABI } from "../abi/intentAccount.js";
import type { IntentRecord, SwapParams, RebalanceParams, TransferParams, CombinedSwap } from "../types/intent.js";

// ─── ERC-20 minimal ABI (transfer only) ──────────────────────────────────────
const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Zero address sentinel for native ETH transfers
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// ─── Swap router ABI (minimal — encode swap call) ─────────────────────────────
// Targets a Uniswap-v2-compatible router: swapExactTokensForTokens
const SWAP_ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn",     type: "uint256"   },
      { name: "amountOutMin", type: "uint256"   },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address"   },
      { name: "deadline",     type: "uint256"   },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CombinerResult {
  combinedSwaps: CombinedSwap[];
  soloRecords: IntentRecord[];
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Separate a flat list of IntentRecords into:
 *   - combinedSwaps: groups of SWAP intents merged into a single multi-call
 *   - soloRecords:   DCA, REBALANCE, and uncombineable SWAPs that each need their own call
 *
 * @param records       All records in the batch
 * @param swapRouter    Address of the DEX router to target
 * @param accountAddr   The IntentAccount address (used as default recipient)
 */
export function combineIntents(
  records: IntentRecord[],
  swapRouter: Address,
  accountAddr: Address,
): CombinerResult {
  const swaps = records.filter((r) => r.payload.action === "SWAP");
  const rebalances = records.filter((r) => r.payload.action === "REBALANCE");
  const dcas = records.filter((r) => r.payload.action === "DCA");
  const transfers = records.filter((r) => r.payload.action === "TRANSFER");

  const { groups, ungrouped } = _groupSwaps(swaps);

  const combinedSwaps: CombinedSwap[] = groups.map((group) =>
    _buildCombinedSwap(group, swapRouter, accountAddr),
  );

  // Ungrouped swaps each get a solo call
  const soloSwapCalls: CombinedSwap[] = ungrouped.map((r) =>
    _buildCombinedSwap([r], swapRouter, accountAddr),
  );

  // Each REBALANCE intent expands into a sequence of SWAP calls to reach target weights.
  // We treat each token except the last as "sell down to target" via the swap router.
  const rebalanceCalls: CombinedSwap[] = rebalances.map((r) =>
    _buildRebalanceCalls(r, swapRouter, accountAddr),
  );

  // DCA intents are submitted as individual swap calls (one interval per intent)
  const dcaCalls: CombinedSwap[] = dcas.map((r) =>
    _buildDcaCall(r, swapRouter, accountAddr),
  );

  // TRANSFER intents: ERC-20 transfer(to, amount) or native ETH send
  const transferCalls: CombinedSwap[] = transfers.map((r) =>
    _buildTransferCall(r),
  );

  return {
    combinedSwaps: [...combinedSwaps, ...soloSwapCalls, ...rebalanceCalls, ...dcaCalls, ...transferCalls],
    soloRecords: [],
  };
}

// ─── Grouping logic ────────────────────────────────────────────────────────────

interface SwapGroup {
  records: IntentRecord[];
  // The full token path through which this group routes
  path: Address[];
}

/**
 * Groups SWAP intents that can share a multi-hop route.
 *
 * Two intents are combinable when:
 *   (a) Same (tokenIn, tokenOut) pair → aggregate amountIn, use minimum minAmountOut
 *   (b) tokenOut[A] == tokenIn[B]     → chain into a single 2-hop route A→B→C
 *
 * Greedy O(n²) — fine for typical batch sizes (≤50).
 */
function _groupSwaps(swapRecords: IntentRecord[]): {
  groups: IntentRecord[][];
  ungrouped: IntentRecord[];
} {
  const used = new Set<string>();
  const groups: IntentRecord[][] = [];

  for (const record of swapRecords) {
    if (used.has(record.id)) continue;
    const params = record.payload.params as SwapParams;
    const group: IntentRecord[] = [record];
    used.add(record.id);

    for (const candidate of swapRecords) {
      if (used.has(candidate.id)) continue;
      const cp = candidate.payload.params as SwapParams;

      const sameRoute =
        cp.tokenIn.toLowerCase() === params.tokenIn.toLowerCase() &&
        cp.tokenOut.toLowerCase() === params.tokenOut.toLowerCase();

      const chainable =
        cp.tokenIn.toLowerCase() === params.tokenOut.toLowerCase();

      if (sameRoute || chainable) {
        group.push(candidate);
        used.add(candidate.id);
        // Only group pairs for now — multi-intent chains add complexity
        break;
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  const ungrouped = swapRecords.filter((r) => !groups.flat().includes(r) && !used.has(r.id));
  // Any record not placed into a multi-intent group stays solo
  const ungroupedSolo = swapRecords.filter(
    (r) => !groups.some((g) => g.includes(r)),
  );

  return { groups, ungrouped: ungroupedSolo.filter((r) => !groups.flat().includes(r)) };
}

// ─── Call encoding ─────────────────────────────────────────────────────────────

function _buildCombinedSwap(
  group: IntentRecord[],
  swapRouter: Address,
  accountAddr: Address,
): CombinedSwap {
  const intentIds = group.map((r) => r.id);

  if (group.length === 1) {
    // Single swap — straight encode
    const params = group[0].payload.params as SwapParams;
    const call = _encodeSwapCall(params, swapRouter, accountAddr);
    return { intentIds, calls: [call] };
  }

  // Two intents: check whether same route (aggregate) or chainable
  const p0 = group[0].payload.params as SwapParams;
  const p1 = group[1].payload.params as SwapParams;

  const sameRoute =
    p1.tokenIn.toLowerCase() === p0.tokenIn.toLowerCase() &&
    p1.tokenOut.toLowerCase() === p0.tokenOut.toLowerCase();

  if (sameRoute) {
    // Aggregate both amountIns into a single swap call
    const aggregatedParams: SwapParams = {
      ...p0,
      amountIn: (BigInt(p0.amountIn) + BigInt(p1.amountIn)).toString(),
      // Use the stricter (lower) minAmountOut to satisfy both intents
      minAmountOut: (
        BigInt(p0.minAmountOut) < BigInt(p1.minAmountOut)
          ? BigInt(p0.minAmountOut)
          : BigInt(p1.minAmountOut)
      ).toString(),
    };
    return { intentIds, calls: [_encodeSwapCall(aggregatedParams, swapRouter, accountAddr)] };
  }

  // Chainable: tokenOut[0] == tokenIn[1] — two sequential swap calls
  return {
    intentIds,
    calls: [
      _encodeSwapCall(p0, swapRouter, accountAddr),
      _encodeSwapCall(p1, swapRouter, accountAddr),
    ],
  };
}

/**
 * Expand a REBALANCE intent into a sequence of swap calls.
 *
 * Strategy: treat the first token in the list as the settlement token (e.g. USDC).
 * For each non-settlement token whose current weight exceeds its target by more than
 * toleranceBps, sell the excess back to the settlement token.
 * For each token below target, buy it from the settlement token.
 *
 * Because we don't have live balances at encoding time, we encode proportional
 * swap calls using a 1 ETH reference amount scaled by the weight delta.
 * A production implementation would first read on-chain balances.
 */
function _buildRebalanceCalls(
  record: IntentRecord,
  swapRouter: Address,
  accountAddr: Address,
): CombinedSwap {
  const p = record.payload.params as RebalanceParams;
  const settlementToken = p.tokens[0] as Address;

  // Reference total: 1e18 (treat as 1 unit of portfolio in 18-decimal precision)
  const REF_TOTAL = BigInt("1000000000000000000");

  const calls: Array<{ target: Address; value: bigint; data: Hex }> = [];

  for (let i = 1; i < p.tokens.length; i++) {
    const token = p.tokens[i] as Address;
    const targetBps = p.targetWeightsBps[i];
    // Assume equal current weights as a conservative baseline when no oracle is available
    const currentBps = Math.floor(10_000 / (p.tokens.length - 1));
    const deltaBps = currentBps - targetBps;

    if (Math.abs(deltaBps) <= p.toleranceBps) continue;

    // Amount proportional to the weight delta relative to the reference total
    const amount = (REF_TOTAL * BigInt(Math.abs(deltaBps))) / 10_000n;
    if (amount === 0n) continue;

    const swapParams: SwapParams = deltaBps > 0
      // Overweight — sell token → settlement
      ? {
          tokenIn: token,
          tokenOut: settlementToken,
          amountIn: amount.toString(),
          minAmountOut: "0", // slippage left to execution layer
          recipient: accountAddr,
        }
      // Underweight — sell settlement → token
      : {
          tokenIn: settlementToken,
          tokenOut: token,
          amountIn: amount.toString(),
          minAmountOut: "0",
          recipient: accountAddr,
        };

    calls.push(_encodeSwapCall(swapParams, swapRouter, accountAddr));
  }

  // If all weights are within tolerance, produce a no-op call to keep the batch structure valid
  if (calls.length === 0) {
    calls.push({ target: accountAddr, value: 0n, data: "0x" });
  }

  return { intentIds: [record.id], calls };
}

/**
 * Encode a single DCA interval as one swap call.
 * The DCA intent specifies amountPerInterval; the relayer fires one call per interval trigger.
 */
function _buildDcaCall(
  record: IntentRecord,
  swapRouter: Address,
  accountAddr: Address,
): CombinedSwap {
  const p = record.payload.params as { tokenIn: string; tokenOut: string; amountPerInterval: string };
  const swapParams: SwapParams = {
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    amountIn: p.amountPerInterval,
    minAmountOut: "0",
    recipient: accountAddr,
  };
  return { intentIds: [record.id], calls: [_encodeSwapCall(swapParams, swapRouter, accountAddr)] };
}

/**
 * Encode a TRANSFER intent.
 * - ERC-20: calls token.transfer(to, amount)
 * - Native ETH: zero-address token → plain value send with empty calldata
 */
function _buildTransferCall(record: IntentRecord): CombinedSwap {
  const p = record.payload.params as TransferParams;
  const isNative = p.token.toLowerCase() === ZERO_ADDRESS.toLowerCase();

  const call: { target: Address; value: bigint; data: Hex } = isNative
    ? {
        target: p.to as Address,
        value: BigInt(p.amount),
        data: "0x",
      }
    : {
        target: p.token as Address,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [p.to as Address, BigInt(p.amount)],
        }),
      };

  return { intentIds: [record.id], calls: [call] };
}

function _encodeSwapCall(
  params: SwapParams,
  swapRouter: Address,
  accountAddr: Address,
): { target: Address; value: bigint; data: Hex } {
  const path: Address[] = [params.tokenIn as Address, params.tokenOut as Address];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour slippage window

  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: "swapExactTokensForTokens",
    args: [
      BigInt(params.amountIn),
      BigInt(params.minAmountOut),
      path,
      (params.recipient as Address | undefined) ?? accountAddr,
      deadline,
    ],
  });

  return { target: swapRouter, value: 0n, data };
}
