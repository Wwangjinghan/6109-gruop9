#!/usr/bin/env bash
# =============================================================================
#  run_demo.sh — AgentIntent Protocol Integration Demo
#
#  What this script does:
#    1. Start a local Anvil node (in-process chain)
#    2. Deploy the canonical ERC-4337 EntryPoint (v0.7)
#    3. Deploy IntentAccountFactory
#    4. Create an IntentAccount for the demo user via the factory
#    5. Fund the IntentAccount's EntryPoint deposit
#    6. Start the Relayer (Express / TypeScript) in the background
#    7. Run demo_submit.ts — fires 5 simultaneous SWAP intents
#    8. Print the on-chain gas comparison report
#    9. Tear everything down (Anvil + Relayer)
#
#  Prerequisites:
#    • Node.js ≥ 20
#    • Foundry (anvil, cast, forge)  — install via foundryup
#    • npm workspaces installed       — run `npm install` at repo root first
#
#  Usage:
#    chmod +x run_demo.sh
#    ./run_demo.sh
# =============================================================================

set -euo pipefail

# ─── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[demo]${RESET} $*"; }
success() { echo -e "${GREEN}[demo] ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}[demo] ⚠${RESET} $*"; }
fatal()   { echo -e "${RED}[demo] ✗${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}══ $* ${RESET}"; }

# ─── Cleanup trap ─────────────────────────────────────────────────────────────
ANVIL_PID=""
RELAYER_PID=""

cleanup() {
  echo ""
  info "Tearing down background processes…"
  [[ -n "$RELAYER_PID" ]] && kill "$RELAYER_PID" 2>/dev/null && info "Relayer stopped (PID $RELAYER_PID)"
  [[ -n "$ANVIL_PID"   ]] && kill "$ANVIL_PID"   2>/dev/null && info "Anvil stopped   (PID $ANVIL_PID)"
  # Remove temporary env file
  [[ -f /tmp/agentintent_demo.env ]] && rm /tmp/agentintent_demo.env
}
trap cleanup EXIT

# ─── Dependency checks ────────────────────────────────────────────────────────
step "Checking dependencies"

for cmd in anvil cast forge node npm tsx; do
  if command -v "$cmd" &>/dev/null; then
    success "$cmd found ($(command -v "$cmd"))"
  else
    fatal "$cmd not found. Install Foundry (foundryup) and ensure Node.js ≥ 20 is on PATH."
  fi
done

# ─── Config constants ─────────────────────────────────────────────────────────
ANVIL_PORT=8545
RELAYER_PORT=3001
ANVIL_URL="http://127.0.0.1:${ANVIL_PORT}"
RELAYER_URL="http://127.0.0.1:${RELAYER_PORT}"

# Anvil deterministic accounts (from the standard mnemonic)
#   Account 0 — deployer / owner
#   Account 1 — relayer agent (signs UserOps)
#   Account 2 — simulator / demo user
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RELAYER_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
AGENT_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

DEPLOYER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
RELAYER_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
AGENT_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

# Canonical ERC-4337 EntryPoint v0.7 bytecode (pre-deployed on all chains)
ENTRY_POINT_ADDR="0x0000000071727De22E5E9d8BAf0edAc6f37da032"

# Mock token addresses — we use Anvil's address space (no real ERC-20 needed
# for the demo; the combiner only encodes calldata, it doesn't execute real swaps)
MOCK_USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
MOCK_WETH="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
MOCK_ROUTER="0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"

# ─── Step 1: Start Anvil ──────────────────────────────────────────────────────
step "Step 1 — Starting local Anvil node"

anvil \
  --port "$ANVIL_PORT" \
  --block-time 1 \
  --chain-id 31337 \
  --silent &
ANVIL_PID=$!

info "Waiting for Anvil to be ready…"
for i in $(seq 1 20); do
  if cast block-number --rpc-url "$ANVIL_URL" &>/dev/null; then
    success "Anvil is up (PID $ANVIL_PID, chain-id 31337)"
    break
  fi
  sleep 0.5
  [[ $i -eq 20 ]] && fatal "Anvil did not start within 10s"
done

# ─── Step 2: Deploy EntryPoint ────────────────────────────────────────────────
step "Step 2 — Deploying ERC-4337 EntryPoint v0.7"

# 1. Compile EntryPoint (outputs to contracts/out/)
info "Compiling EntryPoint…"
forge build \
  --contracts contracts/lib/account-abstraction/contracts/core/EntryPoint.sol \
  --root contracts --silent 2>&1

EP_JSON="contracts/out/EntryPoint.sol/EntryPoint.json"

