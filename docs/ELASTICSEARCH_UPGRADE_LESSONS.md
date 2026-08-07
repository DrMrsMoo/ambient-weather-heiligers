# Elasticsearch Upgrade Lessons

_Written 2026-08-07, from the 8.19 → 9.4 upgrade preparation on the staging cluster._

This file exists so hard-won knowledge does not live only in a session transcript or on someone's
Desktop. Every entry cost something to learn. **The specifics are staging's; the principles apply
to any operation on either cluster.**

The detailed runbooks and research live outside the repo in
`~/Desktop/weather-tracker-upgrade-knowledge-base/` and `~/Desktop/weather-tracker-upgrades/`.
This document holds the parts that are about **this codebase and its data**.

---

## 1. A green pipeline does not prove a deploy landed

**The lesson:** a successful run proves the pipeline works. It does not prove your code is running.
To verify a deploy, assert the **installed artifact** on disk.

**What happened (2026-08-03):** the ES v7→v8 client migration was believed deployed. `cron.log`
showed `npm ci succeeded`, both clusters `status: 'success'`, fresh documents in all four write
indices, no errors. Every criterion passed.

**It had never deployed.** A silently-failing `git fetch` left a stale local tag, so `npm ci`
installed from the OLD lockfile — client **7.16.0** on disk while the tag pinned **8.19.2**. It was
a perfectly normal v7 run of v7 code, for a full day. Nothing in the log names a client version, so
success under v7 was indistinguishable from success under v8.

It surfaced only when v8-migrated scripts failed with
`illegal_argument_exception: ... unrecognized parameter: [query]` — a v7 client serializing v8-style
top-level `query` into the URL.

**Fixed in PR #19 and PR #21.** `fetchAndIndex-production.sh` now verifies two independent things:

| Check | Log line | Catches |
|---|---|---|
| Source matches deployed tag | `[deploy] verified source at <sha> matches origin production-current` | source-only deploys |
| Installed deps match lockfile | `[deploy] verified @elastic/elasticsearch@X.Y.Z matches production-current lockfile` | dependency deploys |

⚠️ **PR #19 alone was not enough.** A source-only change (e.g. `helpers.js` `toFixed(0)` →
`toFixed(3)`) leaves `package-lock.json` untouched, so the `npm ci` gate SKIPS and the version
assertion PASSES while stale code runs and reports success. **A dependency check does not cover a
source-code change.** That gap is what PR #21 closed.

⚠️ **Never change the unreachable-GitHub path to abort.** If GitHub is down the script WARNS and
keeps indexing. Weather data is still being produced and the clusters are still up; refusing to
index because a code host is unreachable loses real data to fix nothing.

---

## 2. Silent failures are the enemy in unattended paths

**The lesson:** `2>/dev/null || true` in a cron path converts a loud failure into an invisible one.

**What happened:** `git fetch --tags --quiet 2>/dev/null || true` hid both the failure and its
reason. Under cron there is no TTY and no SSH agent, so a credential-gated fetch failed **every
single run** and nobody knew.

**How to apply:**
- In unattended paths, log failures even when continuing.
- Ask "what does this look like when it fails?" If the answer is "the same as success," fix it.
- Test in a cron-REALISTIC environment, not your shell:
  ```bash
  env -i HOME="$HOME" PATH=/usr/bin:/bin GIT_TERMINAL_PROMPT=0 ./fetchAndIndex-production.sh
  ```
  `env -i` strips `SSH_AUTH_SOCK`, which is what actually reproduces cron.

📌 **The Pi's GitHub access needs no credentials.** The remote is HTTPS on a public repo, so
anonymous reads work. The two-accounts SSH problem is scoped to **pushes from the Mac**; the Pi only
ever reads.

---

## 3. `docs.deleted == docs.count` does NOT mean an index is empty

**The lesson:** `_cat` columns describe **storage**, not data semantics. Assert emptiness with
`_count`.

**What happened (2026-08-07):** `ambient_weather_heiligers_imperial_2020_06_30` was scheduled for
deletion. The evidence was this `_cat/indices` row:

```
docs.count 26187   docs.deleted 26187   store.size 48mb   pri.store.size 24mb
```

Read as: "26,187 documents, all deleted ⇒ the index is empty ⇒ safe to DELETE."

**Wrong.** `GET .../_count` returned **26,187 live documents**.

`docs.deleted` counts **Lucene tombstones** — documents marked deleted in segments but not yet
merged away. It is unrelated to `docs.count`, which is the live count. The inflated `store.size` vs
`pri.store.size` is the same tombstone artifact, not evidence of emptiness. (After reindexing, the
copy came out at 21.3mb versus the original's 48mb, with an identical document count — the reindex
compacted what the merge never had.)

**The delete was cancelled and the index reindexed instead.** 26,187 documents survived because the
runbook required proving emptiness **before** deleting, rather than after.

📌 **Write the assertion as a GATE, not a step you trust yourself to remember.** The gate is the
entire reason the data still exists.

