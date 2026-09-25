# Raspberry Pi Runtime — Findings for the v9 Client Upgrade

_Companion to [es_client_v9_upgrade_plan.md](es_client_v9_upgrade_plan.md). Compiled 2026-09-25._

What actually constrains the Pi, and what is currently wrong with how it resolves Node.

---

## The OS support matrix does not apply here — checked, do not re-investigate

[Elastic's OS support matrix](https://www.elastic.co/support/matrix#matrix_os) scopes operating
systems for installing Elastic **server** products. It does not bind this deployment:

- There is **no Elasticsearch node on the Pi** — it runs only the Node.js cron job and the JS client.
- **Elastic Cloud owns both clusters' host OS and JVM.**
- The matrix has **no clients/language-client section** — no Node versions, no client platforms.

**What actually binds the Pi** is (1) the client package's `engines` and (2) Node's own ARM support.
Both are covered below.

Also checked and clear:

- **glibc** — Node arm64 needs ≥2.28; Pi OS Bullseye 2.31 / Bookworm 2.36 / Trixie 2.41 all exceed it.
- **ARM-specific client defects** — none. The 9.4.3 dependency tree is pure JS (`tslib`,
  `@elastic/transport` → `undici`, `hpagent`). No native addons, no node-gyp, no build step, so
  `npm ci` is architecture-neutral. (9.4.0 also drops `apache-arrow`.) The one historical Pi bug was
  in client v7.9.1.

---

## Node version requirements

| Client version | Requires |
|---|---|
| 9.0 – 9.3 | Node `>=18` |
| **9.4.0 – 9.4.x** | **Node `>=20`** |
| **9.5.1** | **Node `>=22`** |

`@elastic/transport` also declares `>=20`, so they agree at 9.4.3. This repo's `engines` already
declares `>=20`.

📌 Elastic's prose docs still say "minimum v18" and are **stale** — trust the package `engines`.

⚠️ **`^9.4.3` resolves to 9.5.1 today**, silently raising the Node floor to 22 mid-upgrade.
**Pin `~9.4.3`** and treat a Node 22 floor as separate, deliberate work.

⚠️ **`engines` is advisory.** There is no `.npmrc` and no `engine-strict`, so `npm ci` will **not**
fail on an out-of-range Node — the failure surfaces at runtime, after every deploy gate has already
reported success. Exactly the lessons-§1 "green run, wrong artifact" shape.

---

## The Pi's Node runtime is reached by accident

The plan originally asserted cron uses `/usr/bin/node` **v24.13.0** while interactive shells use nvm
**v23.5.0**. **The script's own logic contradicts that.**

`fetchAndIndex-production.sh:16-24` sources `~/.bashrc`, then nvm, then takes
`NODE_BIN=$(which node)` — which *should* yield the nvm runtime (v23.5.0), not `/usr/bin/node`.

**Likely explanation:** Debian's `.bashrc` early-returns under cron's non-interactive shell, so nvm
silently no-ops and PATH falls through to `/usr/bin/node`.

⛔ **Failure mode:** fix the Pi's `.bashrc`, or change an nvm default, and cron's Node major shifts
**silently** — potentially below the `>=20` floor, after every deploy gate has passed.

### Settle the actual state

The last clause reproduces cron's environment, which is the answer that matters:

```bash
ssh <pi> "uname -m; node -v; /usr/bin/node -v; \
  env -i HOME=/home/pi PATH=/usr/bin:/bin bash -lc 'which node; node -v'"
```

---

## Related gaps, all unaudited by the original plan

- **`NODE_BIN` is never validated.** `NPM_BIN` gets an emptiness guard
  (`fetchAndIndex-production.sh:119-122`); `NODE_BIN` gets none, so `:165` can execute
  `"" runMainIIFE.js` — an opaque failure into `logs/cron.log`, after the gates.
- **No Node *version* assertion exists anywhere**, despite the script rigorously asserting git tag
  and client version.
- **Stale hardcoded Node paths below the floor:** `scripts/deployment/fetchAndIndex-pi.sh:7` and
  `fetchdata-pi.sh:8` pin nvm **v16.13.1**. `docs/DEPLOYMENT.md:306` documents v23.5.0 as reference.
- **A second Node-resolution site the plan never audits:**
  `com.heiligers.ambient-weather.plist` pins v23.5.0 in its PATH.
- **Node 23 is odd-numbered and EOL** — unpatched, while holding Elastic Cloud credentials over TLS.
  Validating on v23 while cron runs v24 proves nothing about production.

### Recommended fix set (plan item 3.7)

1. Collapse to **one runtime** (Node 24 LTS), with nvm's default pointed at it.
2. Add a **Node-major assertion** to `fetchAndIndex-production.sh` beside the existing gates.
3. Guard `NODE_BIN` for emptiness as `NPM_BIN` already is.
4. Commit `.npmrc` with `engine-strict=true`.
5. Fix the stale pins listed above.

---

## Pre-existing: two launchd jobs are already dead

Unrelated to this upgrade, but should not be discovered *during* it.

Two jobs fail with **exit 127**, hardcoding `/usr/local/bin/node`, which does not exist on the Mac:

- **monthly data archiving**
- **weekly log archiving**

Both are **silently failing today**. One of them, `scripts/archive-data.js`, is also an unlisted
`createEsClient` consumer.
