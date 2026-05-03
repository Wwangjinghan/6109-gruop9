# AgentIntent Protocol

ERC-4337 意图批处理协议。用户在链下签名意图（Intent），Relayer 将多个意图合并为单个 UserOperation，通过 ERC-4337 EntryPoint 提交上链执行。

支持意图类型：**SWAP / TRANSFER / DCA / REBALANCE**

---

## 架构

```
用户 / Agent Simulator
  │  EIP-191 签名 Intent（SWAP / TRANSFER / DCA / REBALANCE）
  ▼
Relayer（Intent Batcher）          /relayer — TypeScript / Express
  │  收集 N 个意图，或等待 BATCH_WINDOW_MS
  │  相同路由的 SWAP → 聚合成单笔，可链式的 SWAP → 顺序调用
  ▼
UserOpBuilder + BundlerSubmitter
  │  打包为 PackedUserOperation
  │  agent 私钥签名（EIP-191）
  │  调用 EntryPoint.handleOps
  ▼
IntentAccount（ERC-4337 智能账户）  /contracts — Solidity / Foundry
  │  validateUserOp：接受 owner 或 agent 签名
  │  execute / executeBatch：执行链上调用
  ▼
链上执行完成，intent 状态更新为 executed
```

### 核心不变量

**意图哈希**在 Solidity、TypeScript relayer、前端三处必须完全一致：

```
keccak256(abi.encode(sender, target, callData, value, deadline, nonce))
+ EIP-191 前缀
```

---

## 目录结构

| 路径 | 内容 |
|------|------|
| `/contracts` | Foundry 项目 — `IntentRegistry`、`IntentAccount`、`IntentAccountFactory`、`AgentRegistry`、部署脚本（EVM + ZK Stack） |
| `/relayer` | TypeScript/Express — `IntentBatcher`、`BundlerSubmitter`、`UserOpBuilder`、`DcaScheduler`、Agent Simulator |
| `/frontend` | Next.js 15 — wagmi v2、shadcn/ui、类型化意图提交表单（4 种 Action）、实时 Dashboard |
| `/6109zk` | ZK Hyperchain 研究 — 本地链配置、基准测试脚本、性能报告 |

---

## 快速开始（本地全链路演示）

### 前提条件

```bash
# Node.js ≥ 20
node --version

# Foundry（anvil / forge / cast）
# Linux / WSL：
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Windows（无法访问官网时，从 GitHub Releases 手动下载）
# https://github.com/foundry-rs/foundry/releases
# 下载 foundry_nightly_win32_x86_64.zip，解压后加入 PATH

# 验证
anvil --version && forge --version && cast --version
```

### 一键运行 Demo

```bash
# 1. 克隆后初始化 submodules（OpenZeppelin、eth-infinitism、forge-std）
git submodule update --init --recursive

# 2. 安装 npm 依赖（国内加镜像）
npm install --registry https://registry.npmmirror.com

# 3. 安装 tsx（TypeScript 运行时）
npm install -g tsx --registry https://registry.npmmirror.com
# 如果 tsx 命令找不到，把 npm global bin 加入 PATH：
export PATH="$(npm config get prefix)/bin:$PATH"

# 4. 运行 Demo
chmod +x run_demo.sh
./run_demo.sh
```

### Demo 执行流程

`run_demo.sh` 自动完成以下 7 个步骤：

| 步骤 | 内容 |
|------|------|
| 1 | 启动本地 Anvil 节点（chain-id 31337，出块间隔 1s） |
| 2 | 编译并部署 ERC-4337 EntryPoint v0.7 到规范地址 |
| 3 | `forge script` 部署 `IntentRegistry` + `IntentAccountFactory` + `AgentRegistry` |
| 4 | 通过工厂创建 IntentAccount（owner = Anvil #0，agent = Anvil #1） |
| 5 | 向 EntryPoint 充值 1 ETH 作为 gas 预存 |
| 6 | 后台启动 Relayer（Express，端口 3001） |
| 7 | 并发提交 5 个 SWAP 意图 → 验证合并 → 打印 Gas 报告（含真实 gasUsed） |

### 预期输出

```
✓ All 5 intents executed in a SINGLE transaction/UserOp bundle.

┌─────────────────────────────────────────────┐
│           GAS SAVINGS SUMMARY               │
├─────────────────────────────────────────────┤
│  Intents in batch        : 5               │
│  Gas (5 × individual)    : 900,000         │
│  Gas (1 × batched UserOp): 520,000         │
│  Gas saved               : 380,000         │
│                                             │
│  Formula:                                   │
│    (N×Gas_i − Gas_b) / (N×Gas_i) × 100%   │
│    = 42.2%                                  │
│                                             │
│  Cost @ 10 gwei, ETH=$3000:               │
│    Individual : $27.0000                    │
│    Batched    : $15.6000                    │
│    Saved      : $11.4000                    │
└─────────────────────────────────────────────┘
```

