import { describe, it, expect } from "vitest";
import { hashDcaIntent, buildSignedDcaIntent } from "./intentSigner.js";
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`;

function makeWalletClient(): WalletClient {
  const account = privateKeyToAccount(PRIVATE_KEY);
  return createWalletClient({ account, chain: sepolia, transport: http() });
}

describe("hashDcaIntent", () => {
  it("returns a 32-byte hex hash", () => {
    const hash = hashDcaIntent("user-1", {
      tokenIn: USDC,
      tokenOut: WETH,
      amountPerInterval: "1000000",
      intervalSeconds: 86400,
      totalIntervals: 7,
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("produces identical hashes for identical inputs", () => {
    const params = {
      tokenIn: USDC,
      tokenOut: WETH,
      amountPerInterval: "1000000",
      intervalSeconds: 86400,
      totalIntervals: 7,
    };
    expect(hashDcaIntent("user-1", params)).toBe(hashDcaIntent("user-1", params));
  });

  it("produces different hashes when userId differs", () => {
    const params = {
      tokenIn: USDC,
      tokenOut: WETH,
      amountPerInterval: "1000000",
      intervalSeconds: 86400,
      totalIntervals: 7,
    };
    expect(hashDcaIntent("user-1", params)).not.toBe(hashDcaIntent("user-2", params));
  });

  it("produces different hashes when amountPerInterval differs", () => {
    const base = { tokenIn: USDC, tokenOut: WETH, intervalSeconds: 86400, totalIntervals: 7 };
    expect(hashDcaIntent("u", { ...base, amountPerInterval: "100" })).not.toBe(
      hashDcaIntent("u", { ...base, amountPerInterval: "200" }),
    );
  });
});

describe("buildSignedDcaIntent", () => {
  it("returns an IntentPayload with action DCA", async () => {
    const wc = makeWalletClient();
    const payload = await buildSignedDcaIntent(
      {
        userId: "user-1",
        tokenIn: USDC,
        tokenOut: WETH,
        amountPerInterval: 1_000_000n,
        intervalSeconds: 86400,
        totalIntervals: 4,
        nonce: 0,
      },
      wc,
    );

    expect(payload.action).toBe("DCA");
    expect(payload.userId).toBe("user-1");
    expect(payload.params.tokenIn).toBe(USDC);
    expect(payload.params.tokenOut).toBe(WETH);
  });

  it("produces a valid 65-byte EIP-191 signature", async () => {
    const wc = makeWalletClient();
    const payload = await buildSignedDcaIntent(
      {
        userId: "user-sig",
        tokenIn: USDC,
        tokenOut: WETH,
        amountPerInterval: 500_000n,
        intervalSeconds: 3600,
        totalIntervals: 1,
      },
      wc,
    );

    // 65-byte hex = "0x" + 130 hex chars
    expect(payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("sets a deadline one hour from now when not provided", async () => {
    const before = Math.floor(Date.now() / 1000);
    const wc = makeWalletClient();
    const payload = await buildSignedDcaIntent(
      {
        userId: "u",
        tokenIn: USDC,
        tokenOut: WETH,
        amountPerInterval: 1n,
        intervalSeconds: 3600,
        totalIntervals: 1,
      },
      wc,
    );
    const after = Math.floor(Date.now() / 1000);
    expect(payload.deadline).toBeGreaterThanOrEqual(before + 3600);
    expect(payload.deadline).toBeLessThanOrEqual(after + 3600 + 1);
  });

  it("two calls with same input produce the same hash (deterministic)", async () => {
    const wc = makeWalletClient();
    const input = {
      userId: "user-det",
      tokenIn: USDC,
      tokenOut: WETH,
      amountPerInterval: 1_000_000n,
      intervalSeconds: 86400,
      totalIntervals: 4,
      nonce: 0,
    };
    const p1 = await buildSignedDcaIntent(input, wc);
    const p2 = await buildSignedDcaIntent(input, wc);
    expect(p1.signature).toBe(p2.signature);
  });
});
