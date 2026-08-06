# Composable index templates — the CURRENT source of truth

These replace the legacy `_template` (v1) files in the parent directory.

## Which file do I use?

| Directory | API | Status |
|---|---|---|
| `config/templates/composable/` ← **here** | `_index_template` | ✅ **CURRENT — use these** |
| `config/templates/` (parent) | `_template` (v1) | ⛔ **LEGACY — historical reference only** |

- Deleted from staging in Phase 3 (2026-08-06). Kept in git for rollback + provenance.
- Legacy `_template` is deprecated and removed in a future major. Do not add new ones.

## Files

- `ambient_weather_heiligers_imperial.json` — pattern `ambient_weather_heiligers_imperial_*`
- `ambient_weather_heiligers_metric.json` — pattern `ambient_weather_heiligers_metric_*`

Each file is a **paste-ready Kibana Dev Tools request**: `PUT _index_template/<name>` then the body.
Same convention as the legacy files. Not `.json`-parseable as-is — the first line is the verb+path.

## Applying

Kibana → Dev Tools, on the target cluster. Paste the file contents verbatim.

Composable templates take **priority over legacy ones** for overlapping patterns automatically, so
applying these while a legacy template still exists is safe — there is no window where a new index
picks up the wrong mapping.

Verify before deleting anything legacy:
```
POST _index_template/_simulate_index/ambient_weather_heiligers_imperial_2099_01
POST _index_template/_simulate_index/ambient_weather_heiligers_metric_2099_01
```
Assert: 1 shard · your mappings · alias `all-ambient-weather-heiligers-{imperial,metric}`.

## ⚠️ Two things that will bite you later

**1. No `is_write_index` in the `aliases` block — this is deliberate.**
A new index created under these templates joins the alias as a **READ member only**. Write-index
promotion is always an explicit `_aliases` swap. A template that set `is_write_index: true` would
try to create a *second* write index on rollover, which Elasticsearch rejects.
➡️ **On your next rollover you MUST promote the new index by hand**, or writes silently keep
landing on the old one. Matches legacy behaviour exactly — the legacy files also used `{ }`.

**2. Known type inconsistencies were copied FAITHFULLY, not fixed.**
Do not "tidy" these while pasting. Changing them needs a reindex to affect existing data and is a
separate, deliberate change:
- **Rain fields:** imperial is all `float`. Metric has `hourly_rain_mm`, `weekly_rain_mm`,
  `event_rain_mm` as `long` (truncates sub-mm) while `daily/monthly/total_rain_mm` are `float`.
  Almost certainly a legacy mistake.
- **Wind speed:** `windspeedmph` / `windspeed_km_per_hr` are `long` while gusts differ across the
  pair (`windgustmph` `long`, `windgust_km_per_hr` `float`).
- **Battery:** `battout` (`long`, imperial) vs `battery_condition` (`keyword`, metric) are genuinely
  different fields, not a unit conversion. Correct as-is.

The property lists must stay **complete**: under `dynamic: "runtime"` (§4) an omitted field is not
indexed — it falls back to a runtime field with an INFERRED type, which is both slower to query and
liable to infer wrongly (a rain value of `1` infers `long`). Explicit beats inferred.

**3. LOGSTASH-ERA fields were REMOVED 2026-08-06 — deliberately, do not re-add them.**

Dropped from both templates:
`fulldate.*` · `agent.*` · `host.name` · `ecs.version` · `log.file.path` · `log.offset` ·
`fields.data_type` · `@version`

These were the standard field set Filebeat/Logstash injected, inherited unexamined from the legacy
templates. Verified before removal: grepping all `*.js` / `*.mjs` in this repo (excluding
`node_modules`) returns **zero** references to any of them. The Node pipeline writes weather data
only. Same era as the `filebeat-7.6.1` and `logstash` legacy templates deleted in Phase 3.

Result: **29 properties each**, all weather data or timestamps. Nothing mapped that the pipeline
does not write.

**`@timestamp` was KEPT** — it is the conventional Elasticsearch time field and Kibana data views
commonly default to it. The pipeline's own time fields are `date` and `dateutc`.

📌 **Old documents that DO carry these fields remain queryable.** Documents in
`..._2026_08_05` (copied from `..._2021_12_30` by the 08-05 reindex) still have them in `_source`.
Under `dynamic: "runtime"` (§4) they resolve at query time, so removing the explicit mapping does
not make that history unreachable — it is just slower to aggregate. This is precisely why `runtime`
made the removal safe.

⚠️ **Existing indices are unaffected** — they keep whatever mapping they were created with. This
only governs indices created after the template is applied.

**4. `dynamic` is `"runtime"` — a DELIBERATE change from the legacy templates (2026-08-06).**

Legacy used `dynamic: "true"`. The composable templates use `"runtime"`.

| | `true` (legacy) | `false` | `"runtime"` (now) |
|---|---|---|---|
| Stored in `_source` | ✅ | ✅ | ✅ |
| Visible in GET by id | ✅ | ✅ | ✅ |
| Searchable / aggregatable | ✅ | ❌ | ✅ (at query time) |
| Added to the inverted index | ✅ | ❌ | ❌ |
| Ingest rejects a document | never | never | never |

**Why not `true`:** a new field is auto-mapped with an INFERRED type, and a wrong inference is
permanent without a reindex. This is not hypothetical — the metric rain fields typed as `long`
(truncating sub-mm values) are exactly that mistake, still visible in §2 above.

**Why not `false`:** unmapped fields become unqueryable and unaggregatable. Making one usable would
mean defining a runtime field by hand first — extra work just to check whether a trend matters.

**Why `"runtime"`:** new fields are queryable and aggregatable immediately, with no manual step, and
a wrong inferred type is corrected by editing the runtime field — **no reindex**. Ingest is never
rejected.

⚠️ **Cost:** runtime fields are computed per-document, per-query from `_source` — no doc_values, no
inverted index. Aggregating one across ~1.9M documents is materially slower than an indexed field.
➡️ **If a runtime field proves useful, promote it to a real property in this file** and let it be
indexed on the next index. Runtime is for discovery, not for permanent hot-path fields.

📌 `date_detection`, `numeric_detection` and `dynamic_date_formats` are **KEPT and ARE active** —
they govern type inference for runtime fields too. (They would be inert only under `dynamic: false`.)

⚠️ **Applies to indices created AFTER this template is applied.** Existing indices keep their
current mappings, including their `dynamic` setting.

## Legacy keys intentionally dropped

`order` → superseded by `priority` (unset; nothing else matches these patterns — add
`"priority": 100` if a competing template ever appears) · `version` → provenance now in `_meta` ·
`_source: {enabled: true}` → already the default · `dynamic_templates: []` → empty no-op ·
`mappings._meta: {}` → was empty, real `_meta` now at template top level.

No mapping **type wrapper** existed in either legacy source (`properties` sat directly under
`mappings`), so no `_doc` unwrapping was needed for ES 8+.

## Rollback

Re-apply the legacy body from the parent directory and `DELETE _index_template/<name>`. Deleting a
template never touches existing indices or their data.

## Related

- Runbook: `~/Desktop/weather-tracker-upgrades/staging/2026-08-03-phase3-composable-templates-runbook.md`
- Lessons: `docs/ELASTICSEARCH_UPGRADE_LESSONS.md`
