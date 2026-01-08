#!/bin/bash
# Production cron script - ALWAYS runs from production-current tag
# This ensures production stability while main continues development

REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
cd "$REPO_DIR"

# Load NVM - check multiple common installation locations
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    \. "$NVM_DIR/nvm.sh"
elif [ -s "$HOME/.config/nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.config/nvm"
    \. "$NVM_DIR/nvm.sh"
else
    echo "ERROR: NVM not found in common locations" >> logs/cron.log
    exit 1
fi

# Fetch latest tags
git fetch --tags --quiet 2>/dev/null || true

# Checkout production tag (detached HEAD is intentional and safe)
git checkout production-current --quiet 2>/dev/null || {
    echo "ERROR: production-current tag not found!" >> logs/cron.log
    exit 1
}

# Run the indexing
source .env
node runMainIIFE.js >> logs/cron.log 2>&1

# Return to main branch (optional, for manual inspections)
git checkout main --quiet 2>/dev/null || true