**Sibling trap: index names do not describe their contents.** `..._imperial_2020_08_03` actually
starts 2020-06-30. Never infer a date range from an index name — measure it with an aggregation.
And always use the FULL index name: `GET imperial_2020_09_12/_search` 404s because no such index
exists, which is not evidence the index is gone.

---

## 4. An alias total is not an ingest measurement

**The lesson:** when an alias spans a cutover, its total double-counts. Break counts down **by
index** before concluding anything about data integrity.

**What happened (2026-08-07):** `compare-clusters` reported, over the same 7-day window:

```
PRODUCTION   2,232
STAGING      3,780      ⚠️ 1,548 more
```

That looks like staging has 1,548 phantom documents. It does not. By index:

```
PRODUCTION   ambient_weather_heiligers_imperial_2020_22_03_06   2,232
STAGING      ambient_weather_heiligers_imperial_2026_08_05      2,232   ← live write index
             ambient_weather_heiligers_imperial_2021_12_30_v2   1,548   ← pre-cutover write index
```

**Both clusters' live write index held exactly 2,232.** Ingest was perfectly healthy. The extra
1,548 sat in the OLD write index, still attached to the alias as a read member, whose date range
overlaps the new one.

`scripts/compare-clusters.js` now prints the per-index breakdown and explicitly reports when the
largest index on each side agrees. Without that, it would have cried wolf on production's cutover —
the exact scenario it exists to verify.

---

## 5. The "incompatible date format" deprecation is misleading

**The lesson:** when Elasticsearch flags weather indices for *"incompatible date format patterns"*
on `@timestamp` / `lastRain` / `last_rain`, the real trigger is almost always **"the index was
created before 8.0."**

**Evidence:**
- `strict_date_optional_time` is **not** an affected pattern. The locale changes affect
  `B G E O L M Q Z a c e q v z` — patterns with day/month names and AM/PM. Ours is pure ISO numeric.
- The live mappings **already matched** the composable templates exactly. Reindexing produced a
  byte-identical mapping.
- Every flagged index was pre-8.0; nothing created at 8.x was ever flagged.
- Elastic's own `details` field says it outright: *"The index was created before 8.0."*
- Managed indices (`ilm-history-*`, `.slm-history-*`, `.monitoring-alerts-7`) get the HONEST
  message — *"Old index with a compatibility version < 8.0"* — for the same underlying cause.

**Proven on 2026-08-07:** a plain reindex with **no mapping change and no script** cleared the flag
on all 7 indices. That could not work if the date format were genuinely the problem.

**How to apply:**
- ✅ **Do NOT "fix" the date formats.** They are correct. Do not add `||epoch_millis`.
- ✅ The fix is a compatibility-VERSION lift: plain reindex, or delete if the index is dead.
- ✅ Deleting clears the deprecation far more cheaply than reindexing — but only with independent
  evidence the data is redundant (see §3 for how that evidence can be misread).

---

## 6. The pipeline writes to the ALIAS, which makes cutovers cheap

**The lesson:** because `main_utils.js` resolves the write index through the alias rather than
hard-coding an index name, an index cutover is an atomic `_aliases` swap with **no pipeline pause
and no code change**.

This is load-bearing and worth preserving. Two full reindex-and-cutover operations (2026-08-05 and
2026-08-07) ran with ingest live throughout; the write indices grew mid-procedure, exactly as they
should.

⚠️ **A corollary for Phase 4 (ILM):** ILM's default rollover naming generates `-000001`-style
names, while this pipeline uses date-named indices (`..._2026_08_05`). Roughly 11 scripts glob
`ambient_weather_heiligers_imperial_*` with a trailing underscore. **Bootstrap naming has to be
decided before the first rollover**, or those scripts break silently.

---

## 7. Verification asserts the specific thing, never the aggregate

Three separate failures this year share one shape — a check that looked authoritative but measured
the wrong thing:

| The check | What it seemed to prove | What it actually proved |
|---|---|---|
| Green pipeline run | the deploy landed | the pipeline works |
| `docs.deleted == docs.count` | the index is empty | tombstones exist |
| Alias document total | ingest diverged | two indices overlap |

**How to apply — the checks that actually settle each question:**

```bash
# Which code is running? (not "did the run succeed")
git rev-parse --short HEAD
grep -m1 '"version"' node_modules/@elastic/elasticsearch/package.json
```

```
# Does this index hold live data? (not "what does _cat say")
GET <full_index_name>/_count

# Where do documents actually live? (not "what is the alias total")
GET <alias>/_search
{ "size": 0, "aggs": { "by_index": { "terms": { "field": "_index" } } } }

# Which index is the pipeline writing to? (assert the index the document NAMES)
GET <alias>/_search
{ "size": 1, "sort": [{"dateutc":"desc"}], "_source": ["date","dateutc"] }
```

📌 **Use `filter_path=index_settings.*` on `_migration/deprecations`** — narrowing it to
`index_settings.ambient_weather_heiligers_*` truncates the response and once produced a false
"cleared" reading.

---

## 8. Production is NOT a copy of staging

**The lesson:** re-measure production independently. Never assume a staging runbook's index list
applies to it.

