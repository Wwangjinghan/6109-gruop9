#!/usr/bin/env bash
# Fund a test address on L1 using the Geth --dev auto-unlocked rich account.
# Usage: ./fund_accounts.sh [recipient_address]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

L1_RPC="http://127.0.0.1:8545"
TEST_ADDR="${1:-0xa61464658AfeAf65CccaaFD3a512b69A83B77618}"

# Geth --dev auto-unlocks a rich account accessible via eth_accounts (no private key needed)
DEV_ACCOUNT=$(curl -sf -X POST "$L1_RPC" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0])")
log "Geth dev account: $DEV_ACCOUNT"

log "Sending 10 ETH to $TEST_ADDR on L1..."
curl -sf -X POST "$L1_RPC" \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{
    \"from\":\"$DEV_ACCOUNT\",
    \"to\":\"$TEST_ADDR\",
    \"value\":\"0x8AC7230489E80000\",
    \"gas\":\"0x5208\",
    \"maxFeePerGas\":\"0x77359400\",
    \"maxPriorityFeePerGas\":\"0x3B9ACA00\"
  }],\"id\":1}" | python3 -c "import sys,json; r=json.load(sys.stdin); print('TX:', r.get('result','ERROR:'+str(r.get('error'))))"

sleep 3
BAL=$(curl -sf -X POST "$L1_RPC" \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$TEST_ADDR\",\"latest\"],\"id\":1}" \
  | python3 -c "import sys,json; b=int(json.load(sys.stdin)['result'],16); print(f'{b/1e18:.4f} ETH')")
log "Balance of $TEST_ADDR: $BAL"
