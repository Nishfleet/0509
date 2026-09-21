# Engine: ads across every platform

Issue #3891. Umbrella #3842 (ads addendum, Nish 2026-09-21). Author: the Opus architect, **2026-09-21**. Every platform below was probed from this VPS today; times UTC. Meta first, then the order the probes justify.

The job: every tracked brand's live advertising, from the platforms' own transparency surfaces, as signals with creatives, first-seen and last-seen — adding a platform is a row plus a field map, never a migration.

---

## The two candidate shapes

### Candidate A — one adapter per platform, each owning its own transport

Ten platforms, ten modules. Each fetches the way its platform requires — some plain `fetch`, some a browser session — parses its own response, and writes its own signals.

- Each platform's oddities stay in one file; a change at Meta cannot break Google.
- It is the obvious shape and the one the old app grew.
- Ten copies of the same retry, rate-limit, budget-accounting, hash-gate and write path. The browser-concurrency cap becomes a rule ten files must remember, which is the definition of a cap that will be broken.

### Candidate B — two transports, N descriptors

The probes below show every ad-transparency surface falls into exactly **two** buckets: an official API behind a token, or a client-rendered UI that refuses a datacenter fetch and needs a real browser. So the engine ships **two transport modules** — `api` and `browser` — and each platform is a **row in `source`** carrying its descriptor (endpoint or URL template, params, the wait-for selector for the browser route, its rate limit, its `reliability`) plus **one pure field-map function** that turns that platform's payload into the common creative shape.

- Adding a platform is a `source` row plus one pure function — exactly the expandability bar the schema exists to serve.
- The browser cap, the budget, retries and the write path exist once, in the transport, where they can be enforced.
- A descriptor that grows conditionals becomes a hand-rolled DSL, which is precisely the glue this rebuild deletes.

## Screening

**The deciding question is where the browser cap lives.** Nish's standing rule (2026-09-21) makes 10 concurrent browsers a config value that only he raises, with a measured escalation path when a sweep cannot finish. In Candidate A that rule is a comment in ten files. In Candidate B it is `max_concurrency: 8` on one queue consumer, and no adapter can even reach a browser except through it.

**Where A is genuinely better:** a platform whose payload does not fit the common creative shape. Meta gives creative bodies, images and a page id; Google's transparency surface gives advertiser, format and date ranges; TikTok's gives spend and impression bands.

**Where both are equal:** normalisation. Either way, one function per platform maps a payload to the shape.

## Decision

**Candidate B wins**, on cap enforcement.

**Grafted from A, and this is the graft that keeps B honest:**

1. **The descriptor is a `zod` schema with a closed field set, not a language.** Endpoint template, method, params, auth kind, wait-for selector, pagination cursor path, rate limit, reliability. No conditionals, no expressions. **A platform that needs anything outside that set gets a real adapter module** — Candidate A's shape, for that one platform. Two transports, not a rule engine.
2. **One pure `map<Platform>` function per platform**, in its own file, with its own fixture test. That is where platform knowledge lives and where a platform's payload change gets fixed.
3. **Fields the common shape cannot hold go to `payload_json` on the signal**, and are promoted to real columns only when a view needs to filter on them — an additive migration, decided then, not now.

**Rejected from A, recorded:** per-platform transports. If a platform ever needs a transport that is neither an API call nor a page render, that is a third transport with a paragraph of justification, not ten.

---

## Live probes — one per platform, all on Gymshark

