# Ambient Weather Heiligers - Modernization & Refactor Plan

## Executive Summary

**Last Updated:** January 4, 2026
**Project Status:** Production-ready code running on Raspberry Pi via `pi-master` branch
**Modernization Status:** In progress on `main` branch

This plan outlines the incremental modernization of the ambient-weather-heiligers codebase from a working Node.js application to a robust, test-covered, TypeScript application with modern tooling and best practices.

---

## Current State Assessment

### Production Environment
- **Location:** This Mac (`/Users/tina/Projects/ambient-weather-heiligers`)
- **Protection:** `production-current` git tag (locked version)
- **Deployment:** Cron job runs at 5:20 AM & 5:20 PM
- **Stability:** Stable, working code
- **Node Version:** Node.js 23.5.0
- **Status:** **PROTECTED** - only deploy via tag movement

### Development Environment (`main` branch)
- **Recent Work Completed:**
  - ✅ Dual-cluster indexing (production + staging)
  - ✅ Factory pattern for ES clients
  - ✅ Backfill CLI with comprehensive scripts
  - ✅ Documentation improvements (CLAUDE.md, README.md)
  - ✅ Independent error handling with `Promise.allSettled()`
  - ✅ Timestamp logging improvements

- **Remaining Challenges:**
  - ❌ Test coverage sporadic and incomplete
  - ❌ Dependencies outdated (ES client v7.16, blocks cluster upgrade to v9)
  - ❌ No TypeScript
  - ❌ Logging not in ECS format
  - ❌ Code quality inconsistent
  - ❌ No release tagging system
  - ❌ Maintainability issues

---

## Safe Deployment Strategy

### 🔒 Protection Model

**CRITICAL:** Production runs from the `production-current` git tag (NOT from `main`). The cron job checks out this tag before every run. You can freely merge to `main` without affecting production.

### Git Workflow

```
main (development/integration branch)
  ↓
feature/xyz branches (refactor work happens here)
  ↓
PR → main (merge freely - doesn't affect production!)
  ↓
git tag vX.Y.Z (create release tag - optional)
  ↓
./deploy-to-production.sh (moves production-current tag)
  ↓
Next cron run uses new version
```

### Deployment Process

1. **Development Phase:**
   - Create feature branch from `main`: `git checkout -b feature/descriptive-name`
   - Make changes, commit frequently
   - Test locally with both clusters: `source .env && node runMainIIFE.js`
   - Create PR to merge into `main`
   - **Merge to `main` freely** - it won't affect production!

2. **Optional: Create Named Release Tag**
   ```bash
   git checkout main
   git pull origin main
   git tag -a v1.1.0 -m "Description of changes"
   git push origin v1.1.0
   ```

3. **Deployment Phase (Move Production Tag):**
   ```bash
   # Use the deployment script (recommended)
   ./deploy-to-production.sh main  # Deploy latest main
   # OR
   ./deploy-to-production.sh v1.1.0  # Deploy specific tag

   # The script will:
   # 1. Show you what's changing
   # 2. Test the target version
   # 3. Move production-current tag if test succeeds
   # 4. Next cron run (5:20 AM/PM) will use new version
   ```

4. **Rollback Plan:**
   ```bash
   # If deployment causes issues, roll back
   git tag -f production-current <previous-commit-or-tag>
   git push origin production-current --force

   # Example: Roll back to v1.0.0
   git tag -f production-current v1.0.0
   git push origin production-current --force
   ```

### Safety Guarantees

✅ **Cron runs from `production-current` tag** - never from `main` branch
✅ **Feature branches isolate changes** - merge to main freely without risk
✅ **`main` branch can change anytime** - production unaffected
✅ **Deployment is explicit** - only happens when you run deploy script
✅ **Automatic testing before deploy** - script tests target version first
✅ **Tags are movable** - easy rollback if issues occur
✅ **Cron logs provide monitoring** - catch issues at next run (5:20 AM/PM)

