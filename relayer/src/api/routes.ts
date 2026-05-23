import { Router, type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  recoverMessageAddress,
  type Hex,
} from "viem";
import { IntentSchema } from "../types/intent.js";
import type { IntentBatcher } from "../batcher/IntentBatcher.js";
import type { DcaScheduler } from "../scheduler/DcaScheduler.js";
import { logger } from "../utils/logger.js";

// ─── Signature helpers ────────────────────────────────────────────────────────

/**
 * Reproduce the hash that intentClient.ts signs on the frontend:
 *   keccak256(abi.encode(userId, action, JSON.stringify(params)))
 *
 * This is the canonical format for intents submitted via the browser.
 * The agent_simulator uses a different (action-specific) hash; those intents
 * are trusted internal traffic and skip this check when userId is not an
 * Ethereum address.
 */
function hashIntentPayload(userId: string, action: string, params: unknown): Hex {
  const paramsJson = JSON.stringify(params);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, string, string"),
      [userId, action, paramsJson],
    ),
  );
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Verify that the intent signature was produced by the wallet whose address
 * equals `userId`. Returns true if verification passes or if userId is not an
 * Ethereum address (simulator / internal traffic).
 */
async function verifyIntentSignature(
  userId: string,
  action: string,
  params: unknown,
  signature: string,
): Promise<boolean> {
  // Only verify when userId looks like a wallet address (i.e. browser-submitted)
  if (!ETH_ADDRESS_RE.test(userId)) return true;

  try {
    const hash = hashIntentPayload(userId, action, params);
    const recovered = await recoverMessageAddress({
      message: { raw: hash },
      signature: signature as Hex,
    });
    return recovered.toLowerCase() === userId.toLowerCase();
  } catch {
    return false;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

function zodErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  next(err);
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createRouter(batcher: IntentBatcher, scheduler?: DcaScheduler): Router {
  const router = Router();

  /**
   * POST /intents
   * Accept a signed intent. Body must match IntentSchema (discriminated union on action).
   *
   * Returns 202 Accepted with { intentId, status } immediately.
   * The intent is queued in the batcher; final status is available via GET /intents/:id.
   */
  router.post("/intents", (req: Request, res: Response) => {
    const parsed = IntentSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.flatten() }, "Intent validation failed");
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }

    const { action, params, signature, userId } = parsed.data;
    const sigValid = await verifyIntentSignature(userId, action, params, signature);
    if (!sigValid) {
      logger.warn({ userId, action }, "Intent rejected — signature mismatch");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const record = batcher.add(parsed.data);
    logger.info(
      { intentId: record.id, action, userId },
      "Intent accepted",
    );
    return res.status(202).json({ intentId: record.id, status: record.status });
  });

  /**
   * GET /intents
   * Return all intents, most-recent first. Supports ?limit=N (default 100).
   */
  router.get("/intents", (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "100", 10) || 100, 500);
    const all = batcher.getAllRecords()
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, limit);
    return res.json(
      all.map((record) => {
        const latencyMs =
          record.executedAt != null && record.submittedAt != null
            ? record.executedAt - record.submittedAt
            : record.submittedAt != null
              ? Date.now() - record.submittedAt
              : undefined;
        return {
          intentId: record.id,
          action: record.payload.action,
          userId: record.payload.userId,
          status: record.status,
          batchId: record.batchId,
          txHash: record.txHash,
          error: record.error,
          receivedAt: record.receivedAt,
          submittedAt: record.submittedAt,
          executedAt: record.executedAt,
          latencyMs,
          gasUsed: record.gasUsed != null ? record.gasUsed.toString() : undefined,
        };
      }),
    );
  });

  /**
   * GET /intents/:id
   * Return the current status of a specific intent.
   */
  router.get("/intents/:id", (req: Request, res: Response) => {
    const record = batcher.getRecord(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "Intent not found" });
    }
    const latencyMs =
      record.executedAt != null && record.submittedAt != null
        ? record.executedAt - record.submittedAt
        : record.submittedAt != null
          ? Date.now() - record.submittedAt
          : undefined;
    return res.json({
      intentId: record.id,
      action: record.payload.action,
      userId: record.payload.userId,
      status: record.status,
      batchId: record.batchId,
      userOpHash: record.userOpHash,
      txHash: record.txHash,
      error: record.error,
      receivedAt: record.receivedAt,
      submittedAt: record.submittedAt,
      executedAt: record.executedAt,
      latencyMs,
      // gasUsed serialised as string to avoid JSON bigint overflow
      gasUsed: record.gasUsed != null ? record.gasUsed.toString() : undefined,
    });
  });

  /**
   * GET /metrics
   * Aggregate throughput, latency, and failure-rate metrics across all tracked intents.
   */
  router.get("/metrics", (_req, res) => {
    const all = batcher.getAllRecords();
    const total = all.length;
    const executed = all.filter((r) => r.status === "executed");
    const failed = all.filter((r) => r.status === "failed");

    // Latency: only intents that have both submittedAt and executedAt
    const withLatency = executed.filter(
      (r): r is typeof r & { submittedAt: number; executedAt: number } =>
        r.submittedAt != null && r.executedAt != null,
    );
    const avgLatencyMs =
      withLatency.length > 0
        ? Math.round(
            withLatency.reduce((s, r) => s + (r.executedAt - r.submittedAt), 0) /
              withLatency.length,
          )
        : null;
    const maxLatencyMs =
      withLatency.length > 0
        ? Math.max(...withLatency.map((r) => r.executedAt - r.submittedAt))
        : null;

    // Gas: intents that have real gasUsed from the receipt
    const withGas = executed.filter(
      (r): r is typeof r & { gasUsed: bigint } => r.gasUsed != null,
    );
    // gasUsed is per-batch (shared by all intents in that batch); deduplicate by batchId
    const batchGasMap = new Map<string, bigint>();
    for (const r of withGas) {
      if (r.batchId && !batchGasMap.has(r.batchId)) {
        batchGasMap.set(r.batchId, r.gasUsed);
      }
    }
    const avgGasPerBatch =
      batchGasMap.size > 0
        ? Number(
            [...batchGasMap.values()].reduce((s, g) => s + g, 0n) /
              BigInt(batchGasMap.size),
          )
        : null;

    // TPS: bucket receivedAt into 10-second windows, take the peak window
    const WINDOW_MS = 10_000;
    const tpsBuckets = new Map<number, number>();
    for (const r of all) {
      const bucket = Math.floor(r.receivedAt / WINDOW_MS) * WINDOW_MS;
      tpsBuckets.set(bucket, (tpsBuckets.get(bucket) ?? 0) + 1);
    }
    const peakTps =
      tpsBuckets.size > 0
        ? parseFloat(
            (Math.max(...tpsBuckets.values()) / (WINDOW_MS / 1000)).toFixed(3),
          )
        : 0;

    return res.json({
      total,
      executedCount: executed.length,
      failedCount: failed.length,
      failedRatePct:
        total > 0 ? parseFloat(((failed.length / total) * 100).toFixed(1)) : 0,
      avgLatencyMs,
      maxLatencyMs,
      peakTps,
      // Gas metrics — null when no on-chain receipts received yet
      avgGasPerBatch,
      gasDataPoints: batchGasMap.size,
    });
  });

  // ── DCA Schedule endpoints (only wired when scheduler is provided) ────────────

  if (scheduler) {
    /**
     * POST /schedules/dca
     * Register a time-interval DCA plan. Body must be a DCA IntentPayload.
     * Returns { scheduleId, nextFireAt, remainingIntervals } immediately.
     */
    router.post("/schedules/dca", (req: Request, res: Response) => {
      const parsed = IntentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      }
      if (parsed.data.action !== "DCA") {
        return res.status(400).json({ error: "Only DCA intents can be scheduled" });
      }
      const schedule = scheduler.register(parsed.data as Extract<typeof parsed.data, { action: "DCA" }>);
      logger.info({ scheduleId: schedule.id, userId: parsed.data.userId }, "DCA schedule created via API");
      return res.status(201).json({
        scheduleId: schedule.id,
        remainingIntervals: schedule.remainingIntervals,
        nextFireAt: schedule.nextFireAt,
        intervalSeconds: schedule.params.intervalSeconds,
      });
    });

    /**
     * GET /schedules/dca
     * List all DCA schedules (active and completed).
     */
    router.get("/schedules/dca", (_req, res) => {
      return res.json(scheduler.getAllSchedules());
    });

    /**
     * GET /schedules/dca/:id
     * Get a specific DCA schedule by ID.
     */
    router.get("/schedules/dca/:id", (req: Request, res: Response) => {
      const s = scheduler.getSchedule(req.params.id);
      if (!s) return res.status(404).json({ error: "Schedule not found" });
      return res.json(s);
    });

    /**
     * DELETE /schedules/dca/:id
     * Cancel an active DCA schedule.
     */
    router.delete("/schedules/dca/:id", (req: Request, res: Response) => {
      const ok = scheduler.cancelSchedule(req.params.id);
      if (!ok) return res.status(404).json({ error: "Schedule not found" });
      return res.json({ cancelled: true });
    });
  }

  /**
   * GET /health
   * Liveness probe — returns current queue depth and uptime.
   */
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      queueLength: batcher.queueLength,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  router.use(zodErrorHandler);

  return router;
}