---

## 分步手动启动（开发调试）

### 终端 1 — 本地链

```bash
anvil --block-time 1 --chain-id 31337
```

### 终端 2 — 编译部署合约

```bash
cd contracts
forge build
forge test                    # 跑所有测试
forge test -vvv               # 详细输出

# 部署到本地 Anvil
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

### 终端 3 — Relayer

```bash
cd relayer
cp .env.example .env
# 编辑 .env，填入以下字段（本地 Anvil）：
#   CHAIN=foundry
#   RPC_URL=http://127.0.0.1:8545
#   RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
#   ACCOUNT_ADDRESS=<工厂创建的 IntentAccount 地址>
#   SWAP_ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D

npm run dev
# 看到 "Relayer started" 即成功
```

### 终端 4 — Frontend

```bash
cd frontend
cp .env.example .env.local
npm run dev
# 访问 http://localhost:3000         ← 意图提交
# 访问 http://localhost:3000/dashboard  ← 实时 Dashboard
```

### 终端 5（可选）— Agent Simulator

```bash
cd relayer
# 在 .env 里补充 SIMULATOR_* 变量后：
npm run simulate:mock    # 使用 MockPriceFeed，无需 CoinGecko key
npm run simulate         # 使用真实 CoinGecko 价格
```

---

## 连接 Sepolia 测试网

```bash
# 部署合约
PRIVATE_KEY=0x<你的私钥> \
  forge script contracts/script/Deploy.s.sol \
  --rpc-url https://sepolia.infura.io/v3/<YOUR_KEY> \
  --broadcast

# relayer/.env
CHAIN=sepolia
RPC_URL=https://sepolia.infura.io/v3/<YOUR_KEY>
RELAYER_PRIVATE_KEY=0x<你的私钥>
ACCOUNT_ADDRESS=0x<部署后的 IntentAccount>

# frontend/.env.local
NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
NEXT_PUBLIC_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<YOUR_KEY>
NEXT_PUBLIC_REGISTRY_ADDRESS=0x<IntentRegistry 地址>
```

---

## 环境变量速查

### `relayer/.env`

| 变量 | 说明 |
|------|------|
| `CHAIN` | `foundry` / `sepolia` / `mainnet` |
| `RPC_URL` | JSON-RPC 节点地址 |
| `RELAYER_PRIVATE_KEY` | Relayer agent 私钥（签 UserOp） |
| `ACCOUNT_ADDRESS` | IntentAccount 合约地址 |
| `SWAP_ROUTER_ADDRESS` | Uniswap v2 兼容路由地址 |
| `ENTRY_POINT_ADDRESS` | ERC-4337 EntryPoint（默认 v0.7 规范地址） |
| `BATCH_SIZE` | 单批最大意图数（默认 10） |
| `BATCH_WINDOW_MS` | 批次刷新窗口（默认 5000ms） |
| `MAX_CONCURRENT` | 并行批次提交上限（Semaphore，默认 3） |
| `SIMULATOR_*` | Agent Simulator 配置（见 `.env.example`） |

### `frontend/.env.local`

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_RELAYER_URL` | Relayer 地址（默认 `http://localhost:3001`） |
| `NEXT_PUBLIC_REGISTRY_ADDRESS` | IntentRegistry 合约地址 |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Sepolia RPC |

---

## 常用检查命令

```bash
# Relayer 健康检查
curl http://localhost:3001/health

# Anvil 出块确认
cast block-number --rpc-url http://127.0.0.1:8545

# 合约编译
cd contracts && forge build

# 合约测试
cd contracts && forge test

# Relayer 单元测试
cd relayer && npm test

# 全局类型检查
npm run typecheck
```

---

## ZK Stack L2 部署

```bash
# 需要安装 foundry-zksync
PRIVATE_KEY=0x... forge script contracts/script/DeployZK.s.sol \
  --rpc-url http://127.0.0.1:3050 \
  --broadcast \
  --zksync \
  --zk-gas-per-pubdata 800 \
  --slow -vvv
# 输出地址写入 contracts/script/.env.zk
```

ZK Stack 研究报告见 `/6109zk/zk-hyperchain/REPORT.md`（中文版 `REPORT_CN.md`）。

---

## 已知局限（生产环境待改进）

- Gas 预估仍保留固定 fallback 值，仅在无链上 receipt 时使用；有 receipt 后自动切换为真实 `gasUsed`
- `AgentRegistry` 为无许可注册，生产可加白名单或质押门槛
- `IntentAccount` nonce 管理未做多签支持
- DCA Scheduler 的 `minAmountOut` 固定为 0，生产应接入价格 oracle
