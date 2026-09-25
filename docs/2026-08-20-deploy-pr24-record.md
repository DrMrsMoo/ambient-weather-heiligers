# Deploy record — PR #24 (indexing hotfix) → production — 2026-08-20

Authoritative post-deploy record. Supersedes
[2026-08-20-deploy-pr24-to-pi.md](2026-08-20-deploy-pr24-to-pi.md), whose
**Step 3 verification recipe was wrong** — see *Caveats & gotchas*.

- Status: **deployed and verified**
- `production-current`: `69202db` (PR #23) → `a9336e821b21df8e12df18384bbe0d3005c79519`
- Pi run completed: `[runMainIIFE] [RESULT]: Done at 2026-08-21T00:44:48Z`

---

## What shipped

PR #24, branch `hotfix_data_not_indexing`, authored by a collaborator (merge commit `a9336e8`).
Repo: `/Users/tina/Projects/ambient-weather-heiligers` (GitHub `DrMrsMoo/ambient-weather-heiligers`, public).

Commits:

- `e38aee0` — Fix `this.recentDataFileNames.length()` TypeError
- `4890ede` — Fix `maxNumRecordsCanGet is undefined` bug

Files changed:

- `/Users/tina/Projects/ambient-weather-heiligers/src/dataFetchers/FetchRawData.js` — 6 lines
- `/Users/tina/Projects/ambient-weather-heiligers/src/dataFetchers/fetchRawData.test.js` — +51
- `/Users/tina/Projects/ambient-weather-heiligers/package-lock.json` — +3

### The three source fixes

All in `/Users/tina/Projects/ambient-weather-heiligers/src/dataFetchers/FetchRawData.js`:

1. **Line ~81, `clearFileNames()`** — was `this.recentDataFileNames.length()`.
   - `.length` called as a function on the public getter → `TypeError: ... is not a function`
   - now `this.recentDataFileNames.length`
2. **Line ~258, multi-day batch branch** — was `this.numberOfRecords = AW_CONSTANTS.maxNumRecordsCanGet`.
   - that key does not exist in `AW_CONSTANTS` (only `dataInterval: 5`, `maxNumRecords: 288`)
   - so every batched multi-day fetch set `numberOfRecords = undefined`
   - now `AW_CONSTANTS.maxNumRecords`
3. **Line ~289, single-day branch condition** — hardcoded literal `288` replaced with
   `AW_CONSTANTS.maxNumRecords`.

Also in this PR:

- `engines: { node: ">=20" }` added to `/Users/tina/Projects/ambient-weather-heiligers/package.json`
  and `/Users/tina/Projects/ambient-weather-heiligers/package-lock.json`
- advisory only — does **not** fail `npm ci`
- Pi's Node v24.13.0 satisfies it

---

## Pre-deploy checks

- `npm test` at `a9336e8` — 9 suites, **182 passed**, 1 skipped, 2 todo
  - includes new regression test: `uses maxNumRecords (288) for batched API calls, not undefined`
- `maxNumRecordsCanGet` absent from all of `/Users/tina/Projects/ambient-weather-heiligers/src/` at `a9336e8`
  - only surviving mention is a descriptive comment in
    `/Users/tina/Projects/ambient-weather-heiligers/src/dataFetchers/fetchRawData.test.js`
- Pi pre-state, healthy at `69202db`:
  - `@elastic/elasticsearch` 8.19.2 on disk, matches lockfile pin
  - `origin` = HTTPS (`https://github.com/DrMrsMoo/ambient-weather-heiligers.git`) → unattended cron fetch needs no credential
  - Node v24.13.0
- **Tina's local `main` was 3 commits behind `origin/main`; fast-forwarded to `a9336e8` BEFORE running the deploy script.**
  - this mattered: `/Users/tina/Projects/ambient-weather-heiligers/deploy-to-production.sh` ends with `git checkout main`
  - a stale local `main` would have left the wrong code checked out afterwards

---

## How it was deployed

Tina ran, interactively:

```
/Users/tina/Projects/ambient-weather-heiligers/deploy-to-production.sh main
```

Run by Tina, not the agent — it needs TTY prompts plus 1Password approval for the tag push.

### Mechanism: the deploy is a TAG MOVE

- `/Users/tina/Projects/ambient-weather-heiligers/deploy-to-production.sh` does **not** copy files to the Pi
- it force-moves the `production-current` tag to the target ref and pushes it:
  `git tag -f production-current <ref>` then `git push origin production-current --force`
- the Pi's cron script checks out that tag on its next run
- so: moving the tag does **not** by itself update the Pi

Script flow:

1. prints commits in `production-current..main` → confirm `yes`
2. `git checkout main`, `source .env`, then **a LIVE `node runMainIIFE.js`** against the real clusters
   - this writes real data; it is the gate, not a dry run
3. asks whether the test run succeeded → Tina answered `yes`
   - a `no` here rolls back to `main` and exits without tagging
4. force-moves and pushes `production-current`
5. ends with `git checkout main`

Confirmed after the push:

- remote `refs/tags/production-current` = `a9336e821b21df8e12df18384bbe0d3005c79519`

### Triggering the Pi

Cron on the Pi is `20 11,23 * * *` **local**; Pi timezone is **MST**; `cron.log` timestamps are **UTC**.
Do not misread that offset as a missed run.

Rather than wait ~5.5h for the 23:20 local run, the run was triggered manually:

```
ssh raspberrypi-tina "/home/pi/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh"
```

- SSH host alias is `raspberrypi-tina` (HostName 192.168.1.159) — **not** `pi`
- repo on the Pi lives at `/home/pi/Projects/ambient-weather-heiligers` — **not** `~/ambient-weather-heiligers`

---

## Verified outcome

Evidence from `/home/pi/Projects/ambient-weather-heiligers/logs/cron.log`:

```
[deploy] verified source at a9336e821b21df8e12df18384bbe0d3005c79519 matches origin production-current
[deploy] package-lock.json changed (or first run) — running npm ci
added 470 packages, and audited 471 packages in 16s
23 vulnerabilities (10 moderate, 8 high, 5 critical)
[deploy] npm ci succeeded
[deploy] verified @elastic/elasticsearch@8.19.2 matches production-current lockfile
```

Then both clusters reported `status: 'success'` and
`[runMainIIFE] [RESULT]: Done at 2026-08-21T00:44:48Z`.

Other checks:

- **Dependency-tree fingerprint: 470 packages / 23 vulnerabilities = the known-good v8 tree.**
  - the bad v7 tree from the Phase 0 incident was **514 packages / 39 vulnerabilities**
  - record this pair; it's a fast eyeball check on any future `npm ci` line
- zero `TypeError`, `is not a function`, or `undefined` matches in the last 250 log lines
- `npm ci` **did** re-run this deploy because `package-lock.json` changed
  - contrast with the source-only 2026-08-06 deploy, where the install gate skipped
  - the gate keys on the lockfile's git blob hash, stamped at
    `/home/pi/Projects/ambient-weather-heiligers/node_modules/.deploy-lock-hash`

---

## Caveats & gotchas

### 1. Grepping the Pi's working tree after a run is UNSOUND — it produced a false alarm

What was seen after the run, on the Pi:

- `git rev-parse --short HEAD` → `69202db`
- both buggy lines still present in `/home/pi/Projects/ambient-weather-heiligers/src/dataFetchers/FetchRawData.js`

Looked like the deploy had failed. **It had not.**

Why:

- `/home/pi/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh` checks out
  `production-current`, runs, then **restores the checkout** with `git checkout -` when finished
- the restore target is the Pi's local `main`
- the Pi's local `main` is **3 commits behind `origin/main`**, still at `69202db`
- so after *every successful run* the working tree sits on OLD code

The reflog on the Pi proves the real sequence:

```
HEAD@{1}: checkout: moving from main to production-current      → a9336e8   (this is what actually ran)
HEAD@{0}: checkout: moving from a9336e821b21... to main         → 69202db   (post-run restore)
```

Takeaway: **a post-run grep of the working tree tells you what `main` points at on the Pi, not what
was deployed.** It will look stale no matter how successful the deploy was.

### 2. This does NOT weaken "verify by artifact, not by a green pipeline"

- the standing rule is still right
- but **"the artifact" here means the blob at the deployed SHA**, not the working tree
- the working tree is scratch space that the run script rewinds; it is not the deployed artifact
- verify the SHA and the blob at that SHA — see the recipe below

### 3. The live test-run gate does not prove the multi-day fix

- the gate in `/Users/tina/Projects/ambient-weather-heiligers/deploy-to-production.sh` exercises
  `getDataForDateRanges`
- which branch it takes depends on how far behind the cluster's latest date is
- on a healthy Pi, `estNumberOfBatches < 1` → it takes the **single-day** path
- so a green test run does **not** by itself exercise the batched multi-day `maxNumRecords` fix
- the unit test (`uses maxNumRecords (288) for batched API calls, not undefined`) is the stronger
  evidence for that specific fix

### 4. Latent trap: the Pi's local `main` is permanently behind

- this is the root cause of the misleading post-run greps
- possible cleanups (**not performed — flagged only**):
  - fast-forward the Pi's local `main` to `origin/main`, or
  - change `/home/pi/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh` to restore to a
    detached SHA instead of `git checkout -`
- either way the working tree stops silently advertising stale code

---

## Correct verification recipe for next time

Replaces "Step 3" in [2026-08-20-deploy-pr24-to-pi.md](2026-08-20-deploy-pr24-to-pi.md).

**1. Confirm the tag moved (Mac):**

```
git -C /Users/tina/Projects/ambient-weather-heiligers ls-remote origin refs/tags/production-current
```

**2. Read the `[deploy]` log lines — authoritative, names the exact SHA that ran:**

```
ssh raspberrypi-tina "grep '\[deploy\]' /home/pi/Projects/ambient-weather-heiligers/logs/cron.log | tail -20"
```

- expect `verified source at <SHA> matches origin production-current`
- expect `verified @elastic/elasticsearch@<version> matches production-current lockfile`

**3. Read the reflog — shows the actual checkout sequence, including the post-run restore:**

```
ssh raspberrypi-tina "git -C /home/pi/Projects/ambient-weather-heiligers reflog -5"
```

**4. Inspect the deployed BLOB by SHA — independent of what is currently checked out:**

```
ssh raspberrypi-tina "git -C /home/pi/Projects/ambient-weather-heiligers show a9336e8:src/dataFetchers/FetchRawData.js | grep -n 'maxNumRecords'"
```

**5. If you want a live artifact check, do it DURING a run, not after.**

Do **not** do this:

- ❌ `git rev-parse --short HEAD` on the Pi after a run
- ❌ `grep` the Pi's working-tree `src/` after a run

Both report the Pi's stale local `main`, not the deploy.

---

## Rollback

From `/Users/tina/Projects/ambient-weather-heiligers`:

```
git tag -f production-current 69202db && git push origin production-current --force
```

- `69202db` = PR #23, the previous production commit
- the Pi picks it up on its next cron run (`20 11,23 * * *` local / MST); force a run over SSH if needed
- ⚠️ **never roll back to `4c5a049`** — that is the stale v7 commit from the earlier Phase 0 incident
  (514 packages / 39 vulnerabilities tree)

---

# Follow-up deploy — PRs #25 + #26 (deploy-script fixes) — 2026-08-20

- Status: **deployed, tag verified**
- `production-current`: `a9336e8` (PR #24) → `ec8364b595f6eab4b353fe3fa5bcba47152bebc3`
- Deployed as an explicit SHA: `./deploy-to-production.sh ec8364b`

## What shipped — script-only, NO runtime change

```
ec8364b Merge pull request #26 from DrMrsMoo/fix_tagging
f325dd0 Fix tagging to force local updates
acfd8ad Merge pull request #25 from DrMrsMoo/fix_deploy
5de8693 Fix hardcoded paths
```

`a9336e8..ec8364b` touches **exactly one file**:
`/Users/tina/Projects/ambient-weather-heiligers/deploy-to-production.sh` (3 insertions, 3 deletions).

1. `REPO_DIR` — hardcoded `/Users/tina/Projects/...` → `"$(cd "$(dirname "$0")" && pwd)"`
2. `git fetch --all --tags` → `git fetch --all --tags --force` (local tag now follows a force-moved remote tag)
3. gate runner — hardcoded `/Users/tina/.nvm/versions/node/v23.5.0/bin/node` → bare `node` from PATH

### Consequence: nothing to verify on the Pi

- `deploy-to-production.sh` runs on the **Mac only**; the Pi never executes it
- `src/` is byte-identical between `a9336e8` and `ec8364b`
- `package-lock.json` unchanged → the Pi's `npm ci` gate **skips**, ES assertion passes identically
- so a green Pi run after this deploy confirms **nothing new about this deploy**

**The tag move IS the deliverable here.** That is the whole assertion. Do not go looking for
Pi-side evidence; there is none to find, and its absence is not a failure.

## Pre-deploy checks

- `npm test` at `ec8364b` — 9 suites, **182 passed**, 1 skipped, 2 todo
- local `main` == `origin/main` == `ec8364b`, working tree clean
  - verified **before** running, because the script ends with `git checkout main` (line 64)
  - this is the PR #24 trap (stale local `main` → wrong code left checked out); it did not recur

## Verified outcome

```
git ls-remote origin refs/tags/production-current
→ ec8364b595f6eab4b353fe3fa5bcba47152bebc3
```

- local tag matches remote exactly
- post-deploy working tree: on `main` at `ec8364b`, clean
- reflog confirms the sequence: `main` → `ec8364b` (gate run) → back to `main`

**This deploy was the first run of the fixed script** — its success is the evidence that the
#25/#26 fixes work.

## Deploying a tag vs a branch — clarified

`production-current` is the deploy tag; it is what the Pi checks out. The script's argument is
the **source ref the tag is moved to** (`git tag -f production-current "$TARGET_REF"`, line 55).

- `TARGET_REF="${1:-main}"` — passing `main` resolves it to a commit *at run time*
- that is only safe if local `main` == `origin/main`; otherwise you tag whatever local points at
- **prefer an explicit SHA** (`./deploy-to-production.sh ec8364b`) — no branch-pointer dependency
- this repo has no `v*` release tags; commit SHAs are the unit of deployment

## Findings from the cron audit (2026-08-20) — NOT fixed, flagged only

Investigated a report that "staging is updated but prod is not". **The premise did not hold.**

### Prod was never behind

Queried both clusters directly — both latest imperial doc at `2026-08-21T00:40:00.000Z`,
identical. The Pi's last runs logged `PRODUCTION Result: { status: 'success' }` alongside staging.

Re-checked with per-day counts after a Kibana chart appeared to show prod flatlining on Aug 9.
**Prod has documents for every day Aug 10–21**, matching staging closely (prod actually holds
*more* Aug 5–9 data than staging). Latest-doc alone was weak evidence; the per-day histogram is
the check worth repeating:

```
curl -s -u "$ES_USERNAME:$ES_PASSWORD" "$ES_HOSTS/ambient_weather_heiligers_imperial*/_search" \
  -H 'Content-Type: application/json' -d '{"size":0,
  "query":{"range":{"dateutc":{"gte":<epoch_ms>}}},
  "aggs":{"per_day":{"date_histogram":{"field":"dateutc","calendar_interval":"day"}}}}'
```

⚠️ `dateutc` is mapped **`long`** (epoch millis), not `date` — ES date math (`now-22d/d`) throws
`query_shard_exception`. Pass raw epoch millis.

The stale impression is the *Caveats §1* trap above: the Pi rewinds to its local `main`
(`69202db`) after every successful run, so any post-run inspection looks un-deployed.

### The Aug 9 chart gap was a DATA VIEW problem, not a data problem — RESOLVED

Cause identified by Tina: the Kibana **data view was pointing at the wrong index**.

**Fix applied (2026-08-20):** both prod data views repointed from a concrete index to the aliases:

| Data view | Index pattern | Time field |
|---|---|---|
| prod imperial | `all-ambient-weather-heiligers-imperial` | `date` |
| prod metric   | `all-ambient-weather-heiligers-metric`   | `date` |

The time field was **already `date`**, so the index pattern could be edited in place in
**Stack Management → Kibana → Data Views** — no delete-and-recreate, view IDs preserved,
dashboards kept working.

⚠️ **In Kibana 8.19 the index pattern IS editable on an existing data view, but the time field
is NOT.** Changing the time field via the UI requires deleting and recreating the view (losing
field formatters and breaking saved-object references). The only in-place route for the time
field is the API, which can change both at once and keeps the ID:

```
POST <KIBANA_URL>/api/data_views/data_view/<VIEW_ID>
  -H 'kbn-xsrf: true' -H 'Content-Type: application/json'
  -d '{"data_view":{"title":"<alias>","timeFieldName":"date"},"refresh_fields":true}'
```

Verified after the change — both aliases return continuous daily counts Aug 1–21 when queried
on `date`, the same path Kibana uses.

**Why the alias is the right target, not the write index:** it spans the historical `_v2` /
`2020_22_03_06` indices as well as the current write index, so the view covers full history —
and it keeps working when the write index next rolls, which is the failure that caused this.

### "4 write indexes" in the cron log is NORMAL — it is 2 clusters × 2

Each run calls `getActiveWriteIndices` against prod **and** staging, so the log shows four
across two `[IndexData]` blocks. Per cluster there are exactly two, as intended:

| Cluster | imperial write index | metric write index |
|---|---|---|
| prod    | `..._imperial_2026_08_09` | `..._metric_2026_08_09` |
| staging | `..._imperial_2026_08_05` | `..._metric_2026_08_05` |

Alias names are **identical on both clusters**, so the data view pattern is the same either side.

Supporting cluster facts:

- prod has a single write index `ambient_weather_heiligers_imperial_2026_08_09`
  (`is_write_index: true`, 1.52M docs / 691mb)
- there is **no data stream and no rollover** — the `2026_08_09` suffix is a static label from the
  index's creation date, and everything written since lands in it indefinitely
- so a recent doc dated Aug 21 lives in an index *named* `2026_08_09`; index name says nothing
  about the dates inside it

**Do not read the index-name date as a data-freshness signal.** It is a creation label.

### Separate find: `@timestamp` has been unwritten since 2026-01-05

- 1,065,257 imperial docs **have** `@timestamp`; 2,221,987 **do not**
- newest `@timestamp` anywhere: `2026-01-05T01:00:07.044Z`
- current docs carry only `date` (mapped `date`) and `dateutc` (mapped `long`)
- `@timestamp` is still in the mapping, so it looks available when building a viz
- **any saved visualization using `@timestamp` as its time field has been silently empty since
  January** — a date histogram drops docs with no value in the time field
- NOT the cause of the Aug 9 gap (wrong date — that would have flatlined in January)
- unexamined: whether dropping `@timestamp` was deliberate

`/Users/tina/Projects/ambient-weather-heiligers/main.js` indexes both clusters symmetrically in
one `Promise.allSettled` — there is no code path that updates staging but skips prod. A genuine
prod-only gap would have to be a runtime error on prod's leg, visible in the log.

### Real problems found (open)

1. **Two launchd jobs dead, exit 127** — `com.heiligers.ambient-weather-archive-data` and
   `-archive-logs` both hardcode `/usr/local/bin/node`, **which does not exist on this Mac**
   (node is at `~/.nvm/versions/node/v23.5.0/bin/node`, also `/opt/homebrew/bin/node`).
   Monthly data archiving and weekly log archiving have been silently failing.
   The Pi's crontab has entries for the same archive tasks, so coverage may be intact via the Pi.
2. **Mac and Pi both run the indexer**, ~1h apart — Pi `20 11,23` MST = 18:20/06:20 UTC;
   Mac `20 5,17` Pacific = 12:20/00:20 UTC. The cluster-date logic in `main.js` is what keeps
   this from duplicating; it is holding, but it is redundant work and double failure surface.
   **Now visible in the data:** prod per-day counts run ~576/day when both machines index, but
   drop to exactly **288** on Aug 10–12 (and ~356 on Aug 13–15). 288 = `AW_CONSTANTS.maxNumRecords`
   = one full day at 5-min intervals from a *single* source. So the dip is inconsistent overlap
   between the two machines, **not data loss** — no gap in coverage, just uneven duplication.
3. **Mac schedules the indexer twice** — both `com.heiligers.ambient-weather.plist`
   (5:20/17:20) and a crontab line (`20 5,17`) invoke the same script.
4. **`com.heiligers.ambient-weather.plist` still pins `v23.5.0` in its PATH** — the same
   hardcoded-path bug class that #25 just fixed in `deploy-to-production.sh`.

## Session summary — 2026-08-20

| Item | Status |
|---|---|
| Deploy `a9336e8` → `ec8364b` | ✅ done, tag verified both local and remote |
| Prod indexing | ✅ working — continuous daily data Aug 10–21 |
| Kibana prod data views → aliases | ✅ repointed, verified on `date` |
| "4 write indexes" concern | ✅ not a bug — 2 clusters × 2 |
| 4 cron/scheduling issues | ⬜ open — filed as a GitHub issue |

**Note on how this unfolded:** the deploy and the chart gap were unrelated. The deploy was
script-only and could not have affected indexing; the chart gap was a Kibana data view pointing
at a concrete index instead of the alias. They got investigated together because both surfaced
in the same session — worth separating next time before assuming a causal link.

**Verification lesson (again):** a single latest-doc query was too thin to conclude "prod is
healthy". It happened to be right, but it could not have distinguished normal indexing from one
stray recent write into an otherwise stalled index. The per-day histogram is the real check.
Same shape as the *Caveats §1* working-tree-grep trap: assert the thing itself, not a proxy.

## Rollback

```
git tag -f production-current a9336e8 && git push origin production-current --force
```

- `a9336e8` = PR #24, the previous production commit
- ⚠️ still **never** roll back to `4c5a049`
- reverting this one only restores the older *deploy script*; it changes no runtime behaviour
