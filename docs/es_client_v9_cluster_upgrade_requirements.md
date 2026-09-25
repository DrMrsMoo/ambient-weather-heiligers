# ES 9.x Cluster Upgrade — Requirements & Constraints

_Research companion to [es_client_v9_upgrade_plan.md](es_client_v9_upgrade_plan.md). Compiled
2026-09-25 from Elastic's upgrade-planning documentation._

Sourced from [plan-upgrade](https://www.elastic.co/docs/deploy-manage/upgrade/plan-upgrade) and
[prepare-to-upgrade](https://www.elastic.co/docs/deploy-manage/upgrade/prepare-to-upgrade).

---

## 1. Production needs a TWO-HOP upgrade: 8.17.10 → 8.19.x → 9.4.3+

**A 9.1+ target requires starting from 8.19.x.** The 8.18 carve-out applies **only** to 9.0.x, so it
does not help a 9.4.3 target.

| Cluster | Current | Path |
|---|---|---|
| Staging | 8.19.19 | ✅ already qualifies → straight to 9.4.3+ |
| **Production** | **8.17.10** | ⛔ **must reach 8.19.latest first**, then 9.4.3+ |

The plan originally logged this as an open question to be answered by "the Cloud console only offers
compliant targets." True, but insufficient: it defers a **known** requirement to execution time.
**Prod's change window roughly doubles** — each hop needs its own snapshot, Upgrade Assistant run,
and verification.

→ Plan items **2.4**–**2.6**.

---

## 2. Indices created in 7.x block the 9.x upgrade outright

> "Indices created in 7.x or earlier must be reindexed, deleted, or archived before upgrading to 9.x."

Nodes **fail to start** with incompatible indices; on Elastic Cloud the console **refuses the
upgrade**. The deprecation API classifies this **critical** — "you cannot upgrade without fixing
this problem."

### Why this is live for this repo

Data starts in 2020 and the v7→v8 *client* migration only landed Aug 2026, so 7.x-created indices
are plausible. The plan names `imperial_2020_12_31`, `metric_2020_12_31`,
`deduped_..._2020_07_25`. **Nothing in the repo records any index's creation version** (grepped:
zero hits for `version.created`).

**Lessons §5 corroborates this directly.** During v7→v8, the "incompatible date format" deprecation's
real trigger turned out to be *"the index was created before 8.0"* — every flagged index was pre-8.0,
and the fix was a compatibility-version lift (reindex or delete), explicitly **not** "fixing" date
formats. **The 8→9 upgrade re-runs that identical gate at the 8.0 boundary.**

### The check

Run on **both** clusters:

```
GET /*/_settings?human=true&filter_path=**.version.created_string
GET /_migration/deprecations?filter_path=index_settings.*
```

⚠️ **§7's trap:** use `filter_path=index_settings.*`. Narrowing to
`index_settings.ambient_weather_heiligers_*` **truncates the response** and once produced a false
"cleared" reading.

### Remediation per index — the choice is not free

| Option | Cost | Constraint |
|---|---|---|
| **Archive** (read-only) | cheap | ⚠️ supports **only search and field-caps** — **no Get API, no writes** |
| **Reindex** | slower | full functionality retained |
| **Delete** | free | data loss |

⛔ **Anything the cron still writes to must be REINDEXED, not archived.** Watch `deduped_*`.

→ Plan items **0.5**, **0.6**.
[Reading indices from older versions](https://www.elastic.co/docs/deploy-manage/upgrade/deployment-or-cluster/reading-indices-from-older-elasticsearch-versions)

---

## 3. Snapshot restore is forward-only

**8.x snapshots DO restore to 9.x** — compatibility table: indices created 8.0–8.19 → 9.0.0–9.5.4 ✅.
This resolves the plan's original item 0.2, which had been treated as a Phase-2 blocker.

**But: "You can't restore a snapshot to an earlier version."** Elasticsearch has no in-place
downgrade. Recovery from a bad 9.x upgrade means **building a new 8.19 cluster and restoring into
it** — not rolling back. The plan's original framing ("determines whether the cluster upgrade is
reversible at all") **overstated what a snapshot buys.**

Elastic also warns that a restore Elasticsearch accepts **can still fail when Kibana starts**
(`.kibana` migration) — it is "not a shortcut around the normal upgrade paths."

[Snapshot and restore](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore)

---

## 4. Elastic Cloud specifics

- **ES and Kibana upgrade simultaneously** — "Elasticsearch, Kibana, Elastic APM, and all of your
  deployment components are upgraded simultaneously." ✅ **No separate Kibana step is needed.**
- **Kibana goes down regardless of topology**, and "deployments with nodes in only one zone might
  experience downtime." → **Declare a downtime window and pause the Pi cron across it.**
- An **automatic snapshot is taken** before changes.

[Upgrade on Elastic Cloud Hosted](https://www.elastic.co/docs/deploy-manage/upgrade/deployment-or-cluster/upgrade-on-ech)

---

## 5. Upgrade Assistant scope

Elastic prescribes running the Assistant **from the latest minor before a major** — i.e. on prod
*after* it reaches 8.19.x — clearing **all** criticals, and reviewing deprecation logs.

The original plan cleared **staging only**. Production needs the same treatment.

Also prescribed and previously missing: review breaking changes across **all** of 9.0 → 9.4 (not
just 9.4), and run snapshot-repository analysis.

→ Plan items **2.5**, **0.7**.

---

## 6. The client/cluster compatibility direction

The plan's conclusion (clusters first) is correct, but the reasoning was incomplete. The documented
guarantee runs **the other way**: **8.x clients are compatible with 9.x clusters** via
[REST API compatibility](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/compatibility)
(the client sends a `compatible-with=8` header).

Two consequences:

1. **The Pi's 8.19.2 client keeps working against a 9.4.3 cluster.** Phase 3 can be fully decoupled
   from Phase 2 and scheduled on its own merits.
2. A **9.x client against the interim 8.19 cluster remains unsupported** — so the two-hop prod path
   does not create a window where the client could be bumped early.
