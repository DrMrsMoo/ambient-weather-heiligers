# Unit Testing Implementation Plan

## Overview
Add comprehensive unit tests to enable safe refactoring of large functions into smaller, composable modules.

## Branching Strategy
- **Epic branch:** `epic/unit-testing` - all testing work lives here
- Feature branches off epic: `epic/unit-testing/backfill-tests`, `epic/unit-testing/es-client-tests`, etc.
- PRs merge feature branches → epic branch → main

## Current State (Updated: 2026-01-11)

### Test Suite Summary
**Overall Status: ✅ EXCELLENT**
- **Test Suites:** 9 passed
- **Total Tests:** 176 passed, 1 skipped, 2 todo
- **Execution Time:** 1.195s

### Coverage by Component

| Component | Test File | Tests | Status |
|-----------|-----------|-------|--------|
| **Data Fetchers** | `src/dataFetchers/fetchRawData.test.js` | 30 | ✅ Excellent |
| **Converters (Imperial→JSONL)** | `src/converters/ConvertImperialToJsonl.test.js` | 18 | ✅ Excellent |
| **Converters (Imperial→Metric)** | `src/converters/ConvertImperialToMetric.test.js` | 17 | ✅ Excellent |
| **Data Indexers (Indexer)** | `src/dataIndexers/Indexer.test.js` | 30 | ✅ Excellent |
| **Data Indexers (ES Methods)** | `src/dataIndexers/esClientMethods.test.js` | 28 | ✅ Excellent |
| **Main Workflow** | `src/mainFlow/main.test.js` | 11 | ✅ Excellent |
| **Main Utilities** | `src/mainFlow/main_utils.test.js` | 18 | ✅ Excellent |
| **Backfill** | `src/backfill/backfill.test.js` | 33 | ✅ Excellent |
| **Helpers** | `src/utils/helpers.test.js` | 7 | ✅ Good |

### Original Targets (Now Complete ✅)
| File | Lines | Test Coverage | Status |
|------|-------|---------------|--------|
| `src/backfill/backfill.js` | 614 | **33 tests** | ✅ **COMPLETE** |
| `src/dataIndexers/esClientMethods.js` | 316 | **28 tests** | ✅ **COMPLETE** |
| `main.js` | 246 | **11 tests** | ✅ **COMPLETE** |
| `src/dataIndexers/Indexer.js` | 181 | **30 tests** | ✅ **COMPLETE** |

**Already well-tested:** helpers.js, ConvertImperialToMetric.js, ConvertImperialToJsonl.js, main_utils.js

## Implementation Steps

### Phase 1: Setup Epic Branch
1. Create epic branch `epic/unit-testing` from main
2. Verify Jest configuration works: `npm test`

### Phase 2: backfill.js Tests (Priority 1)
**Branch:** `epic/unit-testing/backfill-tests`

Create `src/backfill/backfill.test.js` testing:
- `validateArgs()` - argument validation
- `findGapsInCluster()` - gap detection logic
- `loadOrFetchDataForGaps()` - data loading with mocked API/file ops
- `backfillSingleCluster()` - single cluster backfill flow
- `runBackfill()` - main orchestration

**Mocking requirements:**
- Mock Elasticsearch client methods
- Mock file system operations
- Mock Ambient Weather API calls
- Mock readline for user confirmations

### Phase 3: esClientMethods.js Tests (Priority 2)
**Branch:** `epic/unit-testing/es-client-tests`

Create `src/dataIndexers/esClientMethods.test.js` testing:
- `pingCluster()` - cluster connectivity
- `getAmbientWeatherAliases()` - alias retrieval
- `getMostRecentDoc()` - latest document queries
- `bulkIndexDocuments()` - bulk indexing operations
- `searchDocsByDateRange()` - date range searches
- `getOldestDoc()` - oldest document queries

**Mocking requirements:**
- Use existing `esClientMock.js`
- Extend mock for missing operations

### Phase 4: Indexer.js Tests (Priority 3)
**Branch:** `epic/unit-testing/indexer-tests`