**Evidence (from one production log line, 2026-08-07):** prod's alias still carries
`imperial_2020_12_31` + `metric_2020_12_31` (absent from staging), and
`deduped_ambient_weather_heiligers_imperial_2020_07_25` — an index recorded as *defunct* during the
composable-template migration — as a **live alias member**.

📌 **Prod's write index is named `..._2020_22_03_06`.** That is a date-RANGE convention (2020–2022),
not a malformed name. **Do not "fix" it.**

📌 Prod is on **8.17.10**; staging on **8.19.19**. Different versions, different index sets,
different deprecation lists.

---

## 9. Snapshot before anything destructive — and know what the snapshot is

> "After you start to upgrade your Elasticsearch cluster, you cannot downgrade any of its nodes.
> If you can't complete the upgrade process, you must restore from a snapshot."

Elastic Cloud maintains a managed `found-snapshots` repository (GCS-backed). Verify before
destructive work:

```
GET _snapshot
GET _snapshot/found-snapshots/_current
GET _cat/snapshots/found-snapshots?v&s=endEpoch:desc&h=id,status,start_time,duration,indices
```

Then **confirm the specific indices are covered** — a `SUCCESS` snapshot that missed them is no
rollback at all:

```
GET _snapshot/found-snapshots/<snapshot_name>?index_names=ambient_weather_heiligers_*&filter_path=snapshots.indices
```

⚠️ **Caveats worth internalising:**
- These are **SLM-policy snapshots on a retention schedule**. The rollback guarantee is
  time-bounded — if destructive work slips by days, re-verify a current snapshot first.
- Restore is a real operation with downtime, not an undo button. Do not treat a snapshot as licence
  for casual deletion.
- ⚠️ **UNRESOLVED:** whether an 8.19 snapshot can be restored to a 9.4 cluster. This determines
  whether the staging major upgrade is reversible at all. **Answer this before upgrading.**

---

## 10. Open risks carried into the 9.4 upgrade

- ⚠️ **Mixed-version estate.** The Pi indexes to BOTH clusters in ONE process with ONE 8.19.2
  client. Upgrading staging to 9.4 while production stays on 8.17.10 puts one client across two
  majors. Unresearched as of 2026-08-07.
- ⚠️ **Managed indices are the last staging blocker:** `ilm-history-1-000004`,
  `ilm-history-3-000006`, `.slm-history-1-000004`, `.slm-history-3-000006`, `.monitoring-alerts-7`.
  ⛔ **Upgrade Assistant only — never hand-delete.** The `ilm-history-*` ones are
  `is_write_index: true` despite being empty, and `superuser` is not sufficient to remediate system
  indices by hand.
- ⚠️ **Version target: newer is safer than nearer.** 9.4.0–9.4.2 carry known defects; the
  memory-crash issue resolves only at **9.4.3**. 8.19 → 9.1+ is supported directly; 9.0 is not a
  required stepping stone. Elastic Cloud only offers compliant targets, so the console's list is
  authoritative for this deployment.
- ⚠️ **Rain values stay whole numbers** in `..._2026_08_05` — it was created with
  `hourly_rain_mm: long`, which truncates on write. Full precision arrives at the next rollover.
  **Do not read integer rain as a failed deploy.**
- ⚠️ **Staging's 2020–2021 alias aggregates are inflated ~3.27×** by deliberately-retained
  duplicates in `imperial_2020_09_12_v2`. Dashboards over that era will look wrong. This is an
  accepted trade, not a bug; de-duplication is separate, deferred work.

---

## Process notes

- **Timezones:** cron entries are LOCAL, `cron.log` timestamps are UTC. Misreading this once
  produced a wrong "the run never fired" conclusion. The Pi is UTC−7 (Pacific daylight).
- **The Pi has two Node versions:** cron uses `/usr/bin/node` (v24.13.0), interactive shells use
  nvm (v23.5.0). Test Pi behaviour with the cron node, or run `./fetchAndIndex-production.sh`,
  which detects the right one itself.
- **A machine that sleeps cannot run cron reliably.** macOS cron does not replay missed jobs on
  wake; `launchd` with `StartCalendarInterval` does. The Mac was never real ingest redundancy — the
  Pi is the actual source.
- **Record answers in the runbook, not in chat.** Ownership decisions ("these are mine, safe to
  delete") are load-bearing and must survive the session.
- **Old docs go stale and become dangerous.** Two real examples: a rollback instruction pointing at
  the stale v7 commit `4c5a049` (following it recreates the bug), and a claim that
  `fetchAndIndex-production.sh` "does not run npm install" — true when written, false once the
  gated sync was added. Date your claims and correct them in place when disproven.

---

## Related Documentation

- **[CLAUDE.md](CLAUDE.md)** — project constitution, conventions, architecture
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — deployment procedures and rollback
- **[INCIDENT_2026-01-11_data_ingestion_failure.md](INCIDENT_2026-01-11_data_ingestion_failure.md)**
  — log-rotation permission incident; the original "silent cron failure" case
- Outside the repo: `~/Desktop/weather-tracker-upgrade-knowledge-base/LESSONS.md` (full upgrade
  lessons incl. cluster-level research) and `~/Desktop/weather-tracker-upgrades/` (runbooks)
