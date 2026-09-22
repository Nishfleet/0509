# Engine 5 — Mentions

P3 step 5 of umbrella #3842. Written by the Opus deputy (second architect), **2026-09-21**. Contracts: `docs/REBUILD-MENTIONS.md` (#3907), `docs/REBUILD-SCHEMA.md`, `docs/REBUILD-JEV.md` (D5, D6, D8), `docs/REBUILD-STACK.md` (#3906), `docs/REBUILD-COST.md`.

Every probe below I ran myself from this VPS (netcup, German datacenter IP) on **2026-09-21 between 12:13 and 12:17 UTC**. Three of them contradict the mentions contract, and those corrections drive the design.

---

## 0. Three corrections to `docs/REBUILD-MENTIONS.md`, each proven

These are not quibbles. Each one changes what gets built.

### 0.1 Google News links cannot be resolved server-side. The contract's stated method does not work.

`docs/REBUILD-MENTIONS.md` §3 says: *"That is a `fetch(link, { redirect: "manual" })` and reading `Location` — one extra request per new item."* It is not. Four probes:

| Probe | Result |
|---|---|
| `GET <rss article link>`, no follow | **302 → `https://consent.google.com/m?continue=…&gl=DE&…`** |
| same, with `Cookie: CONSENT=YES+cb.20220301-11-p0.en+FX+111` | **302 → consent.google.com**, unchanged |
| same, `&ucbcb=1` appended | **302 → back to `news.google.com/rss/articles/…`** — consent cleared, still no article |
| `curl -sL --max-redirs 8 "<link>&ucbcb=1"` | **200, 582,999 B**, final URL still `news.google.com/rss/articles/…` |

That 583 KB terminal document is an **Angular application shell**. I grepped it for the article: `data-n-au` **absent**, `http-equiv="refresh"` **absent**, the publisher string `advertisinglaw` / `fkks` **absent**. The only non-Google absolute URLs in the whole document are `w3.org` namespaces and `angular.dev/license`. There is no `Location` and no article URL in the markup; the hop is performed by JavaScript.

I also tested decoding the `guid` directly. It is 256 base64 characters decoding to 192 bytes of protobuf whose payload begins `AU_yqLPAkOm91GfyXe1hrE7aItGey8I8bm3FFklWhnWRD9u2…` — the post-2024 opaque format, an encrypted id, **not a URL**. The pre-2024 `CBMi<len>Ahttps://…` form is gone.

**Consequence:** a Worker cannot obtain a Google News item's real article URL without either running a browser or reverse-engineering Google's `batchexecute` endpoint. The second is forbidden (no glue). The first costs browser-seconds this engine is designed not to spend. §2 is the fork this creates.

**The one thing the feed does give us for free** is the publisher origin, in an element the contract does not mention: `<source url="https://advertisinglaw.fkks.com">`. That is a real, stable, parseable publisher domain per item.

### 0.2 DuckDuckGo is not a dependable source from our egress. It 202-challenged every attempt today.

`docs/REBUILD-MENTIONS.md` §11 headlines: *"the honest-identifying UA got a 200 with results"*, and puts `ddg.html` in the MVP set. Today, same host, same honest UA string:

| Attempt | Endpoint | Result |
|---|---|---|
| 1 | `html.duckduckgo.com/html/?q="gymshark"` | **202**, 14,181 B, **0 results** |
| 2 | `html.duckduckgo.com/html/?q="gymshark" review` | **202**, 14,189 B, 0 results |
| 3 | same | **202**, 14,183 B, 0 results |
| 4 | same | **202**, 14,177 B, 0 results |
| 5 | `lite.duckduckgo.com/lite/?q="gymshark"` | **202**, 14,169 B, 0 results |
| control | `www.mojeek.com/search?q="gymshark"` | **403**, 341 B |

Five consecutive challenges and no result markers. The contract's finding was real when it was taken; it does not reproduce four hours later from the same host. The plausible cause is that this IP has been used for SERP probes by several agents today — which is itself the lesson: **a shared datacenter IP's SERP access degrades with use, so SERP is not a source you can schedule.**

**Consequence:** DuckDuckGo leaves the MVP set and becomes a registry row with `is_enabled = 0`, alongside X. The MVP set is the five sources that returned real data today. This costs the "any blog, any forum" breadth claim, and the honest replacement for it is Google News — whose first Gymshark item today is a **law firm's blog** (`advertisinglaw.fkks.com`), not a newspaper.

### 0.3 The homonym problem is live on Hacker News, in the first record returned.

`GET https://hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story&hitsPerPage=3` → 200, 4,455 B, 0.298 s, `nbHits: 10`. Top hit:

```
objectID       47123304
created_at_i   1771859456
title          New undocumented GameShark code format
url            https://social.treehouse.systems/@endrift/116118808586068716
author         throw_await
points         1   num_comments 0
```

