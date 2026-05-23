# AgentIntent Protocol

> **ERC-4337 Intent-Centric Execution Network for AI-Powered On-Chain Agents**
>
> Users sign typed intents off-chain. A Relayer batches and aggregates them into a
> single `PackedUserOperation`, submits it through an `IntentAccount` (ERC-4337
> smart account), and records real gas savings from on-chain receipts.

Supported intent types: **SWAP · TRANSFER · DCA · REBALANCE**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Off-Chain Layer                          │
│                                                                 │
│  User / Agent Simulator                                         │
│    │  Signs typed Intent payload (EIP-191)                      │
│    │  { action, params, constraints, signature }                │
│    ▼                                                            │
│  POST /intents  ──►  Intent Pool (IntentBatcher)                │
│                        │  queue: IntentRecord[]                 │
│                        │  status: pending → batched             │
│                        │  fires on maxBatchSize OR windowMs     │
│                        ▼                                        │
│                      Combiner                                   │
│                        │  SWAP  → group by route, aggregate     │
│                        │  DCA   → per-interval swap call        │
│                        │  REBALANCE → weight-delta swap calls   │
│                        │  TRANSFER  → ERC-20 / native ETH call  │
│                        ▼                                        │
│                      UserOpBuilder + BundlerSubmitter           │
│                        │  builds PackedUserOperation            │
│                        │  signs with agent key (EIP-191)        │
│                        │  Semaphore(MAX_CONCURRENT) prevents    │
│                        │  nonce collisions on parallel batches  │
└────────────────────────┼────────────────────────────────────────┘
                         │  EntryPoint.handleOps([userOp])
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       On-Chain Layer                            │
│                                                                 │
│  ERC-4337 EntryPoint v0.7                                       │
│    │  validates + executes PackedUserOperation                  │
│    ▼                                                            │
│  IntentAccount  (BaseAccount + IAccountExecute)                 │
│    │  validateUserOp  — accepts owner OR agent signature        │
│    │  executeBatch    — runs N calls in one transaction         │
│    ▼                                                            │
│  DEX Router / ERC-20 / target contracts                         │
│                                                                 │
│  IntentRegistry  — records intent hashes, marks executed        │
│  AgentRegistry   — permissionless agent registration +          │
│                    capability declarations                       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              receipt.gasUsed  ──►  IntentRecord.gasUsed
                                    ──►  GET /metrics  (avgGasPerBatch)
                                    ──►  Dashboard (Gas Savings chart)
```

---

## How Each Requirement Is Met

### ✅ 1. Intent Layer — typed, composable, abstract

Every action is a **discriminated-union Intent object**, never a raw contract call:

```typescript
// relayer/src/types/intent.ts
export const IntentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SWAP"),      params: SwapParamsSchema,      ... }),
  z.object({ action: z.literal("TRANSFER"),  params: TransferParamsSchema,  ... }),
  z.object({ action: z.literal("REBALANCE"), params: RebalanceParamsSchema, ... }),
  z.object({ action: z.literal("DCA"),       params: DcaParamsSchema,       ... }),
]);
```

Each intent carries `constraints` (deadline, slippage, nonce) separately from params —
making them composable and independently verifiable.

---

### ✅ 2. Batching & Aggregation — multiple intents → fewer executions

`IntentBatcher` collects intents and flushes when `maxBatchSize` is reached or
`batchWindowMs` elapses. The `Combiner` then merges them:

| Intent type | Aggregation strategy |
|-------------|----------------------|
| SWAP (same route) | amountIn summed → **1 swap call** |
| SWAP (chainable A→B, B→C) | chained into **sequential 2-hop calls** |
| REBALANCE | expanded into weight-delta swap calls |
| DCA | per-interval swap call |
| TRANSFER | ERC-20 `transfer()` or native ETH send |

All calls from one batch are packed into a **single `PackedUserOperation`** and
submitted in **one `EntryPoint.handleOps` transaction** — N intents become 1 tx.

```
// relayer/src/batcher/combiner.ts  — core aggregation logic
export function combineIntents(records, swapRouter, accountAddr): CombinerResult
```

---

### ✅ 3. Execution Coordinator / Relayer

Full off-chain coordinator pipeline:

```
User → POST /intents → IntentBatcher → Combiner → UserOpBuilder
     → BundlerSubmitter → EntryPoint.handleOps → receipt → status update