Create `src/dataIndexers/Indexer.test.js` testing:
- Constructor and initialization
- `initialize()` - index setup and alias management
- `bulkIndexDocuments()` - document indexing
- `pingCluster()` - connectivity checks
- Error handling scenarios

### Phase 5: main.js Tests (Priority 4)
**Branch:** `epic/unit-testing/main-tests`

Enhance `src/mainFlow/main.test.js` testing:
- `main()` - full orchestration flow
- `indexToCluster()` - per-cluster indexing logic
- Dual-cluster coordination
- Error handling and recovery

**Mocking requirements:**
- Mock FetchRawData (mock exists)
- Mock converters
- Mock Indexer class
- Mock file operations

## Key Files to Modify/Create
```
src/
├── backfill/
│   └── backfill.test.js          # NEW
├── dataIndexers/
│   ├── esClientMethods.test.js   # NEW
│   ├── Indexer.test.js           # NEW
│   └── esClientMock.js           # EXTEND
└── mainFlow/
    └── main.test.js              # ENHANCE
```

## Jest Best Practices to Follow
1. **Descriptive test names:** `describe`/`it` blocks that read as specifications
2. **AAA pattern:** Arrange, Act, Assert
3. **Isolated tests:** Each test independent, no shared mutable state
4. **Mock external dependencies:** API calls, file system, Elasticsearch
5. **Test edge cases:** Empty data, errors, boundary conditions
6. **Coverage targets:** Aim for critical paths, not 100% coverage

## Verification
After each phase:
1. Run `npm test` - all tests pass
2. Run `npm test -- --coverage` - verify coverage increased
3. Ensure no regressions in existing tests
4. PR review and merge to epic branch

## Final Merge
Once all phases complete and tested:
- PR from `epic/unit-testing` → `main`
- Full test suite passes
- Coverage report shows improvement

---

## Comprehensive Test Coverage Analysis (2026-01-11)

### Executive Summary

**Overall Assessment: ✅ STRONG**

The project has excellent test coverage with **176 passing tests** across 9 test suites. Core functionality is well-protected for dependency upgrades and refactoring, but utility scripts exposed as npm commands lack test coverage.

### Dependency Upgrade Safety

#### ✅ Well Protected Dependencies

The following dependencies have excellent test coverage protecting against upgrade issues:

1. **`@elastic/elasticsearch`** - 58 tests across Indexer and esClientMethods
   - All major operations tested: search, bulk, index creation, aliases, ping
   - Error handling validated for connection failures, 404s, malformed responses

2. **`moment-timezone`** - Covered in fetchRawData and helpers tests
   - Date parsing, timezone conversions, date arithmetic
   - Edge cases: epoch timestamps, null/undefined handling

3. **`file-system`** / `fs` - All file operations mocked and tested
   - Reading, writing, directory operations, error scenarios

4. **`ambient-weather-api`** - Mocked in fetchRawData tests
   - API call patterns validated with realistic data structures

5. **`yargs`** - Used in `bin/runBackfill.js`
   - Mitigated: backfill.test.js validates logic receiving parsed args
   - Argument validation tested: cluster flags, date formats, conflicts

### Refactoring Safety Assessment

**Excellent Safety for Core Refactoring** ✅

The test suite provides strong protection for refactoring:

1. **Modular Structure** - Each component has isolated tests with clear boundaries
2. **Mock Usage** - External dependencies properly mocked (file system, ES client, API)
3. **Integration Tests** - main.test.js validates component interactions
4. **Edge Cases** - Comprehensive coverage of null/undefined, empty arrays, epoch zero
5. **Error Paths** - Most error scenarios tested (connection failures, invalid data)

#### Examples of Refactoring Protection:

| Refactoring Scenario | Test Protection |
|---------------------|-----------------|
| **Moving date filtering logic** | `main_utils.test.js:35-139` - 7 tests validate filterAfterDate behavior |
| **Changing Elasticsearch operations** | `esClientMethods.test.js` - 28 tests cover all ES interactions |
| **Modifying data conversion** | Converter tests ensure output format consistency |
| **Splitting main workflow** | Integration tests ensure component contracts maintained |
| **Changing backfill gap detection** | `backfill.test.js:213-228` - Tests gap detection with 10-min threshold |
| **Dual-cluster coordination** | `main.test.js:196-226` - Tests per-cluster filtering prevents duplicates |