---

## Modernization Epics

### Epic 1: Testing & Dependency Foundation (HIGH PRIORITY)

**Goal:** Achieve robust test coverage and upgrade core dependencies safely.

**Why First:** Cannot safely refactor or upgrade without tests. ES client upgrade is blocking cluster upgrades to v9.

#### Tasks

- [ ] **1.1 Audit Current Test Coverage**
  - [ ] Run coverage report: `npm test -- --coverage`
  - [ ] Document coverage gaps by module
  - [ ] Identify critical paths needing tests
  - [ ] Create test coverage baseline document

- [ ] **1.2 Expand Unit Test Coverage**
  - [ ] `src/converters/` - Target 80%+ coverage
    - [x] ConvertImperialToJsonl.test.js (exists)
    - [x] ConvertImperialToMetric.test.js (exists)
  - [ ] `src/dataFetchers/` - Target 80%+ coverage
    - [x] fetchRawData.test.js (exists, may need expansion)
  - [ ] `src/dataIndexers/` - Target 80%+ coverage
    - [ ] Indexer.test.js (needs creation)
    - [ ] esClient.test.js (needs creation)
    - [ ] esClientMethods.test.js (needs creation)
  - [ ] `src/utils/` - Target 90%+ coverage
    - [x] helpers.test.js (exists)
  - [ ] `main_utils.js` - Target 90%+ coverage
  - [ ] `main.js` - Integration test coverage

- [ ] **1.3 Add Integration Tests**
  - [ ] End-to-end test: fetch → convert → index (mock clusters)
  - [ ] Dual-cluster indexing test with `Promise.allSettled()`
  - [ ] Error handling test (one cluster fails, other succeeds)
  - [ ] Backfill workflow test

- [ ] **1.4 Upgrade Elasticsearch Client**
  - [ ] Create feature branch: `feature/upgrade-es-client-v8`
  - [ ] Research breaking changes: v7.16 → v8.x
  - [ ] Update `@elastic/elasticsearch` to v8.x
  - [ ] Update ES client code for v8 API changes
  - [ ] Test with staging cluster first
  - [ ] Verify backwards compatibility with v7 clusters (if needed)
  - [ ] Update tests for v8 client
  - [ ] Document migration steps in PR

- [ ] **1.5 Update Other Dependencies**
  - [ ] Create dependency audit: `npm outdated`
  - [ ] Update non-breaking changes: `npm update`
  - [ ] Identify major version upgrades needed
  - [ ] Update each major dependency in separate PR
  - [ ] Test thoroughly after each upgrade

**Success Criteria:**
- ✅ Test coverage >80% overall
- ✅ All critical paths have tests
- ✅ ES client v8+ (unblocks cluster upgrade to v9)
- ✅ All tests pass
- ✅ Dependencies are current

---

### Epic 2: Logging & Observability (MEDIUM PRIORITY)

**Goal:** Improve logging for debugging and enable Elasticsearch ingestion for monitoring.

**Dependencies:** None (can run in parallel with Epic 1)

#### Tasks

- [ ] **2.1 Audit Current Logging**
  - [ ] Document all log levels used
  - [ ] Identify inconsistent logging patterns
  - [ ] Review log output readability
  - [ ] Check timestamp consistency

- [ ] **2.2 Implement ECS Logging Format**
  - [ ] Research ECS (Elastic Common Schema) format
  - [ ] Create ECS logger wrapper/utility
  - [ ] Define standard fields for weather app
    - `@timestamp`
    - `log.level`
    - `message`
    - `service.name` (e.g., "ambient-weather-heiligers")
    - `cluster.name` (PRODUCTION/STAGING)
    - `event.action` (fetch/convert/index)
    - Custom fields for weather data context
  - [ ] Migrate Logger class to output ECS format
  - [ ] Add structured error logging
  - [ ] Test ECS log output format

