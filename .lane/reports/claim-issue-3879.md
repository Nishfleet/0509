# claim/issue-3879 — site-change tracking engine

Packet: `Nishfleet/0509#3879` (REBUILD P3). Snapshot a tracked brand's key
pages on a daily cron, diff against the previous snapshot, let Jev decide
whether the change is noteworthy, flag breakage on the user's own site
immediately.

## What shipped

- `app/lib/site/` — the engine: `browser.server.ts` (Browser Rendering
  `quickAction` capture + per-entity-per-day KV browser budget),
  `extract.server.ts` (HTML → canonical text + structured fields +
  same-origin link discovery), `diff.ts` (`diff@9` line diffs, bounded),
  `context.server.ts` (Jev context pack), `jev.server.ts` (evaluation-model
  endpoint; throws on failure so `step.do` retries, returns `{}` when no key
  so items mark unreviewed), `sweep.server.ts` (capture → extract → hash gate
  → baseline/unchanged/changed; judgment before snapshot write so a Jev
  failure never drops the diff; uncertain band 0.1<p<0.9 recorded, not acted
  on).
- `app/lib/data/*.server.ts` — one writer per table: `watch`, `page`,
  `snapshot`, `signal`, `incident`, `alert`, `jev_verdict`, `entity`,
  `source`, `workspace`. No migration: `0001_rebuild.sql` carries `watch`,
  `snapshot.payload_hash`, `signal(kind='change')`, `incident`,
  `jev_verdict`.
- `workers/site-sweep.ts` — `SiteSweepWorkflow`: `step.do` retries
  (limit 3, exponential) per watch, `SWEEP_CONCURRENCY = 10` = the included
  browser allotment as a config value, telemetry data point per sweep.
- `workers/app.ts` — cron `38 4 * * *` → `SITE_SWEEP.create({id:
  site-sweep-<UTC day>})`; deterministic id re-attaches rather than
  double-sweeps.
- `wrangler.jsonc` — `BROWSER` (remote for dev), `SNAPSHOTS` R2 bucket
  `0509-snapshots`, `COUNTERS` KV `de8578b053224b059226a76fc46c0548`,
  workflow binding, `ENGINE_TELEMETRY`, second cron. R2 bucket and KV
  namespace provisioned on the account during the first claim run.
- Tests: `tests/site-diff.test.ts`, `tests/site-links.test.ts`,
  `tests/integration/site-sweep.integration.test.ts` (real migrations, real
  local D1/R2/KV, a real Workflow run).

## Evidence (this run, `1a8d8e473` on `origin/main` `5e5d7747`)

- `npx vitest run --project node --changed origin/main`: 4 files / 11 tests
  green, 0.4 s.
- `npx vitest run --project workers --changed origin/main`: 2 files / 11
  tests green, 114.8 s — the `sweep-watch-*` step retried the forced
  `quickAction` failure three times across real miniflare time, then landed
  the `capture_failed` incident. That is the Workflow retry proof, in the
  committed suite.
- Prior claim run on the same diff: `npm run typecheck`, `npm run lint`
  (eslint + knip), `npm run build` — all clean; CI re-runs them on the PR.

## Design-rule obedience

- D1 writes batched: one `snapshot` row per watch per tick, one `signal` row
  per item surviving judgment — never a row per observed element (the $105
  anti-pattern).
- Snapshot bodies and screenshot pairs in R2 keyed from D1; no blobs in rows.
- Hot counters in KV: `bsec:<entity>:<day>` browser-ms budget, TTL 48 h.
- Budgets as numbers in code: `BROWSER_MS_PER_ENTITY_PER_DAY` (per brand per
  day), `SWEEP_CONCURRENCY = 10`, `MAX_PAGES_PER_SWEEP = 5`. The hash gate
  runs before any screenshot — unchanged pages cost a capture, never a
  browser session beyond the one content fetch.

## Cost model (priced from docs/REBUILD-COST.md, read 2026-09-21)

Per brand per day: ~15 browser-seconds (capture) + a handful of D1 rows +
R2 puts only on baseline/change. At 100 brands: ~12.5 browser-hours/mo →
**$0.22/mo** beyond the included 10 h; ~30 k D1 writes/mo → 0.06% of the
included 50 M; R2/KV inside included tiers. Well under the product price
point. The concurrency cliff is the thing to watch: raising
`SWEEP_CONCURRENCY` past 10 is a $2.00/browser-month Nish decision.

## Honest deferrals

- Live-account proofs (a production Browser Rendering pull and a live Jev
  verdict over a real brand diff) need deployed bindings and a valid account
  token; the host token at `~/.config/cloudflare/deploy.env` failed
  `user/tokens/verify` this run. The pipeline itself is proven on real local
  D1/R2/KV/Workflow; the production first-sweep proof lands with the deploy.
- Screenshot pixel-diffing is intentionally absent — `pixelmatch` stays on
  the shelf until something needs to compare screenshots; today they are
  stored as the before/after evidence pair only.
