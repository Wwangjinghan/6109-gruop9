#!/usr/bin/env bash
# 一键运行脚本：编译 → 测试 → 部署 → 交互 → DA集成 → 基准测试
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"

L2_RPC="http://127.0.0.1:3050"
# zkstack localhost 富账户私钥
export DEPLOYER_PK="7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() { echo -e "\033[1;36m[GAMECHAIN]\033[0m $*"; }

# ── 1. 编译 ──────────────────────────────────────────────────────────────────
log "Step 1: 编译合约..."
forge build --evm-version paris 2>&1 | tail -5

# ── 2. 单元测试 ───────────────────────────────────────────────────────────────
log "Step 2: 运行单元测试..."
forge test -vv 2>&1

# ── 3. 部署到 L2 ──────────────────────────────────────────────────────────────
log "Step 3: 部署合约到 ZK Stack L2 (chain 271)..."
forge script script/Deploy.s.sol \
  --rpc-url "$L2_RPC" \
  --broadcast \
  --legacy \
  -vv 2>&1

# 加载合约地址
source .env.contracts
log "LEADERBOARD  = $LEADERBOARD"
log "GAME_ITEMS   = $GAME_ITEMS"
log "EXEC_VERIFIER= $EXEC_VERIFIER"

export LEADERBOARD GAME_ITEMS EXEC_VERIFIER

# ── 4. 游戏交互 ────────────────────────────────────────────────────────────────
log "Step 4: 运行游戏交互脚本..."
forge script script/GameInteract.s.sol \
  --rpc-url "$L2_RPC" \
  --broadcast \
  --legacy \
  -vv 2>&1

# ── 5. DA 集成 ─────────────────────────────────────────────────────────────────
log "Step 5: 运行 Modular DA 集成..."
forge script script/DAIntegration.s.sol \
  --rpc-url "$L2_RPC" \
  --broadcast \
  --legacy \
  --ffi \
  -vv 2>&1

# ── 6. 基准测试 ────────────────────────────────────────────────────────────────
log "Step 6: 运行 Gas 基准测试..."
forge script script/Benchmark.s.sol \
  --rpc-url "$L2_RPC" \
  --broadcast \
  --legacy \
  -vv 2>&1

log ""
log "============================================================"
log "  所有步骤完成！"
log "  L2 RPC  : $L2_RPC (chain 271)"
log "  DA 层   : http://127.0.0.1:7777"
log "  合约地址: .env.contracts"
log "============================================================"
