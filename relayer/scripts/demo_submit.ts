/**
 * demo_submit.ts
 *
 * Fires 5 simultaneous SWAP intents (same USDC→WETH route) at the local relayer,
 * waits for them all to reach a terminal status, then prints a gas comparison report.
 *
 * Usage (called by run_demo.sh):
 *   tsx relayer/scripts/demo_submit.ts
 *
 * Required env vars (injected by run_demo.sh):
 *   DEMO_RELAYER_URL        http://localhost:3001
 *   DEMO_AGENT_PRIVATE_KEY  0x-prefixed key (Anvil account #1)
 *   DEMO_TOKEN_IN           mock ERC-20 address
 *   DEMO_TOKEN_OUT          mock ERC-20 address
 *   DEMO_ACCOUNT_ADDRESS    deployed IntentAccount address
 */

import { createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// ─── Config ───────────────────────────────────────────────────────────────────

const RELAYER_URL     = process.env.DEMO_RELAYER_URL     ?? "http://localhost:3001";
const PRIVATE_KEY     = (process.env.DEMO_AGENT_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const TOKEN_IN        = (process.env.DEMO_TOKEN_IN  ?? "0x0000000000000000000000000000000000000001") as `0x${string}`;
const TOKEN_OUT       = (process.env.DEMO_TOKEN_OUT ?? "0x0000000000000000000000000000000000000002") as `0x${string}`;
const ACCOUNT_ADDRESS = (process.env.DEMO_ACCOUNT_ADDRESS ?? "") as `0x${string}`;

const INTENT_COUNT    = 5;
const AMOUNT_IN       = "1000000"; // 1 USDC (6 decimals)
const MIN_AMOUNT_OUT  = "0";

// Gas constants (must mirror relayer defaults)
const GAS_PER_INDIVIDUAL = 180_000;   // ~estimate for a single UserOp swap
const GAS_BATCH_OVERHEAD = 120_000;   // fixed EntryPoint + account overhead
const GAS_PER_CALL       = 80_000;    // per call inside executeBatch

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function hashSwapIntent(userId: string, tokenIn: string, tokenOut: string, amountIn: string): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string userId, string action, address tokenIn, address tokenOut, uint256 amountIn"),
      [userId, "SWAP", tokenIn as `0x${string}`, tokenOut as `0x${string}`, BigInt(amountIn)],
    ),
  );
}