**"GameShark", not "Gymshark".** Algolia's typo tolerance matched a retro-console cheat cartridge. This is D5 `mention_is_about_brand` with a live subject on the first record of the first source — no keyword filter would catch it, because the string genuinely differs by one character and the token is a real product name. Cite `objectID 47123304` as D5's proof item.

---

## 1. The probe table (the MVP set, all from this VPS, 2026-09-21)

| # | Source | Exact call | Status | Bytes | Time | Record proof |
|---|---|---|---|---|---|---|
| 1 | Hacker News | `GET hn.algolia.com/api/v1/search_by_date?query=<q>&tags=story&hitsPerPage=<n>` | 200 | 4,455 | 0.298 s | `objectID 47123304` |
| 2 | Google News | `GET news.google.com/rss/search?q=%22<Brand>%22&hl=en-US&gl=US&ceid=US:en` | 200 | 125,881 | 0.105 s | 100 items; item 1 `<source url="https://advertisinglaw.fkks.com">` |
| 3 | Reddit | `GET www.reddit.com/search.rss?q=<q>&sort=new` | **429** then 200 | 1,294 → 76,579 | **17.97 s** → 0.691 s | 25 entries, 22×`t3_`, 3×`t5_`; first `t5_3atwd`, `updated 2015-11-16` |
| 4 | YouTube | `GET www.youtube.com/feeds/videos.xml?channel_id=<UC…>` | 200 | 22,556 | 0.174 s | 15 entries; `yt:videoId QVx0PY1lf-s` |
| 5 | Medium | `GET medium.com/feed/tag/<tag>` | 200 | 17,155 | 0.342 s | 10 items; `guid https://medium.com/p/bd5a0a82d407` |
| — | DuckDuckGo | `GET html.duckduckgo.com/html/?q=<q>` | **202** ×4 | ~14,180 | 0.078 s | none — challenge page |
| — | GDELT | `GET api.gdeltproject.org/api/v2/doc/doc?query=…&timespan=7d` | **429** | 444 | 11.88 s | *"Please limit requests to one every 5 seconds"* |

Two numbers in that table are design inputs, not trivia:

- **Reddit's 429 took 17.97 seconds to arrive.** A rate-limited Reddit does not fail fast; it holds the connection. The onboarding contract's 8-second source timeout is therefore mandatory here, not advisory, or one Reddit poll eats a Queue consumer's budget.
- **GDELT's 429 took 11.88 seconds.** Same shape, same conclusion. GDELT stays out.

Confirmed unchanged from the contract, so not re-probed in depth: Reddit `search.rss` mixes `t5_` subreddit rows into results (3 of 25 today) and `sort=new` does not order the feed (a 2015 row came first); Medium's `link` carries a `?source=rss------<tag>-<n>` suffix so `guid` is the canonical.

---

## 2. Design it twice — where the canonical URL comes from

Everything else about this engine is forced by the contracts. This is the only real fork, and 0.1 created it.

`docs/REBUILD-SCHEMA.md` puts a conditional CHECK on `signal`: a row with `kind = 'mention'` must carry `canonical_url` and `url_hash` (`CHECK (kind <> 'mention' OR (canonical_url IS NOT NULL AND url_hash IS NOT NULL))`). `docs/REBUILD-MENTIONS.md` rule 1 then says `url_hash` is the cross-source dedup key. Google News cannot supply a real URL. So one of those two has to give.

### Candidate A — resolve before storing

Every surviving Google News item gets a Browser Run pass on its article link; the browser follows the JS hop; we store the landed URL as `canonical_url`. `url_hash` stays the dedup key exactly as the contract describes.

- The contract is satisfied literally. One rule, one key, no judgment involved in dedup.
- Click-through goes straight to the publisher.
- **Cost, measured against `docs/REBUILD-COST.md`:** the cost model budgets **15 browser-seconds per brand per day, total, for the whole product**, of which the ads pull already takes ~7 s and the site snapshot ~8 s. A Browser Run navigation of a 583 KB Angular shell is ~2 s. At 100 brands and a conservative 3 new Google News items per brand per day surviving dedup, that is 300 navigations/day × 2 s = **600 browser-seconds/day = 5.0 browser-hours/month — half the entire 10-hour included allowance, spent by one source on URL rewriting.** It also adds ~6 s per brand per day to a 15 s budget: a 40% increase for no new signal.
- It is fragile in a specific way: we would be racing a client-side redirect in a vendor's SPA, which breaks silently when Google reorganises it.

### Candidate B — store the Google URL, move dedup to D8

