import "dotenv/config";
import express from "express";
import type { Hex, Address } from "viem";
import { createChainClients } from "./chain/viemClients.js";
import { IntentBatcher } from "./batcher/IntentBatcher.js";
import { BundlerSubmitter } from "./submitter/BundlerSubmitter.js";
import { createRouter } from "./api/routes.js";
import { logger } from "./utils/logger.js";
import { ENTRY_POINT_ADDRESS } from "./abi/entryPoint.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT                = Number(process.env.PORT            ?? 3001);
const RPC_URL             = process.env.RPC_URL                ?? "";
const CHAIN_NAME          = process.env.CHAIN                  ?? "sepolia";
const PRIVATE_KEY         = (process.env.RELAYER_PRIVATE_KEY   ?? "") as Hex;
const ACCOUNT_ADDRESS     = (process.env.ACCOUNT_ADDRESS       ?? "") as Address;
const SWAP_ROUTER_ADDRESS = (process.env.SWAP_ROUTER_ADDRESS   ?? "") as Address;
const ENTRY_POINT         = (process.env.ENTRY_POINT_ADDRESS   ?? ENTRY_POINT_ADDRESS) as Address;
const BATCH_SIZE          = Number(process.env.BATCH_SIZE      ?? 10);
const BATCH_WINDOW_MS     = Number(process.env.BATCH_WINDOW_MS ?? 5000);

const missing = [
  !RPC_URL             && "RPC_URL",
  !PRIVATE_KEY         && "RELAYER_PRIVATE_KEY",
  !ACCOUNT_ADDRESS     && "ACCOUNT_ADDRESS",
  !SWAP_ROUTER_ADDRESS && "SWAP_ROUTER_ADDRESS",
].filter(Boolean);

if (missing.length) {
  logger.error({ missing }, "Missing required environment variables");
  process.exit(1);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const { publicClient, walletClient, agentAddress } = createChainClients(
  RPC_URL,
  PRIVATE_KEY,
  CHAIN_NAME,
);

logger.info({ agentAddress, chain: CHAIN_NAME, entryPoint: ENTRY_POINT }, "Chain clients ready");

const submitter = new BundlerSubmitter({
  publicClient,
  walletClient,
  agentAddress,
  entryPointAddress: ENTRY_POINT,
});

const batcher = new IntentBatcher({
  maxBatchSize:   BATCH_SIZE,
  batchWindowMs:  BATCH_WINDOW_MS,
  defaultAccount: ACCOUNT_ADDRESS,
  swapRouter:     SWAP_ROUTER_ADDRESS,
  onBatchReady:   (batch) => submitter.submitBatch(batch).then(() => {}),
});

const app = express();
app.use(express.json());
app.use("/", createRouter(batcher));

const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, batchSize: BATCH_SIZE, batchWindowMs: BATCH_WINDOW_MS },
    "Relayer started",
  );
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = () => {
  logger.info("Shutting down…");
  batcher.stop();
  server.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
