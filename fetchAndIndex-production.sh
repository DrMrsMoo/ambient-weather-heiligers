#!/bin/bash
# Production cron script - ALWAYS runs from production-current tag
# This ensures production stability while main continues development
#
# This script is environment-aware and works on both Mac and Raspberry Pi

# Auto-detect environment and set paths accordingly
if [ "$USER" = "tina" ]; then
    # Mac environment
    REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
    # Use nvm to find node on Mac
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    NODE_BIN=$(which node)
elif [ "$USER" = "pi" ]; then
    # Raspberry Pi environment
    REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
    # Source bashrc to get nvm on Pi
    [ -s "$HOME/.bashrc" ] && source "$HOME/.bashrc"
    export NVM_DIR="$HOME/.config/nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    NODE_BIN=$(which node)
else
    # Fallback: try to auto-detect
    REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
    NODE_BIN=$(which node)
fi

# Verify repository directory exists
if [ ! -d "$REPO_DIR" ]; then
    echo "ERROR: Repository directory not found: $REPO_DIR" >> "$HOME/ambient-weather-error.log"
    exit 1
fi

cd "$REPO_DIR"

# Fetch latest tags
git fetch --tags --quiet 2>/dev/null || true

# Checkout production tag (detached HEAD is intentional and safe)
git checkout production-current --quiet 2>/dev/null || {
    echo "ERROR: production-current tag not found!" >> logs/cron.log
    exit 1
}

# Run the indexing
source .env
"$NODE_BIN" runMainIIFE.js >> logs/cron.log 2>&1

# Return to previous branch (optional, for manual inspections)
git checkout - --quiet 2>/dev/null || true
