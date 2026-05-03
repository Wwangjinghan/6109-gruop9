#!/usr/bin/env bash
# ZK Stack Local Hyperchain — Full Setup Script
# Run from inside WSL2. Prerequisites: Docker running, zkstack, forge, yarn installed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"

ECOSYSTEM_DIR="$HOME/local_hyperchain"

# ---------------------------------------------------------------------------
# 1. Verify tooling
# ---------------------------------------------------------------------------
for cmd in docker zkstack forge yarn node; do
  command -v "$cmd" >/dev/null || err "$cmd not found"
done
docker info >/dev/null 2>&1 || err "Docker daemon is not running — start Docker Desktop first."
log "Prerequisites OK."

# ---------------------------------------------------------------------------
# 2. Start L1 (Geth) + Postgres
# ---------------------------------------------------------------------------
log "Starting local L1 (Geth) and Postgres..."
docker compose -f "$ROOT_DIR/configs/docker-compose.l1.yml" up -d

log "Waiting for Geth (max 60s)..."
timeout 60 bash -c '
  until curl -sf -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" \
    | grep -q "result"; do
    sleep 2
  done
' || err "Geth did not start within 60 seconds."
log "Geth is up."

# ---------------------------------------------------------------------------
# 3. Pre-fund the zkstack deployer address on Geth --dev
# ---------------------------------------------------------------------------
log "Funding deployer address on local L1..."
DEPLOYER="0x36615cf349d7f6344891b1e7ca7c72883f5dc049"
DEV_ACCOUNT=$(curl -sf -X POST http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0])")
curl -sf -X POST http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{
    \"from\":\"$DEV_ACCOUNT\",
    \"to\":\"$DEPLOYER\",
    \"value\":\"0x56BC75E2D63100000\",
    \"gas\":\"0x5208\",
    \"maxFeePerGas\":\"0x77359400\",
    \"maxPriorityFeePerGas\":\"0x3B9ACA00\"
  }],\"id\":2}" > /dev/null
sleep 3
log "Deployer funded."

# ---------------------------------------------------------------------------
# 4. Start simulated DA layer
# ---------------------------------------------------------------------------
log "Starting simulated Modular DA layer..."
python3 "$ROOT_DIR/da-layer/simulated_da.py" &
echo $! > "$ROOT_DIR/.da_pid"
log "DA layer running on http://127.0.0.1:7777"

# ---------------------------------------------------------------------------
# 5. Initialize ecosystem (idempotent — zkstack skips if already done)
# ---------------------------------------------------------------------------
if [[ ! -d "$ECOSYSTEM_DIR" ]]; then
  log "Creating ZK Stack ecosystem..."
  cd "$HOME"
  zkstack ecosystem create \
    --ecosystem-name "local-hyperchain" \
    --l1-network "localhost" \
    --link-to-code "$HOME/zksync-era" \
    --chain-name "myappchain" \
    --chain-id 271 \
    --prover-mode "no-proofs" \
    --wallet-creation "localhost" \
    --l1-batch-commit-data-generator-mode "validium" \
    --base-token-address "0x0000000000000000000000000000000000000001" \
    --base-token-price-nominator 1 \
    --base-token-price-denominator 1 \
    --set-as-default true \
    --evm-emulator false \
    --start-containers false
else
  warn "Ecosystem already exists, skipping create."
fi

# ---------------------------------------------------------------------------
# 6. Deploy contracts + init chain (run from ecosystem dir)
# ---------------------------------------------------------------------------
cd "$ECOSYSTEM_DIR"

log "Deploying ecosystem contracts to local L1 (this takes ~5 min)..."
zkstack ecosystem init \
  --deploy-erc20 true \
  --deploy-ecosystem true \
  --l1-rpc-url "http://127.0.0.1:8545" \
  --server-db-url "postgresql://zksync:zksync@127.0.0.1:5432" \
  --server-db-name "zksync_local" \
  --observability false \
  --update-submodules false \
  --validium-type "no-da" \
  --deploy-paymaster true \
  --no-port-reallocation

# ---------------------------------------------------------------------------
# 7. Start ZK server (L2 node)
# ---------------------------------------------------------------------------
log "Starting ZK server (L2 node)..."
zkstack server --chain myappchain &
echo $! > "$ROOT_DIR/.server_pid"

log ""
log "============================================================"
log "  ZK Stack Local Hyperchain RUNNING"
log "  L1  Geth      : http://127.0.0.1:8545  (chain 1337)"
log "  L2  ZK server : http://127.0.0.1:3050  (chain 271)"
log "  L2  WebSocket : ws://127.0.0.1:3051"
log "  DA  layer     : http://127.0.0.1:7777"
log "  Postgres      : localhost:5432"
log "============================================================"
