# ES Client v9 Plan — Corrections Log

_Companion to [es_client_v9_upgrade_plan.md](es_client_v9_upgrade_plan.md). Compiled 2026-09-25._

Claims in the plan's first draft that were **factually wrong or stale**, with what was measured
instead. Kept separate so the plan itself carries only current facts.

All repo measurements below were re-run directly against the working tree on 2026-09-25.

---

## Coverage was never broken (the plan's "Gap 2")

**Claimed:** `src/dataIndexers/` reports 0% statements / 0% branches; cause is
`coverageProvider: "v8"`. Logged as blocking Phase-0 item 0.1.

**Measured:**

```
$ npx jest --coverage --coverageReporters=text
dataIndexers   | 89.27 | 95.06 | 86.66 |
  errors.js    | 92.85 |   100 |    80 |  uncovered: 8-9
  esClient.js  |  23.8 |   100 |     0 |  uncovered: 9-40
All files      | 90.07 |  87.3 |    93 |
```

**Real cause:** `jest.config.js:37-39` sets `coverageReporters: ["json"]`, so a bare `--coverage`
writes a JSON file and **prints no table** — which reads as "no coverage."

**Knock-on effects:**

- Item 0.1 drops from a blocking prerequisite to a one-line config fix (add `"text"`).
- `errors.js` is at **100% branch coverage** — "all four predicates untested" was wrong. Only
  `isUnauthorizedError` (lines 8-9) is uncovered, so item 1.3 shrinks to one predicate.
- The genuine gap is **`esClient.js` at 23.8% statements / 0% functions** — `createEsClient` never
  executes in any test. Item 1.2 stands unchanged.

---

## Client construction site counts

**Claimed:** "9 more files, ~12 `new Client()` sites total."

**Measured:**

| Kind | Count | Where |
|---|---|---|
| `new Client()` | **11** in 9 files | `esClient.js:30` (cron path) + **10 in `scripts/`** |
| `createEsClient()` calls | **9** in 4 files | `main.js:21,22` (cron path), `src/backfill/backfill.js:106`, `scripts/archive-data.js:202,203`, `scripts/manual-index.js:126,127`, `scripts/verify-indexing.js:68,69` |

**`src/backfill/backfill.js` was absent from the plan entirely** and is a client consumer.

**The consequential part:** the production cron path has exactly **one** `new Client()` site,
`esClient.js:30`. Everything else is a hand-run operator script. The original plan conflated the two
and inflated item 3.2's scope roughly twelvefold.

---

## Exported method surface

**Claimed:** `ping`, `info`, `cat.indices`, `indices.getAlias`, `indices.create`, `indices.delete`,
`search` ×2, `bulk`, `count` — 10 methods.

**Measured** (`esClientMethods.js:348`): **7** exported — `pingCluster`,
`getAmbientWeatherAliases`, `createIndex`, `getMostRecentDoc`, `searchDocsByDateRange`,
`deleteIndex`, `bulkIndexDocuments`.

`getClusterInfo`, `getAllAmbientWeatherIndices` and `countDocuments` are defined but **absent from
`module.exports` — unreachable dead code**. Both of the first two carry latent bugs:

- `getClusterInfo` (`:14`) defaults to `esClient`, which **is not imported in that file**
- `getAllAmbientWeatherIndices` (`:48`) defaults to `require('./esClient')` — the *module object*,
  not a client

Neither bites today only because nothing can call them. → Item 1.6 should resolve by **deletion**,
not by writing tests.

Also in the surface but unlisted: `cat.aliases` (`scripts/verify-backfill.js:68`) and **17
`client.close()` sites**.

---

## `requestTimeout` — the premise was inverted

**Claimed:** the 9.0 default-timeout removal means "every one of the ~12 client sites needs an
explicit `requestTimeout`."

**Actual guidance** —
[timeout best practices](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/timeout-best-practices):
the client is "configured to not time out any HTTP request by default" because "Elasticsearch will
always eventually respond," and "reissuing a request that it has not responded to yet can cause
performance side effects."

