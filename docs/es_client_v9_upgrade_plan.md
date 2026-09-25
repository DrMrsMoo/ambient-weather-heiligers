# Elasticsearch JS Client 9.x Upgrade Plan

_Written 2026-09-25; revised the same day against Elastic's upgrade-planning docs.
Branch: `upgrade/es-client-v9` (off `main` at `ec8364b`)._

Upgrading `@elastic/elasticsearch` from **8.19.2** to **9.4.3+**, and the clusters from 8.x to 9.x.

> **Clusters first, client last.** But note the client bump is **not urgent** — 8.x clients are
> supported against 9.x clusters, so Phase 3 can be scheduled on its own merits once Phase 2 lands.

### Companion documents

| Doc | When to read it |
|---|---|
| [es_client_v9_cluster_upgrade_requirements.md](es_client_v9_cluster_upgrade_requirements.md) | Before Phase 2 — Elastic's rules, upgrade paths, the 7.x index blocker |
| [es_client_v9_verification_reference.md](es_client_v9_verification_reference.md) | **Whenever something looks broken** — false alarms, deploy assertions |
| [es_client_v9_pi_runtime_findings.md](es_client_v9_pi_runtime_findings.md) | Before Phase 3.7 — Node/ARM constraints and the Pi's runtime problems |
| [es_client_v9_plan_corrections.md](es_client_v9_plan_corrections.md) | If a claim here contradicts your memory of the first draft |
| [ELASTICSEARCH_UPGRADE_LESSONS.md](ELASTICSEARCH_UPGRADE_LESSONS.md) | §1, §2, §5, §6, §7, §8, §9, §10 are load-bearing here |

---

## Starting state

| Thing | Value |
|---|---|
| `@elastic/elasticsearch` installed | **8.19.2** (`^8.19.0` in package.json) |
| `@elastic/transport` | 8.10.2 |
| Target | **9.4.3+**, pinned `~9.4.3` |
| Production cluster | **8.17.10** |
| Staging cluster | **8.19.19** |
| Test baseline | 9 suites, 182 passed, 1 skipped, 2 todo (185 total) |
| Coverage (`dataIndexers`) | 89.27% stmts / 95.06% branch |

📌 **Two repos share this name.** All work is on the **DrMrsMoo** fork (`origin`, branch `main`).
The `TinaHeiligers` upstream is frozen on client v7 and is not used. Before concluding anything
about a dependency version, check which *repo* the page is for:

```bash
git remote -v
git show origin/main:package.json | grep elastic
```

---

## Blockers

Both must be resolved before Phase 2. Details in
[es_client_v9_cluster_upgrade_requirements.md](es_client_v9_cluster_upgrade_requirements.md).

**⛔ 1. Production needs two hops: 8.17.10 → 8.19.x → 9.4.3+.**
A 9.1+ target requires starting from 8.19.x. Prod's change window roughly doubles. Staging (8.19.19)
already qualifies.

**⛔ 2. Indices created in 7.x block the 9.x upgrade outright — unmeasured.**
Nodes fail to start; Cloud refuses the upgrade. Data starts in 2020 and nothing in the repo records
any index's creation version. Lessons §5 hit this exact gate at the 8.0 boundary during v7→v8.

---

## Client usage surface

| File | Role |
|---|---|
| `src/dataIndexers/esClient.js:30` | **the sole `new Client()` on the cron path** |
| `src/dataIndexers/esClientMethods.js` | 7 exported methods (`:348`) |
| `src/dataIndexers/errors.js` | reads `error.meta.body.status`; `instanceof errors.ResponseError` |
| `src/dataIndexers/Indexer.js:75-80` | **write-index resolution** — load-bearing (lessons §6) |

**Construction sites:** 11 `new Client()` in 9 files (10 of them in `scripts/`), plus 9
`createEsClient()` calls in 4 files — `main.js:21,22`, `src/backfill/backfill.js:106`,
`scripts/archive-data.js:202,203`, `scripts/manual-index.js:126,127`,
`scripts/verify-indexing.js:68,69`.

📌 Only `esClient.js:30` is on the production cron path. The rest are hand-run operator scripts.

⚠️ `getClusterInfo`, `getAllAmbientWeatherIndices` and `countDocuments` are **unreachable dead code**
(absent from `module.exports`), and the first two have broken default arguments. Delete them (1.6).

---

## Breaking changes that affect this code

