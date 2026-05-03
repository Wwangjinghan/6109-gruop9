import { randomUUID } from "crypto";
import type { IntentBatcher } from "../batcher/IntentBatcher.js";
import type { DcaParams, IntentPayload } from "../types/intent.js";
import { logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DcaSchedule {
  id: string;
  userId: string;
  params: DcaParams;
  signature: string;
  account?: string;
  /** Unix seconds — when the first interval fires */
  startAt: number;
  /** How many intervals remain */
  remainingIntervals: number;
  /** Unix ms — when the next interval fires */
  nextFireAt: number;
  /** How many intervals have been attempted */
  executedIntervals: number;
  createdAt: number;
  active: boolean;
}

export type DcaScheduleSummary = Omit<DcaSchedule, "signature">;

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Manages time-interval DCA plans. Each registered schedule fires one SWAP
 * intent per interval into the IntentBatcher, decrementing remainingIntervals
 * until the plan is exhausted.
 *
 * The tick loop runs every TICK_MS and fires all schedules whose nextFireAt
 * has elapsed.
 */
export class DcaScheduler {
  private readonly batcher: IntentBatcher;
  private readonly schedules = new Map<string, DcaSchedule>();
  private timer: NodeJS.Timeout | null = null;
  private static readonly TICK_MS = 5_000; // check every 5 seconds

  constructor(batcher: IntentBatcher) {
    this.batcher = batcher;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Register a new DCA plan. The first interval fires immediately if startAt
   * is in the past, otherwise waits until startAt.
   */
  register(payload: IntentPayload & { action: "DCA" }): DcaSchedule {
    const p = payload.params as DcaParams;
    const now = Math.floor(Date.now() / 1000);
    const startAt = payload.deadline
      ? Math.min(now, payload.deadline)
      : now;

    const schedule: DcaSchedule = {
      id: randomUUID(),
      userId: payload.userId,
      params: p,
      signature: payload.signature,
      account: payload.account,
      startAt,
      remainingIntervals: p.totalIntervals,
      nextFireAt: startAt * 1000, // store as ms
      executedIntervals: 0,
      createdAt: Date.now(),
      active: true,
    };

    this.schedules.set(schedule.id, schedule);
    logger.info(
      {
        scheduleId: schedule.id,
        userId: payload.userId,
        intervalSeconds: p.intervalSeconds,
        totalIntervals: p.totalIntervals,
        nextFireAt: new Date(schedule.nextFireAt).toISOString(),
      },
      "DCA schedule registered",
    );

    this._ensureRunning();
    return schedule;
  }

  cancelSchedule(scheduleId: string): boolean {
    const s = this.schedules.get(scheduleId);
    if (!s) return false;
    s.active = false;
    logger.info({ scheduleId }, "DCA schedule cancelled");
    return true;
  }

  getSchedule(scheduleId: string): DcaScheduleSummary | undefined {
    const s = this.schedules.get(scheduleId);
    if (!s) return undefined;
    const { signature: _sig, ...rest } = s;
    return rest;
  }

  getAllSchedules(): DcaScheduleSummary[] {
    return Array.from(this.schedules.values()).map(({ signature: _sig, ...rest }) => rest);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Tick ─────────────────────────────────────────────────────────────────────

  private _ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), DcaScheduler.TICK_MS);
  }

  private _tick(): void {
    const now = Date.now();
    let anyActive = false;

    for (const schedule of this.schedules.values()) {
      if (!schedule.active || schedule.remainingIntervals <= 0) continue;
      anyActive = true;

      if (now < schedule.nextFireAt) continue;

      this._fireInterval(schedule);
    }

    // Stop the timer when no active schedules remain
    if (!anyActive && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private _fireInterval(schedule: DcaSchedule): void {
    const p = schedule.params;

    // Build a one-interval SWAP payload from the DCA plan
    const swapPayload: IntentPayload = {
      userId: schedule.userId,
      action: "SWAP",
      params: {
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: p.amountPerInterval,
        minAmountOut: "0",
        ...(schedule.account ? { recipient: schedule.account } : {}),
      },
      signature: schedule.signature,
      ...(schedule.account ? { account: schedule.account } : {}),
      deadline: Math.floor(Date.now() / 1000) + p.intervalSeconds,
      nonce: schedule.executedIntervals,
    };

    try {
      const record = this.batcher.add(swapPayload);
      schedule.executedIntervals += 1;
      schedule.remainingIntervals -= 1;
      schedule.nextFireAt += p.intervalSeconds * 1000;

      if (schedule.remainingIntervals <= 0) {
        schedule.active = false;
        logger.info(
          { scheduleId: schedule.id, totalExecuted: schedule.executedIntervals },
          "DCA schedule completed",
        );
      } else {
        logger.info(
          {
            scheduleId: schedule.id,
            intentId: record.id,
            remainingIntervals: schedule.remainingIntervals,
            nextFireAt: new Date(schedule.nextFireAt).toISOString(),
          },
          "DCA interval fired",
        );
      }
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, "Failed to queue DCA interval intent");
    }
  }
}
