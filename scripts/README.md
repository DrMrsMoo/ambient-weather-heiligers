# Scripts Directory

This directory contains utility scripts for managing, verifying, and maintaining the ambient weather data indexing system.

## Table of Contents

- [Backfill & Gap Management](#backfill--gap-management)
- [Verification & Analysis](#verification--analysis)
- [Cluster Management](#cluster-management)
- [Usage Examples](#usage-examples)

---

## Backfill & Gap Management

### `check-recent-gaps.js`
**Purpose:** Identifies data gaps in the staging cluster over the last 7 days.

**What it does:**
- Queries staging cluster for documents from last 7 days
- Detects gaps where time between consecutive documents exceeds 10 minutes
- Provides gap duration, missing record counts, and coverage statistics

**Usage:**
```bash
npm run check-staging-gaps
# or
source .env && node scripts/check-recent-gaps.js
```

**Output:**
- List of gaps with timestamps, duration, and missing record counts
- Coverage analysis (expected vs actual records)

---

### `check-production-gaps.js`
**Purpose:** Identifies data gaps in the production cluster over the last 7 days.

**What it does:**
- Queries production cluster for documents from last 7 days
- Detects gaps where time between consecutive documents exceeds 10 minutes
- Provides gap duration, missing record counts, and coverage statistics

**Usage:**
```bash
npm run check-prod-gaps
# or
source .env && node scripts/check-production-gaps.js
```

**Output:**
- List of gaps with timestamps, duration, and missing record counts
- Coverage analysis (expected vs actual records)

---

### `compare-clusters.js`
**Purpose:** Compares data between production and staging clusters for a specific date range.

**What it does:**
- Queries both clusters for documents in a specified period
- Identifies which cluster has data and which is missing data
- Shows sample documents from clusters that have data

**Usage:**
```bash
npm run compare-clusters
# or
source .env && node scripts/compare-clusters.js
```

**Note:** Currently hardcoded to check Jan 1-2, 2026 period. Edit the script to change date ranges.

---

### `copy-prod-to-staging.js`
**Purpose:** Copies missing data from production to staging cluster.

**What it does:**
1. Exports documents from production cluster for specified date range
2. Saves data to local files (imperial JSON + JSONL, metric JSONL)
3. Indexes the data to staging cluster
4. Verifies the gap is filled

**Usage:**
```bash
npm run copy-prod-to-staging
# or
source .env && node scripts/copy-prod-to-staging.js
```

**Note:** Currently hardcoded to Jan 1-2, 2026 period. Edit the script to change date ranges.

**Important:** This is a utility for recovering from staging indexing failures. Use with caution.

---

## Verification & Analysis

### `verify-backfill.js`
**Purpose:** Verifies that backfilled data was successfully indexed to the staging cluster.

**What it does:**
- Checks active write indices in staging
- Queries documents in backfilled date range (Dec 28-31, 2025)
- Shows document counts, date ranges, and sample documents
- Analyzes coverage (expected vs actual records)
- Verifies manual file ranges

**Usage:**
```bash
npm run verify-backfill
# or
source .env && node scripts/verify-backfill.js
```

**Output:**
- Active write indices
- Imperial and metric document counts
- Sample documents
- Gap analysis
- Manual file verification

---

### `analyze-data.js`
**Purpose:** Provides detailed analysis of data distribution by day in staging cluster.

**What it does:**
- Breaks down document counts by day for a specific period
- Compares actual vs expected records per period
- Lists all local data files with their date ranges
- Calculates coverage percentage per day

**Usage:**
```bash
npm run analyze-data
# or
source .env && node scripts/analyze-data.js
```

**Note:** Currently analyzes Dec 28-31, 2025 period. Edit script to change dates.

---

### `check-duplicates.js`
**Purpose:** Detects duplicate documents in the staging cluster (same timestamp indexed multiple times).

**What it does:**
- Samples specific timestamps to check for duplicates
- Aggregates duplication statistics across date ranges
- Shows most duplicated timestamps
- Useful for identifying issues from multiple backfill runs

**Usage:**
```bash
npm run check-duplicates
# or
source .env && node scripts/check-duplicates.js
```

**Note:** Duplicates can occur from running backfill multiple times. This is for analysis only.

---

### `check-gap-details.js`
**Purpose:** Provides detailed analysis of a specific gap period.

**What it does:**
- Breaks gap into periods (e.g., before midnight, after midnight)
- Checks document counts for each period
- Identifies boundary documents (last before gap, first after gap)
- Helps understand the exact nature of data gaps

**Usage:**
```bash
npm run check-gap-details
# or
source .env && node scripts/check-gap-details.js
```

**Note:** Currently analyzes Dec 31 - Jan 2 period. Edit script to change dates.

---

### `verify-indexing.js`
**Purpose:** Verifies data indexing after running the main application.

**What it does:**
- Checks that data was successfully indexed
- Verifies index health and document counts

**Usage:**
```bash
npm run verify-indexing
# or
source .env && node scripts/verify-indexing.js
```

**Note:** This is a legacy script from the original project.

---

## Cluster Management

### `manual-index.js`
**Purpose:** Manually indexes specific data files to Elasticsearch.

**What it does:**
- Allows manual indexing of specific JSONL files
- Useful for one-off indexing operations
- Bypasses the normal cron-based workflow

**Usage:**
```bash
npm run manual-index
# or
source .env && node scripts/manual-index.js
```

**Note:** This is a legacy script from the original project.

---

## Usage Examples

### Finding and Filling Gaps

1. **Check for gaps in staging:**
   ```bash
   npm run check-staging-gaps
   ```

2. **If gaps found, check if production has the data:**
   ```bash
   npm run check-prod-gaps
   npm run compare-clusters  # Edit dates in script first
   ```

3. **Fill the gap using backfill:**
   ```bash
   ./backfill.sh --staging --from YYYY-MM-DD --to YYYY-MM-DD --yes
   ```

4. **If backfill can't fetch from API, copy from production:**
   ```bash
   npm run copy-prod-to-staging  # Edit dates in script first
   ```

5. **Verify the gap is filled:**
   ```bash
   npm run verify-backfill
   npm run check-staging-gaps
   ```

### Analyzing Data Quality

1. **Check for duplicates:**
   ```bash
   npm run check-duplicates
   ```

2. **Analyze data distribution:**
   ```bash
   npm run analyze-data
   ```

3. **Verify specific date range:**
   ```bash
   npm run verify-backfill
   ```

---

## Environment Requirements

All scripts require environment variables to be set. Ensure `.env` file exists with:

**Production Elasticsearch:**
- `ES_CLOUD_ID`
- `ES_USERNAME`
- `ES_PASSWORD`

**Staging Elasticsearch:**
- `STAGING_CLOUD_ID`
- `STAGING_ES_USERNAME`
- `STAGING_ES_PASSWORD`

**Ambient Weather API:**
- `AMBIENT_WEATHER_API_KEY`
- `AMBIENT_WEATHER_APPLICATION_KEY`
- `AMBIENT_WEATHER_MACADDRESS`

---

## Notes

- Most scripts have hardcoded date ranges for specific analysis tasks
- Edit the scripts directly to change date ranges
- All scripts use `source .env` when run via npm scripts
- Scripts are designed for one-off analysis and recovery operations
- For routine backfilling, use the main backfill CLI: `./backfill.sh`

---

## Contributing

When adding new scripts:
1. Place them in this `scripts/` directory
2. Document them in this README
3. Add npm script aliases in `package.json` with `.env` sourcing
4. Use the existing scripts as templates for error handling and logging
