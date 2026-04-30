import { encodeFunctionData, type Address, type Hex } from "viem";
import { INTENT_ACCOUNT_ABI } from "../abi/intentAccount.js";
import type { IntentRecord, SwapParams, CombinedSwap } from "../types/intent.js";

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
  const nonSwaps = records.filter((r) => r.payload.action !== "SWAP");

  const { groups, ungrouped } = _groupSwaps(swaps);

  const combinedSwaps: CombinedSwap[] = groups.map((group) =>
    _buildCombinedSwap(group, swapRouter, accountAddr),
  );

  // Ungrouped swaps each get a solo call too
  const soloSwapCalls: CombinedSwap[] = ungrouped.map((r) =>
    _buildCombinedSwap([r], swapRouter, accountAddr),
  );

  return {
    combinedSwaps: [...combinedSwaps, ...soloSwapCalls],
    soloRecords: nonSwaps,
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

function _encodeSwapCall(
  params: SwapParams,
  swapRouter: Address,
  accountAddr: Address,
): { target: Address; value: bigint; data: Hex } {
  const path: Address[] = [params.tokenIn as Address, params.tokenOut as Address];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min slippage window

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