`canonical_url` = the `news.google.com/rss/articles/…` URL (the CHECK is satisfied; it is a real, working, public URL). `dedup_key` = `guid`. A new column-free field from the feed, `publisher`, = the host of `<source url>`. Cross-source dedup stops being string equality on `url_hash` and becomes **D8 `duplicate_signal`**, which `docs/REBUILD-JEV.md` already declares is *"the only dedup"*.

- Zero browser-seconds. Mentions stay a pure `fetch` engine, which is the premise the whole cost model rests on.
- Nothing is reverse-engineered and nothing races a vendor's SPA.
- **The click-through still works.** This is the point that decides it: Google's interstitial is broken *for a Worker*, not for a person. A human clicking the link runs the JavaScript and lands on the article. The user loses nothing; only our server-side resolver does.
- Weakness: two sources reporting the same story arrive as two rows until D8 collapses them, so dedup costs a judgment instead of a hash comparison, and it is probabilistic rather than exact.
- Weakness: the stored URL is a Google URL, so the row is less useful as an archival citation.

### Screening, and the decision

**Candidate B wins, on cost and on honesty about what we can actually do.**

Candidate A spends half the product's entire browser allowance to convert a working link into a prettier working link. The cost doc's own framing — *"only two legs use a browser… if a future source reaches for Browser Rendering because it is convenient, it costs roughly 500× the cheap path"* — describes Candidate A precisely. And the benefit it buys is nearly zero, because the user's click already works.

**Grafted from A, because A was right about one thing.** A real publisher URL is genuinely better when we can get one for free, and four of the five MVP sources hand us one. So:

1. **`canonical_url` is upgradeable.** A Google News signal starts with the Google URL. When D8 later collapses it against an item from a source that carries a real URL (HN, Medium, a watched feed), the **real URL wins** and replaces it on the surviving row. Google News is a discovery source whose URL is provisional, and the schema does not need to change for that — it is an `UPDATE` on one column.
2. **The publisher is stored on every Google News row**, in `payload_json.publisher`, read from `<source url>`'s host, so the UI can say "Frankfurt Kurnit Klein & Selz" and the standing engine can weigh outlets, without any resolution.

**Rejected from A, recorded so it is not re-litigated:** Browser Run for Google News URL resolution. The number to beat is **5.0 browser-hours per month at 100 brands** for zero new signal. If someone later argues for it, that is the figure they must argue against.

**Consequential correction to the contract:** `docs/REBUILD-MENTIONS.md` rule 1 ("`url_hash` is the cross-source dedup key") is downgraded to a *fast path*. `url_hash` equality still collapses items for free where both sources gave a real URL — that is cheap and exact and should run first. D8 is the fallback, and for Google News it is the only path. A PR that hand-writes fuzzy title matching to close the gap is rejected; that is what D8 is.

---

## 3. Data flow, against schema tables by name

```
cron ──► queue mentions-fast ──┐
   │                          ├──► poll ──► R2 body + snapshot row ──► MentionsJudge Workflow ──► signal rows
   └───► queue mentions-paced ─┘
```

1. **Cron** reads `watch JOIN entity JOIN source WHERE entity.state = 'on' AND source.kind = 'mentions' AND source.is_enabled = 1`. `entity.state = 'on'` is the only per-brand switch — delivery rule 4 ("per-brand OFF is absolute") is enforced here, at collection, not later by filtering.
2. **Queue message** is `{ watch_id, source_id, entity_id, workspace_id }`. Nothing else; the consumer re-reads what it needs.
3. **Consumer** calls the one upstream (§1), computes `payload_hash` over the response body, and writes the body to R2 at `mentions/<workspace_id>/<watch_id>/<iso-date>/<payload_hash>`.
4. **`snapshot`** gets exactly one row per watch per tick: `payload_r2_key`, `payload_hash`, `item_count`, `fetched_at`. This is the cost boundary from `docs/REBUILD-SCHEMA.md` and it is not negotiable. **If `payload_hash` matches the previous snapshot for this watch, the row is still written** (coverage and freshness must be answerable) but no judgment runs and no R2 body is re-stored — the key points at the existing object.
5. **`MentionsJudgeWorkflow`** reads the snapshot, parses items, and for each item not already present by `(source_id, dedup_key)` — the table's own UNIQUE constraint:
   - **D5** `mention_is_about_brand` → below 0.1, logged to `jev_verdict` and dropped, no `signal` row ever written.
   - **D8** `duplicate_signal` against the workspace's last 30 days → `p >= 0.9` and the middle band collapse in the UI and **keep both `signal` rows**. `p <= 0.1` keeps them separate. The survivor is the earlier `observed_at`; a tie breaks to the higher `source.reliability` (`official_api` > `rss` > `scraped_page` > `best_effort`). The duplicate gets `payload_json.collapsed_into` set to the survivor id and is not tombstoned. The survivor takes the sighting (`engagement_json`, `last_seen_at` advances) and the `canonical_url` upgrade from §2 graft 1, with `url_hash` rewritten to match. `docs/engines/mentions.md` used to say "no new row"; that wording is superseded by `docs/REBUILD-JEV.md` and the 2026-09-22 decision on #3965.
   - **D6** `mention_matters` → the row is written either way; `p` decides whether the feed shows it or hides it behind "show all".