async function submitIntent(
  walletClient: ReturnType<typeof createWalletClient>,
  userId: string,
  nonce: number,
): Promise<{ intentId: string }> {
  const intentHash = hashSwapIntent(userId, TOKEN_IN, TOKEN_OUT, AMOUNT_IN);
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: intentHash },
  });

  const payload = {
    userId,
    action: "SWAP",
    params: {
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountIn: AMOUNT_IN,
      minAmountOut: MIN_AMOUNT_OUT,
      recipient: ACCOUNT_ADDRESS || undefined,
    },
    signature,
    account: ACCOUNT_ADDRESS || undefined,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    nonce,
  };

  const res = await fetch(`${RELAYER_URL}/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /intents failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function pollStatus(intentId: string, timeoutMs = 120_000): Promise<{
  intentId: string;
  status: string;
  batchId?: string;
  txHash?: string;
  userOpHash?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${RELAYER_URL}/intents/${intentId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "executed" || data.status === "failed") return data;
    }
    await sleep(2_000);
  }
  throw new Error(`Intent ${intentId} timed out after ${timeoutMs}ms`);
}

function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

function banner(text: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner("AgentIntent Protocol — Demo Integration Test");

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({ account, chain: foundry, transport: http("http://127.0.0.1:8545") });

  console.log(`\n  Agent address : ${account.address}`);
  console.log(`  Relayer URL   : ${RELAYER_URL}`);
  console.log(`  Token path    : ${TOKEN_IN} → ${TOKEN_OUT}`);
  console.log(`  Intent count  : ${INTENT_COUNT}`);

  // ── Step 1: Fire all 5 intents simultaneously ──────────────────────────────
  banner("Step 1 — Submitting 5 simultaneous SWAP intents");

  const submitStart = Date.now();
  const submits = await Promise.all(
    Array.from({ length: INTENT_COUNT }, (_, i) =>
      submitIntent(walletClient, `demo-user-${i + 1}`, i),
    ),
  );
  const submitMs = Date.now() - submitStart;

  const intentIds = submits.map((s) => s.intentId);
  console.log(`\n  Submitted ${INTENT_COUNT} intents in ${submitMs}ms`);
  intentIds.forEach((id, i) => console.log(`    [${i + 1}] ${id}`));

  // ── Step 2: Wait for all to reach a terminal status ────────────────────────
  banner("Step 2 — Waiting for execution (polling relayer)…");

  const pollStart = Date.now();
  const results = await Promise.all(intentIds.map((id) => pollStatus(id, 120_000)));
  const pollMs = Date.now() - pollStart;

  results.forEach((r, i) => {
    const icon = r.status === "executed" ? "✓" : "✗";
    console.log(`    [${i + 1}] ${icon} ${r.status.padEnd(10)} txHash: ${r.txHash ?? "—"}  batch: ${r.batchId ?? "—"}`);
  });

  // ── Step 3: Verify single-bundle execution ─────────────────────────────────
  banner("Step 3 — Verifying bundle consolidation");

  const executed = results.filter((r) => r.status === "executed");
  const failed   = results.filter((r) => r.status === "failed");

  const uniqueBatches  = new Set(results.map((r) => r.batchId).filter(Boolean));
  const uniqueTxHashes = new Set(results.map((r) => r.txHash).filter(Boolean));
  const uniqueUserOps  = new Set(results.map((r) => r.userOpHash).filter(Boolean));

  console.log(`\n  Executed       : ${executed.length} / ${INTENT_COUNT}`);
  console.log(`  Failed         : ${failed.length} / ${INTENT_COUNT}`);
  console.log(`  Unique batches : ${uniqueBatches.size}`);
  console.log(`  Unique txHashes: ${uniqueTxHashes.size}`);
  console.log(`  Unique UserOps : ${uniqueUserOps.size}`);

  const isSingleBundle = uniqueTxHashes.size === 1 && executed.length === INTENT_COUNT;
  if (isSingleBundle) {
    console.log("\n  ✓ All 5 intents executed in a SINGLE transaction/UserOp bundle.");
  } else if (uniqueTxHashes.size > 0) {
    console.log(`\n  ⚠ Intents spread across ${uniqueTxHashes.size} transaction(s).`);
  } else {
    console.log("\n  ✗ No intents confirmed on-chain within the timeout.");
  }

  // ── Step 4: Gas comparison report ─────────────────────────────────────────
  banner("Step 4 — Gas Comparison Report");

  // Individual: each intent as its own UserOp
  const gasIndividual = INTENT_COUNT * GAS_PER_INDIVIDUAL;

  // Batched: all 5 same-route SWAPs merge into one executeBatch call
  // → 1 verification overhead + N swap calls inside executeBatch
  const gasBatched = GAS_BATCH_OVERHEAD + INTENT_COUNT * GAS_PER_CALL;

  const gasSaved    = gasIndividual - gasBatched;
  const savedPct    = ((gasSaved / gasIndividual) * 100).toFixed(1);

  // Approx cost at 10 gwei, ETH = $3 000
  const ETH_USD = 3_000;
  const GWEI    = 10;
  const costIndividual = (gasIndividual * GWEI * 1e-9 * ETH_USD).toFixed(4);
  const costBatched    = (gasBatched    * GWEI * 1e-9 * ETH_USD).toFixed(4);
  const costSaved      = (gasSaved      * GWEI * 1e-9 * ETH_USD).toFixed(4);

  console.log(`
  ┌─────────────────────────────────────────────┐
  │           GAS SAVINGS SUMMARY               │
  ├─────────────────────────────────────────────┤
  │  Intents in batch        : ${String(INTENT_COUNT).padEnd(16)}│
  │  Gas (5 × individual)    : ${fmtNum(gasIndividual).padEnd(16)}│
  │  Gas (1 × batched UserOp): ${fmtNum(gasBatched).padEnd(16)}│
  │  Gas saved               : ${fmtNum(gasSaved).padEnd(16)}│
  │                                             │
  │  Formula:                                   │
  │    (N×Gas_i − Gas_b) / (N×Gas_i) × 100%    │
  │    = (${fmtNum(gasIndividual)} − ${fmtNum(gasBatched)}) / ${fmtNum(gasIndividual)} × 100%  │
  │    = ${savedPct.padEnd(40)}%│
  │                                             │
  │  Cost @ ${GWEI} gwei, ETH=$${ETH_USD}:             │
  │    Individual : $${costIndividual.padEnd(28)}│
  │    Batched    : $${costBatched.padEnd(28)}│
  │    Saved      : $${costSaved.padEnd(28)}│
  └─────────────────────────────────────────────┘`);

  console.log(`\n  Total demo time: ${((Date.now() - submitStart) / 1000).toFixed(1)}s`);
  console.log(`  Polling time   : ${(pollMs / 1000).toFixed(1)}s\n`);

  // Exit non-zero if verification failed
  if (!isSingleBundle && uniqueTxHashes.size !== 1) {
    console.error("  ✗ VERIFICATION FAILED — intents were not bundled into a single tx.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n  FATAL:", err.message);
  process.exit(1);
});
