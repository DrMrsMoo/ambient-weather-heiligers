## How to Test This PR

### Prerequisites

1. **Environment Setup**
   ```bash
   # Ensure .env file exists with required credentials
   cp .env.example .env
   # Edit .env with actual credentials for:
   # - Production ES cluster (ES_CLOUD_ID, ES_USERNAME, ES_PASSWORD)
   # - Staging ES cluster (STAGING_CLOUD_ID, STAGING_ES_USERNAME, STAGING_ES_PASSWORD)
   # - Ambient Weather API (AMBIENT_WEATHER_API_KEY, AMBIENT_WEATHER_APPLICATION_KEY, AMBIENT_WEATHER_MACADDRESS)
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Verify Data Directories Exist**
   ```bash
   mkdir -p data/ambient-weather-heiligers-{imperial,metric,imperial-jsonl,metric-jsonl}
   ```

---

### Test 1: Basic Backfill with Local Files

**Objective:** Verify backfill can detect, convert, and index local data files

```bash
# 1. Check for gaps in staging
npm run check-staging-gaps

# 2. If gaps exist, run backfill for a specific date range
./backfill.sh --staging --from 2025-12-29 --to 2026-01-01 --yes

# 3. Verify the backfill succeeded
npm run verify-backfill

# Expected Results:
# - Local files detected and converted to JSONL
# - Data indexed to staging cluster
# - No errors reported
# - Gap verification shows data was filled
```

---

### Test 2: Auto-Conversion of Manual Files

**Objective:** Verify auto-conversion of raw JSON files to JSONL formats

```bash
# 1. Place a raw JSON file in data/ambient-weather-heiligers-imperial/
# (The PR includes 3 manual files for testing)

# 2. Run backfill
./backfill.sh --staging --from 2025-12-29 --to 2026-01-01 --yes

# 3. Check that JSONL files were created
ls -la data/ambient-weather-heiligers-imperial-jsonl/
ls -la data/ambient-weather-heiligers-metric-jsonl/

# Expected Results:
# - Imperial JSONL files created automatically
# - Metric JSONL files created automatically
# - Files preserved (not deleted after indexing)
# - Log shows "Converting [filename] to imperial JSONL..."
# - Log shows "Converting [filename] to metric JSONL..."
```

---

### Test 3: Dual-Cluster Backfill

**Objective:** Verify independent gap detection and backfill for both clusters

```bash
# 1. Run backfill for both clusters
./backfill.sh --both --from 2025-12-29 --to 2026-01-01 --yes

# Expected Results:
# - Two separate gap detections performed
# - Both clusters processed sequentially
# - Independent results for each cluster
# - Log shows "[DUAL-CLUSTER MODE]" message
# - Log shows results for both PRODUCTION and STAGING
```

---

### Test 4: Gap Detection Scripts

**Objective:** Verify gap detection and analysis scripts work correctly

```bash
# 1. Check staging gaps
npm run check-staging-gaps

# 2. Check production gaps
npm run check-prod-gaps

# 3. Compare clusters
npm run compare-clusters

# 4. Analyze data distribution
npm run analyze-data

# Expected Results:
# - Scripts run without errors
# - Output shows clear gap information
# - Date ranges, document counts, and coverage percentages displayed
# - Timestamps are in human-readable format
```

---

### Test 5: API Fallback (No Local Files)

**Objective:** Verify backfill falls back to API when local files don't exist

```bash
# 1. Run backfill for a date range without local files
./backfill.sh --staging --from 2026-01-03 --to 2026-01-04 --yes

# Expected Results:
# - Log shows "No data found in local files for specified range"
# - Log shows "Attempting to fetch data from Ambient Weather API..."
# - If API has data: records fetched and indexed
# - If API has no data: "No data available" message
# - Temp files created and cleaned up after indexing
```

---

### Test 6: Cluster-to-Cluster Copy

**Objective:** Verify copying data from production to staging works

```bash
# 1. Identify a gap in staging that production has
npm run compare-clusters

# 2. If production has data staging is missing, copy it
npm run copy-prod-to-staging

# 3. Verify gap is filled
npm run check-staging-gaps

# Expected Results:
# - Data exported from production
# - Local files created (JSON + JSONL formats)
# - Data indexed to staging
# - Verification shows gap is filled
```

---

### Test 7: Error Handling

**Objective:** Verify graceful error handling

```bash
# 1. Test with invalid date range (to > from)
./backfill.sh --staging --from 2026-01-01 --to 2025-12-29

# Expected Results:
# - Clear error message about invalid date range
# - Process exits gracefully

# 2. Test without --prod, --staging, or --both flag
./backfill.sh --from 2025-12-29 --to 2026-01-01

# Expected Results:
# - Error message: "Must specify --prod, --staging, or --both"
# - Process exits gracefully

# 3. Test cleanup error handling
# (Simulated by making temp file read-only, but not necessary for normal testing)
```

---

### Test 8: Verification Suite

**Objective:** Verify all verification scripts function correctly

```bash
# Run each verification script
npm run verify-backfill
npm run check-staging-gaps
npm run check-prod-gaps
npm run compare-clusters
npm run analyze-data
npm run check-duplicates
npm run check-gap-details

# Expected Results:
# - All scripts execute without errors
# - Output is formatted and readable
# - Data analysis is accurate
# - Scripts connect to correct clusters
```

---

### Manual Verification Checklist

After running automated tests, manually verify:

- [ ] Local files in `data/ambient-weather-heiligers-imperial/` are preserved
- [ ] JSONL files created in `imperial-jsonl` and `metric-jsonl` directories
- [ ] Elasticsearch indices contain expected document counts
- [ ] No duplicate documents created (check via `npm run check-duplicates`)
- [ ] Timestamps are correctly filtered (boundary documents excluded)
- [ ] Both imperial and metric data indexed
- [ ] Error logs are clear and actionable
- [ ] Scripts documentation in `scripts/README.md` is accurate
- [ ] Main README.md has backfill section
- [ ] All npm scripts work with `source .env` prefix

---

### Success Criteria

✅ **All tests pass with expected results**
✅ **No errors or exceptions thrown**
✅ **Data successfully indexed to target clusters**
✅ **Local files properly converted and preserved**
✅ **Gap detection accurately identifies missing data**
✅ **Documentation is clear and complete**
✅ **Scripts are organized in `scripts/` directory**
✅ **npm scripts work correctly with environment variables**

---

### Troubleshooting

**Issue:** "TypeError: Cannot read properties of undefined (reading 'split')"
- **Cause:** Environment variables not loaded
- **Fix:** Ensure `.env` file exists and `source .env` is in npm script

**Issue:** "No data found in local files for specified range"
- **Cause:** No local files overlap with the date range
- **Fix:** This is expected - backfill will fall back to API

**Issue:** "Too early to fetch data"
- **Cause:** Rate limit check (shouldn't happen with bypass enabled)
- **Fix:** Wait 5 minutes or check `bypassRateLimit` parameter

**Issue:** Duplicate documents in cluster
- **Cause:** Running backfill multiple times for same date range
- **Fix:** This is cosmetic - duplicates can be removed during reindexing
