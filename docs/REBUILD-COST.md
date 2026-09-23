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

That 15 seconds is the stopwatch timing in the table above, taken 2026-09-21. It is not a production counter. The GraphQL week is the next section, and that week had 0 ON brands, so it does not replace this figure.

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

That dominance claim is still an estimate. The measured week below can price worker `0509` CPU, and it cannot attribute browser hours to that worker.

## Measured week, 2026-09-15 to 2026-09-22

Queried 2026-09-22 from Cloudflare's GraphQL Analytics API, account `f670a698e17bf160c8e4679823e68916`, window `datetime_geq` 2026-09-15T00:00:00Z and `datetime_lt` 2026-09-22T00:00:00Z. Seven UTC days. The raw responses and the brand-count SQL are in the PR that added this section.

ON brands inside the window: 0, as far as the current `entity` table can show. Production D1 `0509`, database `746c6e3d-782e-443a-82d6-28ca93a16294`, had one `entity` row with `state = 'on'` at query time. Domain `gymshark.com`, role `self`, `created_at` 2026-09-22T14:54:40.669Z, which is after the window. That table is current state, so it cannot show a brand that was ON during the week and later removed. `snapshot` rows: 0. `watch` rows: 0. No line below is divided by a brand count. A per-brand-per-day figure needs a brand that was ON during the week.