- [ ] **2.3 Enhance Debugging Capability**
  - [ ] Add request/response IDs for tracing
  - [ ] Include duration metrics for operations
  - [ ] Add context fields (filenames, record counts)
  - [ ] Improve error stack traces

- [ ] **2.4 Set Up Log Ingestion (Optional)**
  - [ ] Create logs index template for ES
  - [ ] Configure Filebeat (or direct ingest) on Pi
  - [ ] Create Kibana dashboard for monitoring
  - [ ] Set up alerts for errors/failures

**Success Criteria:**
- ✅ All logs use ECS format
- ✅ Logs are machine-readable and human-readable
- ✅ Debugging is significantly easier
- ✅ (Optional) Logs ingested to ES for monitoring

---

### Epic 3: TypeScript Migration (MEDIUM-HIGH PRIORITY)

**Goal:** Convert codebase to TypeScript for type safety and maintainability.

**Dependencies:** Epic 1 (tests must exist before refactoring)

#### Tasks

- [ ] **3.1 Project Setup**
  - [ ] Install TypeScript: `npm install --save-dev typescript @types/node`
  - [ ] Create `tsconfig.json` with appropriate settings
  - [ ] Configure build scripts in package.json
  - [ ] Set up `src/` → `dist/` compilation
  - [ ] Install types for dependencies
    - `@types/ambient-weather-api` (or create custom types)
    - Types for other dependencies
  - [ ] Configure Jest for TypeScript (ts-jest)

- [ ] **3.2 Incremental Migration Strategy**
  - [ ] Enable `allowJs: true` in tsconfig (allows mixing JS/TS)
  - [ ] Create migration order (start with low-dependency files):
    1. `src/utils/` (helpers, constants)
    2. `src/logger/`
    3. `src/converters/`
    4. `src/registry/`
    5. `src/dataFetchers/`
    6. `src/dataIndexers/`
    7. Root files (main.js, main_utils.js)

- [ ] **3.3 Migrate Utilities**
  - [ ] `src/utils/constants.js` → `constants.ts`
  - [ ] `src/utils/helpers.js` → `helpers.ts`
  - [ ] Update tests to TypeScript
  - [ ] Define type interfaces for common data structures

- [ ] **3.4 Migrate Logger**
  - [ ] `src/logger/Logger.js` → `Logger.ts`
  - [ ] Define Logger interfaces
  - [ ] Update ECS logging types (if Epic 2 done)

- [ ] **3.5 Migrate Converters**
  - [ ] `src/converters/ConvertImperialToJsonl.js` → `.ts`
  - [ ] `src/converters/ConvertImperialToMetric.js` → `.ts`
  - [ ] Define weather data types
  - [ ] Update tests to TypeScript

- [ ] **3.6 Migrate Data Fetchers**
  - [ ] `src/dataFetchers/FetchRawData.js` → `.ts`
  - [ ] Define API response types
  - [ ] Update tests to TypeScript

- [ ] **3.7 Migrate Data Indexers**
  - [ ] `src/dataIndexers/esClient.js` → `.ts`
  - [ ] `src/dataIndexers/esClientMethods.js` → `.ts`
  - [ ] `src/dataIndexers/Indexer.js` → `.ts`
  - [ ] Define ES document types
  - [ ] Update tests to TypeScript

- [ ] **3.8 Migrate Root Files**
  - [ ] `main_utils.js` → `main_utils.ts`
  - [ ] `main.js` → `main.ts`
  - [ ] Update entry points (`runMainIIFE.js`)
  - [ ] Update all run scripts

- [ ] **3.9 Remove JavaScript**
  - [ ] Set `allowJs: false` in tsconfig
  - [ ] Delete all `.js` files (keep `.mjs` if needed)
  - [ ] Update all imports
  - [ ] Verify build succeeds
  - [ ] Run full test suite

**Success Criteria:**
- ✅ 100% TypeScript (no `.js` except config files)
- ✅ No `any` types (use proper types throughout)
- ✅ All tests passing
- ✅ Build succeeds without errors
- ✅ Type coverage >95%