### Critical Test Coverage Details

#### 1. Data Fetchers (`fetchRawData.test.js` - 30 tests)

**Coverage Highlights:**
- ✅ `clusterLatestDate` parameter handling - **Critical for preventing duplicates**
  - Tests cluster date vs local file fallback
  - Validates epoch 0 handling (falsy but valid timestamp)
  - Tests "too early" prevention (5-minute minimum interval)
- ✅ Date extraction and parsing from multiple sources
- ✅ API interaction with error handling
- ✅ File I/O operations with edge cases
- ⚠️ **2 TODO tests** at lines 77-78 (recentDataFileNames, skipSave)
- ⚠️ **1 skipped test** at line 320 (should be fixed or removed)

#### 2. Data Indexers (`Indexer.test.js` + `esClientMethods.test.js` - 58 tests)

**Coverage Highlights:**
- ✅ Cluster connectivity and health checks
- ✅ Write index detection and management
- ✅ Bulk indexing with error capture
- ✅ Date range queries with custom options
- ✅ Index creation with "already exists" handling
- ✅ Index deletion with "not found" handling
- ✅ Alias management and filtering

**Error Scenarios Covered:**
- Connection failures, timeout errors
- Non-200 status codes (404, 400)
- Malformed responses from Elasticsearch
- Empty result sets

#### 3. Main Workflow (`main.test.js` - 11 tests)

**Coverage Highlights:**
- ✅ Dual-cluster initialization with Promise.allSettled
- ✅ Per-cluster filtering based on independent latest dates
- ✅ Graceful degradation when clusters unavailable
- ✅ "Too early" fetch prevention
- ✅ Error handling preserves overall workflow

**Critical Protection:**
- Prevents duplicate data when multiple machines run cron jobs
- Validates each cluster only gets records it doesn't have
- Tests filtering with null, undefined, and valid epoch dates

#### 4. Backfill Feature (`backfill.test.js` - 33 tests)

**Coverage Highlights:**
- ✅ Comprehensive argument validation (cluster flags, date formats)
- ✅ Gap detection with 10-minute threshold
- ✅ Dual-cluster mode with independent gap detection
- ✅ User confirmation flow (skip with --yes flag)
- ✅ Local file loading with date range filtering
- ✅ Date parsing edge cases (leap years, invalid dates)

**Error Scenarios:**
- ES client creation failures
- Search query failures
- File read errors (corrupt files)
- Indexer initialization failures

#### 5. Main Utilities (`main_utils.test.js` - 18 tests)

**Coverage Highlights:**
- ✅ `prepareDataForBulkIndexing` with filterAfterDate parameter
  - Tests null/undefined filtering (all records included)
  - Tests strict filtering (dateutc > filterAfterDate)
  - Tests epoch 0 handling
  - Tests multiple files with consistent filtering
- ✅ Progress state management with logging
- ✅ Data type handling (imperial vs metric index aliases)

### Missing Test Coverage - Utility Scripts

The following scripts exposed as npm commands have **NO test coverage**:

#### ⚠️ High Priority (Write Operations - Data Corruption Risk)

1. **`scripts/manual-index.js`** - Manual data indexing
   - **Risk:** High - Performs bulk write operations
   - **Exposed as:** `npm run manual-index`
   - **Recommendation:** Add integration test validating file selection and bulk indexing

2. **`scripts/copy-prod-to-staging.js`** - Copies data between clusters
   - **Risk:** High - Cross-cluster write operations
   - **Exposed as:** `npm run copy-prod-to-staging`
   - **Recommendation:** Test with mocked ES clients to validate query/index flow

3. **`scripts/archive-data.js`** - Archives/deletes old data
   - **Risk:** High - Destructive operations
   - **Exposed as:** `npm run archive-data`, `npm run archive-data:dry-run`
   - **Recommendation:** Test `--dry-run` flag behavior and deletion logic

#### ⚠️ Medium Priority (Read Operations - Monitoring Critical)

