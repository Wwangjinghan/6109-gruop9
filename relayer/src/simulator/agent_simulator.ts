/**
 * agent_simulator.ts
 *
 * Monitors a price feed (real CoinGecko or mock) and fires a DCA intent to the
 * relayer whenever a configured condition is met.
 *
 * Usage:
 *   npx tsx src/simulator/agent_simulator.ts
 *
 * Required env vars (see .env.example):
 *   SIMULATOR_AGENT_PRIVATE_KEY   — 0x-prefixed key; signs intents as "agent"
 *   SIMULATOR_RELAYER_URL         — e.g. http://localhost:3001
 *   SIMULATOR_USER_ID             — arbitrary user identifier
 *   SIMULATOR_TOKEN_IN            — ERC-20 address (e.g. USDC on Sepolia)
 *   SIMULATOR_TOKEN_OUT           — ERC-20 address (e.g. WETH on Sepolia)
 *   SIMULATOR_AMOUNT_PER_INTERVAL — token-unit amount (decimal string, e.g. "1000000" for 1 USDC)
 *   SIMULATOR_INTERVAL_SECONDS    — DCA cadence in seconds (e.g. 86400 = daily)
 *   SIMULATOR_TOTAL_INTERVALS     — number of DCA rounds (max 52)
 *
 * Optional:
 *   SIMULATOR_PRICE_FEED          — "coingecko" (default) | "mock"
 *   SIMULATOR_COINGECKO_API_KEY   — CoinGecko Pro key
 *   SIMULATOR_ASSET               — CoinGecko asset id (default "ethereum")
 *   SIMULATOR_CONDITION_TYPE      — "BELOW" | "ABOVE" | "PERCENT_DROP" | "PERCENT_RISE" (default "BELOW")
 *   SIMULATOR_THRESHOLD_USD       — price threshold for BELOW/ABOVE (default 2000)
 *   SIMULATOR_PERCENT             — percent for PERCENT_DROP/PERCENT_RISE (default 5)
 *   SIMULATOR_POLL_INTERVAL_MS    — how often to check the price (default 60000 = 1 min)
 *   SIMULATOR_COOLDOWN_MS         — minimum ms between triggers (default 3600000 = 1 h)
 *   SIMULATOR_MOCK_INITIAL_PRICE  — starting price for mock feed (default 2500)
 *   SIMULATOR_MOCK_DRIFT_PERCENT  — price drift per tick for mock feed (default -1)
 *   CHAIN                         — "sepolia" (default) | "mainnet"
 */

import "dotenv/config";
import { createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { logger } from "../utils/logger.js";
import { CoinGeckoPriceFeed, MockPriceFeed, type PriceFeed } from "./priceFeed.js";
import { ConditionEvaluator, type PriceRule } from "./conditions.js";
import { buildSignedDcaIntent } from "./intentSigner.js";
import { RelayerClient } from "./relayerClient.js";

// ─── Config ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const AGENT_PRIVATE_KEY      = requireEnv("SIMULATOR_AGENT_PRIVATE_KEY") as Hex;
const RELAYER_URL            = requireEnv("SIMULATOR_RELAYER_URL");
const USER_ID                = requireEnv("SIMULATOR_USER_ID");
const TOKEN_IN               = requireEnv("SIMULATOR_TOKEN_IN") as Address;
const TOKEN_OUT              = requireEnv("SIMULATOR_TOKEN_OUT") as Address;
const AMOUNT_PER_INTERVAL    = BigInt(requireEnv("SIMULATOR_AMOUNT_PER_INTERVAL"));
const INTERVAL_SECONDS       = Number(requireEnv("SIMULATOR_INTERVAL_SECONDS"));
const TOTAL_INTERVALS        = Number(requireEnv("SIMULATOR_TOTAL_INTERVALS"));

const PRICE_FEED_TYPE        = optionalEnv("SIMULATOR_PRICE_FEED", "coingecko");
const COINGECKO_API_KEY      = process.env.SIMULATOR_COINGECKO_API_KEY;
const ASSET                  = optionalEnv("SIMULATOR_ASSET", "ethereum");
const CONDITION_TYPE         = optionalEnv("SIMULATOR_CONDITION_TYPE", "BELOW") as PriceRule["type"];
const THRESHOLD_USD          = Number(optionalEnv("SIMULATOR_THRESHOLD_USD", "2000"));
const PERCENT                = Number(optionalEnv("SIMULATOR_PERCENT", "5"));
const POLL_INTERVAL_MS       = Number(optionalEnv("SIMULATOR_POLL_INTERVAL_MS", "60000"));
const COOLDOWN_MS            = Number(optionalEnv("SIMULATOR_COOLDOWN_MS", "3600000"));
const MOCK_INITIAL_PRICE     = Number(optionalEnv("SIMULATOR_MOCK_INITIAL_PRICE", "2500"));
const MOCK_DRIFT_PERCENT     = Number(optionalEnv("SIMULATOR_MOCK_DRIFT_PERCENT", "-1"));
const CHAIN_NAME             = optionalEnv("CHAIN", "sepolia");

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const chain = CHAIN_NAME === "mainnet" ? mainnet : sepolia;
const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain, transport: http() });

