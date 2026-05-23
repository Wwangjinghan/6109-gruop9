# AgentIntent Protocol — 组员通知

## 一、我们已经完成了什么

### 智能合约（`contracts/`）
- `IntentAccount.sol` — ERC-4337 智能账户，支持 owner + agent 双角色签名，`executeBatch()` 一笔交易执行多个调用
- `IntentRegistry.sol` — 链上 Intent 记录，trusted bundler 白名单，`markExecuted()` 防重放
- `AgentRegistry.sol` — 链上 Agent 注册表，permissionless 注册，capabilities 声明，可枚举
- `IntentAccountFactory.sol` — CREATE2 工厂，确定性地址部署
- Deploy 脚本：`Deploy.s.sol`（Anvil/Sepolia）和 `DeployZK.s.sol`（ZK Stack L2, chain 271）

### 链下 Relayer（`relayer/`）
- Intent Schema（`types/intent.ts`）：Zod 判别联合体，4 种类型：SWAP / DCA / REBALANCE / TRANSFER
- IntentBatcher（`batcher/IntentBatcher.ts`）：窗口 + 大小双触发批处理
- Combiner（`batcher/combiner.ts`）：SWAP 同路由聚合、多跳链接、REBALANCE 拆解、TRANSFER、DCA
- BundlerSubmitter（`submitter/BundlerSubmitter.ts`）：Semaphore 并发控制，UserOp 构建签名提交，链上 gasUsed 写回
- DCA Scheduler（`scheduler/DcaScheduler.ts`）：时间间隔自动触发 SWAP
- Agent Simulator（`simulator/agent_simulator.ts`）：价格触发的 DCA + REBALANCE 模拟
- REST API：`POST /intents`、`GET /intents`、`GET /intents/:id`、`GET /metrics`、`GET /health`

### 前端（`frontend/`）
- Intent 提交表单（`IntentForm.tsx`）：支持 4 种 action 类型，动态字段
- 实时 Dashboard（`/dashboard`）：
  - 7 个统计卡片：Total / Pending / Completed / Failed / Avg Latency / Gas Saved % / Avg Gas per Batch
  - 3 个图表：Gas Savings（柱状）/ Throughput TPS（面积）/ Execution Latency（折线）
  - Live 模式自动对接 Relayer，Demo 模式离线演示
- `gasUsed` 数据管道：链上 receipt → IntentRecord → `/metrics` → Dashboard

### ZK Stack 研究（`6109zk/`）
- 研究报告：`zk-hyperchain/REPORT.md` 和 `REPORT_CN.md`
- 配置、benchmark 数据

---

## 二、和要求相比还差什么

| 项目 | 当前状态 | 缺口 |
|------|---------|------|
| Intent 签名验证 | 合约执行时验证 | Relayer 入队前未做链下签名校验，任何格式正确的请求都会入队 |
| 状态持久化 | 纯内存 Map | Relayer 重启后所有 pending intent 丢失，生产应换 Redis |
| Gas 估算 | 固定常量 | 未调用 `eth_estimateUserOperationGas`，会过度预留或不足 |
| Paymaster | 无 | `paymasterAndData` 硬编码为 `"0x"`，用户需自己有 ETH 付 gas |
| 失败重试 | 无 | UserOp 失败直接标 failed，无自动重试逻辑 |
| 前端 Live 模式 | 仅跟踪 sessionStorage 中的 intentId | Simulator 提交的 intent 不出现在 Intent Queue |
| 测试覆盖 | 单元测试有 | 缺少 E2E 集成测试（合约 + Relayer + 前端联调） |
| 合约可升级性 | 无 | 不支持升级，上线后逻辑无法修改 |

---

## 三、怎么启动项目

### 前置条件

```bash
node --version   # >= 20
# Foundry（anvil / forge / cast）
# Windows 从 https://github.com/foundry-rs/foundry/releases 下载
```

### 一键演示（推荐）

```bash
git clone https://github.com/Wwangjinghan/6109-gruop9
cd 6109-gruop9
npm install
chmod +x run_demo.sh && ./run_demo.sh
```