if [[ -f "$EP_JSON" ]]; then
  EP_BYTECODE=$(node -e "process.stdout.write(require('./${EP_JSON}').bytecode.object)")

  # 2. Deploy to a temporary address
  info "Deploying EntryPoint bytecode…"
  DEPLOYED=$(cast send \
    --private-key "$DEPLOYER_KEY" \
    --rpc-url "$ANVIL_URL" \
    --create "$EP_BYTECODE" \
    --json 2>/dev/null | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).contractAddress||'')}catch{}})")

  if [[ -n "$DEPLOYED" ]]; then
    # 3. Copy deployed code to the canonical address
    EP_CODE=$(cast code "$DEPLOYED" --rpc-url "$ANVIL_URL")
    cast rpc anvil_setCode "$ENTRY_POINT_ADDR" "$EP_CODE" \
      --rpc-url "$ANVIL_URL" >/dev/null

    # 4. Verify
    NONCE_CHECK=$(cast call "$ENTRY_POINT_ADDR" \
      "getNonce(address,uint192)(uint256)" \
      "$DEPLOYER_ADDR" 0 \
      --rpc-url "$ANVIL_URL" 2>/dev/null || echo "")

    if [[ -n "$NONCE_CHECK" ]]; then
      success "EntryPoint deployed and verified at $ENTRY_POINT_ADDR"
    else
      warn "EntryPoint code set but getNonce check failed"
      SKIP_ONCHAIN=true
    fi
  else
    warn "EntryPoint deployment failed — skipping on-chain execution"
    SKIP_ONCHAIN=true
  fi
else
  warn "EntryPoint artifact not found after build — skipping on-chain execution"
  SKIP_ONCHAIN=true
fi

[[ "${SKIP_ONCHAIN:-false}" == "true" ]] && \
  warn "On-chain execution will be skipped (batching logic still verified)"

# ─── Step 3: Deploy contracts via Forge ───────────────────────────────────────
step "Step 3 — Deploying IntentAccountFactory (forge script)"

FACTORY_ADDR=""
REGISTRY_ADDR=""

if forge build --root contracts 2>&1; then
  success "Contracts compiled"

  info "Running forge script Deploy.s.sol…"
  DEPLOY_OUTPUT=$(PRIVATE_KEY="$DEPLOYER_KEY" forge script \
    contracts/script/Deploy.s.sol \
    --rpc-url "$ANVIL_URL" \
    --broadcast \
    --root contracts 2>&1) && DEPLOY_OK=true || DEPLOY_OK=false

  # Always print forge script output so errors are visible
  echo "$DEPLOY_OUTPUT" | sed 's/^/  [forge] /'

  if [[ "$DEPLOY_OK" == "true" ]]; then
    REGISTRY_ADDR=$(echo "$DEPLOY_OUTPUT" | grep -oP 'IntentRegistry deployed at: \K0x[0-9a-fA-F]+' | head -1)
    FACTORY_ADDR=$(echo "$DEPLOY_OUTPUT"  | grep -oP 'IntentAccountFactory deployed at: \K0x[0-9a-fA-F]+' | head -1)
    [[ -z "$FACTORY_ADDR" ]] && warn "Could not parse factory address from forge output"
  else
    warn "forge script failed — see [forge] output above"
  fi
else
  warn "forge build failed — see output above"
fi

# Fallback: deploy factory directly with cast if forge script didn't produce an address
if [[ -z "$FACTORY_ADDR" ]]; then
  info "Deploying IntentAccountFactory via cast (fallback)"
  # Deploy a minimal contract that records the factory address for the demo
  # We use address(0) as placeholder — demo_submit.ts uses the account address directly
  FACTORY_ADDR="0x0000000000000000000000000000000000000000"
  warn "Factory not deployed on-chain — demo will run in relayer-only mode (batching verified, not on-chain execution)"
  SKIP_ONCHAIN=true
fi

[[ -n "$FACTORY_ADDR" && "$FACTORY_ADDR" != "0x000"* ]] && success "IntentAccountFactory at $FACTORY_ADDR"
[[ -n "$REGISTRY_ADDR" ]]                                 && success "IntentRegistry       at $REGISTRY_ADDR"

# ─── Step 4: Create IntentAccount ─────────────────────────────────────────────
step "Step 4 — Creating IntentAccount for demo user"

ACCOUNT_ADDR=""

