# CLAUDE.md - Project Constitution

This file serves as the primary source of truth for AI assistants (Claude, Copilot, etc.) and developers working on this project.

---

## Project Overview

**ambient-weather-heiligers** is a Node.js application that collects weather data from a personal Ambient Weather station and indexes it into Elasticsearch clusters for analysis and visualization.

### Key Features
- Fetches weather data from Ambient Weather API
- Converts imperial measurements to metric
- Indexes data to both production and staging Elasticsearch clusters simultaneously
- Designed to run on Raspberry Pi via cron jobs
- Independent error handling per cluster (one failure doesn't affect the other)

---

## Development Workflow

### CRITICAL: Remote Repository and Base Branch

**Primary Remote:** `DrMrsMoo/ambient-weather-heiligers` (origin)
**Base Branch:** `main`

All work is done against the DrMrsMoo fork. The upstream TinaHeiligers repository is not used for development.

```bash
# Verify your remote configuration:
git remote -v
# origin should point to: git@github.com:DrMrsMoo/ambient-weather-heiligers.git
```

### CRITICAL: Always Create a New Branch

**NEVER commit directly to `main` or `master`.** Always create a new feature branch for any code work.

```bash
# Before making ANY code changes:
git checkout main
git pull origin main
git checkout -b feature/descriptive-name

# Example branch names:
# - feature/add-humidity-alerts
# - fix/api-rate-limit-handling
# - refactor/convert-to-typescript
```

### Branch Naming Conventions
- `feature/` - New features or enhancements
- `fix/` - Bug fixes
- `refactor/` - Code refactoring (no behavior change)
- `docs/` - Documentation updates
- `test/` - Test additions or updates

### Branch Structure
- **`main`** - Active development branch (merge PRs here)
- **`deployment`** - Stable production branch (receives tested changes from main)
- **`production-current` tag** - Points to `deployment` branch (cron runs from this tag)

### Git Workflow
1. Create feature branch from `main`
2. Make changes and commit often with clear messages
3. Push branch to origin: `git push -u origin feature/branch-name`
4. Create PR against `main` branch: `gh pr create --repo DrMrsMoo/ambient-weather-heiligers`
5. After PR approval, **merge to main freely** - production is protected!
6. When ready to deploy, merge `main` → `deployment` and move tag (see DEPLOYMENT.md)

**PRODUCTION PROTECTION:** Production runs from the `production-current` git tag pointing to the `deployment` branch. The cron job (5:20 AM/PM) always checks out this tag. You can merge to `main` without affecting production - deployment only happens when you explicitly merge to `deployment` and move the tag.

**Deployment Workflow:**
```
feature/* → main → deployment → production-current tag → cron execution
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment procedures and [REFACTOR_PLAN.md](REFACTOR_PLAN.md) for modernization roadmap.

---

## Project Structure

```
ambient-weather-heiligers/
├── src/
│   ├── converters/          # Imperial ↔ Metric, JSONL conversion
│   ├── dataFetchers/        # Ambient Weather API client
│   ├── dataIndexers/        # Elasticsearch client & indexing logic
│   ├── logger/              # Logging utilities
│   ├── registry/            # File tracking
│   └── utils/               # Helper functions
├── data/                    # Raw and converted data (gitignored)
├── config/                  # ES index templates and aliases
├── main.js                  # Main orchestration logic
├── runMainIIFE.js          # Entry point
├── .env                     # Environment variables (gitignored)
├── .env.example            # Environment template
└── CLAUDE.md               # This file
```

---

## Architecture Patterns

### ES Client Factory Pattern
The Elasticsearch client uses a factory pattern to support multiple clusters:

```javascript
const { createEsClient } = require('./src/dataIndexers/esClient');

const prodClient = createEsClient('ES');        // Production
const stagingClient = createEsClient('STAGING'); // Staging
```

### IndexData Class
Each cluster gets its own `IndexData` instance:

```javascript
const prodIndexer = new IndexData(prodClient);
const stagingIndexer = new IndexData(stagingClient);
```

### Data Flow
```
Ambient Weather API
    ↓
FetchRawData (saves to data/)
    ↓
ConvertImperialToJsonl
    ↓
ConvertImperialToMetric
    ↓
IndexData.bulkIndexDocuments() → Production & Staging (parallel)
```

---

## Environment Variables

### Required Variables

**Ambient Weather API:**
- `AMBIENT_WEATHER_API_KEY`
- `AMBIENT_WEATHER_APPLICATION_KEY`
- `AMBIENT_WEATHER_MACADDRESS`

**Production Elasticsearch:**
- `ES_CLOUD_ID`
- `ES_USERNAME`
- `ES_PASSWORD`

**Staging Elasticsearch:**
- `STAGING_CLOUD_ID`
- `STAGING_ES_USERNAME`
- `STAGING_ES_PASSWORD`

### Setup
```bash
# Copy example file
cp .env.example .env

# Edit with actual credentials
nano .env

# Load for testing
source .env
```

---

## Code Conventions

### Error Handling
- **Always use `Promise.allSettled()` for parallel cluster operations**
- Never let one cluster failure block another
- Log errors with cluster context: `[PRODUCTION]` or `[STAGING]`
- Return structured error objects, don't throw in cluster operations

Example:
```javascript
const results = await Promise.allSettled([
  indexToCluster(prodIndexer, 'PRODUCTION'),
  indexToCluster(stagingIndexer, 'STAGING')
]);
```

### Logging
- Use `Logger` class from `src/logger`
- Include context in log messages: `[FunctionName]`, `[PRODUCTION]`, etc.
- Log levels: `logInfo`, `logWarning`, `logError`

### Client Parameter Pattern
**CRITICAL:** All `esClientMethods.js` functions accept a `client` parameter.
- Always use the passed `client` parameter, not the global `esClient` import
- This enables multi-cluster support

❌ **Wrong:**
```javascript
async function pingCluster(client) {
  return await esClient.ping(); // BUG: uses global instead of parameter
}
```

✅ **Correct:**
```javascript
async function pingCluster(client) {
  return await client.ping(); // Uses the passed parameter
}
```

---

## Testing

### Local Testing
```bash
# Ensure dependencies are installed
npm install

# Load environment variables
source .env

# Run the application
node runMainIIFE.js
```

### Expected Output
```
[main]: Starting dual-cluster indexing...
[PRODUCTION] Initializing cluster connection...
[STAGING] Initializing cluster connection...
[PRODUCTION] Cluster ready! Latest imperial: ...
[STAGING] Cluster ready! Latest imperial: ...
=== FINAL RESULTS ===
[PRODUCTION] Result: { cluster: 'PRODUCTION', status: 'success' }
[STAGING] Result: { cluster: 'STAGING', status: 'success' }
```

---

## Deployment (Mac Production Environment)

### Current Setup
- **Location:** `/Users/tina/Projects/ambient-weather-heiligers`
- **Stable Branch:** `deployment` (production-ready code)
- **Production Tag:** `production-current` → points to `deployment` branch
- **Cron Schedule:** 5:20 AM & 5:20 PM daily
- **Cron Script:** `fetchAndIndex-production.sh` (checks out production-current tag)

### How It Works

The cron job **always** runs from the `production-current` tag pointing to the `deployment` branch. This means:
- ✅ You can freely merge PRs to `main` without affecting production
- ✅ Deployment only happens when you merge `main` → `deployment` and move the tag
- ✅ Rollback is instant (just move the tag back)

### Deploying Changes

```bash
# Step 1: Merge main into deployment branch
git checkout deployment
git pull origin deployment
git merge origin/main

# Step 2: Test the deployment
source .env
node runMainIIFE.js

# Step 3: If tests pass, deploy
git push origin deployment
git tag -f production-current deployment
git push origin production-current --force
git checkout main

# Next cron run (5:20 AM/PM) will use the new version
```

### Quick Rollback

```bash
# If something breaks, rollback instantly:
git tag -f production-current <previous-tag>
git push origin production-current --force
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment procedures.

---

## Common Tasks

### Adding a New ES Cluster
1. Add credentials to `.env`:
   ```bash
   NEW_CLUSTER_CLOUD_ID="..."
   NEW_CLUSTER_ES_USERNAME="..."
   NEW_CLUSTER_ES_PASSWORD="..."
   ```

2. Create client in `main.js`:
   ```javascript
   const newClient = createEsClient('NEW_CLUSTER');
   const newIndexer = new IndexData(newClient);
   ```

3. Add to parallel indexing:
   ```javascript
   await Promise.allSettled([
     indexToCluster(prodIndexer, 'PRODUCTION'),
     indexToCluster(stagingIndexer, 'STAGING'),
     indexToCluster(newIndexer, 'NEW_CLUSTER')
   ]);
   ```

### Debugging Data Fetching
```bash
# Check saved data files
ls -lh data/ambient-weather-heiligers-imperial/

# View raw data
cat data/ambient-weather-heiligers-imperial/<filename>.json | jq .

# Check JSONL conversion
cat data/ambient-weather-heiligers-imperial-jsonl/<filename>.jsonl | head
```

### Checking Elasticsearch Indices
```javascript
// In DevTools or via API
GET ambient_weather_heiligers_imperial_*/_search
{
  "size": 1,
  "sort": [{"dateutc": "desc"}]
}
```

---

## Known Issues & Gotchas

### 1. Empty Data Directory
If `data/ambient-weather-heiligers-imperial` doesn't exist, the app will crash.
**Solution:** Create required directories:
```bash
mkdir -p data/ambient-weather-heiligers-{imperial,metric,imperial-jsonl,metric-jsonl}
```

### 2. API Rate Limits
Ambient Weather API has rate limits. If running multiple fetches, space them out.

### 3. First Run on New Cluster
First run on a new/empty cluster will fail to find recent documents. This is expected behavior and will self-resolve after first successful indexing.

### 4. Duplicate Data
The Ambient Weather API counts backwards in time, which can cause duplicates. This is handled by deduplication during reindexing operations (see README.md).

---

## Dependencies

### Core Dependencies
- `@elastic/elasticsearch` (v7.16.0) - ES client
- `ambient-weather-api` (0.0.6) - Ambient Weather API client
- `convert-units` (2.3.4) - Unit conversion
- `moment-timezone` (0.5.31) - Timezone handling

### Dev Dependencies
- `jest` (27.0.4) - Testing framework
- `@elastic/elasticsearch-mock` (0.3.1) - ES mock for tests

---

## Future Improvements

See [REFACTOR_PLAN.md](REFACTOR_PLAN.md) for the comprehensive modernization roadmap, organized into 5 epics:

**High Priority:**
- [ ] Expand test coverage to >80%
- [ ] Upgrade Elasticsearch client to v8+ (unblocks cluster upgrade to v9)
- [ ] Convert to TypeScript

**Medium Priority:**
- [ ] Implement ECS logging format
- [ ] Improve code quality and architecture
- [ ] Add monitoring for Raspberry Pi

**Low Priority:**
- [ ] Automate de-duping entries
- [ ] Set up ILM for automatic index rollover
- [ ] Set up CI/CD pipeline
- [ ] Add alerts for cluster failures

Progress is tracked in REFACTOR_PLAN.md with detailed checklists for each epic.

---

## Support & Contact

**Author:** Tina Heiligers
**Repository:** https://github.com/TinaHeiligers/ambient-weather-heiligers
**Fork:** https://github.com/DrMrsMoo/ambient-weather-heiligers

---

## Version History

- **v1.0.0** (Jan 2026) - Dual-cluster indexing support
  - Factory pattern for ES client
  - Parallel indexing to production and staging
  - Independent error handling with Promise.allSettled
  - Bug fixes for esClientMethods.js
  - Backfill CLI with comprehensive gap detection
  - Safe deployment strategy with git tags

---

## Related Documentation

- **[REFACTOR_PLAN.md](REFACTOR_PLAN.md)** - Comprehensive modernization roadmap with 5 epics
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Step-by-step deployment procedures and troubleshooting
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[README.md](../README.md)** - Project overview and usage instructions
- **[scripts/README.md](../scripts/README.md)** - Documentation for all utility scripts

---

*Last updated: January 4, 2026*