6. **`signal`** gets a row per surviving item, `kind = 'mention'` (**singular** — see the vocabulary trap below), `snapshot_id` pointing back for the proof trail. `mention` is the view over it. No mention table exists.
7. **`jev_verdict`** takes every call, unique on `(question_id, input_hash)` — the contract's cache, enforced by the database.
8. **`user_decision`** feeds the next context pack: a user marking a mention "not noteworthy" is read into `user_memory` for that subject's later D6 calls.
9. **`alert`** rows are written for D6 `p >= 0.9` items per the delivery contract's Alerts column. This engine writes alerts; it never sends anything. Engine 7 owns sending.

**The canary, per source, is source state, not a brand result.** `docs/REBUILD-MENTIONS.md` §7 earned this rule with Substack's 200-and-nothing. Each source's registry row carries a canary query with a known-nonzero expectation; the consumer runs it once per tick and stores the count, the degraded reason, and the last-good time on `source.config_json` (main has no canary column). Canary zero ⇒ the **source** is marked degraded, not the brand. Without this, DuckDuckGo's 202-with-a-14 KB-body would have been recorded as "no mentions this week" forever, which is exactly the failure that was sitting in the MVP set this morning.

---

## 4. Workflow / Queue / cron layout, with the numbers

Per `docs/REBUILD-STACK.md` §4.10, the tick is **cron → enqueue → consumer**, never work inline in `scheduled`.

```jsonc
"triggers": { "crons": ["17 2 * * *"] },
"queues": {
  "producers": [
    { "queue": "mentions-fast",  "binding": "MENTIONS_FAST" },
    { "queue": "mentions-paced", "binding": "MENTIONS_PACED" }
  ],
  "consumers": [
    { "queue": "mentions-fast",  "max_batch_size": 10, "max_batch_timeout": 30,
      "max_retries": 5, "max_concurrency": 10, "dead_letter_queue": "mentions-dlq" },
    { "queue": "mentions-paced", "max_batch_size": 1,  "max_batch_timeout": 30,
      "max_retries": 3, "max_concurrency": 1,  "dead_letter_queue": "mentions-dlq" }
  ]
}
```

**Why two queues and not one.** `max_concurrency` is a per-queue config value, and the sources fall into two rate classes that cannot share one. Reddit 429s on a second request within fifteen seconds from this IP and takes 18 seconds to say so; Google News and HN answer in 0.1–0.3 s and tolerate parallelism. One queue would force every source down to concurrency 1 and stretch a 100-brand sweep from minutes to hours.

| Queue | Sources | `max_concurrency` | Why that number |
|---|---|---|---|
| `mentions-fast` | Google News, HN Algolia, YouTube, Medium | **10** | Sub-second, no observed rate limit. 400 polls at 100 brands finish in ~1 minute. |
| `mentions-paced` | Reddit (and DuckDuckGo, GDELT, X when enabled) | **1** | Reddit 429 measured on a second request in ~15 s. 100 polls, one at a time, ~25 minutes. Inside the daily window with room. |

- **`17 2 * * *`**, not `0 2 * * *`: off-the-hour so the mentions sweep does not collide with the ads and site-change sweeps on the same account's browser and Queue budgets.
- **Hard timeout 8 s per upstream call** (`docs/REBUILD-ONBOARDING.md`), enforced by `AbortSignal.timeout(8000)` on the fetch. This is what stops Reddit's 18-second 429 from consuming the consumer.
- **`dead_letter_queue` is mandatory.** The stack doc: *"messages that reach the retry limit are deleted permanently."* A silently dropped brand-source pair is the failure this engine must not have.
- **Workflow step discipline.** Steps are the billing unit (500,000 included, then $0.80/100k) with a 1 MiB output cap per step. D5 calls are batched **ten items per `step.do`**, and a step returns verdict ids and item ids — never bodies, never the payload. One step per external boundary, not one per line.
- **Retries** are `step.do`'s built-in `{ retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }`. No sleep loop, no retry helper.

---

## 5. Jev decisions and the context-pack fields each one needs

