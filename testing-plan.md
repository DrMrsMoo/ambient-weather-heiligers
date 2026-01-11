# Unit Testing Implementation Plan

## Overview
Add comprehensive unit tests to enable safe refactoring of large functions into smaller, composable modules.

## Branching Strategy
- **Epic branch:** `epic/unit-testing` - all testing work lives here
- Feature branches off epic: `epic/unit-testing/backfill-tests`, `epic/unit-testing/es-client-tests`, etc.
- PRs merge feature branches → epic branch → main

## Current State
| File | Lines | Test Coverage |
|------|-------|---------------|
| `src/backfill/backfill.js` | 614 | None |
| `src/dataIndexers/esClientMethods.js` | 316 | None |
| `main.js` | 246 | Minimal (29 lines) |
| `src/dataIndexers/Indexer.js` | 181 | None |

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