---

### Epic 4: Code Quality & Architecture (LOW-MEDIUM PRIORITY)

**Goal:** Improve code maintainability, performance, and senior-level practices.

**Dependencies:** Epic 1 (tests), Epic 3 (TypeScript helps refactoring)

#### Tasks

- [ ] **4.1 Code Quality Audit**
  - [ ] Run linter: set up ESLint with TypeScript rules
  - [ ] Run code complexity analysis
  - [ ] Identify code smells and anti-patterns
  - [ ] Document refactoring opportunities

- [ ] **4.2 Refactor for Clarity**
  - [ ] Remove dead code (if any remains)
  - [ ] Simplify complex functions (extract smaller functions)
  - [ ] Improve variable/function naming
  - [ ] Add JSDoc/TSDoc comments for public APIs
  - [ ] Remove magic numbers (use constants)

- [ ] **4.3 Improve Error Handling**
  - [ ] Create custom error classes
  - [ ] Add retry logic with exponential backoff (API calls)
  - [ ] Improve error messages (include context)
  - [ ] Ensure all promises handle rejections

- [ ] **4.4 Performance Optimization**
  - [ ] Profile code for bottlenecks
  - [ ] Optimize file I/O (batch operations if possible)
  - [ ] Review ES bulk indexing batch sizes
  - [ ] Consider streaming large files instead of loading in memory

- [ ] **4.5 Architecture Improvements**
  - [ ] Review separation of concerns
  - [ ] Consider dependency injection for testability
  - [ ] Evaluate class vs. functional patterns
  - [ ] Document architectural decisions

**Success Criteria:**
- ✅ Code passes linting with no errors
- ✅ All functions <50 lines (or documented why not)
- ✅ No code duplication
- ✅ Clear, self-documenting code

---

### Epic 5: Maintainability & DevOps (LOW PRIORITY)

**Goal:** Set up automation, documentation, and processes for long-term maintenance.

**Dependencies:** Epic 1 (tests for CI), Epic 3 (TypeScript for better tooling)

#### Tasks

- [ ] **5.1 Release Management**
  - [x] Implement git tagging strategy (documented in this plan)
  - [ ] Create CHANGELOG.md with release history
  - [ ] Document versioning scheme (SemVer)
  - [ ] Automate changelog generation

- [ ] **5.2 Continuous Integration**
  - [ ] Set up GitHub Actions workflow
    - Run tests on PR
    - Run linter on PR
    - Build TypeScript on PR
    - Block merge if tests fail
  - [ ] Add status badges to README

- [ ] **5.3 Automated De-duplication**
  - [ ] Research de-duplication strategies for ES
  - [ ] Implement automated de-duping (replace manual Logstash)
  - [ ] Test with sample duplicate data
  - [ ] Schedule periodic de-dupe runs

- [ ] **5.4 Index Lifecycle Management**
  - [ ] Configure ILM policy for weather indices
  - [ ] Set up automatic index rollover
  - [ ] Define retention policy
  - [ ] Test rollover behavior

- [ ] **5.5 Raspberry Pi Monitoring**
  - [ ] Set up health check endpoint/script
  - [ ] Monitor cron job execution
  - [ ] Alert on failures
  - [ ] Monitor disk space, memory usage

- [ ] **5.6 Documentation**
  - [ ] Keep CLAUDE.md updated
  - [ ] Document all scripts in scripts/README.md
  - [ ] Add architecture diagrams
  - [ ] Create troubleshooting guide
  - [ ] Document deployment process

**Success Criteria:**
- ✅ CI/CD pipeline running
- ✅ Release process documented and tagged
- ✅ ILM managing index lifecycle
- ✅ Pi monitoring in place
- ✅ Documentation complete and current

---

## Progress Tracking

### Completion Status

