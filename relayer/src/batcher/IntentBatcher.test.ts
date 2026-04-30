import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IntentBatcher } from "./IntentBatcher.js";
import type { IntentPayload } from "../types/intent.js";

const ROUTER  = "0xRouter000000000000000000000000000000000" as `0x${string}`;
const ACCOUNT = "0xAccount00000000000000000000000000000000" as `0x${string}`;
const USDC    = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH    = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const makeSwap = (n = 0): IntentPayload => ({
  userId: `user-${n}`,
  action: "SWAP",
  params: { tokenIn: USDC, tokenOut: WETH, amountIn: "1000", minAmountOut: "900" },
  signature: "0x" + "ab".repeat(65),
});

const makeDca = (): IntentPayload => ({
  userId: "user-dca",
  action: "DCA",
  params: {
    tokenIn: USDC,
    tokenOut: WETH,
    amountPerInterval: "500",
    intervalSeconds: 86400,
    totalIntervals: 4,
  },
  signature: "0x" + "ab".repeat(65),
});

describe("IntentBatcher", () => {
  let onBatchReady: ReturnType<typeof vi.fn>;
  let batcher: IntentBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    onBatchReady = vi.fn().mockResolvedValue(undefined);
    batcher = new IntentBatcher({
      maxBatchSize: 3,
      batchWindowMs: 1000,
      defaultAccount: ACCOUNT,
      swapRouter: ROUTER,
      onBatchReady,
    });
  });

  afterEach(() => {
    batcher.stop();
    vi.useRealTimers();
  });

  it("flushes when maxBatchSize is reached", () => {
    batcher.add(makeSwap(0));
    batcher.add(makeSwap(1));
    expect(onBatchReady).not.toHaveBeenCalled();
    batcher.add(makeSwap(2));
    expect(onBatchReady).toHaveBeenCalledOnce();
  });

  it("passes a CombinedBatch with combinedSwaps to onBatchReady", () => {
    batcher.add(makeSwap(0));
    batcher.add(makeSwap(1));
    batcher.add(makeSwap(2));

    const [batch] = onBatchReady.mock.calls[0];
    expect(batch).toHaveProperty("batchId");
    expect(batch).toHaveProperty("combinedSwaps");
    expect(batch.records).toHaveLength(3);
  });

  it("flushes after batchWindowMs", async () => {
    batcher.add(makeSwap(0));
    expect(onBatchReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBatchReady).toHaveBeenCalledOnce();
  });

  it("assigns unique ids to each intent", () => {
    const r1 = batcher.add(makeSwap(0));
    const r2 = batcher.add(makeSwap(1));
    expect(r1.id).not.toBe(r2.id);
  });

  it("getRecord returns the stored record", () => {
    const r = batcher.add(makeSwap(0));
    expect(batcher.getRecord(r.id)).toBe(r);
  });

  it("getRecord returns undefined for unknown id", () => {
    expect(batcher.getRecord("does-not-exist")).toBeUndefined();
  });

  it("marks records as batched before calling onBatchReady", () => {
    batcher.add(makeSwap(0));
    batcher.add(makeSwap(1));
    batcher.add(makeSwap(2));

    const [batch] = onBatchReady.mock.calls[0];
    batch.records.forEach((r: { status: string }) => {
      expect(r.status).toBe("batched");
    });
  });

  it("handles mixed SWAP and DCA intents in one flush", () => {
    batcher.add(makeSwap(0));
    batcher.add(makeDca());
    batcher.add(makeSwap(1));

    const [batch] = onBatchReady.mock.calls[0];
    expect(batch.records).toHaveLength(3);
    // Combiner puts DCAs into singleCalls
    expect(batch.singleCalls).toHaveLength(1);
  });

  it("decrements queueLength after a flush", () => {
    batcher.add(makeSwap(0));
    expect(batcher.queueLength).toBe(1);
    batcher.add(makeSwap(1));
    batcher.add(makeSwap(2)); // triggers flush
    expect(batcher.queueLength).toBe(0);
  });
});
