# Creator sources — every route to another account's public data, ranked

REBUILD P1 scout (Nishfleet/0509#3880) · umbrella Nishfleet/0509#3842 · 2026-09-21.
Companion to `docs/REBUILD-MENTIONS.md` (brand mentions) and `docs/REBUILD-KEEPLIST.md` (engine audit). Scope: creators/influencers — for each platform, every route to **another** account's public data, ranked by robustness, with cost per 1k records and one live proof of the best zero-spend route.

**Probe conditions.** All live probes ran 2026-09-21 ~07:00–07:10 UTC from the fleet VPS (datacenter IP, curl). Same vantage as REBUILD-MENTIONS: surfaces that fail closed from here will also fail from workerd, and per KEEPLIST finding 3 workerd plain `fetch` is bot-gated *worse* than curl — a route proven by curl is "works from VPS, needs a Browser Rendering leg from workerd" until re-proven. No account, credential, or payment was used for any probe; everything below is other accounts' **public** data only.

**Cost model.** "Records" = post-level items + one profile/stats record per creator per poll. Assumed load for the monthly column: 100 tracked creators, daily poll, ~10 post records + 1 profile record per creator-day → **~33,000 records/month**. Stated once; platform tables use it. Provider prices are from live pricing pages on 2026-09-21 (links inline).

## Route-type legend

- **API** = official/documented endpoint. Robust; the ranking baseline.
- **WEB** = logged-out public web page (plain fetch or CF Browser Rendering). Fragile: markup and bot-gate dependent.
- **3P** = maintained third-party provider (Apify, ScrapeCreators, Bright Data, EnsembleData). Robust-by-outsourcing; costs money.
- **SIDE** = RSS, oEmbed, sitemaps, search engines, data aggregators. Cheapest, narrowest coverage.

---

## Instagram

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **IG Graph API `business_discovery`** (`/{ig-user-id}?fields=business_discovery.username(<other>){media,...}`) — reads any *business/creator* account's profile + media | API | Yes — business/creator accounts only | $0 (free; Meta app + token, app review) | High — documented, but only covers business/creator accounts and needs Meta app approval |
| 2 | Third-party providers — Apify `instagram-scraper` ($2.70/1k Free-plan rate → $1.50/1k Business), ScrapeCreators `/v1/instagram/*` ($1.88/1k → $0.99/1k), Bright Data IG datasets ($1.5/1k PAYG), EnsembleData ($0.1–0.3/1k at tier) | 3P | Yes — full public data incl. non-business | $0.99–2.70 | High-ish — the industry-standard fill for what Meta's API won't serve |
| 3 | Logged-out web (`instagram.com/<user>/`, post `/embed`) via Browser Rendering | WEB | Yes in a real browser session — but NOT from datacenter IP (see proof) | ~$0.09–0.45/1k pages (browser-hours) | Low from our vantage — login wall, not markup fragility |
| 4 | Internal `web_profile_info` endpoint | SIDE | Would be yes | — | Dead for us — **401 `require_login:true`** from datacenter IP |
| 5 | RSS/oEmbed | SIDE | oEmbed exists but needs FB token since 2020 | — | Dead zero-spend |

**Recommended:** 3P provider (any of the four — they're the only route covering all account types), priced $0.99–2.70/1k → **~$33–89/mo at 100 creators**. Browser Rendering is the fallback for *verification-of-record* screenshots, not bulk data.
**Live proof (absence, zero-spend):** `GET instagram.com/gymshark/` logged-out → HTTP 200 but the 626 KB body is a **login shell** (`<title>Instagram`, login forms, zero profile fields); `/api/v1/users/web_profile_info?username=gymshark` → **401** `{"require_login":true,"status":"fail"}`; `instagram.com/p/BsOGulcndj-/embed/captioned/` → HTTP 200 login-only content. No zero-spend data route exists from this vantage — the wall itself is the measurement.

## TikTok

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Logged-out profile page** `tiktok.com/@<user>` — ships `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON with profile + stats inline | WEB | Yes — proven | ~$0 (plain fetch) / browser-hours if it starts gating | Medium — works today; hydration schema is unversioned and can break |
| 2 | **oEmbed** `tiktok.com/oembed?url=<video>` — title/author/embed HTML per known post | SIDE | Yes — proven | $0 | Medium-high — documented oEmbed, but needs the post URL (no discovery leg) |
| 3 | TikTok Research API / Display API | API | Research API: yes (academic approval); Display API: own-account videos only | $0 | Low availability — approval-gated, and Display covers own account only |
| 4 | Third-party — ScrapeCreators `/v1/tiktok/*`, Apify `tiktok-scraper`, Bright Data TikTok datasets, EnsembleData TikTok API | 3P | Yes — profiles, posts, comments, search | $0.99–1.88 (SC), ~$1.5 (BD/Apify) | High |
| 5 | RSS bridges (unofficial) | SIDE | Yes | $0 | Low — community bridges die frequently |

**Recommended:** WEB profile page for per-creator stats/posts (zero-spend, proven), oEmbed for post enrichment when URLs are known, 3P for keyword/hashtag *discovery* (the side door WEB can't do).
**Live proof:** `GET tiktok.com/@gymshark` (browser UA) → HTTP 200, 370 KB; hydration JSON contains `"uniqueId":"gymshark","followerCount":6700000` — real other-account stats. `GET tiktok.com/oembed?url=https://www.tiktok.com/@scout2015/video/6718335390845095173` → HTTP 200 `{"type":"video","author_name":"Scout, Suki & Stella","title":"Scramble up ur name…"}`. (One sampled video returned `400 {"code":400}` — endpoint has per-video gaps; retry/alternate id needed.)

## YouTube

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Channel RSS** `youtube.com/feeds/videos.xml?channel_id=<id>` | SIDE | Yes — proven twice (this run + REBUILD-MENTIONS) | $0 | High — stable syndication surface; ~15 latest entries only |
| 2 | **Data API v3** — `channels.list`, `playlistItems`, `videos.list` (1 unit ea.), `search.list` (100 units); 10,000 units/day free default | API | Yes — full public channel/video data | $0 within quota | Highest — documented, keyed (needs `YOUTUBE_API_KEY`, free GCP project) |
| 3 | oEmbed `youtube.com/oembed?url=<video>` | SIDE | Yes | $0 | High for known URLs; no discovery |
| 4 | Logged-out channel page / `yt-dlp` extraction | WEB | Yes | browser-hours | Low from datacenter IP (consent wall; see MENTIONS) |
| 5 | Third-party — ScrapeCreators `/v1/youtube/*`, Bright Data YouTube datasets | 3P | Yes — incl. transcripts, comments | $0.99–1.5 | High |

**Recommended:** channel RSS for new-video polling + Data API v3 for stats/history once the free key exists. Both $0.
**Live proof:** `GET youtube.com/feeds/videos.xml?channel_id=UCX6OQ3DkcsbYNE6H8uQQuVA` (MrBeast) → HTTP 200 Atom feed, `yt:video:` ids + `published` timestamps. Data API unproven this run — `YOUTUBE_API_KEY` absent on host (KEEPLIST: `credentials_missing`).

## X (Twitter)

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **xAI live search via the existing SuperGrok seat** (`x_search`, proven in REBUILD-MENTIONS) | SIDE | Yes — proven with real posts | $0 marginal (prepaid seat, ~14k tok/query) | Medium — undocumented consumer proxy, gate-dependent; but $0 and already wired |
| 2 | **X API v2 pay-per-usage credits** — post read $0.005, user read $0.01, 24h dedup, 3M posts/mo cap | API | Yes — full public data | $5/1k posts, $10/1k users | Highest — documented; now subscription-free credit model (changed since REBUILD-MENTIONS' $200/mo framing) |
| 3 | Third-party — ScrapeCreators `/v1/twitter/*`, Bright Data X datasets, EnsembleData Twitter API | 3P | Yes | $0.99–1.88 | High |
| 4 | Logged-out web / nitter | WEB | Yes | — | Dead — nitter instances are extinct; x.com logged-out is a wall |

**Recommended:** keep the SuperGrok seat for search/discovery; X API credits are the documented fallback (**$5/1k posts → ~$165/mo** at the model volume) if the proxy gate ever rejects the seat.
**Live proof:** inherited — REBUILD-MENTIONS 2026-09-20, HTTP 200 with 3 real posts (handles, timestamps, x.com URLs). Not re-probed: the call meters the prepaid seat and re-proving adds no information.

## Threads

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Threads API** — keyword search (`/keyword_search`) covers *all* public posts; user endpoints cover own account + public profiles by ID lookup | API | Yes via keyword search; per-profile reads need the account's public presence | $0 (Meta app + token) | High — documented; needs the `THREADS_ACCESS_TOKEN` decision (KEEPLIST: `credentials_missing`) |
| 2 | Third-party — ScrapeCreators `/v1/threads/*`, EnsembleData Threads API | 3P | Yes | $0.99–1.88 | High |
| 3 | Logged-out web `threads.com/@<user>` | WEB | Would be yes | — | Dead from datacenter IP — proof below |
| 4 | RSS | SIDE | — | — | None exists |

**Recommended:** Threads API keyword search (free, official, covers other accounts) once the credential decision lands; ScrapeCreators/EnsembleData as paid fallback.
**Live proof (absence):** `threads.net/@zuck` → 301 → `threads.com/@zuck` → HTTP 200 but a generic shell — zero occurrences of `zuck`, no `follower_count`, no profile JSON. Meta serves Threads logged-out markup only to residential-looking clients. Same Meta wall family as Instagram.

## Substack

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Per-publication RSS** `<pub>.substack.com/feed` | SIDE | Yes — proven (REBUILD-MENTIONS) | $0 | High — documented, on-publish freshness |
| 2 | **Publication JSON API** `<pub>.substack.com/api/v1/archive?sort=new&offset=0&limit=N` — posts with ids, slugs, dates; `/api/v1/publication/users` for pub metadata | SIDE | Yes — proven this run | $0 | Medium-high — unofficial but stable, structured JSON beats RSS parsing |
| 3 | Reader/notes endpoints (`api/v1/notes`, leaderboard) | SIDE | Partial — notes, rankings | $0 | Medium — coverage narrow, unversioned |
| 4 | Third-party | 3P | Marginal — no dedicated Substack actors of note | — | n/a |

**Recommended:** RSS for post polling + `/api/v1/archive` for backfill/enumeration. $0 end to end.
**Live proof:** `GET newsletter.pragmaticengineer.com/api/v1/archive?sort=new&offset=0&limit=5` → HTTP 200 JSON array, `"id":215854309,"title":"AI Skills with Matt Pocock","slug":"ai-skills-with-matt-pocock"` — real other-account posts, richer than the RSS item shape.

## Bluesky

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Jetstream firehose** `wss://jetstream*.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&compress=false` — every public post network-wide, filter by `wantedDids` | SIDE | Yes — ALL accounts, proven | $0 | High — official ATProto infra, plain JSON with `compress=false` |
| 2 | **Public AppView XRPC** `public.api.bsky.app` — `getProfile`, `getAuthorFeed`, `getPosts` (per-account reads) | API | Yes — proven | $0 | Medium — works now; the same host 403s `searchPosts` and intermittently gates everything (bsky-docs#332) |
| 3 | Authenticated `app.bsky.feed.searchPosts` via app-password session | API | Yes | $0 (throwaway DID) | Medium — needs the credential decision; KEEPLIST shows connector is code-ready (`BSKY_IDENTIFIER`/`BSKY_APP_PASSWORD`) |
| 4 | Third-party — ScrapeCreators `/bluesky/*` | 3P | Yes | ~$1/1k | High |

**Recommended:** Jetstream filtered by tracked creators' DIDs (free, real-time, covers everyone) + unauthenticated `getProfile`/`getAuthorFeed` for backfill and stats. No credential needed for the core lane.
**Live proof:** `GET public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app` → HTTP 200 `{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app"…}`; `getAuthorFeed?actor=bsky.app&limit=2` → HTTP 200 real post (`at://did:plc:zbrhmanjs62oyqywjwdazxz3/app.bsky.feed.post/3mvta262ufs27`, author kenjennings.bsky.social). Jetstream handshake → streamed real commit frames (`"kind":"commit","collection":"app.bsky.feed.post","time_us":1789974205689979`). `searchPosts` unauth → **HTTP 403** HTML block — the one read that stays credential-gated. *(Note: REBUILD-MENTIONS recorded getProfile-class reads as 403 yesterday; today they return 200 — the gate is intermittent exactly as bsky-docs#332 describes.)*

## Twitch

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Helix API** — `users`, `streams`, `channels/followed`, `videos`, `schedule` with a free app token (800 req/min documented) | API | Yes — all public channel data | $0 (free dev app) | Highest — documented, stable |
| 2 | **Public web GraphQL** `gql.twitch.tv/gql` with the site's own public Client-ID — profile, broadcast settings, VODs | SIDE | Yes — proven | $0 | Medium — undocumented; the client-id is public-by-design but unversioned; Integrity checks tighten occasionally |
| 3 | Logged-out channel page | WEB | Yes | — | Low — SPA, no useful SSR data |
| 4 | Third-party — ScrapeCreators `/v1/twitch/*`, EnsembleData Twitch | 3P | Yes | ~$1/1k | High |
| 5 | Community RSS bridges (twitchrss) | SIDE | Yes | $0 | Low — single-maintainer service |

**Recommended:** Helix with a throwaway dev app ($0, official, covers everything the product needs: presence, schedule, VODs, follower counts). Public GQL as the zero-provisioning stopgap.
**Live proof:** `POST gql.twitch.tv/gql` `Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko` `{user(login:"ninja"){id displayName broadcastSettings{title game{name}}}}` → HTTP 200 `{"id":"19571641","displayName":"Ninja","broadcastSettings":{"title":"WEEK 1 NFL RECAP | WEEK 2 PREDICTIONS","game":{"name":"Just Chatting"}}}` — another account's live channel state, zero auth beyond the public web client id.

## Patreon

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Graphtreon** `graphtreon.com/creator/<name>` — public stats aggregator: patron counts, earnings series, post counts | SIDE | Yes — proven | $0 | Medium — third-party site, but purpose-built and stable for years |
| 2 | Patreon API v2 | API | **No** — own campaign only | $0 | Dead for competitor tracking |
| 3 | Logged-out `patreon.com/<creator>` | WEB | Yes in a real browser | — | Dead from datacenter IP — 403 |
| 4 | Third-party providers | 3P | Marginal — no first-class Patreon product found at the four providers | — | n/a |

**Recommended:** Graphtreon for patron/earnings trend lines (the only public telemetry that exists for Patreon). Post-level content has no working public route — paywalled by design; say so.
**Live proof:** `GET patreon.com/kurzgesagt` (browser UA) → **403**, 5.7 KB block page. `GET graphtreon.com/creator/kurzgesagt` → HTTP 200, 186 KB containing `earningsSeriesData = [[1427155200000,…` — real per-creator patron/earnings time series embedded in the page.

## LinkedIn

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **Logged-out company page** `linkedin.com/company/<org>/` — guest overview serves follower count, about, headcount | WEB | Yes — companies only, proven | ~$0 (plain fetch) / browser-hours when challenged | Medium — works today; the guest wall is a rate/UA dial LinkedIn turns without notice |
| 2 | Third-party — Bright Data LinkedIn datasets ($1.5/1k), ScrapeCreators `/v1/linkedin/*`, Apify, EnsembleData | 3P | Yes — people + company profiles, posts | $0.99–1.88 | High — the only route covering personal profiles |
| 3 | Official API — `organizationalEntityShareStatistics`, Marketing API | API | **No** — own org or partner-gated | $0 (own data only) | Dead for competitor tracking (KEEPLIST: `competitor_limited` by design) |
| 4 | Logged-out personal profile `/in/<user>` | WEB | Would be yes | — | Dead — 999 authwall |
| 5 | RSS | SIDE | — | — | None exists |

**Recommended:** guest company pages for brand-side LinkedIn presence; a 3P provider is mandatory for people profiles. Personal-profile tracking is the single most restricted surface in this scout.
**Live proof:** `GET linkedin.com/company/cloudflare/` logged-out → HTTP 200, `og:description` = "Cloudflare | 1,187,614 followers on LinkedIn…", `pageKey: d_org_guest_company_overview`. `GET linkedin.com/in/satyanadella/` → **HTTP 999**, 1.5 KB authwall — the documented block signal.

## Pinterest

| # | Route | Type | Other accounts? | Cost / 1k records | Robustness |
|---|-------|------|-----------------|-------------------|------------|
| 1 | **User/board RSS** `pinterest.com/<user>/feed.rss` (and `/<user>/<board>.rss`) | SIDE | Yes — proven twice (KEEPLIST connector + this run) | $0 | Medium-high — undocumented but stable; recent pins only |
| 2 | **Pinterest API v5** — pins, boards, analytics | API | Mostly own account; public pin/board reads limited | $0 (trial 1k req/day, standard after approval — PLAN figures) | Medium-high; coverage of *other* accounts is thin |
| 3 | Third-party — ScrapeCreators `/v1/pinterest/*` (search, pins, boards) | 3P | Yes | $0.99–1.88 | High |
| 4 | Logged-out pin/profile pages | WEB | Partial | browser-hours | Low-medium — JS shell with some SSR |

**Recommended:** `feed.rss` per tracked creator/board (zero-spend, already code-proven by the shipped connector — `pinterest.com/gymshark/feed.rss` → 25 real pins on workerd per KEEPLIST). API v5 if a key ever lands; ScrapeCreators for search/discovery.
**Live proof:** `GET pinterest.com/gymshark/feed.rss` → HTTP 200, RSS channel `<title>Gymshark</title>`, `<link>https://www.pinterest.com/gymshark/</link>` — real other-account items.

---

## Provider price sheet (live pages, read 2026-09-21)

| Provider | Unit | Price / 1k records | Monthly est. @ ~33k records | Link |
|----------|------|--------------------|------------------------------|------|
| **Apify** (e.g. `apify/instagram-scraper`, pay-per-event) | result | $2.70 free plan · $2.30 Starter · $1.90 Scale · $1.50 Business | $89 · $76 · $63 · $50 | apify.com/apify/instagram-scraper |
| **ScrapeCreators** (credit packs; 1 credit ≈ 1 request; cache hits free; never expire) | request | $1.88 ($47/25k) · $0.99 ($497/500k) | $62 · $33 | scrapecreators.com/#pricing |
| **Bright Data** Web Scraper API (IG/LI/TT/X/YT datasets; pay-per-success) | record | $1.50 PAYG · $1.30 at Scale ($499/mo, 384k incl.) · free 5k/mo | $50 · $43+ plan | brightdata.com/products/web-scraper/pricing |
| **EnsembleData** (units; user posts = 1 unit/10 posts; keyword search = 1 unit/20 posts) | record (post) | ~$0.22 at Wood (45k units/mo = 450k posts) | $100 flat (plan-priced, not per-record) | ensembledata.com/pricing |
| **X API v2** credits | post | $5.00 ($0.005/post; user read $10/1k) | ~$165 | docs.x.com/x-api/getting-started/pricing |
| **CF Browser Rendering** (Workers Paid) | browser-hour | ~$0.09–0.45/1k pages (2–5 s/snapshot; $0.09/hr, 10 h/mo incl.) | $3–15 | developers.cloudflare.com/browser-rendering/platform/pricing/ |
| Plain fetch / RSS routes | Workers request | ~$0 — sub-ms CPU, within Workers' free-included request volume at this scale | ~$0 | — |

## The money decision (for Nish)

One decision, three options:

1. **Zero-spend launch (recommended):** YouTube RSS+API · Substack RSS+archive · Bluesky Jetstream+XRPC · Twitch Helix · Pinterest RSS · TikTok WEB hydration · LinkedIn guest company pages · X via SuperGrok seat — **8 of 11 platforms at $0 marginal**. Monthly cost ≈ $0 (+ existing Workers Paid plan). Gaps: Instagram, Threads, Patreon post-level, LinkedIn personal profiles.
2. **Close the Meta gap:** Instagram + Threads via ScrapeCreators ($47/25k-credit pack, ~$62/mo at model volume) or EnsembleData Wood ($100/mo flat, covers IG+TT+Threads+Twitch+X together — better per-platform economics if 3+ platforms go through it). Cheapest credible paid floor: **~$47–100/mo**.
3. **Full coverage:** EnsembleData Gold/Platinum or Bright Data Scale for IG+Threads+LI-personal+Patreon-adjacent at volume: **$400–800/mo** — exceeds the product's own price point per month at 100 creators unless creator tracking is a paid-tier feature. That last line is a finding, not a recommendation.

**Robustness ranking summary (all platforms):** official APIs and syndication surfaces (YouTube API/RSS, Substack, Jetstream, Helix, Pinterest RSS, X API credits) > third-party providers (they absorb the bot-gate war) > logged-out web hydration (TikTok today — works, unversioned) > logged-out HTML scraping (LinkedIn companies — works, rate-dial risk) > dead-from-datacenter (IG, Threads, Patreon pages, personal LinkedIn, unauth Bluesky search).

**Honest coverage holes to carry into the build:** (a) Instagram has **no** zero-spend route — it's a paid-provider or nothing; (b) Threads' only coverage is its official API's keyword search or 3P; (c) Patreon yields patron/earnings *telemetry* (Graphtreon) but no post-level content; (d) LinkedIn personal profiles are 999-walled — company pages only; (e) every WEB route marked "works" was proven from VPS curl — workerd plain fetch is a *worse* vantage (KEEPLIST finding 3), so each needs a Browser Rendering fallback priced above.
