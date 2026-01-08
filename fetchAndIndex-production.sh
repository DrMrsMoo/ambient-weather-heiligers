  #!/bin/bash
  # Production cron script - ALWAYS runs from production-current tag
  # This ensures production stability while main continues development

  REPO_DIR="$HOME/Projects/ambient-weather-heiligers"
  cd "$REPO_DIR"

  # Load NVM (works on both Mac and Pi)
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

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
