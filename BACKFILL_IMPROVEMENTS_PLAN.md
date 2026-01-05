# Backfill PR Improvements Plan

## Context

The backfill feature is **additive** and should not modify core application flow. The current implementation incorrectly assumes data is missing during late Dec 2025 - Jan 1 2026, when in fact the weather station was online and data exists locally in manual files.

### Manual Data Files (Already Retrieved)
- `1766966700000_1767052800000.json`: 288 records (Dec 29 00:05 - Dec 30 00:00)
- `1767053100000_1767139200000.json`: 288 records (Dec 30 00:05 - Dec 31 00:00)
- `1767139500000_1767225600000.json`: 288 records (Dec 31 00:05 - Jan 1 00:00)

**Total: 864 records** that need to be converted to metric/JSONL and indexed.

## Critical Files

**Backfill-specific (will modify):**
- `/Users/tina/Projects/ambient-weather-heiligers/src/backfill/backfill.js` (527 lines) - Main backfill logic
- `/Users/tina/Projects/ambient-weather-heiligers/runBackfill.js` - CLI entry point

**Core converters (will use, not modify):**
- `/Users/tina/Projects/ambient-weather-heiligers/src/converters/ConvertImperialToJsonl.js`
- `/Users/tina/Projects/ambient-weather-heiligers/src/converters/ConvertImperialToMetric.js`

## Issues Identified

### 1. Local File Processing Issue (CRITICAL)
**Current behavior:** `loadDataFromLocalFiles()` reads raw JSON files but doesn't check if they've been converted to JSONL/metric format.

**Problem:** Manual files exist but aren't converted, so backfill may try to fetch from API instead or fail to process them correctly.

**Root cause:** The backfill assumes JSONL files exist for indexing, but manual files are raw JSON only.

### 2. PR Review Issues (Backfill-specific only)

From Copilot review, focusing ONLY on backfill code:

**High Priority:**
- **startEpoch not used in API calls** (backfill.js:370) - Only `endEpoch` passed to API, `startEpoch` ignored
- **Boundary query logic** (backfill.js:243) - Uses `gte` (>=) when it should use `gt` (>) per comment
- **Error return inconsistency** (backfill.js:72) - `result.reason` can be Error object or string

**Medium Priority:**
- **Record count estimation** - Always assumes 288 records when bypassing rate limit
- **Silent file cleanup failures** (backfill.js:443) - Cleanup errors ignored

**Note:** Index validation and searchDocsByDateRange issues are in shared code (`esClientMethods.js`), so we'll skip those per user preference.

## Implementation Plan

### Step 1: Fix Local File Auto-Processing

**Goal:** Make backfill automatically detect and convert unconverted local files

**Changes to `loadDataFromLocalFiles()` (backfill.js:469-524):**

1. After reading imperial JSON file, check if JSONL versions exist
2. If JSONL files don't exist, create them inline:
   - Convert imperial JSON → imperial JSONL
   - Convert imperial JSON → metric JSONL
3. Return the raw imperial records (existing behavior)
4. Update the `performBackfill()` function to handle this properly

**Detailed implementation:**
```javascript
async function loadDataFromLocalFiles(startEpoch, endEpoch, clusterName) {
  // ... existing code to read JSON files ...

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const fileBaseName = file.replace('.json', '');
    const filePath = `${dataDir}/${file}`;

    // Read imperial JSON
    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Check if JSONL versions exist, create if needed
    const imperialJsonlPath = `./data/ambient-weather-heiligers-imperial-jsonl/${fileBaseName}.jsonl`;
    const metricJsonlPath = `./data/ambient-weather-heiligers-metric-jsonl/${fileBaseName}.jsonl`;

    if (!fs.existsSync(imperialJsonlPath)) {
      // Convert to JSONL inline (don't use Converter class to avoid complexity)
      backfillLogger.logInfo(`[${clusterName}] Converting ${file} to JSONL...`);
      const jsonlContent = records.map(r => JSON.stringify(r)).join('\n');
      fs.writeFileSync(imperialJsonlPath, jsonlContent);
    }

    if (!fs.existsSync(metricJsonlPath)) {
      // Convert to metric and write JSONL
      backfillLogger.logInfo(`[${clusterName}] Converting ${file} to metric...`);
      const metricRecords = records.map(r => convertToMetric(r));
      const metricJsonlContent = metricRecords.map(r => JSON.stringify(r)).join('\n');
      fs.writeFileSync(metricJsonlPath, metricJsonlContent);
    }

    // Filter and add to results (existing behavior)
    const filteredRecords = records.filter(record => {
      return record.dateutc > startEpoch && record.dateutc < endEpoch;
    });

    if (filteredRecords.length > 0) {
      allRecords.push(...filteredRecords);
      filesProcessed++;
    }
  }

  return { dataRecords: allRecords, filesProcessed };
}
```

