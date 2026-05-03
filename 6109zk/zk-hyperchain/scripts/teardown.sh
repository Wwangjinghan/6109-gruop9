#!/usr/bin/env bash
# Stop all ZK Stack local services
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

for pidfile in .server_pid .da_pid; do
  f="$ROOT_DIR/$pidfile"
  if [[ -f "$f" ]]; then
    pid=$(cat "$f")
    kill "$pid" 2>/dev/null && log "Stopped process $pid ($pidfile)" || true
    rm "$f"
  fi
done

log "Stopping Docker containers..."
docker compose -f "$ROOT_DIR/configs/docker-compose.l1.yml" down
log "All services stopped."