```

`BundlerSubmitter` uses a `Semaphore(MAX_CONCURRENT)` to allow parallel batch
submission without nonce collisions. The relayer acts as a trusted bundler — it
is whitelisted in `IntentRegistry` via `setBundler(address, true)`.

```typescript
// relayer/src/submitter/BundlerSubmitter.ts
async submitBatch(batch: CombinedBatch): Promise<Hex> {
  await this.semaphore.acquire();   // ← coordinator gate
  try { return await this._submitBatchInner(batch); }
  finally { this.semaphore.release(); }
}
```

---

### ✅ 4. Asynchronous Pipeline — submit now, execute later

Intent lifecycle is fully asynchronous with tracked state:

```
pending  →  batched  →  submitted  →  executed
                                   ↘  failed
```

- `POST /intents` returns `202 Accepted` with `intentId` immediately
- Intent sits in the pool until the batch window fires
- `GET /intents/:id` polls for status at any time
- `submittedAt`, `executedAt`, `gasUsed` are recorded from the on-chain receipt

```typescript
// relayer/src/types/intent.ts
export interface IntentRecord {
  id: string;
  status: IntentStatus;           // pending | batched | submitted | executed | failed
  receivedAt: number;             // ms — entered the pool
  submittedAt?: number;           // ms — UserOp broadcast
  executedAt?: number;            // ms — receipt confirmed
  gasUsed?: bigint;               // actual gas from receipt
  batchId?: string;
  txHash?: Hex;
}
```

DCA intents additionally use `DcaScheduler` for time-interval re-firing — each
interval injects a new SWAP intent into the batcher automatically.

---

### ✅ 5. Agent Registry — on-chain, permissioned, enumerable

`AgentRegistry.sol` provides a full protocol-level registry:

```solidity
// contracts/src/AgentRegistry.sol
function register(string[] calldata capabilities) external;
  // e.g. ["SWAP", "DCA", "REBALANCE", "TRANSFER"]

function isRegistered(address agent) external view returns (bool);
function getAgents() external view returns (address[] memory);
function getAllAgentInfo() external view returns (AgentInfo[] memory);
```

`IntentRegistry` enforces a **trusted bundler whitelist** — only addresses
approved via `setBundler(address, true)` can call `markExecuted()`:

```solidity
// contracts/src/IntentRegistry.sol
modifier onlyTrustedBundler() {
  if (!trustedBundlers[msg.sender]) revert Unauthorized();
  _;
}
```

`IntentAccount` itself supports a two-role model: **owner** (full control) and
**agent** (execution-only, EIP-191 verified in `_validateSignature`).

---

### ✅ 6. Performance Dashboard — throughput, latency, gas before/after

**REST API** (`GET /metrics`):

```json
{
  "total": 42,
  "executedCount": 38,
  "failedCount": 1,
  "failedRatePct": 2.4,
  "avgLatencyMs": 1840,
  "maxLatencyMs": 3200,
  "peakTps": 0.8,
  "avgGasPerBatch": 247000,
  "gasDataPoints": 9
}
```

**Frontend Dashboard** (`/dashboard`):

| Card | Data source |
|------|-------------|
| Total / Pending / Completed / Failed | live poll of `IntentRecord.status` |
| Avg Latency | `executedAt − submittedAt` from receipt |
| Gas Saved % | `(N × GAS_PER_INTENT − receipt.gasUsed) / (N × GAS_PER_INTENT)` |
| Gas Savings chart | per-batch `receipt.gasUsed` vs individual baseline |
| Throughput chart | intent arrival rate bucketed into 10-second windows |

Gas data comes from **real on-chain receipts** (`receipt.gasUsed` written to
every `IntentRecord` in `BundlerSubmitter._submitBatchInner`). Estimates are
used only as a fallback when no receipt has arrived yet.

---

## Repository Layout

| Path | Contents |
|------|----------|
| `contracts/src/IntentAccount.sol` | ERC-4337 smart account — `BaseAccount` + `IAccountExecute` + `executeBatch` |
| `contracts/src/IntentRegistry.sol` | On-chain intent store — trusted bundler whitelist, `markExecuted` |
| `contracts/src/AgentRegistry.sol` | Protocol-level agent registry — capabilities, enumeration |
| `contracts/src/IntentAccountFactory.sol` | CREATE2 factory for deterministic account deployment |
| `contracts/script/Deploy.s.sol` | EVM deploy script (Anvil / Sepolia) |
| `contracts/script/DeployZK.s.sol` | ZK Stack L2 deploy script (chain 271) |
| `relayer/src/types/intent.ts` | Zod intent schema — discriminated union, all 4 action types |
| `relayer/src/batcher/IntentBatcher.ts` | Intent pool — queue, windowed flush, async pipeline |
| `relayer/src/batcher/combiner.ts` | Aggregation logic — SWAP grouping, multi-hop chaining |
| `relayer/src/submitter/BundlerSubmitter.ts` | Coordinator — UserOp build, sign, submit, receipt |
| `relayer/src/scheduler/DcaScheduler.ts` | Time-interval DCA scheduler — tick-based re-firing |
| `relayer/src/simulator/agent_simulator.ts` | AI agent simulator — price-triggered DCA + REBALANCE |
| `relayer/src/api/routes.ts` | REST API — `/intents`, `/metrics`, `/schedules/dca`, `/health` |
| `frontend/src/components/IntentForm.tsx` | Typed intent form — action selector + dynamic fields |
| `frontend/src/app/dashboard/` | Real-time dashboard — live mode + demo mode |
| `6109zk/` | ZK Hyperchain research — configs, benchmarks, reports |

---

## Quick Start

### Prerequisites

```bash
# Node.js >= 20
node --version

# Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup
# Windows: download from https://github.com/foundry-rs/foundry/releases
```

### One-Command Demo

```bash
git submodule update --init --recursive
npm install
chmod +x run_demo.sh && ./run_demo.sh
```

`run_demo.sh` starts Anvil → deploys contracts → creates an IntentAccount →
starts the Relayer → submits 5 concurrent SWAP intents → prints a gas report
with **real `receipt.gasUsed`** numbers.

### Manual Start (4 terminals)

```bash
# Terminal 1 — local chain
anvil --block-time 1 --chain-id 31337

# Terminal 2 — contracts
cd contracts && forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Terminal 3 — relayer
cd relayer && cp .env.example .env   # fill in addresses
npm run dev

# Terminal 4 — frontend
cd frontend && npm run dev
# http://localhost:3000          ← intent submission (SWAP / TRANSFER / DCA / REBALANCE)
# http://localhost:3000/dashboard  ← live performance dashboard
```

### Agent Simulator

```bash
cd relayer
npm run simulate:mock   # price-triggered DCA + REBALANCE, no API key needed
npm run simulate        # real CoinGecko price feed
```

---

## API Reference

```
POST   /intents              Submit a signed intent (SWAP | TRANSFER | DCA | REBALANCE)
GET    /intents/:id          Poll intent status + gasUsed + txHash
GET    /metrics              Aggregate throughput, latency, gas, failure rate
POST   /schedules/dca        Register a time-interval DCA plan
GET    /schedules/dca        List all DCA schedules
GET    /schedules/dca/:id    Get a specific schedule
DELETE /schedules/dca/:id    Cancel a schedule
GET    /health               Liveness probe
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CHAIN` | `foundry` / `sepolia` / `zksync` |
| `RPC_URL` | JSON-RPC endpoint |
| `RELAYER_PRIVATE_KEY` | Agent key — signs UserOperations |
| `ACCOUNT_ADDRESS` | Deployed IntentAccount address |
| `SWAP_ROUTER_ADDRESS` | Uniswap v2-compatible router |
| `ENTRY_POINT_ADDRESS` | ERC-4337 EntryPoint (default: canonical v0.7) |
| `BATCH_SIZE` | Max intents per batch (default: 10) |
| `BATCH_WINDOW_MS` | Flush interval in ms (default: 5000) |
| `MAX_CONCURRENT` | Parallel batch submission limit — Semaphore (default: 3) |
| `BUNDLER_ADDRESS` | Address to whitelist in IntentRegistry at deploy time |
| `SIMULATOR_*` | Agent simulator config (see `relayer/.env.example`) |

---

## ZK Stack L2

```bash
PRIVATE_KEY=0x... forge script contracts/script/DeployZK.s.sol \
  --rpc-url http://127.0.0.1:3050 --broadcast \
  --zksync --zk-gas-per-pubdata 800 --slow -vvv