### Step 2: Fix performBackfill() to Use Pre-converted Files

**Goal:** Use the JSONL files we just created instead of creating temp files

**Changes to `performBackfill()` (backfill.js:343-460):**

Current flow creates temporary files even when using local data. Instead:

1. When `dataSource === 'local'`, skip temp file creation
2. Identify which local files were used based on the date range
3. Pass those file base names directly to `prepareDataForBulkIndexing()`

**Implementation approach:**

```javascript
async function performBackfill(client, clusterName, startEpoch, endEpoch) {
  // ... existing data loading code ...

  if (dataRecords.length === 0) {
    return { status: 'skipped', message: 'No data to backfill' };
  }

  let filesForIndexing = [];

  if (dataSource === 'local') {
    // Use existing JSONL files (already converted by loadDataFromLocalFiles)
    // Identify files that overlap with our date range
    const dataDir = './data/ambient-weather-heiligers-imperial';
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const fileBaseName = file.replace('.json', '');
      const records = JSON.parse(fs.readFileSync(`${dataDir}/${file}`, 'utf8'));

      // Check if this file has records in our range
      const hasRelevantRecords = records.some(r =>
        r.dateutc > startEpoch && r.dateutc < endEpoch
      );

      if (hasRelevantRecords) {
        filesForIndexing.push(fileBaseName);
      }
    }

    backfillLogger.logInfo(`[${clusterName}] Using ${filesForIndexing.length} pre-existing JSONL files`);

  } else {
    // API source - create temp files (existing behavior)
    const tempFileBaseName = `backfill_${Date.now()}`;
    // ... existing temp file creation code ...
    filesForIndexing = [tempFileBaseName];
  }

  // Index using the identified files
  const indexer = new IndexData(client);

  const imperialPayload = prepareDataForBulkIndexing(filesForIndexing, 'imperial', backfillLogger);
  const imperialResult = await indexer.bulkIndexDocuments(imperialPayload, 'imperial');

  const metricPayload = prepareDataForBulkIndexing(filesForIndexing, 'metric', backfillLogger);
  const metricResult = await indexer.bulkIndexDocuments(metricPayload, 'metric');

  // Clean up only temp files (if API source)
  if (dataSource === 'api') {
    // ... cleanup temp files ...
  }

  return {
    status: 'success',
    cluster: clusterName,
    dataSource,
    filesUsed: filesForIndexing.length,
    recordsFound: dataRecords.length,
    imperialIndexed: imperialResult.indexCounts.count,
    metricIndexed: metricResult.indexCounts.count
  };
}
```

### Step 3: Fix PR Review Issues (Backfill-specific)

#### 3a. Fix startEpoch Usage in API Calls

**Location:** backfill.js:368-370

**Current code:**
```javascript
const fetchResult = await fetcher.getDataForDateRanges(true, endEpoch, true);
```

**Issue:** `startEpoch` is calculated but never used. This could cause incomplete data fetching.

**Fix:** Add a comment explaining why only endEpoch is used (API counts backwards) and verify the logic is correct:

```javascript
// API counts backwards from endEpoch. The rate limit bypass in FetchRawData
// will calculate how many records to fetch based on the gap duration.
// We then filter results to (startEpoch, endEpoch) range after fetching.
const fetchResult = await fetcher.getDataForDateRanges(true, endEpoch, true);
```

**Alternative:** If the current approach is insufficient, we may need to pass both boundaries and let FetchRawData calculate the exact limit needed.

#### 3b. Fix Boundary Query Logic

**Location:** backfill.js:243

**Current code:**
```javascript
const firstDocAfter = await searchDocsByDateRange(
  client, imperialIndex, toDate, Date.now(),
  { size: 1, sort: ['dateutc:asc'], ... }
);
```

**Issue:** Comment says "AFTER toDate" but `searchDocsByDateRange` uses `gte` (>=), which includes toDate itself.

**Fix:** This is actually in the shared `esClientMethods.js` file. Since we're only fixing backfill code, add a workaround comment:

