import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserOpBuilder } from "./UserOpBuilder.js";
import type { CombinedBatch } from "../types/intent.js";
import type { PublicClient } from "viem";

const ACCOUNT = "0xAccount00000000000000000000000000000000" as `0x${string}`;
const ROUTER  = "0xRouter000000000000000000000000000000000" as `0x${string}`;
const USDC    = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WETH    = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`;

function makeMockPublicClient(): PublicClient {
  return {
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "getNonce") return Promise.resolve(0n);
      if (functionName === "getUserOpHash") return Promise.resolve("0xdeadbeef" + "00".repeat(28));
      return Promise.resolve(null);
    }),
    getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: 1_000_000_000n }),
  } as unknown as PublicClient;
}

function makeBatch(callCount: number): CombinedBatch {
  const calls = Array.from({ length: callCount }, (_, i) => ({
    target: ROUTER,
    value: 0n,
    data: `0x${i.toString(16).padStart(8, "0")}` as `0x${string}`,
  }));

  return {
    batchId: "test-batch",
    account: ACCOUNT,
    combinedSwaps: callCount > 0 ? [{ intentIds: ["i1"], calls }] : [],
    singleCalls: [],
    records: [],
    createdAt: Date.now(),
  };
}

describe("UserOpBuilder", () => {
  let publicClient: PublicClient;
  let builder: UserOpBuilder;

  beforeEach(() => {
    publicClient = makeMockPublicClient();
    builder = new UserOpBuilder(publicClient);
  });

  it("sets sender to the batch account address", async () => {
    const op = await builder.build(makeBatch(1));
    expect(op.sender).toBe(ACCOUNT);
  });

  it("uses nonce from EntryPoint.getNonce", async () => {
    const op = await builder.build(makeBatch(1));
    expect(op.nonce).toBe(0n);
  });

  it("encodes execute (not executeBatch) for a single call", async () => {
    const op = await builder.build(makeBatch(1));
    // execute selector = 0xb61d27f6
    expect(op.callData.startsWith("0xb61d27f6")).toBe(true);
  });

  it("encodes executeBatch for multiple calls", async () => {
    const op = await builder.build(makeBatch(3));
    // executeBatch selector = 0x34fcd5be
    expect(op.callData.startsWith("0x34fcd5be")).toBe(true);
  });

  it("returns 0x callData for an empty batch", async () => {
    const op = await builder.build(makeBatch(0));
    expect(op.callData).toBe("0x");
  });

  it("leaves signature as 0x (caller must sign)", async () => {
    const op = await builder.build(makeBatch(1));
    expect(op.signature).toBe("0x");
  });

  it("packs gasFees as a bytes32 hex string", async () => {
    const op = await builder.build(makeBatch(1));
    expect(op.gasFees).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("increases callGasLimit proportionally to number of calls", async () => {
    const op1 = await builder.build(makeBatch(1));
    const op3 = await builder.build(makeBatch(3));

    const [, callGas1] = unpackGasLimits(op1.accountGasLimits);
    const [, callGas3] = unpackGasLimits(op3.accountGasLimits);
    expect(callGas3).toBeGreaterThan(callGas1);
  });

  it("calls getUserOpHash on the EntryPoint", async () => {
    const op = await builder.build(makeBatch(1));
    const hash = await builder.getUserOpHash(op);
    expect(hash).toMatch(/^0x/);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getUserOpHash" }),
    );
  });
});

// Helper: unpack bytes32 accountGasLimits → [verificationGasLimit, callGasLimit]
function unpackGasLimits(packed: `0x${string}`): [bigint, bigint] {
  const n = BigInt(packed);
  return [n >> 128n, n & ((1n << 128n) - 1n)];
}