| Id | When it runs | Context-pack fields actually needed | Action |
|---|---|---|---|
| **D5** `mention_is_about_brand` | once per new item, before any `signal` row exists | `self`, `subject` (card: name, domain, category), `item` (title, body excerpt, source, URL, captured-at), `reliability` | `p >= 0.9` keep · `p <= 0.1` drop and log · between: keep, marked "possibly" |
| **D8** `duplicate_signal` | after D5 keeps, against the subject's last 30 days | `subject`, `item`, `history_30d` (kind, one-liner, date), plus both normalized-URL and normalized-title hashes | `p >= 0.9` collapse in the UI, keep both rows · `p <= 0.1` keep separate · between: collapse, show "and 1 more". Survivor is the earlier `observed_at` (reliability breaks a tie). Duplicate stores `payload_json.collapsed_into`. `canonical_url` upgrade lands on the survivor. |
| **D6** `mention_matters` | after D8, on every kept item | everything D5 had, plus `competitor_set`, `history_30d`, `user_memory` (prior "not noteworthy" marks), `reliability` | `p >= 0.9` feed + D4 candidate · `p <= 0.1` behind "show all" · between: feed, normal |

- **Order is fixed: D5 → D8 → D6.** D5 first because the homonym problem is the main source of noise and everything downstream is wasted on a GameShark row. D8 before D6 so we do not pay a D6 call for an item we are about to collapse.
- **`reliability` comes from the `source` registry column**, per the Jev contract's schema requirement — never a constant in the adapter. Today: `hn.algolia` = `official_api`; `news.google_rss`, `reddit.search_rss`, `youtube.channel_rss`, `medium.tag_rss` = `rss`; `ddg.html` = `scraped_page` (and disabled).
- **Budget:** 25 D5 + 25 D6 calls per brand per day. Exhausting it marks items `unreviewed` and the Workflow retries them next tick — it never silently skips (Jev contract principle 6).
- **Proof for the packet:** D5 must be proven on HN `objectID 47123304` ("New undocumented GameShark code format" under query `gymshark`) with the context-pack hash, `p`, the reason and the timestamp. That record is real and is in this document.

---

## 6. Cost line

**Unit of work = one source poll** (one watch, one tick). Priced from `docs/REBUILD-COST.md`, the Cloudflare price sheet read 2026-09-21.

### Per 1,000 polls

| Resource | Units | Rate | Cost |
|---|---|---|---|
| Workers requests | 1,000 | 10M/mo included | $0.00 |
| D1 rows written (`snapshot`) | 1,000 | 50M/mo included, then $1.00/M | $0.00 |
| D1 rows written (`signal`, ~2 survive per poll) | ~2,000 | same | $0.00 |
| R2 Class A (PUT body) | 1,000 | 1M/mo included, then $4.50/M | $0.00 |
| R2 storage (≈50 KB/body, 30-day expiry) | ~50 MB | 10 GB included | $0.00 |
| Queue operations (write + read + delete) | 3,000 | 1M/mo included, then $0.40/M | $0.00 |
| Workflow steps (batched 10 items/step) | ~200 | 500k/mo included, then $0.80/100k | $0.00 |
| **Browser Rendering** | **0** | — | **$0.00** |
| Jev calls (D5 + D8 + D6) | ~2,000–4,000 | seat cost, not Cloudflare | see budget §5 |

### Monthly at 100 brands

5 sources × 100 brands × 1 poll/day × 30 days = **15,000 polls/month**.

| Resource | Monthly | Against included | Cost |
|---|---|---|---|
| Workers requests | 15,000 | 0.15% of 10M | $0.00 |
| D1 rows written | ~45,000 (15k snapshot + ~30k signal) | **0.09% of 50M** | $0.00 |
| R2 Class A | 15,000 | 1.5% of 1M | $0.00 |
| R2 storage steady-state | ~750 MB | 7.5% of 10 GB | $0.00 |
| Queue operations | 45,000 | 4.5% of 1M | $0.00 |
| Workflow steps | ~3,000 | 0.6% of 500k | $0.00 |
| **Browser Rendering** | **0 browser-seconds** | — | **$0.00** |
| **Cloudflare total** | | | **$0.00** |

**The headline is the zero in the Browser Rendering row, and it is the whole reason Candidate B won.** Candidate A would have put 5.0 browser-hours/month there — half the included allowance — and moved this engine from $0.00 to roughly $0.00 plus a 40% increase in the product's total browser budget, for no new signal.

Jev is the only real cost and it is a seat cost: ~45,000 D5 + ~45,000 D6 calls/month at 100 brands, capped by the per-brand-per-day budget.

---

## 7. Failure modes and the degraded UI state

Per `docs/REBUILD-DONE.md` §C: *"Every source in the registry has a live capture in the last 24 h for at least one tracked brand, **or is marked degraded in the UI with the reason**."*

