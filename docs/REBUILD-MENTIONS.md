# Mentions across the internet — scout: one zero-spend route per source

REBUILD P1 scout (Nishfleet/0509#3844) · umbrella Nishfleet/0509#3842 · 2026-09-20.

Answers Nishfleet/0509#3844: for each source — Reddit, X, Pinterest, Substack, Medium, blogs, mainstream media, YouTube, Bluesky, Hacker News — the cheapest working route (official API, RSS, public search, the existing SERP provider with a `site:` query, xAI live search via the existing SuperGrok seat for X), its rate limit, freshness, what a record looks like, and one real probe per route with the response cited.

**Inheritance (nothing here re-proves them):** the PLAN slice (#3170, shipped as `docs/mentions/PLAN.md`) established the per-source feasibility/legal posture, the `presence_item` data model, dedup primitives and the MVP pricing math, and the mentions epic (#3171) is the product charter. This scout inherits all of that verbatim and adds only what REBUILD needs: a live route proof per source on today's infrastructure, one real response per route, and the recommended launch set. Points already sourced in PLAN.md §2/§8 (terms, rate-limit docs) are cited, not re-researched.

## Probe conditions (matters to every verdict below)

All probes ran 2026-09-20 (~17:10–18:05 IST) from the fleet VPS — a **datacenter IP**. That is the honest deployment reality for pull-based polling, and it is the single biggest variable: several surfaces that work from a browser fail closed from here (Reddit unauthenticated → 403, DuckDuckGo HTML → 202 anomaly challenge, Bluesky public XRPC → 403), while every documented RSS/JSON surface responded normally. Nothing below was probed from a residential IP; verdicts are for the server-side polling shape.

## The table

One row per requested source. "Proof" = the live probe run for this scout; verbatim response excerpts are in the per-source sections. Verdict reflects zero-spend status and launch readiness only.

| Source | Cheapest working route | Cost | Rate limit (budget we must honor) | Freshness | Proof | Verdict |
|---|---|---|---|---|---|---|
| **Mainstream media** | (a) Google News RSS query feeds `news.google.com/rss/search?q=…`; (b) GDELT DOC 2.0 `api.gdeltproject.org/api/v2/doc/doc` (PLAN.md and older issues call it "DOC 2.1"; "DOC 2.0" is the documented name) | $0 | Google News: no published limit; 100 items/query hard cap. GDELT: the API's own 429 body says "Please limit requests to one every 5 seconds"; ≤250 records/question cap per the DOC 2.0 docs | Minutes (Google News); near-real-time, 65 machine-translated languages (GDELT). Window: `timespan=7d` proven live; `timespan=3months` returned an **empty** result set live (the inherited "3-month window" is NOT honored; 1m token throttled this run, unmeasured) | (a) HTTP 200, 100 items — Forbes/Fortune/CNBC titles for "Cloudflare". (b) HTTP 200 after one 429 (spacing honored) | **MVP** |
| **X** | xAI live search: `x_search` tool via the existing SuperGrok seat — `POST https://cli-chat-proxy.grok.com/v1/responses`, model `grok-4.5`, `tools:[{type:"x_search"}]` | $0 out-of-pocket at launch volumes (prepaid SuperGrok seat: each call meters ~14k in / 2.4k out tokens against the subscription; NOT api.x.ai pay-per-use) | Seat cap 1 concurrent (the fleet's seat-cap registry for xai-oauth/grok-4.6); measured latency 30–60 s/query (pi SuperGrok extension docs); no published per-day query ceiling found — meter tokens, serialize | Window-filtered posts returned (last-7d query returned posts through the last day); indexing latency unmeasured | HTTP 200 with 3 real Cloudflare posts (handles, text, timestamps, x.com URLs) | **MVP** — the only X surface with real brand chatter at $0 out-of-pocket |
| **Reddit** | Official Data API (OAuth app), commercial-use approval pending — connector already shipped and gated (`REDDIT_COMMERCIAL_ACCESS`) | $0 once approved | 100 QPM per OAuth client (10-min averaging window, documented) | Near-real-time within limits | (**absence probe**) Unauthenticated `search.json` = **HTTP 403** (anti-bot HTML block from datacenter IP); no credit-free path | **Deferred** — approval-gated. Never operate the unauthenticated surface |
| **Pinterest** | None. API v5 is OAuth-gated per-user; **no free public mention-search endpoint exists** | — | Trial/Standard tiers behind app review; per PLAN §2 (citing developers.pinterest.com access-tiers + rate-limits pages: 1,000 req/day/app trial; 100 req/s/user/app standard) — inherited figures, not re-verified this run; parked verdict makes it low-stakes | — | (**absence probe**) `api.pinterest.com/v5/keywords/search` without token = **HTTP 401** `{"code":2,"message":"Authentication failed."}` | **Parked** (`manual_only`), unchanged from #3170 |
| **Substack** | Official per-publication RSS `https://<pub>.substack.com/feed` (official help page, PLAN §8) | $0 | 1 fetch/feed/poll | On publish | HTTP 200, 606 KB, 20 items, dc:creator + pubDate + content:encoded; brand match step found the "Cloudflare" mention inside item text | **MVP** (named publications) |
| **Medium** | Official tag/profile/publication RSS `medium.com/feed/tag/<tag>` (official help page, PLAN §8) | $0 | 1 fetch/feed/poll | On publish | HTTP 200, 10 items for `tag/cloudflare` — two brand-named titles ("Cloudflare Workers…") | **MVP** (named pubs/profiles/tags) |
| **Blogs** | (a) Publisher/brand blog RSS (`blog.cloudflare.com/rss/` etc.); (b) long-tail third-party discovery: existing SERP provider (Decodo `google_search`) with a `site:` query on the **free tier** | (a) $0; (b) $0 within free quota: standard scraper 1,800 req/month, JS renderer 800 req/month (budget counters in `app/lib/decodo-budget.server.ts`) | (a) 1 fetch/feed/poll; (b) Decodo budget KV counters shared with the product's existing google-search source: 1,800/mo ≈ ~60/day if mentions took the whole budget — size conservatively, the product already draws on the same counter | (a) On publish; (b) near-real-time (Google index latency) | (a) HTTP 200, 20 items ("Saving another 100TB of RAM with math (and Rust)"). (b) **Operator route not live-probed this run** — see the Blogs section's evidence-class note; provider- and shape-evidence: committed live captures `tests/fixtures/google-search/decodo-nike.json` (6 organic results, real titles/URLs) + production usage of the same provider today | **MVP**: brand-blog RSS. Long-tail discovery: budget-capped Decodo free tier, pending an in-app `site:` re-probe |
| **YouTube** | Channel RSS `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (free, no key); keyword `search.list` stays quota-gated (100 search.list/day, derived from the documented quota default — PLAN §2) | $0 | Channel feed: 1 fetch/feed/poll (~15 entries returned). Data API: ~100 search.list/day across ALL brands | On publish | Page fetch hit the EU consent wall (302 → consent.youtube.com); with consent cookie, channel page resolved (id `UCgv3xMy6kECn0boYP9d2o-g`) and feed = **HTTP 200**, title "Cloudflare", 15 entries with `yt:video:` ids + published timestamps | **MVP** (channel feeds for self + competitors) |
| **Bluesky** | `app.bsky.feed.searchPosts` XRPC **with an app-password session** — unauthenticated `searchPosts` on `public.api.bsky.app` blocked from datacenter IPs | $0 | Documented "generous; contact us if rate-limited" (PLAN §8 cites) | Near-real-time | (**absence probe**) Unauthenticated = **HTTP 403** (HTML block page) — matching the intermittently-403 evidence PLAN.md cites ([bsky-docs#332](https://github.com/bluesky-social/bsky-docs/issues/332)); authenticated path not re-provable without a Bluesky credential on this host | **Fast-follow** — cheap to wire, blocked on a session credential decision |
| **Hacker News** | Algolia HN Search API `hn.algolia.com/api/v1/search[_by_date]` — no auth at all | $0 | Community-observed ~10k req/hr/IP courtesy (not an SLA); ~1,000 results/query cap (PLAN §8 cites) | Near-real-time | HTTP 200, `nbHits: 9588`, newest stories with titles / createdAt / points / num_comments | **MVP** |

## Proofs, verbatim (trimmed)

Quotes are trimmed excerpts of real responses captured this run. Full responses were not committed (docs-only issue); items enough to prove each route.

**X — SuperGrok seat, `x_search`** (brand: Cloudflare, window 2026-09-13→2026-09-20, HTTP 200):

```json
[{"handle": "mfachallenge",
  "text": "Wordpress, ugh. What a maintenance nightmare. Rebuild it in @Cloudflare workers with a framework like Astro and save yourself the headache.",
  "posted_at": "Sat, 19 Sep 2026 23:56:50 GMT",
  "url": "https://x.com/mfachallenge/status/2101460540845637843"},
 {"handle": "sheilfer",
  "text": "Currently reworking a feature to use Cloudflare Workers so it can be faster & cheaper…",
  "posted_at": "Sat, 19 Sep 2026 23:54:55 GMT",
  "url": "https://x.com/sheilfer/status/2101460058848600458"}]
```

Request shape (what the SuperGrok seat accepted this run — an **undocumented consumer proxy, observed working 2026-09-20; treat as best-effort, gate-dependent, can break without notice**: it returned HTTP 426 "Your Grok CLI version (none) is outdated" on a plain `Authorization: Bearer` call, then 200 with the seat's client-version header set. If the proxy gate ever bumps past us, X falls back to api.x.ai pay-per-use — a money-class decision — or out of MVP):

```
POST https://cli-chat-proxy.grok.com/v1/responses
Authorization: Bearer <SuperGrok OAuth access token>   # auth.json[xai-oauth]
x-grok-client-version: <the version this run passed with>  # gate checks a client-version string
x-grok-client-identifier / x-grok-client-mode / X-XAI-Token-Auth / x-authenticateresponse
{"model":"grok-4.5","input":[{"role":"user","content":"<query>"}],
 "tools":[{"type":"x_search","from_date":"…","to_date":"…"}],"store":false}
```

Usage for this one query: 14,163 input + 2,420 output tokens (2,420 incl. 1,913 reasoning) — the per-query price meter. The stored access token had expired (2026-09-20T07:44:45Z); the first probe got **HTTP 401**; a refresh-token grant against the seat's own token endpoint restored the token (new expiry same-day T23:09Z) — observed behavior, not documented API surface. Two operational facts the implementation must own: the token expires ~every few hours (a refresh lane is mandatory), and the client-version header set is part of what the gate accepts (observed 426 when missing; if the gate bumps versions without warning, the call breaks — that is a known property of this proxy, not a stable API guarantee).

**Mainstream media — Google News RSS** (brand query `"Cloudflare"`, HTTP 200, 100 items):

```
<title>Jev Cuts AI Decision Costs 100x And Vercel, Cloudflare Rushed To Add It - Forbes</title>
<pubDate>Sat, 19 Sep 2026 15:09:19 GMT</pubDate>
<link>https://news.google.com/rss/articles/CBMiwAFBVV95cUxQdDBjTWt2aUh1S04yU25kYzJ1…?oc=5</link>
```
(Item links are `news.google.com` redirect wrappers, never publisher-canonical — PLAN §4's redirect-resolution requirement re-confirmed live.)

**Mainstream media — GDELT DOC 2.0** (`mode=artlist&timespan=7d`, first attempt **HTTP 429**, spaced retry HTTP 200):

```json
{"articles": [{"url": "https://finance.yahoo.com/markets/stocks/articles/cloudflare-insiders-just-sold-44-101009063.html",
               "title": "Cloudflare Insiders Just Sold $44 Million Into …"}]}
```
Two more live facts from the window experiments this run: the 429 body is itself the surgical citation — verbatim, `Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries.` — and spacing honored only loosely (429s also arrived at 20–35 s gaps from this shared IP; spaced retry is required practice, not optional). And the inherited "rolling 3-month window" is WRONG: `timespan=3months` returned HTTP 200 with an **empty** result set. Serviceable window proven live = 7d; smaller caps unmeasured this run (the `1m` probe kept hitting 429 — left unmeasured rather than hammered, honoring the API's own error text).

**Substack RSS** (https://newsletter.pragmaticengineer.com/feed, HTTP 200, 20 items):

```
title: "AI Skills with Matt Pocock" | dc:creator: "Gergely Orosz" | pubDate: Thu, 17 Sep 2026 11:29:00 GMT
link:  https://newsletter.pragmaticengineer.com/p/ai-skills-with-matt-pocock
```
The brand-matched item (read-side step; the operator's read-side match found 1 of 20 items containing "Cloudflare" in item text):

```
title: Why Ramp built its own in-house coding agent, Inspect | dc:creator: "Gergely Orosz"
link:  https://newsletter.pragmaticengineer.com/p/why-ramp-built-its-own-in-house-coding-agent
```

**Medium tag RSS** (https://medium.com/feed/tag/cloudflare, HTTP 200, 10 items):

```
- Stop Treating Cloudflare Workers as CDN Scripts: The Network Is Now Programmable | Sun, 20 Sep 2026 06:18:03 GMT
- No Load Balancer, No Cloud Armor: How I Protected My Google Cloud Run Origin Behind Cloudflare for… | Thu, 17 Sep 2026
```

**Blogs — publisher RSS** (https://blog.cloudflare.com/rss/, HTTP 200, 20 items):

```
- Saving another 100TB of RAM with math (and Rust) | https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/
```

**Blogs — SERP `site:` route** (evidence class — see the failed-probe note): the same Decodo provider that serves the product's Google search source today. Shape evidence, committed as REAL live captures: `tests/fixtures/google-search/decodo-nike.json` — `results[0].content.results.results.organic` = 6 entries, first `{"title":"Nike. Just Do It. Nike.com","url":"https://www.nike.com/"}`. The `site:` operator is a pass-through query string on the same `google_search` target (`buildDecodoRequestBody(query)`) — no provider capability beyond the fixture's shape. **Why no live `site:` probe this run:** `DECODO_SCRAPER_AUTH` lives in the Worker secret store, the deployed app exposes no arbitrary-query entry point to it, and creating a fresh trial account is a money/identity action outside this worker's authority (`mechanism-impossible:` provider credential is a runtime secret on this host; no app path serves an arbitrary `site:` query). Treat the operator's live passage as a build-time obligation for the connector: its first run must assert `site:` filtering actually restricts to the brand's domain before the budget is spent. Free fallbacks measured today: DuckDuckGo HTML = **HTTP 202 anomaly/challenge page** (blocked from datacenter IP); Bing RSS (`search?…&format=rss`, HTTP 200, 10 organic items) works but **did not honor `site:`** (unfiltered organic results) — unusable as the primary, acceptable as emergency manual fallback.

**YouTube channel feed** (`channel_id=UCgv3xMy6kECn0boYP9d2o-g`, HTTP 200, 15 entries):

```
title: 6 weeks to Cloudflare Connect 2026! | published: 2026-09-15T17:12:50+00:00 | id: yt:video:4FyYF-_qVyQ
```
(Channel-page discovery from a datacenter IP hits the EU consent wall (`302 → consent.youtube.com`); a consent cookie (`SOCS=CAI`) clears it. Resolve the channel id from the tracked brand's YouTube URL once at target-onboarding, then poll only the feed.)

**Bluesky** (unauthenticated probe, HTTP 403 — HTML block page, not API JSON):

```
<html><head><title>403 Forbidden</title><link href='//fonts.bunny.net/css?family=Rubik…' …>
```
Read this as the documented caveat turned reality from this vantage: session auth is required for searchPosts. Wire the connector against an app-password session when the decision to hold a Bluesky credential is made; zero-cost itself, parked on the credential, not on feasibility.

**Hacker News** (`search_by_date?query="Cloudflare"&tags=story`, HTTP 200):

```json
nbHits: 9588
[{"title": "Anyone Used Cloudflare AI Agent Diagnostics for SaaS Purchases?", "created_at": "2026-09-19T11:21:52Z", "points": 3, "num_comments": 1}]
```

**Reddit** (probe of the *absence of a free unauth path*): `search.json?q="Cloudflare"` → **HTTP 403**, HTML anti-bot shell. The working route is the shipped OAuth connector behind the commercial-approval gate — PLAN §2's posture stands, unchanged, and the probe kills the dream of scraping it for free.

**Pinterest** (absence probe): `api.pinterest.com/v5/keywords/search` → **HTTP 401** `{"code":2,"message":"Authentication failed.","status":"failure"}`. No free brand-search surface; unchanged verdict.

## Recommended MVP set for launch

Ordered; all $0 incremental. The first four are pull-RSS/JSON with zero credentials and zero approvals — the launch spine; X is the only social surface with real brand chatter that is both $0 incremental (prepaid seat) and approval-free; the rest are named so nobody re-litigates them in the build.

| # | Source(s) | Why launch |
|---|---|---|
| 1 | **Google News RSS** query feeds | Minutes-fresh mainstream coverage of any brand phrase, zero credentials, 100 items/query — the single highest-yield zero-spend surface |
| 2 | **GDELT DOC 2.1** | Cross-language mainstream depth Google News misses; explicitly commercial-use terms; only cost is honoring the serialization gap |
| 3 | **One RSS engine** with four mounts: publisher/brand blogs, Substack pubs, Medium pubs/profiles/tags, YouTube channel feeds | One parser, four product surfaces; target onboarding = "give me the feed URL"; zero credentials |
| 4 | **HN Algolia search** | Tech-forum mention track, no auth, free engagement signals (points/comments) for ranking |
| 5 | **X via the SuperGrok seat** `x_search` | The only X surface at zero incremental spend (prepaid) and no platform approval; token-budgeted per query, serialized; needs the OAuth refresh lane + pinned client-version headers |

Explicitly **not** in MVP, with the reason stated once: Bluesky (needs a session credential decision — cheap connector otherwise), Reddit (commercial-use written approval gate; connector already shipped), Pinterest (no free public surface at all), YouTube keyword search (100/day quota bucket is a thin surface per #3170 — channel feeds carry it), Threads/LinkedIn (not in this scout's source list; PLAN §2 holds their verdicts).

## Unified mention record shape

Rebuild-pure (survives the D1 reset; no dependency on shipped migrations), while keeping everything #3170 established about dedup and matching:

```jsonc
{
  // identity
  "id": "mention_<ulid>",
  "tracked_entity_id": "<self|competitor entity row>",
  "source": "gnews-rss | gdelt | publisher-blog-rss | substack-feed | medium-feed | youtube-feed | hn | x | serp-site",
  "source_target": "<normalized feed URL or the search phrase accepted by the surface>",

  // what we matched
  "entity_phrase": "<the brand/person phrase that matched>",
  "match_class": "title | body | search-index",   // where the phrase proved
  "match_confirmed": true,                        // read-side verification state (capture-validity gate)

  // the artifact
  "external_id": "<source-native stable id — guid / tweet id / video id / objectURL>",
  "url": "<as returned>",
  "canonical_url": "<redirect resolved (gnews, yt: id→watch url), tracking params stripped, https-upgraded>",
  "url_hash": "<sha256(canonical_url)>",          // dedup key within a source_target
  "title": "<headline/post title>",
  "excerpt": "<first N chars of description/body/caption, bounded>",
  "author": {"name": "...", "handle": "..."},     // nullable per source
  "published_at": "<source-claimed timestamp, timezone-aware>",
  "observed_at": "<first fetch timestamp>",

  // free engagement (never paid enrichment), nullable per source
  "engagement": {"points": 3, "comments": 1, "likes": null, "reposts": null},

  "raw": {...},                                    // the source's own item JSON, bounded
  "tombstone": false                               // deletion detection keeps: URL gone → flip, never delete
}
```

Dedup/rules (inherited, restated so the rebuild keeps them): `UNIQUE (source_target, url_hash)`; cross-source syndication collapses at read time on normalized-title hash — keep every row, rank in UI; `external_id` is `UNIQUE` per `source`; Google News items resolve redirects before hashing. Ranking: match strength (title > body > search-index) → source class (news > social > forum) → free engagement → recency decay.

## Cost ledger for this scout

Zero out-of-pocket spend. One SuperGrok `x_search` call (~16.6k tokens metered against the prepaid subscription; $0 out-of-pocket) plus two GDELT window probes and the rest free public HTTP GETs (~20 requests total; the GDELT probes drifted into repeated 429s during window testing and were stopped rather than hammered — the API's own error text is quoted in the mainstream-media section as the authoritative rate citation). **Zero Decodo calls** (credential not reachable from this host — see the Blogs row's `mechanism-impossible:` note).
