# ES 9.x Upgrade — Verification Reference

_Companion to [es_client_v9_upgrade_plan.md](es_client_v9_upgrade_plan.md)._

**Consult this before concluding that anything failed.** Every entry below is a normal observation
that looks like a failure. Several have already caused false alarms on this project.

---

## False alarms — normal things that look broken

| Observation | Why it's normal |
|---|---|
| Date-math queries throw `query_shard_exception` | **`dateutc` is mapped `long`** (epoch millis), **not `date`**. ES date math (`now-22d/d`) does not work on it. **Pass raw epoch millis.** |
| `@timestamp` queries return empty | **Unwritten since 2026-01-05** — 1,065,257 imperial docs have it, 2,221,987 don't — but it's **still in the mapping**, so it looks available. |
| "4 write indexes" in cron logs | Normal: 2 clusters × 2 types. |
| Exactly **288** docs/day | Normal when only one host ran. Mac and Pi index ~1h apart: **~576/day when both run, exactly 288 when one does.** Not data loss. |
| Integer rain values in `..._2026_08_05` | Expected (lessons §10) — **do not read as a failed deploy.** |
| Deprecations appear "cleared" after narrowing `filter_path` | **The response was truncated.** Use `filter_path=index_settings.*`, never `index_settings.ambient_weather_heiligers_*` (lessons §7). |

---

## Verifying a cluster upgrade

Use §7's **specific** assertions, never aggregates:

- per-index `_count`
- the `by_index` terms aggregation
- **the index the newest document NAMES**

⚠️ **Production is not a copy of staging** (lessons §8). Re-measure it independently. It carries
`imperial_2020_12_31`, `metric_2020_12_31`, and
`deduped_ambient_weather_heiligers_imperial_2020_07_25` as a live alias member.

---

## Verifying a deploy — assert the installed artifact, not a green run

A successful run proves the pipeline works. It does **not** prove your code is running (lessons §1).

⛔ **Do not use `git rev-parse --short HEAD` on the Pi after a run.** It is unsound and already
produced a false alarm (`2026-08-20-deploy-pr24-record.md:148-173`):
`fetchAndIndex-production.sh:168` runs `git checkout -` after the run, and the Pi's local `main`
lags `origin/main`, so the tree shows stale code.

**Use the cron log — it names the SHA that actually ran:**

```bash
ssh raspberrypi-tina "grep '\[deploy\]' .../logs/cron.log | tail -20"
git show <sha>:<path>          # confirm the deployed blob
grep -m1 '"version"' node_modules/@elastic/elasticsearch/package.json
```

✅ The version-assertion line **is** sound — `node_modules` is gitignored and is not restored by
`git checkout -`.

### Dependency-tree fingerprint (second independent signal)

| Client major | Packages | Vulns |
|---|---|---|
| v7 (historical) | 514 | 39 |
| v8 (current) | 470 | 23 |
| v9 | _capture at 3.1_ | _capture at 3.1_ |

### On the `npm ci` gate

The general caveat — a source-only change leaves `package-lock.json` untouched, so the gate SKIPS
while stale code runs (lessons §1, PR #21) — **does not apply to the client bump.** A version bump
changes the lockfile, so the gate **will** fire and the assertion **will** be meaningful. Expect a
slow first Pi run.

---

## Index creation-version audit

Run on **both** clusters before any upgrade:

```
GET /*/_settings?human=true&filter_path=**.version.created_string
GET /_migration/deprecations?filter_path=index_settings.*
```

Any index created in 7.x blocks the 9.x upgrade outright. See
[es_client_v9_cluster_upgrade_requirements.md](es_client_v9_cluster_upgrade_requirements.md) §2 for
what to do about it.