logger.info({ agentAddress: account.address, chain: CHAIN_NAME }, "Agent simulator initialising");

const priceFeed: PriceFeed = PRICE_FEED_TYPE === "mock"
  ? new MockPriceFeed({ prices: { [ASSET]: MOCK_INITIAL_PRICE }, driftPercent: MOCK_DRIFT_PERCENT })
  : new CoinGeckoPriceFeed({ apiKey: COINGECKO_API_KEY });

const rule: PriceRule = (() => {
  switch (CONDITION_TYPE) {
    case "BELOW":        return { type: "BELOW",        asset: ASSET, thresholdUsd: THRESHOLD_USD };
    case "ABOVE":        return { type: "ABOVE",        asset: ASSET, thresholdUsd: THRESHOLD_USD };
    case "PERCENT_DROP": return { type: "PERCENT_DROP", asset: ASSET, percent: PERCENT };
    case "PERCENT_RISE": return { type: "PERCENT_RISE", asset: ASSET, percent: PERCENT };
    default: throw new Error(`Unknown condition type: ${CONDITION_TYPE}`);
  }
})();

const evaluator  = new ConditionEvaluator(rule);
const relayer    = new RelayerClient({ baseUrl: RELAYER_URL });

// ─── Monitor loop ─────────────────────────────────────────────────────────────

let lastTriggerAt = 0;
let nonce = 0;
let running = true;

async function tick(): Promise<void> {
  let point;
  try {
    point = await priceFeed.getPrice(ASSET);
  } catch (err) {
    logger.warn({ err }, "Price fetch failed — skipping tick");
    return;
  }

  const result = evaluator.evaluate(point);

  logger.info(
    { asset: ASSET, priceUsd: point.priceUsd, triggered: result.triggered, reason: result.reason },
    "Price tick",
  );

  if (!result.triggered) return;

  const now = Date.now();
  const cooldownRemaining = COOLDOWN_MS - (now - lastTriggerAt);
  if (lastTriggerAt > 0 && cooldownRemaining > 0) {
    logger.info({ cooldownRemaining }, "Condition met but still in cooldown — skipping");
    return;
  }

  logger.info({ priceUsd: point.priceUsd, rule: result.rule }, "Condition triggered — building DCA intent");

  let payload;
  try {
    payload = await buildSignedDcaIntent(
      {
        userId: USER_ID,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        amountPerInterval: AMOUNT_PER_INTERVAL,
        intervalSeconds: INTERVAL_SECONDS,
        totalIntervals: TOTAL_INTERVALS,
        nonce: nonce++,
      },
      walletClient,
    );
  } catch (err) {
    logger.error({ err }, "Failed to build signed intent");
    return;
  }

  let submitResponse;
  try {
    submitResponse = await relayer.submit(payload);
  } catch (err) {
    logger.error({ err }, "Failed to submit intent to relayer");
    return;
  }

  lastTriggerAt = Date.now();

  logger.info(
    { intentId: submitResponse.intentId, status: submitResponse.status, priceUsd: point.priceUsd },
    "DCA intent submitted",
  );

  // Fire-and-forget status poll in the background — logs final outcome without blocking the loop
  relayer
    .pollUntilDone(submitResponse.intentId, { intervalMs: 5_000, timeoutMs: 300_000 })
    .then((s) => {
      logger.info(
        { intentId: s.intentId, status: s.status, txHash: s.txHash },
        "Intent reached terminal status",
      );
    })
    .catch((err) => {
      logger.warn({ err, intentId: submitResponse.intentId }, "Status polling timed out or errored");
    });
}

async function runLoop(): Promise<void> {
  logger.info(
    {
      asset: ASSET,
      condition: rule,
      pollIntervalMs: POLL_INTERVAL_MS,
      cooldownMs: COOLDOWN_MS,
      priceFeed: PRICE_FEED_TYPE,
    },
    "Monitor loop started",
  );

  while (running) {
    await tick();
    if (running) await sleep(POLL_INTERVAL_MS);
  }

  logger.info("Monitor loop stopped");
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(): void {
  logger.info("Shutting down agent simulator…");
  running = false;
  priceFeed.close?.();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);

// ─── Start ────────────────────────────────────────────────────────────────────

runLoop().catch((err) => {
  logger.error({ err }, "Unhandled error in monitor loop");
  process.exit(1);
});

// ─── Util ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
