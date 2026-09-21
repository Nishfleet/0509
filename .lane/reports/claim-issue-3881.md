# claim/issue-3881 — REBUILD cost sheet + unit-cost model (scout, umbrella #3842)

Role: scout. Research only, no code. Files in scope: `docs/REBUILD-COST.md`,
`.lane/reports/claim-issue-3881.md`. Nothing else touched.

## What shipped

`docs/REBUILD-COST.md` — audit-dated **2026-09-21**, every figure read live off
`developers.cloudflare.com` that day:

- §1 price sheet for every primitive the rebuild touches: Workers
  (requests/CPU), Cron, Workers Logs, D1 (rows read/written/storage/index
  writes), R2 (Standard + Infrequent Access, ops classes, zero egress), KV,
  Durable Objects (requests, duration, both storage backends), Queues,
  Workflows (steps + storage billing since 2026-08-10), Browser Rendering
  (browser hours + monthly-averaged concurrency), Workers AI (neurons + the
  model price table incl. LLM/vision/translation/embedding rows), Email
  Service, Analytics Engine (published-but-unbilled), Vectorize.
- §2 per-1,000-operations marginal-cost table (the deliverable unit the
  packet asked for).
- §3 stay-cheap practices: 11 items citing 4 dated non-vendor write-ups
  (littlebearapps $4,868 D1-write disaster; honeymarron 10B→2.4M rows_read
  reduction; toolchew production cost model; cloudsecop D1 production
  gotchas) plus official docs (use-indexes, metrics-analytics, pricing
  footnotes).
- §4 unit-cost model: per-brand-per-day op counts as arithmetic, monthly
  bill at 10/100/1,000 brands ($5 / ~$12 / ~$100), the three dominant design
  choices (browser-hours budget, judgment-call size+model, digest fan-out
  volume), and the Vectorize per-query full-index-scan trap.
- §5 the 2026-09-17 ~$105 rows-written incident priced both ways:
  row-per-event $0.0010/1k events vs batched-50:1 $0.00002/1k; at the
  incident's ~155M events, $105 vs $0.00.
- §6 stock guardrails only: budget alerts, billable-usage dashboard,
  `limits.cpu_ms`, Workers AI daily cap, Browser Rendering concurrency +
  `X-Browser-Ms-Used`, D1 free-tier hard limits, per-query row attribution.

## Decisions

- **Jev judgment priced as Workers AI.** The packet's "Jev judgment" op is
  modelled as 2 calls/day on `llama-3.1-8b-instruct-fp8-fast` (~33
  neurons/brand/day); the doc names model choice as a dominant lever (~80×
  neuron-rate spread across the table).
- **Digest modelled at worst case** (1 send/brand/day). Bundling collapses
  the line; the unbundled frame is the pessimistic bound and lands exactly
  on the 3,000/mo inclusion at 100 brands — called out in the doc.
- **Vectorize excluded from the daily loop.** Its per-query cost scales with
  index size ((stored+queries)×dims), so the doc prices it as a lazy lane
  and shows the trap instead of hiding it in the base model.

## Verification

- All 13 platform pricing pages fetched live 2026-09-21 (Workers, D1, R2,
  DO, KV, Queues, Workflows, Browser Rendering, Workers AI, Email Service,
  Analytics Engine, Vectorize, Billing) — links + page-update stamps inline.
- Non-vendor write-ups fetched and verified: littlebearapps.com
  (2026-03-18), zenn.dev/honeymarron (2026-09-07), toolchew.com
  (2026-06-09), cloudsecop.net (2025-09-11). rxliuli.com returned HTTP 403 —
  not cited.
- Monthly model recomputed by hand: 100 brands → 87.5 browser-h (77.5
  billable × $0.09 = $6.98); 3,000 sends = included boundary; all other
  meters inside paid inclusions. 1,000 brands → browser $77.85 + email
  $9.45 + AI $7.59 + R2 $0.57.
- Scope check: `git status` shows only the two in-scope paths.
