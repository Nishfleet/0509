# REBUILD cost — Cloudflare price sheet and unit-cost model (issue #3881, umbrella #3842)

Audit date: **2026-09-21** (UTC). Method: every figure below was read live off
`developers.cloudflare.com` on this date. Each row carries its source link and
the page's own "Last updated" stamp where the site publishes one; a number
without a date is worthless because pricing moves. This doc prices things — it
recommends no tier and no spend increase; that call is Nish's.

What this doc must let every later packet answer: **Cloudflare units consumed
per 1,000 operations, priced from the current sheet, and the monthly estimate
at 100 tracked brands.** Both tables exist below (§2, §4).

## 1. Price sheet today — every primitive the rebuild touches

All figures read **2026-09-21**. "Included" = the Workers Paid plan's monthly
bundled allowance ($5/month minimum, no egress/bandwidth charges anywhere on
this page).

| Primitive | Meter | Free plan | Workers Paid ($5/mo base) | Source (page updated) |
|---|---|---|---|---|
| **Workers** | Requests | 100,000/day | 10M/mo incl, +$0.30/M | [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-08-28) |
| | CPU time | 10 ms/invocation | 30M CPU-ms/mo incl, +$0.02/M CPU-ms; 5 min cap/invocation (30 s default), 15 min for Cron/Queue consumers | same |
| | Duration | not billed | not billed — wall-clock wait is free | same |
| | Static assets / subrequests | free, unlimited | free, unlimited; subrequests never billed | same |
| **Cron Triggers** | — | shared with Workers | scheduled invocations bill as ordinary Worker requests + CPU (15-min CPU cap each) | [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [cron docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/) |
| **Workers Logs** | Log events written | 200,000/day, 3-day retention | 20M/mo incl, +$0.60/M; 7-day retention | [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-08-28) |
| **D1** | Rows read | 5M/day | 25B/mo incl, +$0.001/M | [d1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (2026-04-21) |
| | Rows written | 100,000/day | 50M/mo incl, +$1.00/M | same |
| | Storage | 5 GB total | 5 GB incl, +$0.75/GB-mo | same |
| | Index writes | — | each indexed column in a write adds ≥1 extra written row | same (definition 6) |
| **R2** (Standard) | Storage | 10 GB-mo/mo | $0.015/GB-mo | [r2 pricing](https://developers.cloudflare.com/r2/pricing/) (2026-08-07) |
| | Class A ops (mutating) | 1M/mo | $4.50/M | same |
| | Class B ops (reads) | 10M/mo | $0.36/M | same |
| | Egress | free | free — always, every class | same |
| | Delete ops | free | free | same |
| **R2 Infrequent Access** | Storage / ops / retrieval | no free tier | $0.01/GB-mo; A $9.00/M; B $0.90/M; retrieval $0.01/GB; 30-day minimum storage duration | same |
| **Workers KV** | Keys read | 100,000/day | 10M/mo incl, +$0.50/M | [kv pricing](https://developers.cloudflare.com/kv/platform/pricing/) (2026-04-21) |
| | Keys written / deleted / list | 1,000/day each | 1M/mo incl each, +$5.00/M each | same |
| | Storage | 1 GB | 1 GB incl, +$0.50/GB-mo | same |
| **Durable Objects** (compute) | Requests | 100,000/day | 1M/mo incl, +$0.15/M (RPC session = 1 request; WS msgs 20:1) | [do pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (2026-08-25) |
| | Duration | 13,000 GB-s/day | 400,000 GB-s/mo incl, +$12.50/M GB-s; hibernating objects not billed; billed at 128 MB/object | same |
| **DO storage** (SQLite backend) | Rows read / written | 5M/day, 100,000/day | same as D1: 25B/mo, 50M/mo incl, +$0.001/M, +$1.00/M | same |
| | Stored data | 5 GB | 5 GB-mo incl, +$0.20/GB-mo (billing live since 2026-01-07) | same + [changelog](https://developers.cloudflare.com/changelog/2025-12-12-durable-objects-sqlite-storage-billing/) |
| **DO storage** (KV backend, legacy) | Read/write units, stored data | n/a | 1M read units +$0.20/M; 1M write +$1.00/M; 1M deletes +$1.00/M; 1 GB +$0.20/GB-mo | same |
| **Queues** | Standard operations (per 64 KB chunk written/read/deleted) | 10,000 ops/day | 1M ops/mo incl, +$0.40/M; ≈3 ops per message delivered; each retry = a read op; DLQ write = a write op | [queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) (2026-04-21) |
| **Workflows** | Requests, CPU time | shared with Workers | shared with Workers | [workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) (2026-07-21) |
| | Steps | 3,000/day | 500,000/mo incl, +$0.80 per additional 100,000 | same |
| | Storage | 1 GB-mo | 1 GB-mo incl, +$0.20/GB-mo; state kept 3 d free / 30 d paid | same |
| | (step + storage billing applies since 2026-08-10) | | | [changelog](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/) |
| **Browser Rendering** | Browser hours | 10 min/day | 10 h/mo incl, +$0.09/h | [browser-run pricing](https://developers.cloudflare.com/browser-run/pricing/) (2026-04-21) |
| | Concurrent browsers (sessions only) | 3 | 10 monthly-averaged incl, +$2.00/browser | same |
| | Metering | — | `X-Browser-Ms-Used` response header reports ms per call; failed `waitForTimeout` calls not billed | same |
| **Workers AI** | Neurons | 10,000/day | 10,000/day free, then $0.011 per 1,000 Neurons | [workers-ai pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (2026-09-17) |
| | LLMs (token-equivalent) | — | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` $0.045/M in, $0.384/M out; `llama-3.2-3b-instruct` $0.051/$0.335; `llama-3.3-70b-instruct-fp8-fast` $0.293/$2.253; `glm-5.3-flash` $0.150/$0.500; `glm-5.3` $1.400/$4.400; `granite-4.0-h-micro` $0.017/$0.112 | same |
| | Vision (creative OCR class) | — | `llama-3.2-11b-vision-instruct` $0.049/M in, $0.676/M out | same |
| | Translation | — | `m2m100-1.2b` $0.342/M in + $0.342/M out | same |
| | Embeddings | — | `bge-m3` / `qwen3-embedding-0.6b` $0.012/M input tokens | same |
| | Image classification | — | `resnet-50` $2.51/M images | same |
| **Email Service** | Outbound sends | not available | 3,000/mo incl, +$0.35 per 1,000 emails; verified-account destinations always free | [email-service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) (2026-06-09) |
| | Inbound routing | unlimited | unlimited (handler bills as Workers) | same |
| **Analytics Engine** | Data points written | 100,000/day | 10M/mo incl, +$0.25/M | [analytics-engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) (2026-04-23) |
| | Read queries (SQL API) | 10,000/day | 1M/mo incl, +$1.00/M | same |
| | | | **Currently not billed** — pricing published in advance | same |
| **Vectorize** | Queried vector dimensions | 30M/mo | 50M/mo incl, +$0.01/M | [vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) (2026-04-21) |
| | Stored vector dimensions | 5M | 10M incl, +$0.05 per 100M | same |

## 2. Cloudflare units per 1,000 operations — marginal rates

The number a later packet multiplies by its op count. Rates are the paid-plan
marginal (post-inclusion) rates from §1; "1k ops" columns are plain arithmetic.

| Unit | Per-1k marginal cost | Basis (§1 row) |
|---|---|---|
| Worker requests | **$0.00030** | $0.30/M |
| Worker CPU-ms | **$0.000020** | $0.02/M CPU-ms |
| D1 rows written | **$0.0010** | $1.00/M — the expensive meter on this sheet |
| D1 rows read | **$0.0000010** | $0.001/M — reads are ~1000× cheaper than writes |
| R2 Class A ops | **$0.0045** | $4.50/M |
| R2 Class B ops | **$0.00036** | $0.36/M |
| R2 storage | $0.015 per GB-mo | flat |
| KV reads | **$0.00050** | $0.50/M |
| KV writes/deletes/list | **$0.0050** | $5.00/M — 10× the read rate |
| DO requests | **$0.00015** | $0.15/M |
| DO duration | $0.0125 per 1,000 GB-s | $12.50/M GB-s |
| Queue operations | **$0.00040** | $0.40/M |
| Workflow steps | **$0.0080** | $0.80 per 100,000 |
| Browser hours | **$0.090/h** (1k s = $0.025) | $0.09/h — the biggest marginal meter in our model |
| Workers AI neurons | **$0.011** | per 1,000 Neurons |
| Email sends | **$0.35** | per 1,000 emails |
| Analytics Engine datapoints | $0.00025 (currently unbilled) | $0.25/M |
| AE read queries | **$1.00** | $1.00/M |
| Vectorize queried dims | $0.010 per M dims | $0.01/M — see §4 trap |
| Vectorize stored dims | $0.05 per 100M | flat |

## 3. How the best builders stay cheap — cited practice

Vendor marketing excluded; these are official docs plus dated practitioner
write-ups with real bills attached.

1. **Batch every write that can be batched.** `env.DB.batch([...])` runs many
   statements in one subrequest and one transaction — one round trip instead of
   N ([cloudsecop.net, *D1 in production*, 2025-09-11](https://cloudsecop.net/en/blog/d1-production-patterns-en/)).
   Batching doesn't cut *row* counts — summarising does — but it cuts
   subrequests, latency and failure surface. Official same advice:
   [D1 best practices](https://developers.cloudflare.com/d1/best-practices/).
2. **Summary rows, not event rows.** The disaster case is measured, not
   hypothetical: two write bugs (a cron worker with no dedup check re-writing
   the same batch every tick; a harvester missing `ON CONFLICT DO UPDATE`)
   wrote **4.83 billion rows in January 2026 → ~$4,779 in write charges on a
   $5/mo account** ([littlebearapps.com, 2026-03-18](https://littlebearapps.com/blog/d1-billing-disaster-circuit-breakers/)).
   Same bug class as our 2026-09-17 $105 day (§5). Every redundant row was a
   row that should have been an `UPDATE` of a summary — or never written.
3. **Fix read amplification before reaching for cache.** `rows_read` counts
   rows *scanned*, not returned. A measured reduction: 10B rows/day → 2.4M
   rows/day with zero cache added, by ranking per-query reads via GraphQL
   `d1QueriesAdaptiveGroups`, diffing `EXPLAIN QUERY PLAN` against
   `meta.rows_read`, fixing JOIN-through-CTE scans and running `ANALYZE` so the
   planner stops mis-selecting indexes. Also: `rows_written` counts index
   writes — 6 indexes → 7 written rows per INSERT
   ([zenn.dev/honeymarron, 2026-09-07](https://zenn.dev/honeymarron/articles/cloudflare-d1-free-tier-rows-read?locale=en)).
   Official companion: [D1 use-indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
   and [metrics-analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)
   (`queryEfficiency` → 1 is the goal).
4. **CPU time ≠ wall-clock — the inversion that makes Workers cheap.** A
   request that waits 400 ms on D1 and computes 3 ms bills ~3 ms. I/O-heavy
   backends are the discount case; CPU-heavy loops are the expensive one
   ([toolchew.com, 2026-06-09](https://toolchew.com/en/deepdive-cloudflare-workers-cost/);
   [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
   Corollary: fan out to subrequests/bindings freely, keep JS compute small.
5. **Blobs go to R2, never into D1.** R2 is $0.015/GB-mo with free egress and
   10M free Class-B reads/mo; D1 storage is $0.75/GB-mo — **50×** — and a 100 KB
   blob in a row still counts as one row on every read that scans it
   ([r2 pricing](https://developers.cloudflare.com/r2/pricing/);
   [d1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)).
   Screenshots, snapshots, creative archives: R2 keys, D1 stores the pointer.
6. **Hot counters live in KV or a Durable Object, not D1 — but mind the KV
   write rate.** KV writes are $5.00/M, 10× the read rate; a KV-write-heavy
   workload is the classic budget surprise ([toolchew, ibid.](https://toolchew.com/en/deepdive-cloudflare-workers-cost/)).
   KV is eventually consistent — exact counters/leases go to a Durable Object
   ([do pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)),
   which is also the only path that doesn't fight KV's consistency model.
7. **Hibernate Durable Objects.** DO duration bills wall-clock while an object
   is active *and cannot hibernate* — an `accept()`ed WebSocket without the
   Hibernation API bills the whole connection lifetime
   ([do pricing footnotes](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
8. **Cached responses kill CPU, not requests.** Workers Caching still bills the
   request but skips CPU on hits — at 80% hit rate the CPU line drops 84% in
   Cloudflare's own worked example ([workers pricing, Example 5](https://developers.cloudflare.com/workers/platform/pricing/)).
   Pair with Cache Rules on anything static or slowly-changing.
9. **Retries via Workflows/Queues semantics, not re-runs.** A Workflow step
   retries the *step*, not the whole pipeline; a Queue retry costs one read op
   instead of a full pipeline re-execution. Re-running a whole cron pipeline
   because step 9 of 10 failed is the expensive version of the same job
   ([workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/);
   [queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)).
10. **Budget the browser, per call.** `X-Browser-Ms-Used` on every response is
    the meter reading — log it per brand, and cap browser seconds per brand per
    day. Concurrency bills as a *monthly average of daily peaks*, so steady
    low parallelism beats bursty fan-out ([browser-run pricing](https://developers.cloudflare.com/browser-run/pricing/)).
11. **Daily free-tier ceilings are hard stops now.** Since 2026-09-01 D1 free
    limits (5M reads / 100k writes per day) error on exceedance rather than
    passing silently — free-tier "savings" that ignore the ceiling become
    downtime, not thrift ([honeymarron, ibid.](https://zenn.dev/honeymarron/articles/cloudflare-d1-free-tier-rows-read?locale=en);
    [d1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)).

## 4. Unit-cost model — one tracked brand, daily cadence

Scope per the packet: **ads pull, site snapshot (screenshot + text), mentions
poll, diffing, Jev judgment, alert write, digest send** — per brand per day,
then monthly at 10 / 100 / 1,000 brands. The model below assumes the §5
guardrails (batched D1 writes, R2 for artifacts, KV counters); the anti-pattern
fork is priced separately in §5.

### Per-brand-per-day operation counts (assumptions in-line, recomputable)

| Operation | What runs | Units consumed / day |
|---|---|---|
| Ads pull | 1 Browser Rendering session, 60 s browser time; 3 Worker invocations ≈ 250 CPU-ms; 10 ad-creative objects to R2 (~1 MB); D1: 1 batched summary row + 5 reads | BR 60 s; Workers 3 req / 250 ms; R2 10 A-ops + ~1 MB; D1 1 W + 5 R |
| Site snapshot | 1 `/snapshot` call, 45 s; 2 Worker invocations ≈ 60 ms; PNG (~0.5 MB) + extracted text (~50 KB) to R2 | BR 45 s; Workers 2 req / 60 ms; R2 2 A-ops + ~0.55 MB; D1 1 W + 3 R |
| Mentions poll | 3 source polls on the fetch path (RSS/feed + API routes — no browser); 1 Worker invocation ≈ 200 ms, ~12 unbilled subrequests; 1 KV counter write + 3 reads | Workers 1 req / 200 ms; KV 1 W + 3 R; D1 1 batched W + 2 R |
| Diffing | content-hash compare inside the snapshot/poll invocations; ~5 ms CPU; ~2 D1 reads; avg 1 changed row/day | Workers ~5 ms; D1 1 W + 2 R |
| Jev judgment | 2 Workers AI calls on `llama-3.1-8b-instruct-fp8-fast`, ~1,500 input + 300 output tokens each: (1500×4119 + 300×34868)/10⁶ ≈ **16.6 neurons/call → ~33 neurons/day** | AI ≈ 33 neurons |
| Alert write | ~3 alert events/day, batched 50:1 into summary rows; 3 KV hot-counter writes | D1 ≈ 0.06 W; KV 3 W |
| Digest send | 1 email/day/brand (worst case — unbundled; see lever below) | Email 1 send |
| Pipeline orchestration | 1 Workflow instance/day: 4 steps; 2 queue messages × 3 ops; ~5 AE datapoints; ~3 misc Worker requests (cron share, flush, read-back) | WF 1 inv + 4 steps; Queues 6 ops; AE 5 dp; Workers 3 req |

**Daily totals per brand:** BR 105 s · Workers ~10 req / ~600 CPU-ms · AI ~33
neurons · D1 ~4 W (1+1+1+1+0.06 — the alert row is the only fractional write)
/ ~12 R · R2 12 A-ops + ~1.55 MB + 5 B-ops (digest/artifact reads) · KV 4 W /
~8 R (poll counters + misc reads) · Email 1 · Workflow 1 inv + 4 steps ·
Queues 6 ops · AE 5 dp · DO 0 · Vectorize 0 (see trap below).

**Monthly per brand (×30):** BR 0.875 h · 300 req / 18,000 CPU-ms · ~1,000
neurons · ~120 W / 360 R rows · 360 A + 150 B ops, ~48 MB steady-state storage
(30-day retention) · 120 KV W / 240 R · 30 sends · 30 inv + 120 steps · 180
queue ops · 150 AE dp.

### Monthly bill at 10 / 100 / 1,000 brands

| Meter | 10 brands | 100 brands | 1,000 brands |
|---|---|---|---|
| Browser hours | 8.75 h — **included** (10 h) | 87.5 h → 77.5 × $0.09 = **$6.98** | 875 h → 865 × $0.09 = **$77.85** |
| Worker requests | 3,000 — incl | 30,000 — incl | 300,000 — incl (3% of 10M) |
| Worker CPU-ms | 180k — incl | 1.8M — incl | 18M — incl (**60%** of 30M — watch) |
| Workers AI neurons | ~10k — free tier | ~100k — free tier | ~990k → 690k over 300k/mo free → **$7.59** |
| D1 rows W / R | 1.2k / 3.6k — incl | 12k / 36k — incl | 120k / 360k — incl |
| R2 storage | ~0.5 GB — incl | ~4.8 GB — incl | ~48 GB → 38 × $0.015 = **$0.57** |
| R2 A / B ops | 3.6k / 1.5k — incl | 36k / 15k — incl | 360k / 150k — incl |
| KV W / R | 1.2k / 2.4k — incl | 12k / 24k — incl | 120k / 240k — incl |
| Email sends | 300 — incl | 3,000 — **exactly** the included line | 30,000 → 27 × $0.35 = **$9.45** |
| Workflow steps | 1,200 — incl | 12k — incl | 120k — incl (24% of 500k) |
| Queue ops | 1,800 — incl | 18k — incl | 180k — incl |
| AE datapoints | 1.5k — incl (unbilled) | 15k — incl | 150k — incl |
| **Monthly total** | **$5.00** (base only) | **$5 + 6.98 ≈ $11.98** | **$5 + 77.85 + 9.45 + 7.59 + 0.57 ≈ $100.46** |
| **$ / brand / mo** | $0.50 | **≈ $0.12** | ≈ $0.10 |

**The three design choices that dominate the number:**

1. **Browser-hours budget per brand per day.** 78% of the marginal bill at
   1,000 brands. Every second/day/brand = 30 s/brand/mo; at scale, +10 s/day ≈
   +$0.75/mo per 1,000 brands per second-of-cadence. Snapshot cadence and
   session length are the throttle — poll-fetch first, browse only on signal.
2. **Judgment-call size and model.** Workers AI is the #2 line at 1,000 brands.
   The input-side neuron spread across usable models is ~80× (granite-micro
   1,542/M-in vs glm-5.3 127,273/M-in) — and output tokens carry ~63% of this
   workload's per-call neuron count (300 out × 34,868 vs 1,500 in × 4,119),
   so the *output* rate dominates. Same 2 calls/day at 1,000 brands:
   llama-8b-fp8 $7.59 → llama-3.3-70b-instruct-fp8-fast ≈$66/mo ($26.37 in +
   $40.55 out) → glm-5.3 ≈$205/mo gross ($126 in + $79.20 out; ≈$202 after
   the free allocation). Call count × prompt size × model choice is the
   lever — not "using AI less".
3. **Digest fan-out volume.** Email sends are free up to 3,000/mo — *exactly*
   100 brands × 30 days. One more daily send per brand at 100 brands, or the
   same cadence at 101 brands, starts billing at $0.35/1k. Bundling the digest
   (one send covering all of a user's brands) collapses this line to ~$0 at any
   brand count — the per-brand-per-day framing is the pessimistic bound.

**The Vectorize trap (designed out of the loop):** queried dimensions price as
`(stored vectors + queries) × dims` — every query pays a full-index scan. A
5,000-vector × 384-dim index bills ≈1.92M queried dims **per query**: ~26
queries/month exhausts the 50M paid inclusion. Similarity lookups are a lazy
lane (weekly batch or on-demand), never a per-poll step
([vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)).

## 5. The anti-pattern, priced: 2026-09-17's $105 of D1 rows-written

On 2026-09-17 this account's D1 rows-written line reached roughly **$105**. At
$1.00/M marginal beyond the 50M/mo inclusion, that is ≈**105M billable written
rows, ≈155M rows total** — an event-volume number (~5.2M rows/day pace if the
$105 accrued month-to-date across ~30 days; ~105M/day if it was a single-day
spend — either way it is not a watchlist-count number).

Same event stream, two write shapes:

| Design | Rows per 1k events | Marginal $ per 1k events | At the incident's ~155M events |
|---|---|---|---|
| **Row-per-event** | 1,000 written rows | $0.0010 | 155M rows → **$105 over inclusion** ($155 gross marginal) |
| **Batched + summarised (50 events → 1 row)** | 20 written rows | $0.00002 | 3.1M rows → **$0.00** (inside the 50M inclusion) |

**$105 vs ~$0 for the same information** — the difference is a number, not
advice. Assumptions stated: 50:1 summary fan-in (one row per entity-day per
event kind, updated in place); batching via `.batch()` does not itself reduce
row counts — the summary shape does. The 50:1 figure is the design target the
schema already supports (`signal` + per-kind detail rollups, REBUILD-SCHEMA);
if the real fan-in is 10:1 the numbers become $0.0001/1k and $15.50 gross
marginal (vs $155 gross — a 10× cut on the same frame), and the mechanism
(write a rollup, not the event) is identical.

Honest bound: per-brand watchlist writes alone (~4/day batched, ~50/day
row-per-event) stay inside the 50M inclusion even at 1,000 brands. The
guardrail exists for the **event lanes** — raw mention hits, creative diffs,
poll results — where volume is unbounded per brand. Little Bear's measured
case (§3.2) is the same shape at 31× our incident volume: 4.83B rows, $4,779,
cause = writes that should have been deduplicated updates.

The guardrails this justifies, verbatim from the packet: **D1 writes batched
and summarised, never row-per-event; snapshots and screenshots in R2, never
base64 in D1; hot counters in KV or DO storage, not D1; Browser Rendering and
Workers AI budgeted per brand per day.**

## 6. Guardrails that are stock — no custom cost watchdogs

Every knob below ships with the platform; the rebuild configures, it does not
build.

- **Budget alerts** — email when usage-based spend crosses a dollar threshold
  ([billing/budget-alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)).
  This is the control that was *not configured* in the Little Bear incident —
  the platform has it; use it.
- **Billable usage dashboard** — daily usage-based cost across the account
  ([billing/billable-usage](https://developers.cloudflare.com/billing/manage/billable-usage/)).
- **Per-Worker CPU cap** — `limits.cpu_ms` in wrangler config / dashboard CPU
  Limits; the denial-of-wallet ceiling on any single invocation
  ([workers pricing → Custom limits](https://developers.cloudflare.com/workers/platform/pricing/)).
- **Workers AI daily free allocation** — 10,000 neurons/day then calls error;
  the free tier is itself the circuit breaker
  ([workers-ai pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)).
- **Browser Rendering concurrency cap + per-call meter** — 3 (free) / 10
  monthly-averaged (paid) concurrent browsers; `X-Browser-Ms-Used` on every
  response is the stock usage telemetry
  ([browser-run pricing](https://developers.cloudflare.com/browser-run/pricing/)).
- **D1 hard daily limits on Free** — reads/writes error past the ceiling
  rather than billing silently
  ([d1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)).
- **Per-query attribution** — `meta.rows_read`/`rows_written` on every D1
  response and GraphQL `d1QueriesAdaptiveGroups` for the ranked list of what
  is actually spending ([d1 metrics-analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)).
- **Queue retention/DLQ bounds** — 4-day default retention, configurable to
  14; DLQ write ops are priced and bounded ([queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)).

## 7. What this doc does not do

- No tier recommendation and no spend-increase recommendation — pricing
  changes and plan choices are Nish's.
- No custom cost watchdog, calculator script, or helper — the model above is
  the table; stock guardrails (§6) are the enforcement.
- No invented or remembered figures: every cell traces to a page read
  2026-09-21; re-read the sheet before pricing a packet months from now.