# Writes ZK_ENTRY_POINT, ZK_REGISTRY, ZK_FACTORY, ZK_AGENT_REGISTRY
# to contracts/script/.env.zk
```

Research report: [`6109zk/zk-hyperchain/REPORT.md`](6109zk/zk-hyperchain/REPORT.md)
Chinese version: [`6109zk/zk-hyperchain/REPORT_CN.md`](6109zk/zk-hyperchain/REPORT_CN.md)

---

## Gas Savings — Before / After Batching

The table below shows measured gas costs from the E2E test suite
(`relayer/src/api/routes.e2e.test.ts — Batch throughput` suite).

| Scenario | Intents | Without batching (est.) | With batching (measured) | Gas saved |
|----------|---------|------------------------|--------------------------|-----------|
| 5 × SWAP same route | 5 | ~500 000 gas (5 × 100 000) | ~180 000 gas (1 tx) | **~64 %** |
| 10 × SWAP same route | 10 | ~1 000 000 gas | ~260 000 gas (1 tx) | **~74 %** |
| Mixed SWAP + DCA batch | 5 | ~500 000 gas | ~180 000–220 000 gas | **~56–64 %** |

**Why batching saves gas:**
- `EntryPoint.handleOps` overhead (validation, nonce check, event emit) is paid **once** per
  batch instead of once per intent.
- `executeBatch` amortises calldata encoding and `SSTORE` writes over all calls.
- Real on-chain `receipt.gasUsed` figures are captured per batch and surfaced in
  `GET /metrics → avgGasPerBatch` and the Dashboard Gas Savings chart.

Gas estimation uses `eth_estimateUserOperationGas` (RPC method) when the bundler
supports it, with a 20 % safety buffer.  When unavailable (e.g. Anvil), a
call-count-scaled constant model is used as fallback.

---

## Trade-offs

| Dimension | Current choice | Why | Production alternative |
|-----------|---------------|-----|----------------------|
| Batching trigger | Time window OR size threshold | Simple; decouples arrival rate from execution | Mempool-aware dynamic sizing |
| Gas estimation | `eth_estimateUserOperationGas` → constant fallback | Accurate when bundler supports it; never blocks | Full bundler simulation endpoint |
| Submission retry | Exponential backoff, max 3 attempts | Handles transient RPC/mempool errors without blocking the queue | Dead-letter queue + alert |
| Paymaster | Optional `PAYMASTER_ADDRESS` env var | Lets deployer sponsor gas without changing account logic | On-chain VerifyingPaymaster with ECDSA sig |
| Signature verification | Off-chain `ecrecover` before queuing | Rejects spoofed browser intents immediately; trusted simulator traffic skips check | ZK proof of valid signature |
| Intent pool | In-process `Map<string, IntentRecord>` | Zero-dependency; good for demo | Redis / persistent queue (survives restarts) |
| Agent trust | `setBundler` whitelist in `IntentRegistry` | Simple access control for a single-relayer deployment | Stake-based or ZK-proof model |
| Slippage | `minAmountOut` set by caller | Keeps intent schema simple | Oracle-computed at execution time |
| Concurrency | `Semaphore(MAX_CONCURRENT)` per relayer | Prevents nonce collisions on a single account | Distributed lock across replicas |
| Decentralisation | Single trusted relayer | Appropriate for a student prototype | Open bundler market (ERC-4337 mempool) |

**Key tension — efficiency vs. decentralisation:**
A single relayer can batch aggressively (low latency, high gas savings) but is a
centralisation and censorship risk.  Moving to an open bundler market (as ERC-4337
envisions) restores trustlessness at the cost of coordination overhead and potentially
smaller batches.  This project intentionally sits at the efficient end of the spectrum
to demonstrate the scalability gains, and documents the trust assumptions explicitly.

---

## Known Limitations

- DCA `minAmountOut` is hardcoded to `"0"` — production should use a price oracle
- `AgentRegistry` is permissionless; add stake or whitelist for production
- No multi-sig support on `IntentAccount`
- Intent pool is in-memory; Relayer restart drops pending intents