4. **`scripts/verify-backfill.js`** - Validates backfill results
   - **Risk:** Medium - Diagnostic tool, won't corrupt data
   - **Exposed as:** `npm run verify-backfill`

5. **`scripts/verify-indexing.js`** - Checks index health
   - **Risk:** Medium - Diagnostic tool
   - **Exposed as:** `npm run verify-indexing`

6. **Gap Detection Scripts** - `check-recent-gaps.js`, `check-production-gaps.js`, `check-gap-details.js`
   - **Risk:** Medium - Critical for monitoring but read-only
   - **Exposed as:** `npm run check-staging-gaps`, `npm run check-prod-gaps`, `npm run check-gap-details`

#### ℹ️ Low Priority (Analysis Tools)

7. **`scripts/analyze-data.js`** - Data analysis
   - **Exposed as:** `npm run analyze-data`

8. **`scripts/check-duplicates.js`** - Duplicate detection
   - **Exposed as:** `npm run check-duplicates`

9. **`scripts/compare-clusters.js`** - Cluster comparison
   - **Exposed as:** `npm run compare-clusters`

### Test Quality Observations

#### Strengths ✅

1. **Realistic test data** - Uses actual timestamp formats and data structures
2. **Clear test names** - Descriptive "it" statements explain expected behavior
3. **Proper setup/teardown** - `beforeEach`/`afterEach` prevent test pollution
4. **Edge case coverage** - Tests null, undefined, empty, epoch zero, malformed data
5. **Error scenarios** - Network failures, invalid data, missing files
6. **Mock isolation** - Dependencies properly isolated with jest.mock()

#### Areas for Improvement ⚠️

1. **TODO items** - 2 todos in `fetchRawData.test.js:77-78` should be implemented
   - `recentDataFileNames` property
   - `skipSave` parameter behavior

2. **Skipped test** - 1 skipped test in `fetchRawData.test.js:320`
   - Should be fixed or removed with justification

3. **No coverage metrics** - Consider adding Jest coverage reporting:
   ```json
   "scripts": {
     "test:coverage": "jest --coverage",
     "test:watch": "jest --watch"
   }
   ```

4. **Entry point scripts** - `bin/` directory scripts not directly tested
   - CLI argument parsing relies on yargs validation
   - Could add subprocess execution tests

### Recommendations

#### 1. Complete Pending Work

- [ ] Implement 2 TODO tests in `fetchRawData.test.js`
- [ ] Fix or remove skipped test at line 320
- [ ] Add coverage reporting to package.json

#### 2. High Priority - Add Script Tests

Create test files for high-risk scripts:

```javascript
// Example: scripts/manual-index.test.js
describe('manual-index', () => {
  it('loads and indexes specified number of recent files', async () => {
    // Mock file system to return test files
    // Mock IndexData to verify bulk indexing called
    // Validate file selection logic
  });

  it('handles missing data directory gracefully', async () => {
    // Mock fs.existsSync to return false
    // Verify warning logged, no crash
  });
});
```

#### 3. Medium Priority - Add Verification Script Tests

Test query construction and result parsing:

```javascript
// Example: scripts/verify-backfill.test.js
describe('verify-backfill', () => {
  it('queries correct date range from staging cluster', async () => {
    // Mock ES client
    // Verify search query structure
    // Validate aggregation logic
  });
});
```

#### 4. Consider Adding

- **Logger class tests** - Currently untested but simple wrapper
- **ES client factory tests** - `src/dataIndexers/esClient.js` - simple configuration
- **Entry point integration tests** - Validate CLI argument handling end-to-end

### Conclusion

The project has **excellent test coverage for its core features** (176 passing tests). The tests effectively protect against:

✅ **Dependency upgrades** - Especially Elasticsearch, moment-timezone, file system
✅ **Code refactoring** - Clear component boundaries, comprehensive mocks
✅ **API changes** - External dependencies well-isolated
✅ **Data corruption** - Core workflows have extensive validation

**Main Gap:** Utility scripts lack test coverage, creating risk for manual operations.

**Next Steps:** Add basic integration tests for the 3-4 high-risk scripts (`manual-index`, `copy-prod-to-staging`, `archive-data`) to achieve comprehensive coverage of all exposed npm script features.
