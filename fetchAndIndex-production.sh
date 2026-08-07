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

# Fetch latest tags. NOT silenced — a failed fetch is how a deploy silently no-ops.
# - cron has no TTY/SSH agent, so a 1Password-gated fetch fails every run
# - silent failure => stale local tag => npm ci reinstalls the OLD lockfile
# - warn only, don't abort: a network blip shouldn't stop indexing
FETCH_OK=yes
if ! git fetch --tags --force >> logs/cron.log 2>&1; then
    FETCH_OK=no
    echo "[deploy] WARNING: git fetch --tags FAILED — local tags may be stale." >> logs/cron.log
    echo "[deploy]          Under cron this is usually SSH auth (no agent/TTY for 1Password)." >> logs/cron.log
    echo "[deploy]          Continuing with the local tag — it may not be the deployed one." >> logs/cron.log
    echo "[deploy]          Source verification below catches a stale tag if origin is reachable." >> logs/cron.log
fi

# Checkout production tag (detached HEAD is intentional and safe)
git checkout production-current --quiet 2>/dev/null || {
    echo "ERROR: production-current tag not found!" >> logs/cron.log
    exit 1
}

# --- Source verification ---------------------------------------------------
# Assert the checked-out source IS the deployed tag. The dependency check below
# only catches deploys that change package-lock.json — a source-only deploy
# (e.g. 2026-08-06 helpers.js toFixed(0)->toFixed(3)) leaves the lockfile
# untouched, so the npm ci gate SKIPS and the version assertion PASSES while the
# Pi runs stale code and reports success.
# Compare against the REMOTE ref, not the local tag: local HEAD always equals the
# local tag (we just checked it out), so only local-vs-remote detects a stale tag
# left behind by a failed fetch.
# Reuse the fetch above rather than making a second network call: if the fetch
# succeeded, the local tag IS the remote tag. Only reach out again when the fetch
# failed, and then with a hard timeout — a HUNG ls-remote (GitHub degraded, not
# down) would otherwise block past the next cron slot.
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null)
REMOTE_TAG_SHA=$(git rev-parse "refs/tags/production-current^{commit}" 2>/dev/null)

if [ "$FETCH_OK" = "yes" ]; then
    ORIGIN_TAG_SHA="$REMOTE_TAG_SHA"
else
    ORIGIN_TAG_SHA=$(GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=15 \
        git ls-remote origin refs/tags/production-current 2>/dev/null | awk '{print $1}')
fi

if [ -n "$ORIGIN_TAG_SHA" ]; then
    # Tag objects: ls-remote gives the tag SHA, which differs from the commit for
    # annotated tags. Resolve locally when we have the object; fall back to the
    # local tag's commit if we cannot.
    RESOLVED=$(git rev-parse "${ORIGIN_TAG_SHA}^{commit}" 2>/dev/null || echo "$ORIGIN_TAG_SHA")
    if [ "$HEAD_SHA" != "$RESOLVED" ]; then
        echo "[deploy] ERROR: checked-out source is NOT the deployed tag — aborting run." >> logs/cron.log
        echo "[deploy]        HEAD:                  $HEAD_SHA" >> logs/cron.log
        echo "[deploy]        origin production-current: $RESOLVED" >> logs/cron.log
        echo "[deploy]        Local tag is stale (see fetch warning above). Fix on the Pi with:" >> logs/cron.log
        echo "[deploy]          git fetch --tags --force && git checkout production-current" >> logs/cron.log
        exit 1
    fi
    echo "[deploy] verified source at ${HEAD_SHA} matches origin production-current" >> logs/cron.log
else
    # GitHub unreachable: cannot prove freshness. NEVER abort here — weather data
    # is still being produced and the clusters are still reachable; refusing to
    # index because a code host is down would lose real data to fix nothing.
    # The local tag is self-consistent; worst case we run slightly old code.
    echo "[deploy] WARNING: could not reach origin to verify production-current." >> logs/cron.log
    echo "[deploy]          Running local tag ${REMOTE_TAG_SHA} — freshness UNVERIFIED." >> logs/cron.log
    echo "[deploy]          CONTINUING with indexing (a code-host outage must not cost data)." >> logs/cron.log
fi

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

# --- Post-install verification ---------------------------------------------
# "npm ci succeeded" != "installed what we intended". Assert disk matches lockfile.
# - 2026-08-03: clean npm ci installed ES 7.16.0 while the tag pinned 8.19.2
# - looked deployed for a day; only the v8 verification scripts failed
# - runs OUTSIDE the gate on purpose: a stale install leaves a VALID stamp,
#   so later runs skip npm ci and a check nested in the gate would never fire
EXPECTED_ES_VERSION=$(git show "production-current:package-lock.json" 2>/dev/null \
    | grep -A2 '"node_modules/@elastic/elasticsearch"' | grep -m1 '"version"' \
    | sed -E 's/.*"version": "([^"]+)".*/\1/')
INSTALLED_ES_VERSION=$(grep -m1 '"version"' node_modules/@elastic/elasticsearch/package.json 2>/dev/null \
    | sed -E 's/.*"version": "([^"]+)".*/\1/')

# Fail closed: an unreadable version is an unverifiable deploy, not a passing one.
if [ -z "$EXPECTED_ES_VERSION" ] || [ -z "$INSTALLED_ES_VERSION" ]; then
    echo "[deploy] ERROR: cannot verify dependencies — ABORTING, not indexing." >> logs/cron.log
    echo "[deploy]        @elastic/elasticsearch installed=${INSTALLED_ES_VERSION:-<unreadable>} expected=${EXPECTED_ES_VERSION:-<unreadable>}" >> logs/cron.log
    echo "[deploy]        Check node_modules exists and the lockfile format is still parseable." >> logs/cron.log
    exit 1
fi

if [ "$EXPECTED_ES_VERSION" != "$INSTALLED_ES_VERSION" ]; then
    echo "[deploy] ERROR: dependency mismatch — ABORTING, not indexing." >> logs/cron.log
    echo "[deploy]        @elastic/elasticsearch installed=${INSTALLED_ES_VERSION} expected=${EXPECTED_ES_VERSION}" >> logs/cron.log
    echo "[deploy]        node_modules does not match the production-current lockfile." >> logs/cron.log
    echo "[deploy]        Likely a stale local tag (see fetch warning above). Fix on the Pi with:" >> logs/cron.log
    echo "[deploy]          git fetch --tags --force && git checkout production-current && npm ci" >> logs/cron.log
    exit 1
fi
echo "[deploy] verified @elastic/elasticsearch@${INSTALLED_ES_VERSION} matches production-current lockfile" >> logs/cron.log
# ---------------------------------------------------------------------------

# Run the indexing
source .env
"$NODE_BIN" runMainIIFE.js >> logs/cron.log 2>&1

# Return to previous branch (optional, for manual inspections)
git checkout - --quiet 2>/dev/null || true
