#!/usr/bin/env bash
# Shared helpers sourced by all scripts in this directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

log()  { echo -e "\033[1;32m[ZK]\033[0m $*"; }
warn() { echo -e "\033[1;33m[ZK]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ZK]\033[0m $*"; exit 1; }
