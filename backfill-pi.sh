#!/bin/bash
# Backfill script for Raspberry Pi
# Navigate to script directory (portable)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1
source .env
node runBackfill.js "$@"