**1. The default 30-second request timeout is removed.** A hung request in cron now blocks ingest
with no error — the silent-failure shape lessons §2 exists to prevent.
⚠️ Elastic **recommends against** re-adding a timeout. Setting one is a deliberate, narrow deviation
justified by lessons §2 — see 3.2 and Q5.

**2. Parameter placement changed.** 8.x routed all unrecognized params to the querystring; 9.x puts
them in the JSON body when the API accepts one. Audit targets: `getMostRecentDoc`'s comma-joined
sort string, `deleteIndex`'s `timeout`/`master_timeout`/`ignore_unavailable`/`allow_no_indices`/
`expand_wildcards`, and `bulk`/`search`/`count` routing.

**3. `estypesWithBody` / `typesWithBodyKey` removed.** This codebase is JavaScript, so the type
removals cost nothing. Runtime param routing (#2) is the part that matters.

**4. Node ≥20 required at 9.4+.** Verified. ⚠️ `^9.4.3` resolves to 9.5.1, which needs Node ≥22 —
pin `~9.4.3`. The Pi's runtime resolution has separate problems; see
[es_client_v9_pi_runtime_findings.md](es_client_v9_pi_runtime_findings.md).

**5. Error shapes — unconfirmed.** `errors.js` depends on `error.meta.body.status` and message-string
matching, verified on 8.19.2 but **not** on 9.x. Phase 3.4.

---

## Test coverage gaps

**⚠️ Gap 1 — `@elastic/elasticsearch-mock` is installed but NO test uses it.** Every test hand-rolls
`jest.fn()` mocks, so they assert *our assumptions* about response shapes, not the client's actual
behaviour. A 9.x response-shape change would pass the suite and fail in production. **This is the
most important gap**, and it must close *before* the version changes so tests pin real 8.19 behaviour.

**⚠️ Gap 2 — `esClient.js` is at 23.8% statements / 0% functions.** `createEsClient` never executes
in any test.

Smaller: `errors.js` is at 100% branch coverage except `isUnauthorizedError` (lines 8-9); the
script-level clients have no tests.

---

## Todo

### Phase 0 — Prerequisites

- [ ] **0.1** Add `"text"` to `coverageReporters` (`jest.config.js:37`) — one line
- [ ] **0.2** ⛔ **Audit index creation versions on BOTH clusters.** Highest-value check in the plan;
      run it first. Commands and the `filter_path` trap: [verification reference](es_client_v9_verification_reference.md)
- [ ] **0.3** ⛔ For each pre-8.0 index, choose reindex / archive / delete. **Archive has no writes
      and no Get API** — anything the cron writes to must be reindexed (Q2)
- [ ] **0.4** Verify a current snapshot actually covers `ambient_weather_heiligers_*` — a `SUCCESS`
      that missed them is no rollback (lessons §9). SLM retention is time-bounded; re-verify if work slips
- [ ] **0.5** Review breaking changes across **all** of 9.0 → 9.4; run snapshot-repository analysis

### Phase 1 — Harden tests against the current client

- [ ] **1.1** Replace hand-rolled mocks with `@elastic/elasticsearch-mock` in
      `esClientMethods.test.js` (Gap 1)
- [ ] **1.2** Add tests for `esClient.js`: construction, env-prefix resolution (`ES` vs `STAGING`),
      each `assert.ok` failure
- [ ] **1.3** Cover `isUnauthorizedError` (`errors.js:8-9`) and the `error.meta.body.status` path
- [ ] **1.4** Add a **timeout-behaviour test** — the 9.0 regression that is otherwise invisible
- [ ] **1.5** Smoke coverage for the script-level clients and `src/backfill/backfill.js:106`
- [ ] **1.6** Delete `getClusterInfo`, `getAllAmbientWeatherIndices`, `countDocuments`
- [ ] **1.7** ✅ **Green suite on 8.19.2 — the reference point.** Everything after is measured against it

### Phase 2 — Cluster upgrades

⚠️ **Declare a downtime window and pause the Pi cron.** Cloud upgrades ES and Kibana simultaneously;
single-zone deployments can incur real downtime (Q4).
⚠️ **Do not deploy anything during a cluster window** — the deploy gate performs a live dual-cluster
write (see Phase 3).

- [ ] **2.1** Clear staging's managed-index blockers: `ilm-history-1-000004`, `ilm-history-3-000006`,
      `.slm-history-1-000004`, `.slm-history-3-000006`, `.monitoring-alerts-7`.
      ⛔ **Upgrade Assistant only — never hand-delete.** They are `is_write_index: true` despite being
      empty, and `superuser` is not sufficient to remediate system indices by hand (lessons §10)
- [ ] **2.2** Upgrade **staging** 8.19.19 → **9.4.3+** (single hop)
- [ ] **2.3** Verify staging with §7's specific assertions — per-index `_count`, the `by_index` terms
      agg, and the index the newest document NAMES. **Check the [verification reference](es_client_v9_verification_reference.md) before reading any result as failure**
- [ ] **2.4** ⛔ **Prod hop 1: 8.17.10 → 8.19.latest.** Snapshot first; verify ingest after
- [ ] **2.5** ⛔ **Run the Upgrade Assistant on PRODUCTION** from 8.19.x, before hop 2. Clear all
      criticals; review deprecation logs
- [ ] **2.6** **Prod hop 2: 8.19.x → 9.4.3+.** Snapshot first
- [ ] **2.7** **Re-measure production independently** — prod is NOT a copy of staging (lessons §8).
      It carries `imperial_2020_12_31`, `metric_2020_12_31`, and
      `deduped_ambient_weather_heiligers_imperial_2020_07_25` as a live alias member

📌 On targeting 9.4.3+: the "9.4.0–9.4.2 memory-crash defect" rationale is **unsourced** (Q8). The
floor is harmless either way.

### Phase 3 — The client upgrade

📌 **Not urgent.** 8.x clients are supported against 9.x clusters, so this decouples from Phase 2.

⛔ **The deploy gate is itself a client call.** `deploy-to-production.sh:42` runs
`git checkout "$TARGET_REF"; source .env; node runMainIIFE.js` before moving the tag — a **live
dual-cluster write**. Deploying the 9.x bump while prod is on 8.x means the gate *is* the
incompatible-client failure. Both clusters must be on 9.x before the bump is **deployed**, not
merely before it runs.

- [ ] **3.1** Bump to **`~9.4.3`** (not `^`); run the Phase-1 suite; fix fallout. Capture the
      dependency-tree fingerprint for 3.8
- [ ] **3.2** Add `requestTimeout` to **`esClient.js:30`** — one line, covers all production ingest.
      Pair it with a cron-level watchdog. Leave operator scripts untimed (Q5)
- [ ] **3.3** Audit param placement for `search` / `indices.delete` / `bulk` / `count` (#2).
      ⚠️ Also resolve: `searchDocsByDateRange` (`esClientMethods.js:248`) uses a raw-array `sort` —
      the exact form `getMostRecentDoc`'s comment claims v8 rejects. One of the two is wrong
- [ ] **3.4** Re-verify `errors.js` against real 9.x errors: is `meta.body.status` still populated,
      and do the `[index_not_found_exception` / `[resource_already_exists_exception` strings match?
- [ ] **3.5** Confirm `{ meta: true }` and `{ ignore: [400] }` remain valid `TransportRequestOptions`
- [ ] **3.6** Update `// v8:` comments to `// v9:` wherever semantics changed
- [ ] **3.7** Fix the Pi's Node resolution — one runtime, a version assertion, a `NODE_BIN` guard,
      `.npmrc` with `engine-strict=true`, and the stale pins. See
      [pi runtime findings](es_client_v9_pi_runtime_findings.md) (Q6)
- [ ] **3.8** ✅ **Verify by asserting the installed artifact, not a green run** (lessons §1).
      ⛔ Do **not** use `git rev-parse` on the Pi — it is known-broken there. Use the cron-log recipe
      in the [verification reference](es_client_v9_verification_reference.md)

### Phase 4 — Close out

- [ ] **4.1** Update `ELASTICSEARCH_UPGRADE_LESSONS.md` with 9.x findings; resolve the §10 open risks
- [x] **4.2** ~~Stale-v7-branch cleanup~~ — done 2026-09-25, see below
- [ ] **4.3** Decide the fate of `deployment` and `modernization-plan` (see below)
- [ ] **4.4** Track or fold into `docs/` the untracked `2026-08-20-deploy-pr24-record.md` and
      `2026-08-20-deploy-pr24-to-pi.md` — load-bearing, one `git clean` from gone
- [ ] **4.5** Fix the two dead launchd jobs (exit 127 on `/usr/local/bin/node`): monthly data
      archiving and weekly log archiving are **silently failing today**
- [ ] **4.6** Correct `docs/CLAUDE.md`'s stale dev-dependency versions (jest 27.0.4, mock 0.3.1 are
      upstream's) and its client version note

---

## Open questions

**Q1 gates the most — answer it first.**

| # | Question | Recommendation |
|---|---|---|
| **Q1** | ⛔ Are any indices pre-8.0/7.x-created? | Run the audit (0.2). Lessons §5 makes a hit likely |
| **Q2** | If so: archive or reindex? | Archive closed historical indices; **reindex** anything the cron or `deduped_*` tooling still writes to. Needs: what still writes to the 2020-era indices? |
| **Q3** | Prod's two hops — one window or two? | **Two**, with independent verification each |
| **Q4** | Is prod single-zone? | Check zone count. If single, pause the Pi cron across the window |
| **Q5** | Accept the `requestTimeout` deviation? | **Yes, narrowly** — cron path only, plus a watchdog |
| **Q6** | Which Node should cron use? | Node 24 LTS everywhere, with a version assertion. Settle current state with the `ssh` command in the [pi findings](es_client_v9_pi_runtime_findings.md) |
| **Q7** | Pin `~9.4.3` or accept Node 22? | **`~9.4.3`** now; Node 22 is separate work |
| **Q8** | Source for the 9.4.0–9.4.2 crash claim? | Cite it, or drop the rationale |
| **Q9** | Refactor 10 script `new Client()` sites to `createEsClient()`? | **Yes, before Phase 3** — mechanical, collapses 11 sites to 1. ⚠️ Touches 8 untested files |

---

## Risks

| Risk | Source | Status |
|---|---|---|
| Pre-8.0 indices block the upgrade | Elastic; lessons §5 | ⛔ **unmeasured — item 0.2** |
| Prod needs two hops | Elastic upgrade path | ⛔ **doubles prod's window** |
| Deploy gate does a live dual-cluster write | `deploy-to-production.sh:42` | ⛔ **Phase 3 sequencing** |
| Snapshot restore is forward-only | Elastic | ⚠️ no in-place downgrade; recovery = new 8.19 cluster |
| Cron's Node runtime is reached by accident | `fetchAndIndex-production.sh:16-24` | ⚠️ silent major shift possible — 3.7 |
| `^9.4.3` silently resolves to 9.5.1 (Node ≥22) | npm registry | pin `~9.4.3` — 3.1 |
| Tests assert assumptions, not client behaviour | Gap 1 | Phase 1.1 |
| Default timeout removal → silent cron hang | 9.0 breaking change | 3.2 — one line, a deliberate deviation |
| ILM rollover naming vs. date-named indices | lessons §6 | out of scope; **decide before first rollover** |

---

## Branch cleanup (2026-09-25)

`git fetch --prune` revealed `origin` had only **6 branches**, not the 18 local refs suggested.

**Deleted (8 local, all fully merged into `origin/main`):** `INC_2026-01-11`,
`docs/elasticsearch-upgrade-lessons`, `docs/update-incident-documentation`,
`feat/compare-clusters-date-range`, `feature/es-client-v8-upgrade`,
`fix/deploy-gate-silent-fetch-failure`, `harden/deploy-guard-source-check`,
`phase3/composable-index-templates`.

**Left pending a decision** (both hold only unmerged documentation):

- **`deployment`** — its `fetchAndIndex-production.sh` is from 2026-01-08 vs `main`'s 2026-08-06.
  Merging would **remove 148 lines** of PR #19/#21 deploy hardening. ⚠️ **It is old, not ahead. Do
  not merge it.** Verify its cron-fix commit (`22a56bf`) is captured in `DEPLOYMENT.md`, then delete
- **`modernization-plan`** — 1 ahead, 94 behind, last touched 2025-12-30. Overlaps
  `docs/REFACTOR_PLAN.md`; reconcile or delete

**Safe to delete on the remote:** `origin/INC_2026-01-11`,
`origin/feature/cluster-based-fetch-dates`, `origin/hotfix_data_not_indexing`,
`origin/phase3/composable-index-templates`.

---

## Sources

- [Plan your upgrade](https://www.elastic.co/docs/deploy-manage/upgrade/plan-upgrade) ·
  [Prepare to upgrade](https://www.elastic.co/docs/deploy-manage/upgrade/prepare-to-upgrade)
- [JS client breaking changes](https://www.elastic.co/docs/release-notes/elasticsearch/clients/javascript/breaking-changes) ·
  [installation & compatibility](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/installation)
- [REST API compatibility](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/compatibility) ·
  [timeout best practices](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/timeout-best-practices)
- Full source list in the companion docs.