A month in the dollar column means 30/7 times the week. Workers prices were read 2026-09-22 from [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): Workers Paid is $5 per month and includes 10 million requests and 30 million CPU milliseconds, then $0.02 per extra million CPU milliseconds. Duration is not charged. R2 prices were read the same day from [R2 pricing](https://developers.cloudflare.com/r2/pricing/), page last updated 2026-08-07. Class A is the mutating and listing set on that page, Class B is the read set, and `DeleteObject` is free. Storage is $0.015 per GB-month after 10 GB, and the page rounds usage up to the next GB. Browser hours stay at the price already in the sheet above, confirmed the same day on [Browser Run pricing](https://developers.cloudflare.com/browser-rendering/pricing/): 10 hours included, then $0.09 per hour, monthly total rounded to the nearest hour. Workflow steps use the Workers pricing page: 500,000 included, then $0.80 per extra 100,000.

Worker rows are script `0509` only, `isPreview = 0`, usage model `standard`. That filter is the whole script for this window: 106,149 requests, all of them production standard. Other scripts on the same account are a different product and are not in this table. D1 rows are this database only.

| Line | Estimate in this doc | Measured this week | Per brand per day | If this week repeats for a month |
|---|---|---|---|---|
| Workers requests | a Workers request per brand-day, no count | 106,149 requests, 10 errors | none, 0 ON brands | 454,924 requests, inside 10 million, $0 |
| Workers CPU | no CPU figure | 33,980,390,340 µs in `cpuTimeUs`, which is 33,980,390 ms. Average 320 ms CPU per request | none, 0 ON brands | 145,630,244 ms. 115,630,244 ms past the included 30 million, at $0.02 per million, **$2.31** |
| D1 rows read | "a few D1 rows" per brand-day | 107,559,825 | none, 0 ON brands | 460,970,679 rows, inside 25 billion, $0 |
| D1 rows written | 10 snapshot rows per brand-day. One `snapshot` row per watch per tick, ten sources. At 0 brands that estimate is 0 snapshot rows | 223,287 rows written. The `snapshot` table has 0 rows, so these writes are the rest of the app | none, 0 ON brands | 956,944 rows, inside 50 million, $0 |
| R2 `0509-snapshots` | snapshot bodies, inside the included tier | Class A: `PutBucket` 1. Class B: 0. Payload 0 bytes, 0 objects, max on 2026-09-21 | snapshot engine has not shipped. `wrangler.jsonc` has no `r2_buckets` binding, and the snapshot table is empty | $0 |
| R2 `0509-landing-page-artifacts` | not a per-brand line in this model. The README calls this bucket an enhancement path | Class A 581: `PutObject` 548, `ListObjects` 30, `PutBucketLifecycleConfiguration` 3. Class B 1,972: `GetObject` 1650, `HeadBucket` 215, `GetBucketLifecycleConfiguration` 59, `HeadObject` 48. `DeleteObject` 65, free. Highest daily payload in the week: 53,057,656,626 bytes plus metadata 468,369 bytes, 5,592 objects, on 2026-09-17. 2026-09-21 was 52,017,118,378 bytes plus metadata 75,591 bytes, 1,717 objects | none. This bucket is not the snapshot engine | operations inside the included 1 million Class A and 10 million Class B. 53.06 GB decimal on the high day rounds up to 54 GB, then 44 GB past the included 10, times $0.015, **$0.66**. One day's storage is not a measured GB-month |
| R2 `0509-support-inbox` | not a per-brand line in this model | Class A 699: `ListObjects` 674, `PutObject` 25. Class B 816: `GetObject` 742, `HeadObject` 72, `HeadBucket` 1, `GetBucketLifecycleConfiguration` 1. Payload 5,668 bytes, 35 objects | none | inside included, $0 |
| Queue operations | the sweep's queues are described in the engine docs and are not in `wrangler.jsonc` | `queueMessageOperationsAdaptiveGroups` returned 0 rows for the whole account | queue engine has not shipped | $0 on this account this week. The sweep's queue bill is still an estimate |
| Workflow steps | the nightly workflow in `docs/REBUILD-DONE.md` is not in `wrangler.jsonc` | workflow `0509-monitoring` only. `stepCount` 0 on 2026-09-15, 0 on 2026-09-16, 4 on 2026-09-21. No other day returned a row | nightly engine has not shipped. These 4 steps are a different workflow | inside 500,000 steps, $0 |
| Browser Rendering duration | 15 browser-seconds per brand per day | `totalSessionDurationMs` summed to 62,703,271 ms, 17.42 hours, one row per date. That dataset has no script name. Events the same week: 12,042, sessions 4,015, and `scriptName` was empty on every row | none. The hours are account-wide and are not worker `0509` | not a 0509 dollar figure. Account-wide, 17.42 hours times 30/7 is 74.65 hours, which rounds to 75 hours. 65 hours past the included 10, times $0.09, is $5.85 for the whole account |
| KV | counters and cursors, inside the included tier | `wrangler.jsonc` has no KV binding | KV counters have not shipped | still an estimate |

No ratio could be computed, so no estimate is marked wrong by more than a factor of two. Those numbers are per-brand rates, and this window has no ON brand. The snapshot-row estimate was not exercised: 0 snapshot rows, matching 0 brands. The platform still read 107,559,825 D1 rows and wrote 223,287 with no ON brand. That is the floor under the per-brand estimate, and it is what the CPU charge is made of.

Daily shape for script `0509`, same window. CPU milliseconds are `cpuTimeUs / 1000`.

| Date | Requests | CPU ms | Rows read | Rows written |
|---|---:|---:|---:|---:|
| 2026-09-15 | 7,169 | 2,008,461 | 9,476,191 | 21,654 |
| 2026-09-16 | 8,273 | 2,182,681 | 10,118,453 | 27,052 |
| 2026-09-17 | 14,325 | 4,861,671 | 16,124,118 | 41,612 |
| 2026-09-18 | 15,149 | 4,148,317 | 16,151,973 | 28,404 |
| 2026-09-19 | 26,703 | 12,062,999 | 27,913,329 | 48,230 |
| 2026-09-20 | 25,691 | 8,051,401 | 21,639,491 | 38,836 |
| 2026-09-21 | 8,839 | 664,860 | 6,136,270 | 17,499 |

2026-09-19 and 2026-09-20 are 20,114,400 of the 33,980,390 CPU ms.

**100 brands.** This week has no per-brand rate, so it does not produce a 100-brand bill. The 10, 100 and 1,000 tables above stay estimates. The measured floor, script `0509` plus this D1 database plus the empty `0509-snapshots` bucket, repeating for a 30-day month, is the $5 subscription plus $2.31 of CPU, **$7.31**. That floor leaves out the account-wide browser hours in the table above. Adding those unattributed hours, $5.85, makes $13.16, and that sum is still not the account bill, because other workers' CPU is not in the $2.31. The $7.31 is under the $10 bar in `docs/REBUILD-DONE.md` §E only as the 0509 app floor at 0 tracked brands. It is not the bill at 100, and it is not a measured per-brand unit cost. §E's bar, under $10 at the current brand count with the per-brand cost measured, is not met yet. One brand exists, and it was created after this window.

The charter line, burn near the $5 base, is the same floor: $5 plus $2.31 of CPU. Adding the landing-page bucket's highest day as if it lasted a month adds $0.66 and still sits under $10. That bucket is not the per-brand engine.

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