| Epic | Priority | Status | Completion | Blocking |
|------|----------|--------|------------|----------|
| Epic 1: Testing & Dependencies | HIGH | 🟡 In Progress | ~30% | No |
| Epic 2: Logging & Observability | MEDIUM | ⚪ Not Started | 0% | No |
| Epic 3: TypeScript Migration | MEDIUM-HIGH | ⚪ Not Started | 0% | Epic 1 |
| Epic 4: Code Quality & Architecture | LOW-MEDIUM | ⚪ Not Started | 0% | Epic 1, 3 |
| Epic 5: Maintainability & DevOps | LOW | 🟡 In Progress | ~10% | Epic 1, 3 |

Legend: ⚪ Not Started | 🟡 In Progress | 🟢 Complete

### Recent Accomplishments

✅ **January 2, 2026** - Manual cleanup and todos (PR #7)
✅ **January 2, 2026** - Backfill CLI with comprehensive scripts (PR #5)
✅ **December 2025** - Dual-cluster indexing architecture
✅ **December 2025** - Factory pattern for ES client

---

## How to Use This Plan

### For Each Work Session

1. **Choose a Task:** Pick an unchecked task from an epic
2. **Create Feature Branch:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/task-name
   ```
3. **Do the Work:** Make changes, test locally
4. **Update This Plan:** Check off completed items
5. **Create PR:**
   ```bash
   git push -u origin feature/task-name
   gh pr create --repo DrMrsMoo/ambient-weather-heiligers
   ```
6. **After Merge:** Update epic completion percentage

### For Each Deployment

1. **Merge all ready PRs to `main`**
2. **Test `main` branch thoroughly:**
   ```bash
   source .env && node runMainIIFE.js
   ```
3. **(Optional) Create named release tag:**
   ```bash
   git checkout main
   git pull origin main
   git tag -a v1.1.0 -m "Description of changes"
   git push origin v1.1.0
   ```
4. **Update CHANGELOG.md**
5. **Deploy using the deployment script:**
   ```bash
   ./deploy-to-production.sh main
   # OR deploy specific tag
   ./deploy-to-production.sh v1.1.0
   ```
6. **Monitor next cron run:** `tail -f logs/cron.log` at 5:20 AM/PM

### Updating This Plan

- **Check off tasks** as you complete them
- **Update completion percentages** after significant milestones
- **Add new tasks** if you discover additional work
- **Revise priorities** as needs change
- **Document blockers** if you get stuck

---

## Risk Management

### Identified Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking production cron job | HIGH | Tag-based protection + deploy script tests before moving tag |
| ES client upgrade breaks indexing | HIGH | Test on staging cluster first, keep v7 client until ready |
| TypeScript migration introduces bugs | MEDIUM | Incremental migration with tests at each step |
| Dependency upgrades break compatibility | MEDIUM | Upgrade one at a time, test thoroughly |
| Running out of disk space | LOW | Monitor disk usage, implement ILM |
| API rate limits during development | LOW | Use local data for testing, backfill for gaps |
| Accidental deployment | LOW | Deploy script requires confirmation at two points |

### Rollback Strategy

If any deployed release causes issues:

```bash
# Move production-current tag back to last working version
git tag -f production-current <previous-tag>
git push origin production-current --force

# Example: Roll back to v1.0.0
git tag -f production-current v1.0.0
git push origin production-current --force

# Next cron run will use the rolled-back version
# Monitor: tail -f logs/cron.log
```

Tags can be moved - you can always return to a working state instantly.

---

## Notes

- **Merge to `main` freely** - production is protected by `production-current` tag
- **Working incrementally is key** - small PRs are easier to review and less risky
- **Test everything locally** before creating PR
- **Use staging cluster** for testing ES changes
- **Deployment is explicit** - use `./deploy-to-production.sh` when ready
- **Named tags are optional** - can deploy directly from `main`
- **Rollback is instant** - just move the `production-current` tag back
- **Update this plan regularly** - it's a living document

---

*Last updated: January 4, 2026*
