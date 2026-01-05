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

### Git Workflow
1. Create feature branch from `main`
2. Make changes and commit often with clear messages
3. Push branch to origin: `git push -u origin feature/branch-name`
4. Create PR against `main` branch: `gh pr create --repo DrMrsMoo/ambient-weather-heiligers`
5. After PR approval, merge to main
6. Deploy to Raspberry Pi

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

## Deployment (Raspberry Pi)

### Prerequisites
- Node.js installed
- Git repository cloned
- Environment variables configured in `.env`

### Deployment Steps
```bash
# On Raspberry Pi
cd ~/Projects/ambient-weather-heiligers

# Pull latest main branch
git fetch origin
git checkout main
git pull origin main

# Load environment
source .env

# Test manually
node runMainIIFE.js

# Setup cron job (runs every 5 minutes)
crontab -e
# Add: */5 * * * * cd ~/Projects/ambient-weather-heiligers && source .env && node runMainIIFE.js >> logs/cron.log 2>&1
```

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

## Future Improvements (TODO)

- [ ] Convert to TypeScript
- [ ] Automate de-duping entries
- [ ] Set up ILM for automatic index rollover
- [ ] Add monitoring for Raspberry Pi
- [ ] Implement retry logic with exponential backoff
- [ ] Add comprehensive unit tests
- [ ] Set up alerts for cluster failures

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

---

*Last updated: January 2, 2026*
