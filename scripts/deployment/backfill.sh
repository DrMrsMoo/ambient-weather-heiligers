#!/bin/zsh
# Backfill script for Mac/local development
source $HOME/.zshrc
# Navigate to project root (two levels up from scripts/deployment/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT" || exit 1
node bin/runBackfill.js "$@"
