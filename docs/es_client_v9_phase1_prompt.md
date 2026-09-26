<!--
HOW TO RUN THIS
  Session:  main session, not a subagent — Phase 1 is iterative (write test, run, read
            failure, adjust) and you want to watch the suite go green
  Model:    Opus 5 — item 1.1 is judgment-heavy (preserving assertion intent while swapping
            mocking layers, and noticing when a shape difference is a real finding rather
            than a test to fix)
  Mode:     normal permissions; do NOT use --dangerously-skip-permissions. This edits src/,
            deletes exported functions, and touches jest.config.js — you want to see those.
-->

# Phase 1 Prompt — Harden tests against the current client

_Ready-to-use prompt for executing Phase 1 of
[es_client_v9_upgrade_plan.md](es_client_v9_upgrade_plan.md). Paste the whole thing, from
"Work Phase 1" below, into a fresh session._

---

Work Phase 1 of `docs/es_client_v9_upgrade_plan.md` in the ambient-weather-heiligers repo
(DrMrsMoo fork, branch `upgrade/es-client-v9`).

## Goal

Harden the test suite against the CURRENT client (8.19.2) so it binds to real client behaviour
before any version changes. Phase 1 ends at a green suite on 8.19.2 that becomes the reference
point for the whole upgrade. **Do not change any dependency version in this phase.**

## Read first

- `docs/es_client_v9_upgrade_plan.md` — Phase 1 items 1.1-1.7, plus "Test coverage gaps"
- `docs/es_client_v9_plan_corrections.md` — what the plan's first draft got wrong; several
  coverage claims were false and the corrected numbers matter here
- `docs/CLAUDE.md` — project conventions. Note its "Dev Dependencies" section is stale
  (it lists upstream's jest 27 / mock 0.3.1; the fork is on jest ^29.7.0 / mock ^2.1.0)

## Baseline — capture before touching anything

```bash
npx jest                                              # expect: 9 suites, 182 passed, 1 skipped, 2 todo
npx jest --coverage --coverageReporters=text          # expect: dataIndexers 89.27% stmts / 95.06% branch
```

If either differs from those numbers, stop and report — the plan's reference point has moved.

## Tasks — do them in THIS order, which is not the plan's numbering

```
0  →  jest.config.js fix     (do first: everything after is unreadable without it)
1.1 → mock swap
1.2 → esClient.js tests
1.3 → isUnauthorizedError
1.4 → timeout tripwire
1.6 → delete dead code       (BEFORE 1.5)
1.5 → script smoke coverage
1.7 → green suite, record numbers
```

Two deliberate departures from the plan's numbering:

- **Task 0 goes first.** Without a coverage table printing, you cannot see the effect of any
  later item — and a bare `--coverage` currently prints nothing, which reads as "no coverage."
- **1.6 before 1.5.** Deleting the dead functions shrinks the surface 1.5 has to smoke-test, so
  doing 1.5 first means writing tests you then throw away. 1.6 is also the item most likely to
  surface a surprise caller, and you want that before you build on the module.

---

**0 — Fix `jest.config.js:37`.** `coverageReporters: ["json"]` means a bare `--coverage` writes
a JSON file and prints no table — which reads as "no coverage" and caused the plan's original
false claim that coverage instrumentation was broken. Add `"text"`. This is plan item 0.1, and
it makes the rest of the phase legible.

**1.1 — Replace hand-rolled mocks with `@elastic/elasticsearch-mock`** in
`src/dataIndexers/esClientMethods.test.js`.

This is the most important item in the phase. `@elastic/elasticsearch-mock` is a declared
devDependency (`^2.1.0`) that **zero tests currently use** — every test hand-rolls
`mockClient = { ping: jest.fn(), search: jest.fn(), ... }`. Those tests assert *our assumptions*
about response shapes, not the client's actual behaviour, so a 9.x response-shape change would
pass the suite and fail in production.

Bind the tests to real client behaviour. Preserve the existing assertions' intent — this is a
mocking-layer swap, not a rewrite of what is being tested. Pay attention to the surfaces the
upgrade will stress:
- `{ meta: true }` in `getAmbientWeatherAliases` (recovers `statusCode`)
- `{ ignore: [400] }` in `createIndex`
- flattened response bodies (the v8 shape)
- `operations` for bulk

**1.2 — Add tests for `src/dataIndexers/esClient.js`.** Currently 23.8% statements / **0%
functions** — `createEsClient` never executes in any test. This is the real coverage gap.
Cover: client construction, env-prefix resolution (`ES` vs `STAGING`), and each `assert.ok`
failure path.

**1.3 — Cover `isUnauthorizedError`** (`src/dataIndexers/errors.js:8-9`), the only uncovered
predicate — `errors.js` is otherwise at 100% branch coverage. Explicitly exercise the
`error.meta.body.status` access path, since 9.x may change it and `errors.js` depends on it.

**1.4 — Add a timeout-behaviour test.** 9.0 removes the default 30s request timeout; a hung
request in cron would then block ingest silently. This test is the tripwire that makes that
regression visible. Write it against current (8.19.2) behaviour.

**1.6 — Delete dead code** (do this BEFORE 1.5) from `src/dataIndexers/esClientMethods.js`:
`getClusterInfo`, `getAllAmbientWeatherIndices`, `countDocuments`. All three are absent from
`module.exports` (line 348) and unreachable. Two also have broken default arguments
(`getClusterInfo:14` references an `esClient` not imported in that file;
`getAllAmbientWeatherIndices:48` defaults to the module object, not a client). Confirm no caller
anywhere — including `scripts/` — before deleting. **Delete, do not write tests for them.**
If you find a live caller, stop and report rather than deleting.

**1.5 — Smoke coverage for script-level clients** (after 1.6). 10 `new Client()` sites in
`scripts/` plus `src/backfill/backfill.js:106`. Smoke-level only — these need to fail loudly if
construction breaks, not full behavioural tests.

**1.7 — Green suite, and record the new numbers** (suite count, test count, coverage per
directory) in the plan as the reference point.

## Constraints

- **No dependency version changes.** Not `@elastic/elasticsearch`, not anything else. Phase 1
  pins tests to 8.19.2 behaviour; Phase 3 does the bump.
- **Branch from `upgrade/es-client-v9`**, don't commit to it directly, and never to `main`.
  Per `docs/CLAUDE.md`, all work goes through a feature branch and a PR against `main` on the
  DrMrsMoo fork.
- Keep `Promise.allSettled()` for parallel cluster operations, and the `client`-parameter pattern
  in `esClientMethods.js` (always use the passed `client`, never the global import).
- If a test reveals a real bug rather than a test gap, report it — don't silently fix production
  behaviour under cover of a test task.

## Report at the end

- Before/after test counts and per-directory coverage
- Anything 1.1 revealed about response shapes that differs from what the hand-rolled mocks
  assumed — that is exactly the class of thing the 9.x upgrade will hit
- Any item you could not complete, and why