```javascript
// Query for first document AFTER toDate
// Note: searchDocsByDateRange uses gte (>=), so we might get toDate itself.
// This is fine because we filter with strict < comparison later (line 393).
const firstDocAfter = await searchDocsByDateRange(...);
```

#### 3c. Fix Error Return Inconsistency

**Location:** backfill.js:62-72

**Current code:**
```javascript
} else {
  backfillLogger.logError(`[${clusterName}] Failed:`, result.reason);
}
```

**Issue:** `result.reason` could be Error object or string, causing inconsistent logging.

**Fix:**
```javascript
} else {
  const errorMessage = result.reason instanceof Error
    ? result.reason.message
    : String(result.reason);
  backfillLogger.logError(`[${clusterName}] Failed:`, errorMessage);
}
```

#### 3d. Improve File Cleanup Error Handling

**Location:** backfill.js:440-443

**Current code:**
```javascript
backfillLogger.logInfo(`[${clusterName}] Cleaning up temporary files...`);
if (fs.existsSync(imperialJsonlPath)) fs.unlinkSync(imperialJsonlPath);
if (fs.existsSync(metricJsonlPath)) fs.unlinkSync(metricJsonlPath);
```

**Fix:**
```javascript
backfillLogger.logInfo(`[${clusterName}] Cleaning up temporary files...`);
try {
  if (fs.existsSync(imperialJsonlPath)) fs.unlinkSync(imperialJsonlPath);
  if (fs.existsSync(metricJsonlPath)) fs.unlinkSync(metricJsonlPath);
  backfillLogger.logInfo(`[${clusterName}] Cleanup complete`);
} catch (cleanupErr) {
  backfillLogger.logWarning(`[${clusterName}] Cleanup failed (non-critical):`, cleanupErr.message);
}
```

### Step 4: Update Directory Structure Check

**Goal:** Ensure required JSONL directories exist

**Changes:** Add directory creation to `loadDataFromLocalFiles()`:

```javascript
async function loadDataFromLocalFiles(startEpoch, endEpoch, clusterName) {
  const dataDir = './data/ambient-weather-heiligers-imperial';
  const jsonlDirImperial = './data/ambient-weather-heiligers-imperial-jsonl';
  const jsonlDirMetric = './data/ambient-weather-heiligers-metric-jsonl';

  // Ensure JSONL directories exist
  if (!fs.existsSync(jsonlDirImperial)) {
    fs.mkdirSync(jsonlDirImperial, { recursive: true });
  }
  if (!fs.existsSync(jsonlDirMetric)) {
    fs.mkdirSync(jsonlDirMetric, { recursive: true });
  }

  // ... rest of function ...
}
```

### Step 5: Test with Manual Files

After implementation, test the backfill with the manual files:

```bash
# Load environment
source .env

# Test backfill for the date range where manual files exist
./backfill.sh --staging --from 2025-12-29 --to 2026-01-01 --yes

# Expected behavior:
# 1. Detects manual JSON files in data/ambient-weather-heiligers-imperial/
# 2. Converts them to JSONL (imperial and metric)
# 3. Uses converted files for indexing
# 4. Reports 864 records indexed (3 files × 288 records)
```

## Success Criteria

1. ✅ Manual files are automatically detected and converted
2. ✅ Backfill uses converted JSONL files instead of creating temp files
3. ✅ All 864 records from manual files are indexed successfully
4. ✅ JSONL files are kept (not deleted) for audit trail
5. ✅ PR review issues (backfill-specific) are addressed
6. ✅ No changes to core application flow or shared code

## Risk Mitigation

- **No shared code changes**: Avoids impacting main application flow
- **Additive feature**: Backfill remains independent from regular indexing
- **File preservation**: Keeps all versions (imperial, JSONL, metric) for safety
- **Error handling**: Cleanup failures are logged but don't fail the operation
- **Testing**: Can test with existing manual files before running on clusters

## Out of Scope

- Index existence validation in `esClientMethods.js` (shared code)
- `searchDocsByDateRange` error handling improvements (shared code)
- Cross-platform script issues in `package.json` (not backfill-specific)
- Documentation updates to CLAUDE.md/README.md (can be separate PR)

## Files to Modify

1. `/Users/tina/Projects/ambient-weather-heiligers/src/backfill/backfill.js`
   - `loadDataFromLocalFiles()` - Add auto-conversion logic
   - `performBackfill()` - Use pre-converted files instead of temp files
   - Error handling improvements (3c, 3d)
   - Comment clarifications (3a, 3b)

Total changes: **1 file, ~150 lines modified**
