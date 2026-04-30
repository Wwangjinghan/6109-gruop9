import { describe, it, expect } from "vitest";
import { ConditionEvaluator } from "./conditions.js";
import type { PricePoint } from "./priceFeed.js";

function point(priceUsd: number, asset = "ethereum"): PricePoint {
  return { asset, priceUsd, fetchedAt: Date.now() };
}

describe("ConditionEvaluator — BELOW", () => {
  const rule = { type: "BELOW" as const, asset: "ethereum", thresholdUsd: 2000 };

  it("triggers when price is below threshold", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(1800)).triggered).toBe(true);
  });

  it("does not trigger when price equals threshold", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(2000)).triggered).toBe(false);
  });

  it("does not trigger when price is above threshold", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(2200)).triggered).toBe(false);
  });

  it("triggers on every call when price stays below (no cooldown in evaluator)", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(1900)).triggered).toBe(true);
    expect(ev.evaluate(point(1950)).triggered).toBe(true);
  });
});

describe("ConditionEvaluator — ABOVE", () => {
  const rule = { type: "ABOVE" as const, asset: "ethereum", thresholdUsd: 3000 };

  it("triggers when price is above threshold", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(3500)).triggered).toBe(true);
  });

  it("does not trigger when price equals threshold", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(3000)).triggered).toBe(false);
  });
});

describe("ConditionEvaluator — PERCENT_DROP", () => {
  const rule = { type: "PERCENT_DROP" as const, asset: "ethereum", percent: 10 };

  it("sets baseline on first call without triggering", () => {
    const ev = new ConditionEvaluator(rule);
    const result = ev.evaluate(point(2000));
    expect(result.triggered).toBe(false);
    expect(result.reason).toMatch(/baseline/i);
  });

  it("does not trigger below the percent threshold", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000)); // set baseline
    expect(ev.evaluate(point(1850)).triggered).toBe(false); // 7.5% drop
  });

  it("triggers when drop reaches the threshold", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000)); // set baseline
    expect(ev.evaluate(point(1800)).triggered).toBe(true); // exactly 10%
  });

  it("resets baseline after trigger so subsequent drops are measured fresh", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000));          // baseline = 2000
    ev.evaluate(point(1800));          // triggers (10% drop) → baseline resets to 1800
    // Drop from 1800 to 1700 is ~5.5% — should NOT trigger again
    expect(ev.evaluate(point(1700)).triggered).toBe(false);
    // Drop from 1800 to 1620 is exactly 10% — should trigger
    expect(ev.evaluate(point(1620)).triggered).toBe(true);
  });

  it("reset() clears the baseline", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000)); // baseline set
    ev.reset();
    // Next call should set a new baseline, not trigger
    const result = ev.evaluate(point(1500));
    expect(result.triggered).toBe(false);
    expect(result.reason).toMatch(/baseline/i);
  });
});

describe("ConditionEvaluator — PERCENT_RISE", () => {
  const rule = { type: "PERCENT_RISE" as const, asset: "ethereum", percent: 5 };

  it("sets baseline on first call", () => {
    const ev = new ConditionEvaluator(rule);
    expect(ev.evaluate(point(2000)).triggered).toBe(false);
  });

  it("triggers on a sufficient rise", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000));
    expect(ev.evaluate(point(2100)).triggered).toBe(true); // 5% rise
  });

  it("does not trigger on an insufficient rise", () => {
    const ev = new ConditionEvaluator(rule);
    ev.evaluate(point(2000));
    expect(ev.evaluate(point(2080)).triggered).toBe(false); // 4% rise
  });
});

describe("ConditionEvaluator — reason strings", () => {
  it("includes price and threshold in BELOW reason", () => {
    const ev = new ConditionEvaluator({ type: "BELOW", asset: "ethereum", thresholdUsd: 2000 });
    const { reason } = ev.evaluate(point(1800));
    expect(reason).toMatch(/1800/);
    expect(reason).toMatch(/2000/);
  });
});
