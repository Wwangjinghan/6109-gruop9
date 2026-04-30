import { describe, it, expect } from "vitest";
import { combineIntents } from "./combiner.js";
import type { IntentRecord } from "../types/intent.js";

const ROUTER  = "0xRouter000000000000000000000000000000000" as `0x${string}`;
const ACCOUNT = "0xAccount00000000000000000000000000000000" as `0x${string}`;
const USDC    = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WETH    = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`;
const DAI     = "0x6B175474E89094C44Da98b954EedeAC495271d0F" as `0x${string}`;

function makeSwapRecord(
  id: string,
  tokenIn: string,
  tokenOut: string,
  amountIn = "1000",
  minAmountOut = "900",
): IntentRecord {
  return {
    id,
    payload: {
      userId: "user-1",
      action: "SWAP",
      params: { tokenIn, tokenOut, amountIn, minAmountOut },
      signature: "0x" + "ab".repeat(65),
    },
    status: "pending",
    receivedAt: Date.now(),
  };
}

function makeDcaRecord(id: string): IntentRecord {
  return {
    id,
    payload: {
      userId: "user-2",
      action: "DCA",
      params: {
        tokenIn: USDC,
        tokenOut: WETH,
        amountPerInterval: "500",
        intervalSeconds: 86400,
        totalIntervals: 7,
      },
      signature: "0x" + "ab".repeat(65),
    },
    status: "pending",
    receivedAt: Date.now(),
  };
}

describe("combineIntents", () => {
  it("keeps a single SWAP as a combinedSwap with one call", () => {
    const records = [makeSwapRecord("s1", USDC, WETH)];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    expect(soloRecords).toHaveLength(0);
    expect(combinedSwaps).toHaveLength(1);
    expect(combinedSwaps[0].intentIds).toEqual(["s1"]);
    expect(combinedSwaps[0].calls).toHaveLength(1);
  });

  it("aggregates two SWAPs with identical (tokenIn, tokenOut) into one call", () => {
    const records = [
      makeSwapRecord("s1", USDC, WETH, "1000", "900"),
      makeSwapRecord("s2", USDC, WETH, "2000", "1800"),
    ];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    expect(soloRecords).toHaveLength(0);
    // The two should merge into a single CombinedSwap with one aggregated call
    expect(combinedSwaps).toHaveLength(1);
    expect(combinedSwaps[0].intentIds).toEqual(["s1", "s2"]);
    expect(combinedSwaps[0].calls).toHaveLength(1); // aggregated
  });

  it("chains two SWAPs where tokenOut[A] == tokenIn[B] into two sequential calls", () => {
    // USDC→WETH then WETH→DAI — can chain
    const records = [
      makeSwapRecord("s1", USDC, WETH),
      makeSwapRecord("s2", WETH, DAI),
    ];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    expect(soloRecords).toHaveLength(0);
    expect(combinedSwaps).toHaveLength(1);
    expect(combinedSwaps[0].intentIds).toEqual(["s1", "s2"]);
    expect(combinedSwaps[0].calls).toHaveLength(2); // sequential
  });

  it("routes unrelated SWAPs as separate combinedSwaps", () => {
    const records = [
      makeSwapRecord("s1", USDC, WETH),
      makeSwapRecord("s2", DAI, USDC),
    ];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    expect(soloRecords).toHaveLength(0);
    expect(combinedSwaps).toHaveLength(2);
  });

  it("DCA intents go to soloRecords, not combinedSwaps", () => {
    const records = [makeDcaRecord("d1"), makeDcaRecord("d2")];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    expect(combinedSwaps).toHaveLength(0);
    expect(soloRecords).toHaveLength(2);
  });

  it("handles a mixed batch of SWAPs and DCAs", () => {
    const records = [
      makeSwapRecord("s1", USDC, WETH),
      makeDcaRecord("d1"),
      makeSwapRecord("s2", USDC, WETH),
    ];
    const { combinedSwaps, soloRecords } = combineIntents(records, ROUTER, ACCOUNT);

    // s1 + s2 aggregate; d1 is solo
    expect(combinedSwaps).toHaveLength(1);
    expect(combinedSwaps[0].intentIds).toContain("s1");
    expect(combinedSwaps[0].intentIds).toContain("s2");
    expect(soloRecords).toHaveLength(1);
    expect(soloRecords[0].id).toBe("d1");
  });

  it("encodes non-zero minAmountOut in the call data", () => {
    const records = [makeSwapRecord("s1", USDC, WETH, "5000", "4500")];
    const { combinedSwaps } = combineIntents(records, ROUTER, ACCOUNT);
    const callData = combinedSwaps[0].calls[0].data;
    // 4500 decimal = 0x1194 — should appear somewhere in the encoded calldata
    expect(callData).toMatch(/1194/i);
  });
});