if [[ -n "$FACTORY_ADDR" && "$FACTORY_ADDR" != "0x000"* ]]; then
  # Call factory.createAccount(owner=DEPLOYER, agent=RELAYER_ADDR, salt=0)
  CREATE_RESULT=$(cast send "$FACTORY_ADDR" \
    "createAccount(address,address,uint256)(address)" \
    "$DEPLOYER_ADDR" "$RELAYER_ADDR" "0" \
    --private-key "$DEPLOYER_KEY" \
    --rpc-url "$ANVIL_URL" \
    --json 2>/dev/null || echo '{}')

  # Read the predicted address via call
  ACCOUNT_ADDR=$(cast call "$FACTORY_ADDR" \
    "getAddress(address,address,uint256)(address)" \
    "$DEPLOYER_ADDR" "$RELAYER_ADDR" "0" \
    --rpc-url "$ANVIL_URL" 2>/dev/null || echo "")

  if [[ -n "$ACCOUNT_ADDR" && "$ACCOUNT_ADDR" != "0x000"* ]]; then
    success "IntentAccount at $ACCOUNT_ADDR"
  else
    warn "Could not read IntentAccount address from factory — using DEPLOYER as fallback"
    ACCOUNT_ADDR="$DEPLOYER_ADDR"
  fi
else
  info "Skipping account creation (factory not deployed)"
  ACCOUNT_ADDR="$DEPLOYER_ADDR"
fi

# ─── Step 5: Fund EntryPoint deposit ─────────────────────────────────────────
step "Step 5 — Funding IntentAccount EntryPoint deposit"

if [[ "${SKIP_ONCHAIN:-false}" == "false" ]]; then
  cast send "$ENTRY_POINT_ADDR" \
    "depositTo(address)" "$ACCOUNT_ADDR" \
    --value "1ether" \
    --private-key "$DEPLOYER_KEY" \
    --rpc-url "$ANVIL_URL" \
    --silent 2>/dev/null && success "Deposited 1 ETH to EntryPoint for $ACCOUNT_ADDR" \
    || warn "depositTo call failed — account may not have enough prefund"
else
  info "Skipping EntryPoint deposit (on-chain execution skipped)"
fi

# ─── Step 6: Start the Relayer ────────────────────────────────────────────────
step "Step 6 — Starting the Relayer (Express / TypeScript)"

# Write a temp .env for the relayer
cat > /tmp/agentintent_demo.env <<EOF
PORT=${RELAYER_PORT}
CHAIN=foundry
RPC_URL=${ANVIL_URL}
RELAYER_PRIVATE_KEY=${RELAYER_KEY}
ACCOUNT_ADDRESS=${ACCOUNT_ADDR}
SWAP_ROUTER_ADDRESS=${MOCK_ROUTER}
ENTRY_POINT_ADDRESS=${ENTRY_POINT_ADDR}
BATCH_SIZE=10
BATCH_WINDOW_MS=3000
LOG_LEVEL=warn
EOF

# Start relayer with the temporary env file
(cd relayer && \
  set -a && source /tmp/agentintent_demo.env && set +a && \
  npm run dev 2>&1 | sed 's/^/  [relayer] /' ) &
RELAYER_PID=$!

# Kill anything already on the port before starting
fuser -k ${RELAYER_PORT}/tcp 2>/dev/null || true
sleep 0.5

info "Waiting for Relayer to be ready on port $RELAYER_PORT…"
for i in $(seq 1 60); do
  if curl -sf "${RELAYER_URL}/health" &>/dev/null; then
    success "Relayer is up (PID $RELAYER_PID)"
    break
  fi
  sleep 1
  [[ $i -eq 60 ]] && fatal "Relayer did not start within 60s — check relayer logs above"
done

# ─── Step 7: Run the Demo Submit Script ───────────────────────────────────────
step "Step 7 — Firing 5 simultaneous SWAP intents"

DEMO_RELAYER_URL="$RELAYER_URL" \
DEMO_AGENT_PRIVATE_KEY="$AGENT_KEY" \
DEMO_TOKEN_IN="$MOCK_USDC" \
DEMO_TOKEN_OUT="$MOCK_WETH" \
DEMO_ACCOUNT_ADDRESS="$ACCOUNT_ADDR" \
  npx --prefix relayer tsx relayer/scripts/demo_submit.ts

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
success "Demo complete."
echo ""
echo -e "  ${CYAN}Anvil explorer${RESET}  : ${ANVIL_URL}"
echo -e "  ${CYAN}Relayer health${RESET}   : ${RELAYER_URL}/health"
echo ""
echo -e "  Press ${BOLD}Ctrl+C${RESET} to stop Anvil and the Relayer."
echo ""

# Keep running until user interrupts (trap will clean up)
wait "$RELAYER_PID" 2>/dev/null || true