| Failure | How it is detected | Degraded UI state |
|---|---|---|
| **Silent block: 200 with an empty set** (Substack today, DuckDuckGo's 14 KB challenge) | the per-source canary returns zero | source pill greys out, "Reddit: not answering since <time>". **Never** "0 mentions". |
| Reddit 429 | HTTP 429, or the 8 s abort fires | the message retries with `step.do` backoff; after `max_retries: 3` it lands in `mentions-dlq` and the source shows degraded. The brand is not dropped. |
| Google News redirect chain changes again | the item count is fine, so this is **not** a source failure — it is a click-through failure | nothing degrades; `canonical_url` stays the Google URL and the UI keeps labelling it "via Google News". This is why Candidate B has no failure mode here and Candidate A has a silent one. |
| Stale YouTube channel id | feed returns a 404 **HTML page**, so `item_count` parses as 0 | source degraded for that entity with "we lost the channel, re-resolving"; re-resolution is an identity-engine job (engine 1), queued, not retried here |
| Jev budget exhausted | verdict absent | items shown as **"unreviewed"**, low in the feed, retried next tick. Never dropped, never silently shown as confirmed. |
| Whole sweep late | queue depth / sweep lateness | Home's freshness line says when each source last landed. Per Nish's standing rule this escalates to him the same day with the measured number — it is never left hanging while the feed rots. |
| All five sources degraded at once | every canary zero | Home says "we're having trouble reaching our sources" with the list and the last-good time. It does not say "quiet week" — `docs/REBUILD-STANDING.md`'s quiet-week line is only legitimate when the canaries are green. |

**The rule that ties these together:** a source failure is attributed to the **source**, never to the brand. The user must never read our block as their silence.

---

## PACKETS

Template per umbrella #3842. Each is sized for one 45-minute worker with no design choice left.

---

### P5.1 — The source registry rows and the mentions adapter contract

**GOAL.** Add the six `source` rows for the mentions engine and one shared adapter interface they all satisfy. Each adapter is a pure function `(target, cursor) => Promise<{ items, canaryCount, rawBody }>`; it performs exactly one `fetch` with `AbortSignal.timeout(8000)` and does no storage, no judgment and no retry. Rows, with `kind = 'mentions'`: `news.google_rss` (`rss`), `reddit.search_rss` (`rss`), `hn.algolia` (`official_api`), `youtube.channel_rss` (`rss`), `medium.tag_rss` (`rss`), and `ddg.html` (`scraped_page`, **`is_enabled = 0`**, reason recorded: 202-challenged 5/5 attempts 2026-09-21). Every row carries its canary query and the expected-nonzero flag.

**STOCK FEATURE OR LIBRARY.** `@extractus/feed-extractor` **8.0.3** via `extractFromXml(xml: string)` — we own the `fetch`, it owns RSS/Atom/RDF/JSON normalisation (handles all four; `parseRdfFeed.js` verified present). `zod` **4.6.5** for the adapter return shape. Platform `fetch` + `AbortSignal.timeout`. `HTMLRewriter` (platform, 0 bytes) for any HTML body.

**FILES IN SCOPE.** `workers/sources/mentions/*.ts` (one file per adapter), `workers/sources/registry.ts`, `migrations/` **only** for the `INSERT INTO source` rows.

**FORBIDDEN.** A hand-written XML or RSS parser. `rss-parser` (requires Node's HTTP client at module load). `cheerio` (116 KB, pulls undici). Any `CHECK` constraint on `source.platform` — a new platform is a row, never a migration. Retry logic inside an adapter. Any `fetch` without the 8 s abort. Enabling `ddg.html`.

**PROOF REQUIRED.** One live call per enabled adapter from a `wrangler dev` Worker, each printing status, byte count, parsed item count and the first record's `dedup_key`, with a UTC timestamp. The HN call must return `objectID 47123304` or a later story under query `gymshark`. The Reddit call must show the `t3_`/`t5_` split and prove the `t5_` rows are filtered out.

**PUSH.** Branch `engine/mentions-adapters` off `origin/main`, pushed within 5 minutes of the first commit.

**COST.** Zero Cloudflare units — this packet ships code and six D1 rows, no scheduled work.

---

### P5.2 — The two queues, the cron, and the snapshot write

**GOAL.** Wire `cron "17 2 * * *"` → enqueue one message per eligible watch → two consumers → one `snapshot` row per watch per tick with the body in R2. Eligibility is `watch JOIN entity JOIN source WHERE entity.state = 'on' AND source.kind = 'mentions' AND source.is_enabled = 1`. Rate-classed routing: Reddit and any `scraped_page` source to `mentions-paced`, everything else to `mentions-fast`. An unchanged `payload_hash` still writes the snapshot row and reuses the existing R2 key, and the judge workflow is not started. `snapshot` has no `judged` column on main; the skip is "do not start the workflow". A row that is still `unreviewed` starts the workflow anyway so the next tick can finish it. The mentions cron is added beside the existing `*/5 * * * *` dead-man ping. It does not replace it.

**STOCK FEATURE OR LIBRARY.** Cloudflare Cron Triggers, Queues (`max_concurrency` **10** fast / **1** paced, `max_batch_size` 10/1, `max_retries` 5/3, `dead_letter_queue: "mentions-dlq"`), R2 binding, D1 `batch()`. `wrangler` **4.135.0**.

**FILES IN SCOPE.** `wrangler.jsonc` (triggers + queues + r2 blocks), `workers/mentions/tick.ts`, `workers/mentions/consumer.ts`.

**FORBIDDEN.** Doing the poll inline in `scheduled`. `Promise.all` over brands for any paced source. A `sleep` loop for rate limiting — the concurrency cap is the rate limit. Shipping any queue without its `dead_letter_queue`. Writing the payload body into a D1 column. More than one `snapshot` row per watch per tick. Commenting out the `crons` key to disable (set `crons: []`).

**PROOF REQUIRED.** One real tick on a real workspace with at least four ON brands: the cron invocation id, the enqueued message count, the consumer's per-message log lines, the resulting `snapshot` rows cited by `id`, `watch_id`, `payload_hash`, `item_count`, `fetched_at`, and the matching R2 keys listed with `wrangler r2 object get`. Plus one deliberate re-run proving the unchanged-hash path writes a row and does **not** re-store the body.

**PUSH.** Branch `engine/mentions-tick`.

**COST.** Per 1,000 polls: 1,000 Workers requests, 1,000 D1 rows written, 1,000 R2 Class A, 3,000 Queue operations, **0 browser-seconds**. At 100 brands: 15,000 polls/month, all inside included tiers, **$0.00**.

---

### P5.3 — D5, D8, D6 in the judge Workflow

**GOAL.** `MentionsJudgeWorkflow` consumes a snapshot, diffs items against existing `(source_id, dedup_key)` pairs, and runs D5 → D8 → D6 in that order, writing `jev_verdict` for every call and `signal` rows for survivors. D5 below 0.1 writes a verdict and no signal. D8 at or above 0.9 collapses and upgrades `canonical_url` per the design's graft rule. Jev calls are batched ten items per `step.do`; each step returns ids only, never bodies.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows (`step.do` with `{ retries: { limit: 5, delay: "10 seconds", backoff: "exponential" }, timeout: "30 minutes" }`). The shipped TypeSafe SDK/plugin for Jev, configured as a Worker secret. `zod` **4.6.5** for the context-pack shape.

**FILES IN SCOPE.** `workers/workflows/mentions-judge.ts`, `workers/jev/context-pack.ts`, `wrangler.jsonc` (workflows block).

**FORBIDDEN.** A custom retry loop, a prompt-templating library, or any local fallback model around Jev. Re-asking Jev to break a tie. A second Jev call for the same `(question_id, input_hash)` — the unique index must be doing that work. Returning a page body or a feed payload from a `step.do` (1 MiB cap). A regex or keyword filter standing in for D5. Hand-rolled fuzzy title matching standing in for D8. One `step.do` per item.

**PROOF REQUIRED.** One real run per decision, each citing the context-pack hash, `question_id`, `p`, the reason string, the timestamp and the action taken. **D5's proof item is HN `objectID 47123304`** — "New undocumented GameShark code format", returned live under query `gymshark` on 2026-09-21 — and the expected verdict is a drop. D8's proof is one real story arriving from two sources with the surviving row's `canonical_url` shown before and after the upgrade. Invented samples do not count.

**PUSH.** Branch `engine/mentions-judge`.

**COST.** ~200 Workflow steps per 1,000 polls (0.04% of the included 500k at 100 brands). Jev: budget 25 D5 + 25 D6 per brand per day; exhaustion marks items `unreviewed` and retries, never skips.

---

### P5.4 — Per-source canaries and the degraded state

**GOAL.** Every enabled source runs its registry canary once per tick (not once per brand) and stores the count, the degraded reason, and the last-good timestamp on `source.config_json`. A canary of zero marks the **source** degraded, surfaced as a greyed source pill in the Alerts feed and a line on Home. A degraded source never renders as "0 mentions" or contributes to a "quiet week". A disabled source is not a degraded pill.

**STOCK FEATURE OR LIBRARY.** The existing `source` registry columns and the `snapshot` row — no new table. Workers Analytics Engine `writeDataPoint` for the per-source time series (`blob1` = plugin_key, `double1` = item_count, `double2` = canary_count; index1 is the sampling key, low cardinality, never the brand).

**FILES IN SCOPE.** `workers/mentions/canary.ts`, `workers/mentions/consumer.ts` (call site only), `app/routes/app.alerts.tsx` and `app/routes/app.home.tsx` (the degraded pill and the freshness line). Canary count, `degradedSince`, and `lastGoodAt` live in `source.config_json`. Main has no canary columns on `snapshot` or `source`, and this packet does not add any.

**FORBIDDEN.** Treating a 200 as success. Treating a zero result set as data. Attributing a source failure to a brand. `SELECT COUNT(*)` against Analytics Engine — the correct aggregate is `SUM(_sample_interval)`. A high-cardinality value in `index1`.

**PROOF REQUIRED.** Two real captures: (1) an enabled source green, canary non-zero, pill normal; (2) a deliberately degraded source — point `ddg.html`'s canary at the live `html.duckduckgo.com` endpoint, which 202-challenged 5 of 5 attempts on 2026-09-21 — showing canary zero, the source marked degraded, and the UI rendering "not answering since <time>" rather than "0 mentions". Screenshots at 1440 and 390.

**PUSH.** Branch `engine/mentions-canary`.

**COST.** One extra `fetch` per source per tick (not per brand): 5 canary calls/day total, ~150/month. Analytics Engine is not billed. Negligible.

---

### P5.5 — The unified mention record and the Alerts feed read path

**GOAL.** Land the adapter→`signal` field mapping exactly as the contract's table specifies, and the Alerts feed that reads it. Per-source truths that are bugs if missed: Medium's `guid` is the canonical (not `link`, which carries `?source=rss------<tag>-<n>`); Reddit rows must be filtered to the `t3_` id prefix and sorted by parsed `<updated>`, because `sort=new` does not order the feed; Google News's publisher goes to `payload_json.publisher` from `<source url>`'s host and `canonical_url` stays the Google URL; **`published_at` may be null and null is never `now()`** — those rows sort by `observed_at` and the UI says "found today".

**STOCK FEATURE OR LIBRARY.** The `mention` view over `signal` (already in `0001_init.sql`). `date-fns` **4.4.0** + `@date-fns/tz` **1.5.0** for published/observed arithmetic, `Intl.DateTimeFormat` for display. **Never `Temporal`** — workerd#6907 returns `epochMilliseconds: 0`. React Router 8 loaders; shadcn/ui components from the CLI.

**FILES IN SCOPE.** `workers/mentions/map.ts`, `app/routes/app.alerts.tsx`, `app/components/mention-row.tsx`, `tests/mentions/map.test.ts`. The feed reads `signal` and filters `json_extract(payload_json, '$.collapsed_into') IS NULL`. The `mention` view stays as shipped in `migrations/0001_rebuild.sql` and does not gain `payload_json`.

**FORBIDDEN.** A `mention` table. Stamping `now()` into `published_at`. Storing Medium's `link` as canonical. Ingesting a `t5_` Reddit row. Showing a D6-below-0.1 item in the default feed. Any `Temporal` use, including a `typeof Temporal === 'undefined'` feature-detect (workerd exposes a broken global).

**PROOF REQUIRED.** Real rows from a real workspace: one Google News mention showing `payload_json.publisher = advertisinglaw.fkks.com` (or the live equivalent) with the Google `canonical_url`; one Reddit mention with a `t3_` `dedup_key` and a `t5_` row proven filtered out; one Medium mention whose `canonical_url` is the `guid` form `https://medium.com/p/<id>`; one row with `published_at` null rendering as "found today". Alerts screenshot at 1440 and 390, zero console errors, no horizontal scroll at 390.

**PUSH.** Branch `engine/mentions-feed`.

**COST.** Read path only — D1 rows read (25 billion/month included). $0.00.

---

### P5.6 — X and the disabled-source contract

**GOAL.** Add `x.apify` as a `source` row with `is_enabled = 0` and a recorded reason, and prove that a disabled source is invisible everywhere — not polled, not counted, not rendered, not a degraded pill — so that enabling it later is one `UPDATE` and nothing else. Per Fable's note, the cheapest known route is Apify at roughly $0.40 per 1,000 tweets; that figure is `quotedCost` inside `config_json`, and `approved_cost` stays null until Nish says yes. `source` has no `approved_cost` column on main.

**STOCK FEATURE OR LIBRARY.** The `source` registry's `is_enabled` column and the eligibility join from P5.2. No new mechanism.

**FILES IN SCOPE.** `migrations/` for the row only, `tests/mentions/disabled-source.test.ts`.

**FORBIDDEN.** Any X adapter code, any credential, any Apify call, any spend. A migration to enable a source later. Rendering a disabled source as degraded — disabled and degraded are different states and the UI must not conflate them.

**PROOF REQUIRED.** A test run on a real workspace showing the disabled row produces zero queue messages, zero `snapshot` rows and zero UI surface, and that flipping `is_enabled = 1` on a copy of the row in a local D1 produces a queue message — proving the switch is a row, not a migration. Cite the row id and both tick outputs.

**PUSH.** Branch `engine/mentions-x-disabled`.

**COST.** $0.00 and zero calls, by construction. That is the point of the packet.
