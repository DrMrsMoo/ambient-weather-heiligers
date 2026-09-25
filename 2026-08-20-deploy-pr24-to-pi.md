# Deploy PR #24 (indexing hotfix) to the Pi — 2026-08-20

Moves `production-current` from `69202db` → `a9336e8`. The Pi picks it up on its next cron run.

## What's being deployed

PR #24 (`hotfix_data_not_indexing`), two runtime bugs in
`/Users/tina/Projects/ambient-weather-heiligers/src/dataFetchers/FetchRawData.js`:

- **`maxNumRecordsCanGet` is undefined** (line 258) — batched multi-day fetches set
  `this.numberOfRecords = undefined`. Now `AW_CONSTANTS.maxNumRecords` (288).
- **`.length()` TypeError** (line 81) — `clearFileNames()` called `.length` as a function on
  the public getter. Now `.length`, and reads the private field.
- Bonus: hardcoded `288` in the single-day branch replaced with the constant.
- `package.json` / `package-lock.json` gain `engines: { node: ">=20" }`.

Pre-checks already done:

- `npm test` on `a9336e8` — **182 passed**, 9 suites, incl. a new regression test
  (`uses maxNumRecords (288) for batched API calls, not undefined`).
- `maxNumRecordsCanGet` no longer appears in `src/` on `a9336e8` (only in a test comment).
- Pi is healthy at `69202db`: ES client **8.19.2** on disk matches the lockfile pin,
  origin is **HTTPS** (unattended fetch works), Node **v24.13.0** satisfies `>=20`.

## Step 1 — run the deploy script

The script prompts twice and the push needs 1Password, so run it yourself:

```
cd /Users/tina/Projects/ambient-weather-heiligers && ./deploy-to-production.sh main
```

It will:

1. Show the changes to deploy → answer **`yes`**.
2. Check out `main`, source `.env`, and do a **live** `node runMainIIFE.js` — a real
   fetch + index against both clusters. This is the gate.
3. Ask if the test run succeeded → **`yes`** only if you see both clusters
   `status: 'success'` and `[RESULT]: Done` with no errors. Anything else → **`no`**
   (the script rolls back to `main` and stops; nothing is tagged).
4. Force-move `production-current` to `a9336e8` and push (approve in 1Password).

## Step 2 — confirm the tag moved

```
cd /Users/tina/Projects/ambient-weather-heiligers && git ls-remote origin refs/tags/production-current
```

Expect `a9336e8...`.

## Step 3 — verify on the Pi, by artifact

⚠️ A green pipeline confirms the pipeline, not the deploy. Assert the installed artifact.

Cron is `20 11,23 * * *` **local** on the Pi; `cron.log` timestamps are **UTC**
(UTC−7 Pacific daylight) — don't misread the offset as a missed run.

Either wait for the next run, or trigger it now:

```
ssh raspberrypi-tina "/home/pi/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh"
```

Then check the artifact triple:

```
ssh raspberrypi-tina "cd /home/pi/Projects/ambient-weather-heiligers && \
  git rev-parse --short HEAD && \
  grep -n 'maxNumRecords' src/dataFetchers/FetchRawData.js | sed -n '5p' && \
  grep -m1 '\"version\"' node_modules/@elastic/elasticsearch/package.json"
```

Expect:

- HEAD → **`a9336e8`**
- line 258 → `this.numberOfRecords = AW_CONSTANTS.maxNumRecords;` (**not** `maxNumRecordsCanGet`)
- ES client → **8.19.2** (unchanged; the lockfile diff was only the `engines` field)

And in the log:

```
ssh raspberrypi-tina "tail -40 /home/pi/Projects/ambient-weather-heiligers/logs/cron.log"
```

Expect `[deploy] verified source at a9336e8... matches origin production-current`,
`[deploy] package-lock.json changed (or first run) — running npm ci`,
`[deploy] npm ci succeeded`, then
`[deploy] verified @elastic/elasticsearch@8.19.2 matches production-current lockfile`.

## Rollback

```
cd /Users/tina/Projects/ambient-weather-heiligers && \
  git tag -f production-current 69202db && git push origin production-current --force
```

⚠️ Do **not** roll back to `4c5a049` — that's the stale v7 commit from the Phase 0 incident.

## Notes

- `npm ci` **will** re-run this deploy (the lockfile changed), unlike the source-only
  2026-08-06 deploy. Expect a slower first run on the Pi.
- The `engines: node >=20` field is advisory for `npm ci` — it won't fail the install.
  The Pi's v24.13.0 satisfies it regardless.