**So setting `requestTimeout` is a deliberate deviation from vendor guidance, not compliance with
it.** Lessons §2 still justifies it on the unattended cron path — a silent hang there is this
project's documented recurring failure mode — but it should be narrow and paired with a watchdog,
not applied as blanket hardening. And it is **one line**, not twelve.

---

## Item 3.8's verification recipe was broken on the Pi

**Claimed recipe:**

```bash
git rev-parse --short HEAD
grep -m1 '"version"' node_modules/@elastic/elasticsearch/package.json
```

**The first line is unsound and already caused a false alarm** — documented in
[2026-08-20-deploy-pr24-record.md](2026-08-20-deploy-pr24-record.md), lines 148-173.
`fetchAndIndex-production.sh:168` runs `git checkout -`
after the run, and the Pi's local `main` lags `origin/main`, so post-run the tree shows stale code.

**The second line is still sound** — `node_modules` is gitignored and is *not* restored by
`git checkout -`.

**Corrected:** read the cron log, which names the SHA that actually ran.

---

## The `npm ci` caveat is inverted for this change

**Claimed:** "A source-only change leaves `package-lock.json` untouched, so the `npm ci` gate SKIPS
and the version assertion PASSES while stale code runs."

True in general (lessons §1, PR #21) — but **not for this upgrade**. A client version bump **changes
the lockfile**, so the gate **will** fire and the version assertion **will** be meaningful. Expect a
slow first Pi run and a real reinstall.

Bonus signal available: dependency-tree fingerprint. The v8 tree is 470 packages / 23 vulns; the old
v7 tree was 514 / 39. Capture the v9 number at 3.1 and assert it at 3.8 as a second independent
check.

---

## Production's write index name is stale

**Claimed** (item 2.5, stated emphatically): prod's write index is `..._2020_22_03_06`, a date-RANGE
convention — "do not fix it."

**As of 2026-08-20** prod's write index was `ambient_weather_heiligers_imperial_2026_08_09`
(1.52M docs / 691mb). `..._2020_22_03_06` is a historical **alias member**, not the write index.

The "do not fix it" instruction still holds for the *name convention* — just not about the write
index.

---

## Write-index resolution lives elsewhere

**Claimed:** "`main_utils.js` resolves the write index through the alias."

**Actual:** resolution is in **`Indexer.js:75-80`** (`getAmbientWeatherAliases` → filter
`is_write_index === true`). `main_utils.js:142,160` constructs the alias *name* for bulk writes.
The resolution logic is the load-bearing part (lessons §6), so the plan's pointer aimed at the wrong
file.

---

## "One client instance"

**Claimed** (Blocking Constraint): the Pi indexes to both clusters "with one client instance."

**Actual:** **two** instances (`main.js:21`, `main.js:22`), from one installed package version.
Doesn't change the sequencing conclusion, but the stated reason was wrong.

---

## The 9.4.0–9.4.2 memory-crash defect is unsourced

**Claimed:** 9.4.0–9.4.2 carry a known memory-crash defect (attributed to lessons §10); target
9.4.3+.

**Could not verify.** Elastic's known-issues page has **no 9.4.x section**, and the only 9.4.0–9.4.2
memory issue found is in the **connector service** — irrelevant here (no connectors).

Targeting 9.4.3+ is harmless, but **either re-cite the rationale or drop it**. → Open question Q8.

---

## Node ≥20 at 9.4+ — confirmed, with a caveat

**Claimed:** Node ≥20 required at client 9.4+. **Correct** — registry-verified, the bump lands
exactly at 9.4.0 (9.0–9.3 were `>=18`). `@elastic/transport` also declares `>=20`.

📌 Elastic's prose docs still say "minimum v18" and are **stale** — trust the package `engines`.

⚠️ But `^9.4.3` resolves to **9.5.1** today, which requires Node **`>=22`**. The caret silently
raises the Node floor mid-upgrade. → Pin `~9.4.3`; see Q7.