| # | Platform | Surface | Call | Result |
|---|---|---|---|---|
| 1 | **Meta** | Graph `ads_archive` | `GET graph.facebook.com/v23.0/ads_archive?search_terms=gymshark&ad_reached_countries=["GB"]` | **500** `{"error":{"message":"An unknown error has occurred.","type":"OAuthException","code":1,"fbtrace_id":"AXzg5va6rGJWuxBH11ojtGK"}}` at **12:13:06Z** — no token |
| 2 | **Meta** | Ad Library UI backend | `POST facebook.com/ads/library/async/search_ads/` | **403**, 481 B, a JS challenge body: `fetch('/__rd_verify_Q_6hBQRrniuO4k5xmCsdY_hwHHIwU3qkZAPgY-zRESOhyeKLGw?challenge=3')` at **12:13:07Z** |
| 3 | **Meta** | Ad Library UI page | `GET facebook.com/ads/library/?q=gymshark&country=GB` | **403**, 481 B, same challenge at **12:13:08Z** |
| 4 | **Meta** | **through a real browser** | `GET https://0509.io/search?website=gymshark.com` (the deployed Worker's Browser Rendering leg) | **200**, 134,877 B, **15.55 s**, `data-f9-result-source="meta_library_browser"`, at **12:13:25Z** — real ad archive ids **1035896478962196**, **714074828146579**, **1847470879199109** |
| 5 | **Google** | Ads Transparency RPC | `POST adstransparency.google.com/anji/_/rpc/SearchService/SearchAdvertisers` | **400** `com.google.apps.framework.request.BadRequestException: Trouble converting f.req=… to class com.google.ads.integrity.transparency.reporting.SearchAdvertisersRequest`; a different field shape gave **200 `{}`**, at **12:13:18Z** and **12:14:24Z** |
| 6 | **Google** | Ads Transparency UI | `GET adstransparency.google.com/?region=GB&domain=gymshark.com` | **200**, 2,565,927 B, **zero** `AR…` advertiser ids and **zero** `CR…` creative ids in the HTML, at **12:14:42Z** — client-rendered |
| 7 | **TikTok** | Commercial Content Library UI | `GET library.tiktok.com/ads?region=GB&adv_name=gymshark` | **200**, 38,787 B — an app shell, at **12:14:02Z** |
| 8 | **TikTok** | official Research Ad Library API | `POST open.tiktokapis.com/v2/research/adlib/advertiser/query/` | **401** `{"error":{"code":"access_token_invalid"}}`, `log_id 20260921121402B47E0AD10F81EE04EC74`, at **12:14:02Z** |
| 9 | **TikTok** | guessed library API paths | `library.tiktok.com/api/v1/{search/advertiser,adv/search,ads/search}` | **404**; `/api/v1/search` → **421 "params error"**, at **12:14:58Z** |
| 10 | **LinkedIn** | Ad Library | `GET linkedin.com/ad-library/search?keyword=gymshark` | **403**, 4,570 B, at **12:13:20Z** |
| 11 | **Reddit** | Ad Library | `GET reddit.com/ad-library/` | **200**, 8,408 B, at **12:14:29Z** |
| 12 | **Snap** | political ads | `GET snap.com/political-ads` | **200**, 603,920 B; `transparency.snap.com` → **no DNS record**, at **12:14:29Z** |
| 13 | **X** | ad repository | `GET ads.x.com/ad-repository/search?q=gymshark` | **404**, at **12:14:29Z** |
| 14 | **Pinterest** | ad library | `GET ads.pinterest.com/ad-library/?q=gymshark` | **404**, at **12:14:29Z** |
| 15 | **Amazon** | ad library | `GET amazon.com/adlib` | **404**, at **12:14:29Z** |
| 16 | **Apple** | ad transparency | `GET ads.apple.com/transparency` | **404**, at **12:14:29Z** |

**Probe 4 is the load-bearing one.** Nineteen seconds after Meta's own endpoints returned 403 with a bot challenge to this VPS, the **same upstream, through a real browser in a deployed Worker, returned real ads** — three archive ids anyone can open at `facebook.com/ads/library/?id=1035896478962196`. That single pair is the entire argument for the browser transport, measured rather than asserted, and it is the same finding `REBUILD-KEEPLIST.md` recorded from the other direction.

**Probe 5 deserves a decision, not just a row.** The Google RPC is reachable and it type-checks its input — it named the protobuf message it wanted. It would be possible to brute-force the field map. **Rejected:** an undocumented, unversioned protobuf field map that we discovered by fuzzing is hand-rolled glue that will break silently and without warning, which is exactly the TikTok failure mode `REBUILD-KEEPLIST.md` finding 2 records (0 of 22 captures in 8 days with the flag reading active). Google gets the browser transport like everyone else.

### The build order the probes justify

| Rank | Platform | Transport | Spend | Why here |
|---|---|---|---|---|
| 1 | Meta | browser | $0 | proven live today, ids cited; the flagship signal |
| 2 | Reddit | **fetch** | $0 | the only library that answered a plain datacenter fetch — cheapest signal per unit of work in the whole engine |
| 3 | Google Ads Transparency | browser | $0 | largest coverage after Meta; UI is client-rendered |
| 4 | TikTok | **api**, pending approval | $0 | the official Research Ad Library API exists and answered with a typed auth error — **a Nish item: apply for API access**. Browser route on the UI shell meanwhile |
| 5 | LinkedIn | browser | $0 | 403 to fetch, renders for a browser |
| 6–10 | Snap, X, Pinterest, Amazon, Apple | **parked** | — | no reachable search surface at the obvious URLs today (404 / NXDOMAIN). Each needs someone to *find the URL*, which is a research task, not an engineering one. Parked with the evidence above so it is not re-probed blind |

This replaces #3891's stated order (Meta, then Google, then "one adapter per remaining platform"): **Reddit moves ahead of Google** because it is a plain fetch, and five platforms are parked with evidence rather than scheduled.

---

## Data flow against the schema

| Step | Reads | Writes |
|---|---|---|
| Select | `watch JOIN entity WHERE entity.state='on'` and `source.kind='ads'` | — |
| Collect | `source` (descriptor, rate limit, reliability) | R2: the raw payload per (watch, tick); `snapshot`: **one row** per watch per tick with `payload_r2_key`, `payload_hash`, `item_count`, `fetched_at` |
| Diff the ad set | the previous `snapshot.payload_hash` for that watch | nothing when the hash is unchanged — no creative rows, no screenshots, no Jev |
| New creatives | — | `signal` rows, `kind='ad'`, one **per creative**, never per impression or per element; the creative screenshot and image go to R2 by key |
| Dedup | existing `signal` rows for the entity | `jev_verdict` (D8) only for the cross-platform / re-upload case |
| Materiality | `signal` history | `jev_verdict` (D6-style), and `alert` only when the verdict passes |

**The two rules this table exists to enforce** (`REBUILD-COST.md`): one `snapshot` row per watch per tick, and never a row per observed element. A brand running 400 live creatives writes **one** snapshot row on an unchanged tick, and on a changed tick writes only the creatives that are new. The $105 rows-written bill of 2026-09-17 was the other shape.

## Workflow / Queue / cron layout

```
cron "0 2 * * *"  (daily, 02:00 UTC)
  └─ AdsSweepWorkflow (one instance per tick, all workspaces)
       step.do("select")   → watch ids for ads sources on ON entities        [≤1 MiB out: ids only]
       step.do("enqueue")  → QUEUE.sendBatch() in chunks of 100:
                               browser descriptors → page-sweep   (max_concurrency 8)
                               api/fetch descriptors → fetch-sweep (max_concurrency 20)
       step.sleep("settle", "30 minutes")
       step.do("assert")   → count snapshot rows for this tick; re-enqueue the missing,
                             bounded to one retry round
       step.do("escalate") → if coverage is still short, mark the affected sources degraded
                             and record the measured sweep time for Nish's cap decision
```

- **Coverage is asserted on outcomes, not on the trigger.** That is `REBUILD-KEEPLIST.md` finding 3 (a health check that watched the cron heartbeat reported `ok` while 1 run covered 22 watchlists) and finding 2 (TikTok: 0 of 22 captures in 8 days, flag reading active) turned into a step.
- **The browser cap is `max_concurrency: 8` on `page-sweep`** plus the two slots reserved for interactive onboarding — ten total, the config value Nish's rule names. `"BROWSER_CONCURRENCY_CAP": "10"` sits in `wrangler.jsonc` vars and a test asserts `page-sweep.max_concurrency + RESERVED_INTERACTIVE === BROWSER_CONCURRENCY_CAP`.
- **When the sweep cannot finish in its window at the cap:** the `escalate` step prioritises ON brands' Meta and Google sweeps over the long tail, records the measured wall-clock and queue depth, and raises them to Nish the same day with a proposed cap and its $2-per-browser-per-month cost. It never silently drops a brand.
- Both queues carry `max_retries: 3`, `max_batch_size: 10`, `max_batch_timeout: 5` and a **dead-letter queue**; without a DLQ, messages at the retry limit are deleted permanently.
- Steps per instance: 5. One instance a day = **150 steps a month**.

**Browser session discipline** (`REBUILD-STACK.md` §4.3): the consumer reuses sessions via `puppeteer.sessions()` → `connect()` → **`disconnect()`**, never `close()`, because closing re-pays the cold-launch seconds and burns the 3-new-browsers-per-second limit, which bites before concurrency does on a bursty sweep. Every session logs its `X-Browser-Ms-Used`.

## Jev decisions used

| Id | Primitive | When it runs | Context pack fields |
|---|---|---|---|
| **D8** `duplicate_signal` | Noul | **only** when two creatives are not identical by id — the same ad seen on two platforms, or re-uploaded with a new id | `subject`, `item` = both creatives with their normalised copy hashes, `history_30d` |
| **D6-style** `ad_move_matters` | Noul | **only** when the ad set changed materially: new creatives ≥ 3, or the set shrank by ≥ 30%, or a new format appeared. Budgeted to **2 calls per brand per day** | `self`, `subject`, `item` = the change summary and up to five creative excerpts, `history_30d` = the brand's last 30 days of ad moves, `user_memory` = "not noteworthy" marks, `reliability` from the `source` row |
| **D4** `read_this_first` | Noul + Score | weekly, over items that already passed D6 | as the contract defines; ads compete with every other kind here |

**Exact id equality is code's job, not Jev's.** Two rows with the same `(platform, ad_archive_id)` are the same ad — ground truth, so `REBUILD-JEV.md`'s exclusion applies and D8 is never called for it. D8 exists for the genuinely ambiguous case, which is the only case worth paying for.

**Budget exhaustion marks items `unreviewed`; it never silently skips** (`REBUILD-JEV.md` principle 6).

## Cost line

Per 1,000 ad pulls, priced from `REBUILD-COST.md` (2026-09-21):

| Leg | Units | Per 1,000 pulls |
|---|---|---|
| Browser pull (Meta, Google, LinkedIn) — measured 6.97 s for Gymshark in the cost doc | browser-seconds | 6,970 s = **1.94 browser-hours** → **$0.17** beyond the 10 h allotment |
| Fetch pull (Reddit, TikTok API once approved) | subrequests | 1,000 — free |
| Queue | 1 message × 3 ops, plus retries | 3,000 ops — **$0.0012** |
| R2 | 1 payload PUT + ~2 creative image PUTs on a changed tick | ~3,000 Class A (**$0.0135**), ~0.5 GB-mo (**$0.008**) |
| D1 | 1 snapshot row always + ~2 signal rows on a changed tick (~30% of ticks) | ~1,600 rows — **0.003% of the 50M included** |
| Jev | ≤2 calls per changed pull ≈ 600 | $0 on the seat, **$0.0096** at the measured market rate |

**Monthly at 100 brands**, daily cadence, Meta + Google browser plus Reddit fetch:

- Browser: 100 × 2 × 6.97 s × 30 = **11.6 browser-hours** → 1.6 h beyond the allotment → **$0.15/month**.
- D1: 100 × 3 × 30 = 9,000 snapshot rows + ~1,800 signal rows = **10,800 rows written**, 0.02% of the 50M included → **$0.00**.
- R2: ~27,000 Class A ops → **$0.12**; ~4 GB stored under the 1-year guardrail retention → **$0.06**.
- Queues: 27,000 ops → **$0.01**.
- Jev: ~1,800 calls → **$0 on the seat**, $0.03 at market.

**Total Cloudflare cost at 100 brands: about $0.34 a month**, entirely dominated by browser duration, exactly as `REBUILD-COST.md` predicts. Adding LinkedIn as a third browser platform adds ~$0.08/month. **Adding a platform never changes the shape of this bill; adding a *page* per platform would.**

## Failure modes and the degraded state the UI shows

| Failure | Detection | What the user sees |
|---|---|---|
| A platform starts returning zero for everyone | `snapshot.item_count = 0` across brands for 2 consecutive ticks | that source shows **degraded** on every competitor page with the date it last returned data, and the `assert` step raises it. This is the TikTok silent-failure class; it must be impossible to have a source "active" and empty for 8 days |
| A platform blocks us | non-2xx or challenge body | marked degraded, **not retried harder** — the rate limit lives on the `source` row and is honoured by the Workflow, never by a sleep loop (`REBUILD-GUARDRAILS.md`) |
| Browser cap saturated, sweep overruns its window | the `assert` step's coverage count and measured wall clock | ON brands' Meta and Google data stay current; the long tail shows "updated yesterday" with the real timestamp. Nish gets the measured number and the proposed cap the same day |
| A creative's image 404s | fetch status | the signal shows with copy and a placeholder, never a broken image; the R2 key is absent, not empty |
| A brand is turned off | `entity.state != 'on'` in the select | collection and alerts stop; history stays; turning it on resumes from where it left off |
| Jev budget exhausted for the day | budget counter | new creatives are shown as **unreviewed** in the feed, ordered low, and judged on the next tick. Never dropped |
| Token expiry on an API descriptor | 401 | that source degrades to the browser transport if one exists, otherwise degraded in the UI with "we're reconnecting this source" |

---

## PACKETS

### P1 — the source descriptor and the two transports

**GOAL.** A `zod` descriptor schema with a closed field set, plus `transportApi(descriptor, target)` and `transportBrowser(descriptor, target)` returning `{ payload, status, ms, browserMsUsed? }`. No platform knowledge in either.

**STOCK FEATURE OR LIBRARY.** `zod` **4.6.5**; `fetch` with `AbortSignal.timeout`; Browser Rendering binding — Quick Actions (`/content`, `/screenshot`) where a wait-for selector is not needed, `@cloudflare/puppeteer` **1.4.0** sessions where it is, with `sessions()` → `connect()` → `disconnect()`.

**FILES IN SCOPE.** `app/lib/ads/descriptor.ts`, `app/lib/ads/transport-api.ts`, `app/lib/ads/transport-browser.ts`, `tests/unit/ads/descriptor.test.ts`.

**FORBIDDEN.** Conditionals or expressions inside a descriptor — it is data with a fixed shape. `browser.close()`. Opening a browser outside the `page-sweep` consumer. A third transport. Platform names appearing anywhere in these three files.

**PROOF REQUIRED.** Both transports exercised against real targets from the deployed Worker, with status, ms and `X-Browser-Ms-Used` cited. A descriptor that fails `zod` validation shown rejected at load, not at call time.

**PUSH.** `wip/issue-3891-p1`.

**COST.** Browser transport ~7 browser-seconds per call; the api transport, nothing measurable. State the per-call figure in the PR.

### P2 — Meta: the descriptor row and the field map

**GOAL.** The first `source` row (`platform='meta'`, `kind='ads'`, `reliability='scraped_page'`) and `mapMeta(payload) → Creative[]` with `{ platformCreativeId, copy, mediaUrls[], firstSeen, lastSeen, format, landingUrl }`, proven on a real advertiser.

**STOCK FEATURE OR LIBRARY.** P1's browser transport; `HTMLRewriter` for extraction; `zod` **4.6.5** for the creative shape.

**FILES IN SCOPE.** `app/lib/ads/platforms/meta.ts`, `migrations/` **only** the `source` row seed (a row, not a schema change), `tests/unit/ads/meta.test.ts`, `tests/fixtures/meta-gymshark-2026-09-21.html`.

**FORBIDDEN.** Copying any file from the pre-wipe tree. `git show 668d2452c:<path>` in a read-only worktree is allowed **for upstream API facts only** — endpoint shapes, parameter names, response keys — and the PR must say which facts were read from where. A schema migration: a platform is a row. Calling the Graph API without a token and treating the 500 as a transient error — probe 1 shows it is an `OAuthException`, which is permanent until Nish provides a token.

**PROOF REQUIRED.** A real advertiser's live creatives pulled by the deployed Worker, with at least three `ad_archive_id`s that resolve at `facebook.com/ads/library/?id=<id>`, the snapshot row id, the R2 key and the timestamp. Show the paired evidence this design rests on: a plain fetch to the same Meta endpoint returning 403 in the same run.

**PUSH.** `wip/issue-3891-p2`.

**COST.** 1 browser pull per brand per day ≈ 7 browser-seconds. At 100 brands: 5.8 browser-hours/month.

### P3 — the sweep Workflow, the queues and the cap

**GOAL.** `AdsSweepWorkflow` with the five steps above, both queue consumers with DLQs, the cron, and the cap assertion.

**STOCK FEATURE OR LIBRARY.** Workflows (`step.do` retries, `step.sleep`), Queues (`max_concurrency`, `dead_letter_queue`), Cron Triggers, D1 `batch()`.

**FILES IN SCOPE.** `workers/ads-sweep-workflow.ts`, `workers/queue-consumers.ts`, `workers/schedule.ts`, `wrangler.jsonc`, `tests/integration/ads/sweep.test.ts`.

**FORBIDDEN.** Work done inline in `scheduled()`. A `step.do` per watch — one step enqueues them all. Returning payloads from a step instead of R2 keys (1 MiB cap). A queue without a DLQ. Any `max_concurrency` on `page-sweep` above 8 without Nish's recorded yes and the $2/browser/month cost written in the PR. `setTimeout`/`setInterval`.

**PROOF REQUIRED.** One real tick: instance id, the enqueued count, the covered count from the `assert` step, at least one `step.do` retry in the run history, and one message shown landing in the DLQ after its retries. The cap assertion failing in a test when `max_concurrency` is set to 9.

**PUSH.** `wip/issue-3891-p3`.

**COST.** 5 steps a day = 150 steps a month. Queue ops = 3 per watch per tick; state the monthly figure at 100 brands.

### P4 — creatives as signals, with dedup

**GOAL.** Turn a pulled creative set into `signal` rows: new creatives inserted with `first_seen`, existing ones touched with `last_seen` in the same `batch()`, images and screenshots to R2 by key, and D8 called only for the ambiguous duplicate.

**STOCK FEATURE OR LIBRARY.** D1 `batch()`; R2 binding; the Jev client from the identity engine's P4.

**FILES IN SCOPE.** `app/lib/ads/persist.ts`, `app/lib/ads/dedup.ts`, `tests/integration/ads/persist.test.ts`.

**FORBIDDEN.** A row per observed element — the $105 anti-pattern, named here so it cannot be claimed it was not known. Base64ing an image into a D1 row. Calling D8 for exact `(platform, ad_archive_id)` matches — that is arithmetic. Awaiting prepared statements in a loop instead of `batch()`. Any hand-rolled fuzzy matching beyond the stored normalised hashes that feed D8.

**PROOF REQUIRED.** A real brand's pull shown writing exactly one snapshot row plus N signal rows where N is the count of genuinely new creatives, with the row ids and the D1 rows-written figure for the run. One D8 verdict on a real near-duplicate with its probability, and one exact-id duplicate shown collapsing **without** a Jev call.

**PUSH.** `wip/issue-3891-p4`.

**COST.** State D1 rows written per pull and the monthly total at 100 brands. It must not exceed 1 snapshot row + new creatives.

### P5 — Reddit (fetch) and Google (browser) as rows

**GOAL.** Prove the descriptor claim by adding two more platforms with **no change to the transports**: Reddit on the api/fetch transport, Google Ads Transparency on the browser transport.

**STOCK FEATURE OR LIBRARY.** P1's transports unchanged; one `map` function each; two `source` rows.

**FILES IN SCOPE.** `app/lib/ads/platforms/reddit.ts`, `app/lib/ads/platforms/google.ts`, the two `source` row seeds, their fixture tests.

**FORBIDDEN.** Any edit to `transport-api.ts` or `transport-browser.ts` — if one is needed, stop and say so in the PR; that is the descriptor design failing and it is a finding, not a patch. A migration. Reverse-engineering the `adstransparency.google.com` protobuf RPC: probe 5 shows it type-checks its input and would be brute-forceable, and it is rejected as undocumented glue that breaks silently.

**PROOF REQUIRED.** Both platforms returning real data for a real advertiser, cited with ids and timestamps, and a diff showing zero lines changed in the transport files.

**PUSH.** `wip/issue-3891-p5`.

**COST.** Reddit: one sub-second fetch, no browser. Google: ~7 browser-seconds, taking the engine to 11.6 browser-hours/month at 100 brands (1.6 h beyond the allotment, **$0.15/month**).

### P6 — materiality, the feed and the degraded surface

**GOAL.** The material-change gate (≥3 new creatives, or ≥30% shrink, or a new format), the D6-style judgment behind it with its 2-per-brand-per-day budget, the ads block on the competitor page, and the per-source degraded state.

**STOCK FEATURE OR LIBRARY.** The Jev client; React Router **8.4.0**; `shadcn` **4.21.0**; a Durable Object for the per-brand-per-day Jev and browser budget counters — **not KV**, whose same-key write limit is 1/s and whose writes cost 10× reads (`REBUILD-STACK.md` §4.5).

**FILES IN SCOPE.** `app/lib/ads/materiality.ts`, `workers/budget-counter.ts`, `app/routes/competitors.$id.tsx`, `e2e/competitor-ads.spec.ts`.

**FORBIDDEN.** Calling Jev on every pull. Acting on a verdict in the uncertain band — mark it uncertain and rank it low, and log the probability either way. A legend on the ads block: if it needs one, the design failed (charter addendum, Nish 2026-09-21). Silently skipping when the budget is exhausted — items go to `unreviewed`.

**PROOF REQUIRED.** One real material change with its Jev `question_id`, `input_hash`, probability, reason and the alert it produced; one unchanged tick shown making **no** Jev call at all; one verdict in `0.1 < p < 0.9` shown marked uncertain and ranked low. Playwright at 1440 and 390, no console errors, no horizontal scroll.

**PUSH.** `wip/issue-3891-p6`.

**COST.** ≤2 Jev calls per brand per day = 6,000/month at 100 brands; $0 on the seat, $0.10 at the measured market rate. One DO per workspace-day for the counters.
