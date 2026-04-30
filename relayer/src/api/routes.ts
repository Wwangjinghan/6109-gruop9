import { Router, type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";
import { IntentSchema } from "../types/intent.js";
import type { IntentBatcher } from "../batcher/IntentBatcher.js";
import { logger } from "../utils/logger.js";

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

export function createRouter(batcher: IntentBatcher): Router {
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

    const record = batcher.add(parsed.data);
    logger.info(
      { intentId: record.id, action: parsed.data.action, userId: parsed.data.userId },
      "Intent accepted",
    );
    return res.status(202).json({ intentId: record.id, status: record.status });
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
    });
  });

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
