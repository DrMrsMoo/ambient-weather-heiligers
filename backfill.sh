#!/bin/zsh
# Backfill script for Mac/local development
source $HOME/.zshrc
# Navigate to script directory (portable)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1
node runBackfill.js "$@"