脚本自动完成：启动 Anvil → 部署合约 → 创建 IntentAccount → 启动 Relayer → 提交 5 个并发 SWAP → 打印链上 Gas 对比报告。

### 手动启动（4 个终端）

```bash
# 终端 1 — 本地链
anvil --block-time 1 --chain-id 31337

# 终端 2 — 部署合约
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 终端 3 — 启动 Relayer
cd relayer && cp .env.example .env
# 编辑 .env：填入 ACCOUNT_ADDRESS、SWAP_ROUTER_ADDRESS 等部署地址
npm run dev

# 终端 4 — 启动前端
cd frontend && npm run dev
# http://localhost:3000           ← 提交 Intent
# http://localhost:3000/dashboard ← 实时 Dashboard
```

### 运行 Agent 模拟器

```bash
cd relayer
npm run simulate:mock   # 价格触发的 DCA + REBALANCE，无需 API Key
npm run simulate        # 真实 CoinGecko 价格源
```

### Relayer 关键环境变量（`relayer/.env`）

| 变量 | 说明 |
|------|------|
| `RPC_URL` | 链的 JSON-RPC 地址 |
| `RELAYER_PRIVATE_KEY` | Relayer 签名私钥 |
| `ACCOUNT_ADDRESS` | 已部署的 IntentAccount 地址 |
| `SWAP_ROUTER_ADDRESS` | DEX Router 地址 |
| `BATCH_SIZE` | 每批最多多少个 intent（默认 10）|
| `BATCH_WINDOW_MS` | 批处理窗口时间 ms（默认 5000）|

---

## 四、接下来需要做的事

### 任务 A：优化前端

**1. Live 模式 Intent Queue 显示所有 intent（优先级：高）**

- 当前：Queue 只显示 sessionStorage 中的 intentId（前端自己提交的）
- 方案：改为调用 `GET /intents` 直接拉取所有 intent，替代逐个轮询 `/intents/:id`
- 文件：`frontend/src/app/dashboard/DashboardClient.tsx` 中的 `useLiveData()`

**2. Intent 表单 UX 改进（优先级：中）**

- DCA / REBALANCE 字段说明不够清晰，需加 tooltip 或 placeholder
- REBALANCE 的 `targetWeightsBps` 需校验总和等于 10000
- 文件：`frontend/src/components/IntentForm.tsx`

**3. Dashboard 失败率告警（优先级：中）**

- 失败率 > 10% 时 Failed 卡片已变红，但没有横幅提示
- 方案：加一个顶部 Alert 组件
- 文件：`frontend/src/app/dashboard/DashboardClient.tsx`

**4. 历史记录持久化（优先级：低）**

- 当前刷新页面后 sessionStorage 清空，Intent Queue 清零
- 方案：改用 localStorage，或接入后端 `/intents` 列表端点

---

### 任务 B：上链

**1. 部署到 Sepolia 测试网**

```bash
cd contracts
PRIVATE_KEY=0x你的私钥 forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.infura.io/v3/你的KEY \
  --broadcast --verify
```

需要准备：
- Sepolia ETH（从 faucet 获取）
- Infura 或 Alchemy API Key
- 部署后把合约地址填进 `relayer/.env`

**2. 部署到 ZK Stack L2（chain 271）**

```bash
PRIVATE_KEY=0x你的私钥 forge script contracts/script/DeployZK.s.sol \
  --rpc-url http://127.0.0.1:3050 --broadcast \
  --zksync --zk-gas-per-pubdata 800 --slow
```

需要准备：
- foundry-zksync 工具链（见 README）
- 部署结果自动写入 `contracts/script/.env.zk`

**3. 上链前必须解决**

- `IntentAccount` 需要实际可用的 DEX Router 地址（Sepolia 上的 Uniswap v2：`0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`）
- `minAmountOut` 当前硬编码为 `"0"`，上链前需接入价格预言机或前端计算滑点保护
- `AgentRegistry` 目前 permissionless，考虑是否要加白名单或 stake 机制

---

**GitHub 仓库：https://github.com/Wwangjinghan/6109-gruop9**
