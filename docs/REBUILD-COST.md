# REBUILD cost model — what one tracked brand costs

Issue #3881 / umbrella #3842. Authored by the deputy orchestrator, **2026-09-21**. Every price below was read from Cloudflare's own docs on that date and is cited. Prices move; a figure without a date is worthless.

This replaces the earlier fleet-written cost doc wholesale. Nothing was carried over.

## The price sheet, Workers Paid, read 2026-09-21

| Product | Included | Beyond included |
|---|---|---|
| Workers | 10M requests, 30M CPU-ms / mo | per [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 rows read | 25 billion / mo | $0.001 / million |
| D1 rows written | **50 million / mo** | **$1.00 / million** |
| D1 storage | 5 GB | $0.75 / GB-mo |
| R2 | 10 GB storage, 1M Class A, 10M Class B ops | per [R2 pricing](https://developers.cloudflare.com/r2/pricing/); **no egress fee** |
| KV | 10M reads, 1M writes, 1M deletes, 1 GB / mo | $0.50 / M reads, $5.00 / M writes |
| **Browser Rendering** | **10 browser-hours / mo, 10 concurrent browsers** | **$0.09 / browser-hour**, **$2.00 / additional concurrent browser** (averaged monthly) |
| Workers AI | 10,000 neurons / day | $0.011 / 1,000 neurons |
| Queues | 1M operations / mo | $0.40 / million |

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [Browser Rendering pricing](https://developers.cloudflare.com/browser-rendering/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [usage-based products](https://developers.cloudflare.com/billing/).

**Jev is not on this sheet.** It runs through TypeSafe via the LiteLLM router, not Workers AI, so its cost is a seat cost and is budgeted per engine packet. Workers AI appears here only for OCR and translation.

## What one brand costs per day

Measured, not estimated. Timings I took on 2026-09-21 against real endpoints:

| Leg | Tool | Measured |
|---|---|---|
| Ads pull (Meta Ad Library) | Browser Rendering | **6.97 s** (production `/search?website=gymshark.com`; 6.27 s for `allbirds.com`) |
| Site snapshot | Browser Rendering | ~8 s allowed (cold Chrome; curl on the same homepage was 0.67 s, but workerd is bot-gated there) |
| Mentions — Google News RSS | plain fetch | 0.45 s |
| Mentions — HN Algolia | plain fetch | 0.35 s |
| Hiring — Greenhouse | plain fetch | 0.25 s |

Only two legs touch a browser. **≈15 browser-seconds per brand per day** is the whole model; everything else is a Workers request and a few D1 rows.

## The bill at 10, 100 and 1,000 brands

Daily cadence, 30-day month, 15 browser-seconds per brand-day:

| Brands | Browser-hours / mo | Over the included 10 h | **Browser Rendering cost** |
|---|---|---|---|
| 10 | 1.2 | none | **$0.00** |
| 100 | 12.5 | 2.5 h | **$0.22** |
| 1,000 | 125.0 | 115 h | **$10.35** |

D1 writes under the shipped design — one `snapshot` row per watch per tick, ten sources per brand:

| Brands | Snapshot rows / mo | Against the 50M included |
|---|---|---|
| 10 | 3,000 | 0.006% |
| 100 | 30,000 | 0.06% |
| 1,000 | 300,000 | 0.6% |

**At every scale we plan for, the Cloudflare bill is dominated by Browser Rendering duration, and it is small.** R2 holds the snapshot bodies and has no egress fee. KV holds counters and cursors, comfortably inside its included tier.

## The three design choices that decide the number

1. **Only two legs use a browser.** Mentions and hiring are RSS and JSON APIs at sub-second cost. If a future source reaches for Browser Rendering because it is convenient, it costs roughly 500× the cheap path per call. The keep-list finding stands — arbitrary brand homepages genuinely need the browser — but that is a reason to use it *there*, not everywhere.
2. **The hash gate comes before the screenshot.** An unchanged page costs a fetch and a hash comparison, not a browser session. Skipping this is the difference between 15 browser-seconds per brand-day and 15 per brand-page-day.
3. **Concurrency, not duration, is the cliff.** Duration is $0.09/hour and we use very little of it. Concurrency is **$2.00 per additional concurrent browser, averaged over the month** — so ten extra concurrent browsers left running is $20/mo, roughly a hundred times the duration cost at 100 brands. At 15 s per brand and 10 concurrent browsers, 1,000 brands sweep in about 25 minutes of wall time, entirely inside the included concurrency. **Cap the sweep at 10 concurrent browsers and the browser bill stays near zero.**

## An honest correction to my own schema argument

In `docs/REBUILD-SCHEMA.md` I chose the snapshot-plus-curated design over a row-per-observed-item design partly on cost, citing ~300k D1 writes a month at 100 brands. That number is right, but **D1 includes 50 million writes a month**, so at 100 brands *both* designs cost $0 in D1. The cost argument as I framed it does not bite at our scale.

The design choice still stands, for reasons that survive the correction: it bounds write growth rather than letting it scale with everything observed, it keeps blobs out of D1 rows entirely, and it is the pattern that does not produce the failure below. But I overstated the near-term saving and the record should say so.

## The $105 anti-pattern, priced

On 2026-09-17 this account's D1 rows-written reached roughly **$105**. At $1.00 per million rows beyond the included 50 million, that is about **155 million rows written in a month** — some 5 million a day.

No design in this document approaches that: the largest here is 300,000 rows a month at 1,000 brands. Reaching 155M means writing per *observed element* rather than per item — a row per ad impression, per page element, per poll result — which is the pattern the batching rule exists to forbid. The lesson priced: **the gap between "a row per item" and "a row per element" is the gap between $0 and $105.**

## Guardrails, as numbers

- Browser Rendering: **≤ 10 concurrent browsers**, a config value. Raising it costs $2 per extra concurrent browser per month and needs Nish's deliberate yes, recorded in the PR with the cost. No agent leaves it hanging while customers wait: if a sweep cannot finish in its window at the cap, escalate to Nish the same day with the measured number and a proposed cap, and meanwhile prioritise ON brands' home and pricing pages over long-tail pages. Never drop brands silently. Duration budget ≤ 20 browser-seconds per brand per day.
- D1: no write per observed element. Snapshots are one row per watch per tick; signals are one row per item that survived judgment.
- Blobs — screenshots, raw payloads, HTML — in **R2**, never base64 into a D1 row.
- Hot counters (poll cursors, budgets, tallies) in **KV or a Durable Object**, never a D1 write per increment.
- Billing notifications set at **$10 and $25**, so the first surprise arrives as an email rather than as an invoice.
