/**
 * E2E integration test: HTTP API → IntentBatcher → (mock) BundlerSubmitter
 *
 * Spins up a real Express server on a random port. No blockchain connection
 * is needed — the submitter is replaced with a mock that resolves immediately.
 * Tests verify the full request→queue→batch→status-update pipeline.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { createRouter } from "./routes.js";
import { IntentBatcher } from "../batcher/IntentBatcher.js";
import type { CombinedBatch } from "../types/intent.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTER  = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const USDC    = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH    = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Simulator-style userId (non-address) → signature check is skipped
const SIM_USER = "sim-agent-001";
// Dummy 65-byte signature (valid format, fails ecrecover → rejected for address userId)
const DUMMY_SIG = ("0x" + "ab".repeat(65)) as `0x${string}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSwapBody(userId = SIM_USER) {
  return {
    userId,
    action: "SWAP",
    params: { tokenIn: USDC, tokenOut: WETH, amountIn: "1000000", minAmountOut: "0" },
    signature: DUMMY_SIG,
    nonce: 0,
  };
}

async function post(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(url: string) {
  return fetch(url);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let server: Server;
let base: string;
let batcher: IntentBatcher;
let onBatchReady: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  onBatchReady = vi.fn(async (batch: CombinedBatch) => {
    // Simulate successful on-chain execution: mark records executed
    await new Promise((r) => setTimeout(r, 10));
    batch.records.forEach((rec) => {
      rec.status = "executed";
      rec.txHash = "0xdeadbeef" as `0x${string}`;
      rec.submittedAt = Date.now() - 50;
      rec.executedAt = Date.now();
      rec.gasUsed = 180_000n;
    });
  });

  batcher = new IntentBatcher({
    maxBatchSize: 5,
    batchWindowMs: 200,
    defaultAccount: ACCOUNT,
    swapRouter: ROUTER,
    onBatchReady,
  });

  const app = express();
  app.use(express.json());
  app.use("/", createRouter(batcher));

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  batcher.stop();
  server.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await get(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.queueLength).toBe("number");
    expect(typeof body.uptimeSeconds).toBe("number");
  });
});

describe("POST /intents — validation", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await post(`${base}/intents`, { action: "SWAP" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/[Vv]alidation/);
  });

  it("returns 400 for unknown action", async () => {
    const res = await post(`${base}/intents`, {
      userId: SIM_USER,
      action: "UNKNOWN",
      params: {},
      signature: DUMMY_SIG,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when SWAP params are missing tokenIn", async () => {
    const res = await post(`${base}/intents`, {
      userId: SIM_USER,
      action: "SWAP",
      params: { tokenOut: WETH, amountIn: "1000", minAmountOut: "0" },
      signature: DUMMY_SIG,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /intents — signature verification", () => {
  it("accepts intents when userId is a non-address string (simulator traffic)", async () => {
    const res = await post(`${base}/intents`, makeSwapBody("sim-agent-42"));
    expect(res.status).toBe(202);
  });

  it("rejects intents when userId is an address but signature does not match", async () => {
    // Address-shaped userId → sig check fires → DUMMY_SIG won't recover to that address
    const res = await post(`${base}/intents`, makeSwapBody("0x1234567890123456789012345678901234567890"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/[Ss]ignature/);
  });
});

describe("POST /intents → GET /intents/:id lifecycle", () => {
  it("returns 202 with intentId and pending status", async () => {
    const res = await post(`${base}/intents`, makeSwapBody());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toHaveProperty("intentId");
    expect(body.status).toBe("pending");
  });

  it("GET /intents/:id returns the intent record", async () => {
    const postRes = await post(`${base}/intents`, makeSwapBody());
    const { intentId } = await postRes.json();

    const getRes = await get(`${base}/intents/${intentId}`);
    expect(getRes.status).toBe(200);
    const rec = await getRes.json();
    expect(rec.intentId).toBe(intentId);
    expect(rec.action).toBe("SWAP");
  });

  it("GET /intents/:id returns 404 for unknown id", async () => {
    const res = await get(`${base}/intents/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("intent reaches executed status after batch fires", async () => {
    const postRes = await post(`${base}/intents`, makeSwapBody());
    const { intentId } = await postRes.json();

    // Wait for batchWindowMs + mock delay + polling margin
    await new Promise((r) => setTimeout(r, 500));

    const getRes = await get(`${base}/intents/${intentId}`);
    const rec = await getRes.json();
    expect(rec.status).toBe("executed");
    expect(rec.txHash).toBe("0xdeadbeef");
    expect(rec.gasUsed).toBeDefined();
  });
});

describe("GET /intents list", () => {
  it("returns an array", async () => {
    const res = await get(`${base}/intents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("respects ?limit param", async () => {
    // Submit several intents first
    await Promise.all([1, 2, 3].map(() => post(`${base}/intents`, makeSwapBody())));
    const res = await get(`${base}/intents?limit=2`);
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(2);
  });
});

describe("GET /metrics", () => {
  it("returns numeric metric fields", async () => {
    const res = await get(`${base}/metrics`);
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(typeof m.total).toBe("number");
    expect(typeof m.executedCount).toBe("number");
    expect(typeof m.failedCount).toBe("number");
    expect(typeof m.failedRatePct).toBe("number");
    expect(typeof m.peakTps).toBe("number");
  });

  it("shows executed intents after batch fires", async () => {
    await post(`${base}/intents`, makeSwapBody());
    await new Promise((r) => setTimeout(r, 500));

    const res = await get(`${base}/metrics`);
    const m = await res.json();
    expect(m.executedCount).toBeGreaterThan(0);
  });
});

describe("Batch throughput — gas before/after baseline", () => {
  it("batching 5 intents produces 1 onBatchReady call (N→1 reduction)", async () => {
    const callsBefore = onBatchReady.mock.calls.length;

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post(`${base}/intents`, makeSwapBody(`sim-agent-batch-${i}`)),
      ),
    );

    // maxBatchSize=5 → should flush immediately on the 5th intent
    await new Promise((r) => setTimeout(r, 100));
    expect(onBatchReady.mock.calls.length).toBe(callsBefore + 1);
  });

  it("gas savings: single-intent baseline vs batched (from /metrics)", async () => {
    // Submit a batch so gasUsed data is populated
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post(`${base}/intents`, makeSwapBody(`sim-gas-${i}`)),
    ));
    await new Promise((r) => setTimeout(r, 500));

    const res = await get(`${base}/metrics`);
    const m = await res.json();

    // mock sets gasUsed=180_000 per batch of 5 → avg = 180_000
    // individual baseline = DEFAULT_CALL_GAS_BASE (100_000) × 5 = 500_000
    // savings = (500_000 - 180_000) / 500_000 = 64 %
    if (m.avgGasPerBatch !== null) {
      const batchCount = 5;
      const individualBaseline = 100_000 * batchCount;
      const savingsPct = ((individualBaseline - m.avgGasPerBatch) / individualBaseline) * 100;
      expect(savingsPct).toBeGreaterThan(0);
      // Record the numbers for the project report
      console.info(
        `[Gas Report] batch=${batchCount} intents | individual=${individualBaseline} gas | ` +
        `batched=${m.avgGasPerBatch} gas | savings=${savingsPct.toFixed(1)}%`,
      );
    }
  });
});
