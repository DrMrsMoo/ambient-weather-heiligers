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
    NPM_BIN=$(which npm)
elif [ "$USER" = "pi" ]; then
    # Raspberry Pi environment
    REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
    # Source bashrc to get nvm on Pi
    [ -s "$HOME/.bashrc" ] && source "$HOME/.bashrc"
    export NVM_DIR="$HOME/.config/nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    NODE_BIN=$(which node)
    NPM_BIN=$(which npm)
else
    # Fallback: try to auto-detect
    REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
    NODE_BIN=$(which node)
    NPM_BIN=$(which npm)
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

# --- Gated dependency sync -------------------------------------------------
# Only reinstall when package-lock.json actually changed since the last successful
# run. Keeps normal cron runs minimal (no network dependency) while making a
# dependency-changing deploy fail LOUDLY here instead of silently running new code
# against stale node_modules (e.g. a v8 client bump against v7 node_modules).
# The change signal is the lockfile's git blob hash at the checked-out tag, so it
# is robust against file mtimes. The stamp lives in node_modules/ so wiping
# node_modules naturally re-triggers the install.
LOCK_STAMP="node_modules/.deploy-lock-hash"
CURRENT_LOCK_HASH=$(git rev-parse "production-current:package-lock.json" 2>/dev/null || echo "none")

if [ ! -f "$LOCK_STAMP" ] || [ "$(cat "$LOCK_STAMP" 2>/dev/null)" != "$CURRENT_LOCK_HASH" ]; then
    echo "[deploy] package-lock.json changed (or first run) — running npm ci" >> logs/cron.log
    if [ -z "$NPM_BIN" ]; then
        echo "[deploy] ERROR: npm not found (NPM_BIN empty) — aborting run" >> logs/cron.log
        exit 1
    fi
    if "$NPM_BIN" ci >> logs/cron.log 2>&1; then
        echo "$CURRENT_LOCK_HASH" > "$LOCK_STAMP"
        echo "[deploy] npm ci succeeded" >> logs/cron.log
    else
        echo "[deploy] ERROR: npm ci FAILED — aborting run, NOT indexing against a stale/partial node_modules" >> logs/cron.log
        exit 1
    fi
fi
# ---------------------------------------------------------------------------

# Run the indexing
source .env
"$NODE_BIN" runMainIIFE.js >> logs/cron.log 2>&1

# Return to previous branch (optional, for manual inspections)
git checkout - --quiet 2>/dev/null || true
