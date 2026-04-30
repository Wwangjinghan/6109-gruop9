import type { PricePoint } from "./priceFeed.js";

// ─── Rule types ───────────────────────────────────────────────────────────────

/** Fires when price falls below `thresholdUsd`. */
export interface BelowRule {
  type: "BELOW";
  asset: string;
  thresholdUsd: number;
}

/** Fires when price rises above `thresholdUsd`. */
export interface AboveRule {
  type: "ABOVE";
  asset: string;
  thresholdUsd: number;
}

/**
 * Fires when price has dropped by at least `percent`% from the last
 * baseline sample.  The baseline resets after each trigger.
 */
export interface PercentDropRule {
  type: "PERCENT_DROP";
  asset: string;
  /** Drop percentage that triggers the condition (e.g. 5 = 5% drop). */
  percent: number;
}

/**
 * Fires when price has risen by at least `percent`% from the last
 * baseline sample.
 */
export interface PercentRiseRule {
  type: "PERCENT_RISE";
  asset: string;
  percent: number;
}

export type PriceRule = BelowRule | AboveRule | PercentDropRule | PercentRiseRule;

// ─── Evaluator ────────────────────────────────────────────────────────────────

export interface ConditionResult {
  triggered: boolean;
  rule: PriceRule;
  current: PricePoint;
  /** Human-readable description of why this triggered (or didn't). */
  reason: string;
}

/**
 * Stateful evaluator for a single PriceRule.
 *
 * For PERCENT_DROP / PERCENT_RISE rules the evaluator keeps a rolling
 * baseline that is reset whenever the rule fires.
 * Call `reset()` to set a fresh baseline without triggering.
 */
export class ConditionEvaluator {
  private readonly rule: PriceRule;
  private baseline: number | null = null;

  constructor(rule: PriceRule) {
    this.rule = rule;
  }

  evaluate(point: PricePoint): ConditionResult {
    const { priceUsd } = point;
    const rule = this.rule;

    switch (rule.type) {
      case "BELOW": {
        const triggered = priceUsd < rule.thresholdUsd;
        return {
          triggered,
          rule,
          current: point,
          reason: triggered
            ? `${rule.asset} $${priceUsd.toFixed(2)} is below threshold $${rule.thresholdUsd}`
            : `${rule.asset} $${priceUsd.toFixed(2)} is above threshold $${rule.thresholdUsd}`,
        };
      }

      case "ABOVE": {
        const triggered = priceUsd > rule.thresholdUsd;
        return {
          triggered,
          rule,
          current: point,
          reason: triggered
            ? `${rule.asset} $${priceUsd.toFixed(2)} is above threshold $${rule.thresholdUsd}`
            : `${rule.asset} $${priceUsd.toFixed(2)} is below threshold $${rule.thresholdUsd}`,
        };
      }

      case "PERCENT_DROP": {
        if (this.baseline === null) {
          this.baseline = priceUsd;
          return { triggered: false, rule, current: point, reason: `Baseline set: $${priceUsd.toFixed(2)}` };
        }
        const dropPct = ((this.baseline - priceUsd) / this.baseline) * 100;
        const triggered = dropPct >= rule.percent;
        if (triggered) this.baseline = priceUsd; // reset baseline after trigger
        return {
          triggered,
          rule,
          current: point,
          reason: triggered
            ? `${rule.asset} dropped ${dropPct.toFixed(2)}% from baseline $${this.baseline?.toFixed(2)} → $${priceUsd.toFixed(2)}`
            : `${rule.asset} drop so far: ${dropPct.toFixed(2)}% (need ${rule.percent}%)`,
        };
      }

      case "PERCENT_RISE": {
        if (this.baseline === null) {
          this.baseline = priceUsd;
          return { triggered: false, rule, current: point, reason: `Baseline set: $${priceUsd.toFixed(2)}` };
        }
        const risePct = ((priceUsd - this.baseline) / this.baseline) * 100;
        const triggered = risePct >= rule.percent;
        if (triggered) this.baseline = priceUsd;
        return {
          triggered,
          rule,
          current: point,
          reason: triggered
            ? `${rule.asset} rose ${risePct.toFixed(2)}% from baseline $${this.baseline?.toFixed(2)} → $${priceUsd.toFixed(2)}`
            : `${rule.asset} rise so far: ${risePct.toFixed(2)}% (need ${rule.percent}%)`,
        };
      }
    }
  }

  /** Reset the baseline without triggering (call after a forced re-init). */
  reset(newBaseline?: number): void {
    this.baseline = newBaseline ?? null;
  }
}
