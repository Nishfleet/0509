# REBUILD creators — every route to another account's public data

Issue #3880 / umbrella #3842. Written by the Opus deputy, **2026-09-21**. Research only, no code.

**Scope** (Nish, 2026-09-21): creators and influencers are the same product with the same single input — a handle or a channel instead of a domain. *"See where you stand, and who is gaining on you."* Tracking runs **regardless of what a platform's terms allow**, with standing guardrails: dedicated throwaway identities only, never Nish's accounts or a logged-in fleet session; egress from the VPS or Cloudflare, never the Mac; **no payment without Nish**.

**Inherited, not re-probed** (`docs/REBUILD-MENTIONS.md`, same date, same host): Reddit `search.rss` open / `search.json` 403; Bluesky public XRPC 403; Substack search silently blocked while publication `/feed` works; every zero-spend X route closed including the SuperGrok seat; Google News RSS, HN Algolia, Medium tag feeds and DuckDuckGo HTML all open. And from `docs/REBUILD-KEEPLIST.md`: plain `fetch` from workerd is bot-gated by large sites that answer `curl` with 200.

## Method and vantage

Every probe ran from **this VPS (netcup, datacenter IP)** with `curl`, on **2026-09-21 between 12:08 and 12:10 UTC**. That is the same egress workerd uses, which is what makes the results load-bearing rather than anecdotal.

**Two things I could not do, stated rather than hidden:**

1. **No Browser Rendering probe.** `CLOUDFLARE_API_TOKEN` is absent from this host and `wrangler` is unauthenticated. Every row that says "needs Browser Run" is an **inference from the markup I fetched**, not a proven render. Marked `unproven` in the robustness column.
2. **No throwaway identities created.** Nothing here required a signup, and I did not make one. Routes that need a credential — Bluesky app password, Twitch client id, TikTok/Instagram OAuth — are **unproven** in this document. Each is a five-minute signup, and each is the first thing P3 should verify.

**Robustness ranking**, used in every table below:

| Rank | Meaning |
|---|---|
| **A** | Documented API or feed. Breaks only on a versioned deprecation. |
| **B** | Undocumented but stable endpoint (oEmbed, public RSS). Breaks rarely, loudly. |
| **C** | Server-rendered markup. Breaks whenever the vendor reorganises the page, and breaks **silently**. |
| **D** | JS-rendered page. Needs a browser; costs browser-seconds; breaks silently. |
| **X** | Closed from our vantage, or closed by terms. |

---

## The scoreboard

| Platform | Best zero-spend route | Rank | Sees other accounts? | Proven here |
|---|---|---|---|---|
| YouTube | `feeds/videos.xml?channel_id=` | **A** | yes, any public channel | **yes** |
| TikTok | DuckDuckGo `site:tiktok.com` → `tiktok.com/oembed` | **B** | yes, any public video | **yes, end to end** |
| Instagram | logged-out profile HTML → `og:description` | **C** | yes, profile counts only | **yes** |
| X | none | **X** | — | all routes closed |
| Threads | logged-out profile HTML | **C** | profile only | yes (mentions doc) |
| Substack | publication `/feed` | **A** | yes, once known | yes (mentions doc) |
| Bluesky | authenticated `searchPosts` (app password) | **A** | yes, all public posts | **no** — 403 unauth, auth route unproven |
| Twitch | Helix API (free client id) | **A** | yes, any channel | **no** — 401 unauth; page HTML proven instead |
| Patreon | none | **X** | — | 403 challenge, 401 API, 404 RSS |
| LinkedIn | logged-out company page | **C** | company pages only | **yes** |
| Pinterest | `<handle>/feed.rss` | **B** | yes, any public profile | yes (mentions doc) |

---

## 1. YouTube

**Recommended: the channel feed. Rank A, no key, free.**

```
GET https://www.youtube.com/feeds/videos.xml?channel_id=UCma7hhYJ3bfEhZgw3xl77ww
→ 200, 22,556 B, 15 <entry> elements                                  (12:01:55 UTC)

yt:videoId: QVx0PY1lf-s
title:      GYMSHARK ONYX V1 RETURNS
published:  2026-07-14T13:42:02+00:00
author:     Gymshark
```

**This is the single best route in this document**: a documented feed, any public channel, no credential, no rate limit we can hit, no terms problem. It sees **other** accounts fully.

| Route | Rank | Scope | Cost |
|---|---|---|---|
| `feeds/videos.xml` | **A** | any public channel, latest 15, no history, no pagination | free |
| YouTube Data API v3 `channels.list` / `videos.list` | **A** | any public channel, with statistics and full history | 1 quota unit per call against a default 10,000/day |
| YouTube Data API v3 `search.list` | **A** | discovery — other people's videos about a creator | **100 units per call** → ~100 searches/day on the default quota |
| Scraping `youtube.com/@handle` | **D** | — | rejected; the feed exists |

**The channel-id resolution trap, and it is real.** A stale id does not return an empty feed — it returns **404 with 1,613 B of Google's HTML error page** (probed 12:00:46 UTC with a carried-over id). I recovered the correct id by fetching `https://www.youtube.com/@Gymshark/about` with a browser UA (200, **2,068,147 B**) and taking the most frequent `UC…` token: 182 occurrences against 7 for the runner-up.

So: **resolve handle → channel id once, cache it on the entity, never per poll**, and treat a feed 404 as a source failure rather than "no videos". That 2 MB bot-gated page is a Browser Run job, not a plain `fetch` (keep-list finding 6).

**The split that decides the tier:** the feed gives *what this creator published*. Finding *what others published about them* needs `search.list` at 100 units a call, or the SERP. The free feed is the MVP; the keyed Data API is the upgrade, and its quota — ~100 searches/day — is the number that decides whether it scales to 100 creators.

---

## 2. TikTok — the one chain I proved end to end

**Recommended: DuckDuckGo site-scoped search → `tiktok.com/oembed`. Rank B, no key, free.**

The profile page is useless without a browser:

```
GET https://www.tiktok.com/@gymshark
→ 200, 372,466 B — but the body is a JS shell: <title>TikTok - Make Your Day</title>
  and a <script src="https://sf16-website…">. No og: tags. No video ids.   (12:08:55 UTC)
```

I grepped that 372 KB for `"id":"7…"` and `video/7…` and found **nothing**. TikTok renders everything client-side. So the naive route is rank **D**: Browser Run, browser-seconds, and a silent break whenever their bundle changes.

**The chain that works, executed in order:**

```
1) GET https://html.duckduckgo.com/html/?q=site%3Atiktok.com+gymshark+video
   UA: Mozilla/5.0 (compatible; 0509-research/1.0)
   → 200                                                                (12:09:34 UTC)
   decoded uddg → https://www.tiktok.com/@gymshark/video/7559284486014323990

2) GET https://www.tiktok.com/oembed?url=https://www.tiktok.com/@gymshark/video/7559284486014323990
   → 200, 1,906 B, application/json                                     (12:09:34 UTC)
   {"version":"1.0","type":"video",
    "title":"onyx. our biggest drop yet. #onyx #gymsharkonyx #davidlaid #samsulek #Gymshark",
    "author_url":"https://www.tiktok.com/@gymshark","author_name":"Gymshark",
    "html":"<blockquote class=\"tiktok-embed\" … data-video-id=\"7559284486014323990\" …"}
```

**No key, no browser, no terms problem** — oEmbed is a publishing endpoint the platform maintains for embeds. It returns the caption verbatim, including the hashtags and the collab handles (`#davidlaid #samsulek`), which is exactly the competitive signal a creator wants.

**The honest limit: oEmbed enriches, it does not discover.** It needs a video URL you already have. Discovery is the SERP, and the SERP is indexed rather than live — days of lag, not minutes. A control probe confirmed the oEmbed endpoint rejects a made-up id (`400, 45 B, {"message":"Something went wrong","code":400}` at 12:08:55), so the URL must be real.

| Route | Rank | Scope | Cost |
|---|---|---|---|
| DDG `site:tiktok.com` → oEmbed | **B** | any public video, caption + author | free |
| Browser Run on `@handle` | **D** | full profile grid | browser-seconds; **unproven here** |
| TikTok Display API | **A** | **own account only** — useless for competitors | free, OAuth |
| TikTok Research API | **A** | broad, but restricted | applicant-gated; see below |
| TikTok Commercial Content Library | **A** | ads, not organic | free — and it is an **ads** source, filed under the ads engine |

**On the Research API:** it is the only official route to other accounts' organic data, and eligibility has historically been restricted to non-profit academic researchers in the US and EU. I have not re-read the current eligibility page today, so: **treat as closed until someone reads developers.tiktok.com and says otherwise.** We are a commercial product; the base rate on this is "no".

---

## 3. Instagram — profile counts, and nothing below them

```
GET https://www.instagram.com/gymshark/
→ 200, 633,816 B, text/html                                            (12:08:55 UTC)

<meta property="og:type" content="profile">
<meta property="og:title" content="Gymshark (@gymshark) • Instagram photos and videos">
<meta property="og:description" content="9M Followers, 69 Following, 1,740 Posts -
  See Instagram photos and videos from Gymshark (@gymshark)">
```

**Real follower, following and post counts from a tokenless GET.** That is the "where you stand" number, and it is free.

**And that is all there is.** I grepped the same 633 KB for `"shortcode":"…"` and `/p/…/` and found **zero** post identifiers. Meta strips the media grid from the logged-out profile. So Instagram gives you a scoreboard row and no feed.

`instagram_oembed` on `graph.facebook.com` did **respond** without a token, which is worth recording precisely:

```
GET https://graph.facebook.com/v21.0/instagram_oembed?url=<a made-up post URL>
→ 400, 426 B
{"error":{"message":"The requested resource does not exist","type":"OAuthException",
  "code":24,"error_subcode":2207045,"error_user_title":"Media Not Found"}}
```

A **media-not-found** error, not an auth error. The endpoint accepted the unauthenticated request and rejected the fake URL. I did not have a real Instagram post URL to complete the test, so **whether `instagram_oembed` serves real media without an app token is unproven** — and it is a ten-second test for P3 with any real `/p/` URL. If it works, Instagram gets the same discover-then-enrich chain TikTok has.

| Route | Rank | Scope | Cost |
|---|---|---|---|
| Logged-out profile `og:description` | **C** | any public profile: followers, following, posts | free |
| `instagram_oembed` (tokenless) | **B?** | one post's caption and author | free — **unproven** |
| DDG `site:instagram.com` → oEmbed | **B?** | discovery, same chain as TikTok | free — **unproven** |
| Instagram Graph API `business_discovery` | **A** | **another** business/creator account's counts and recent media | free, but needs a Facebook app, a connected IG Business account and App Review |
| Browser Run on the profile | **D** | the grid | browser-seconds; **unproven here** |

**`business_discovery` is the one official route that sees other accounts** — it is designed for exactly this — but it requires an approved Facebook app with a connected Instagram Business account. That is a real onboarding cost and a real review, not a signup. **It is the right P3 upgrade and the wrong MVP.**

**Rank C is a warning, not a footnote.** Parsing `og:description` for "9M Followers" is markup-dependent and will break silently. Two mitigations, both cheap: parse defensively and treat a parse failure as a source failure; and note that "9M" is **rounded** — Instagram's logged-out page does not expose an exact count, so week-over-week deltas below a million are invisible on this route. For a creator with 40k followers the rounding is fine; for Gymshark it is useless. That is a product-level limitation, not a bug.

---

## 4. X — closed, and it is a spend decision

Fully covered in `docs/REBUILD-MENTIONS.md` §10 and not re-probed. Summary: `x.com/<handle>` returns a 185,800 B JS shell; `syndication.twitter.com/srv/timeline-profile/…` returns **429 `Rate limit exceeded`**; `nitter.poast.org` fails to connect; and the SuperGrok seat named in the umbrella as the zero-spend route **is not wired** — the live router config has no uncommented grok rung, only the dead-rung comment `openai/grok-4.6 @ cli-chat-proxy.grok.com : 403 personal-team`.

**Rank X.** For creators this hurts more than for brands, because X is where a creator's peers argue about them. It is still a money question and still Nish's.

---

## 5. Threads

Covered in the mentions doc §9: `threads.com/@gymshark` returns **200** with server-rendered markup (279,358–612,489 B across two fetches minutes apart — Meta varies the payload, so an adapter must not assume a stable shape). The official Threads API is **own-account only** by design.

| Route | Rank | Scope |
|---|---|---|
| Logged-out profile HTML | **C** | profile and recent posts, brittle |
| Threads API (`graph.threads.net`) | **A** | **own account only** |

**Recommendation: own-account via the official API, competitors not at all.** For a creator tracking themselves this is the correct route and it is free. For tracking a rival, a 600 KB brittle scrape is the worst trade available; leave Threads out of the competitor set and say so in the UI rather than shipping a number that silently stops updating.

---

## 6. Substack

Covered in the mentions doc §7. `substack.com/api/v1/post/search` returns **200 with zero results for every query including a `nike` control** — a silent block. A known publication's `/feed` works: `https://www.bigtechnology.com/feed` → **200, 314,977 B** (12:02:12 UTC).

| Route | Rank | Scope |
|---|---|---|
| Publication `/feed` | **A** | full post feed of any public publication |
| `api/v1/post/search` | **X** | silently blocked from this vantage |
| DDG `site:substack.com` | **B** | discovery |

**Substack is the easiest platform in this document once you know the publication, and one of the hardest before that.** Resolution is a SERP job, done once per tracked creator, cached. After that it is the same feed adapter as any blog.

---

## 7. Bluesky

Covered in the mentions doc §8: both `public.api.bsky.app` and `api.bsky.app` return **403** to `app.bsky.feed.searchPosts` from this IP — the first an HTML challenge page (2,334 B), the second *"Request forbidden by administrative rules."* (94 B). This is a **vantage-point** block; the same endpoint is open from a residential IP.

The fix costs nothing but a credential: an **app password** on a dedicated throwaway handle → `com.atproto.server.createSession` → authenticated `searchPosts`. Per the charter guardrails, a throwaway identity, never Nish's account.

| Route | Rank | Scope | Cost |
|---|---|---|---|
| Authenticated `app.bsky.feed.searchPosts` | **A** | all public posts, near-real-time | free — **unproven here** |
| `app.bsky.feed.getAuthorFeed` | **A** | any public account's posts | free — unproven |
| Unauthenticated public XRPC | **X** | 403 from our egress | — |

**Bluesky is the highest-value unproven route in this document.** It is a documented, open, rank-A API over the whole public network, and the only thing between us and it is a signup. It should be P3's first probe.

---

## 8. Twitch

```
GET https://api.twitch.tv/helix/users?login=ninja
→ 401, 72 B  {"error":"Unauthorized","status":401,"message":"OAuth token is missing"}
                                                                       (12:08:55 UTC)

GET https://www.twitch.tv/ninja
→ 200, 212,524 B, server-rendered                                      (12:08:55 UTC)
<meta property="og:profile:username" content="ninja">
<meta property="og:description" content="Just want to make people happy.
  Co-Founder @DrinkNutcase. — Ninja streams live on Twitch! …">
<meta property="og:image" content="https://static-cdn.jtvnw.net/jtv_user_pictures/
  90d40495-f467-4911-9035-72d8d10a49c5-profile_image-300x300.png">
```

**Twitch is the cleanest official story here.** Helix is free, covers other channels fully, and needs only a client id plus an **app access token** (client-credentials — no user, no OAuth dance, no review). `/helix/users`, `/helix/channels`, `/helix/videos`, `/helix/clips` and `/helix/streams` all take a login or broadcaster id and return another channel's public data.

| Route | Rank | Scope | Cost |
|---|---|---|---|
| Helix + app access token | **A** | any channel: profile, streams, videos, clips, schedule | free — **unproven here** (401 without a token) |
| Public channel page `og:` | **C** | username, bio, avatar | free — **proven** |

**Unproven, and stated as such:** I did not register a Twitch application, so the Helix route carries no live proof in this document. The 401 is proven; the fix is not. It is a signup, and it is pre-approved under Nish's standing authorization — it just has not happened.

**Recommendation: Helix with a throwaway developer account.** The page-scrape stays as a fallback for the profile card only.

---

## 9. Patreon — closed on every route I tried

```
GET https://www.patreon.com/mkbhd       (Chrome UA)  → 403, 5,698 B
  <title>Just a moment...</title>  — a Cloudflare interstitial            (12:08:55 UTC)
GET https://www.patreon.com/mkbhd       (honest UA)  → 403, 5,527 B       (12:09:34 UTC)
GET https://www.patreon.com/api/oauth2/v2/campaigns  → 401, 2 B  {}       (12:09:34 UTC)
GET https://www.patreon.com/rss/mkbhd                → 404, 161,556 B     (12:09:34 UTC)
```

Three shapes of no: a Cloudflare bot challenge on the public page (with **both** user agents — unlike DuckDuckGo, the honest UA does not help), a bare 401 on the v2 API, and a 404 on the RSS path. Patreon's API v2 is **own-account only** by design: it authorises a creator to read their own campaign, not to inspect somebody else's.

| Route | Rank | Scope |
|---|---|---|
| Public creator page | **X** | 403 Cloudflare challenge from our egress |
| API v2 | **A**, but **own account only** | the authenticated creator's own campaign |
| RSS | **X** | 404 |
| Browser Run on the page | **D?** | **unproven** — a Cloudflare challenge may or may not clear under a real browser |

**Recommendation: Patreon is out.** Patron counts and paid-tier data are the least public data on the internet and the most defended. It is not an MVP source and probably never a competitor source; own-account via API v2 is the only honest offering.

---

## 10. LinkedIn

```
GET https://www.linkedin.com/company/gymshark/
→ 200, 363,461 B  — a guest page, <meta name="pageKey" content="d_org_guest_company_overview">
                                                                       (12:08:55 UTC)
<meta property="og:title" content="Gymshark | LinkedIn">
<meta property="og:url" content="https://uk.linkedin.com/company/gymshark">
… 409,115 followers
```

The logged-out **company** page is server-rendered and carries a real, **exact** follower count — 409,115, not "409K". That is better fidelity than Instagram's rounded number, on a platform that is otherwise the most closed here.

| Route | Rank | Scope |
|---|---|---|
| Logged-out company page | **C** | company name, exact followers, about, industry, size |
| Logged-out personal profile | **C?** | **unproven** — LinkedIn gates personal profiles far harder than company pages |
| LinkedIn Marketing/Community APIs | **A** | partner-gated; own-organisation only for non-partners |

**LinkedIn is a company-page source, not a creator source.** For the creator customer it is mostly irrelevant; for the brand customer it is a cheap follower-count row. Note also that it redirected to `uk.linkedin.com` — the adapter must follow the country redirect and canonicalise back to `www.linkedin.com/company/<slug>` or the same company will appear under several URLs.

---

## 11. Pinterest

Covered in the mentions doc §5: `https://www.pinterest.com/<handle>/feed.rss` → **200, 23,333 B, 25 items**, first pin `https://www.pinterest.com/pin/358810295339792074/` dated 2026-06-10. Rank **B**, free, any public profile, and the `guid` is a clean permalink.

Publishing feed only — there is no zero-spend route to "who pinned my product".

---

## Recommended MVP set for creators

Four routes, all proven here today, all free, all seeing **other** accounts:

| Platform | Route | Proven | Rank |
|---|---|---|---|
| YouTube | channel feed | yes | A |
| TikTok | DDG discovery → oEmbed | yes, end to end | B |
| Instagram | logged-out profile counts | yes | C |
| Pinterest | user RSS | yes | B |

Plus the mentions engine's six sources (`REBUILD-MENTIONS.md`), which are platform-agnostic and cover "who is talking about this creator" across news, Reddit, HN, Medium and the SERP.

**Two signups that should happen before P3 writes a line of code**, because each converts a rank-C or rank-X row into rank A, and each is free:

1. **Bluesky app password** on a throwaway handle → the whole public network, near-real-time, documented API.
2. **Twitch developer application** → Helix app access token → any channel's full public data.

**Then, in order of value per unit of effort:** YouTube Data API key (unlocks `search.list` discovery at 100 units/call); the `instagram_oembed` tokenless test (ten seconds, and it either unlocks the TikTok-style chain for Instagram or it does not); Instagram `business_discovery` via an approved Facebook app (the only official route to another account's exact counts).

**Out, each for a stated reason:** X (every route closed, spend decision), Patreon (403/401/404 on everything public), Threads competitors (brittle 600 KB scrape for data the official API gives only for your own account), LinkedIn personal profiles (unproven and hard-gated), TikTok Research API (applicant-gated, we do not qualify).

## Cost of the zero-spend set

All four MVP routes are plain `fetch` from the Worker. At **100 tracked creators on a daily cadence** that is 400 requests/day ≈ **12,000/month**, against the Workers Paid allowance of 10M requests/month — **0.12%**, effectively free. Per `REBUILD-SCHEMA.md` each poll writes **one `snapshot` row per watch per tick** (400 D1 rows/day, ~12,000/month against 50M included rows-written) with the body in R2.

The one route with a real unit cost is **Browser Run**, and none of the four MVP routes needs it. Two adjacent jobs do: YouTube channel-id resolution (a 2 MB bot-gated page, **once per creator, cached forever**) and any future TikTok profile-grid route. At 10 h/month included and $0.09/hour after (`REBUILD-STACK.md` §4.3), one-off resolution for 100 creators is noise; a daily TikTok grid render for 100 creators is not, and would need its own budget line before anyone builds it.

**The real constraint is rate limits and bot-gating, not money** — the same conclusion the mentions doc reached. DuckDuckGo challenges some requests, Reddit 429s on a burst, and the bot-gated pages need a browser. Everything paced through one Queue consumer at `max_concurrency: 1`, cron → enqueue → consumer.

---

## Paid providers — the money decision

**Nothing below was purchased, signed up for, or trialled.** Prices are read from public pricing pages.

All four pricing pages were read **2026-09-21 ~12:12 UTC** from this VPS. `scrapecreators.com/pricing` is a **404**; the tiers live on the homepage at `/#pricing`.

| Provider | Tier | Monthly USD | Billing unit | Derived $/1,000 records | Platforms | Other accounts? |
|---|---|---|---|---|---|---|
| **Apify** <br><https://apify.com/pricing> | Free / Starter / Scale / Business | $0 / **$19** / **$199** / **$999** | platform credit; `1 CU = 1 GB RAM for 1 hour`. Store actors are "pay per event" or "pay per usage" — **the plan page publishes no per-result price** | actor-specific — the TikTok Scraper (`clockworks/tiktok-scraper`, its own page) is **$1.70 / 1,000 results**, pay-per-event | IG, TikTok, YouTube, X, FB, LinkedIn via separate actors | **yes** |
| **Bright Data** <br><https://brightdata.com/products/web-scraper/pricing> | Free / Pay-as-you-go / Scale / Enterprise | $0 (5K records/mo) / usage / **$499** (384,000 records incl.) / custom | records | **$1.50 / 1K** PAYG; **$1.30 / 1K** additional on Scale | IG (profiles, posts, reels), TikTok (profiles, posts), LinkedIn (people, company, jobs, posts), X (profiles, posts), YouTube (videos, channels), FB pages | **yes** |
| **ScrapeCreators** <br><https://scrapecreators.com/#pricing> | Free / Freelance / Business / Enterprise | $0 (100 credits) / **$47** (25,000) / **$497** (500,000) / custom | credits, **never expire**, pay-as-you-go not subscription | **$1.88 / 1K** (Freelance) → **$0.99 / 1K** (Business) | 37+ APIs — TikTok, IG, YouTube, FB, X, LinkedIn, Reddit, Pinterest, Threads, Bluesky, Twitch, Spotify | **yes** |
| **EnsembleData** <br><https://ensembledata.com/pricing> | Free / Wood / Bronze / Silver / Gold / Platinum | $0 (50/day) / **$100** (1,500/day) / **$200** (5,000/day) / **$400** (11,000/day) / **$800** (25,000/day) / **$1,400** (50,000/day) | in-house "units", **quota is per day**; an endpoint costs **1–10 units**, some variable by `#posts` / `#replies` | Wood ≈ 45,000 units/mo for $100 → **$2.22 / 1K units**; Platinum ≈ 1.5M/mo for $1,400 → **$0.93 / 1K units**. **Records ≠ units** — divide by 1–10 | TikTok, Instagram, YouTube, Threads, Reddit, Twitch, Twitter, Snapchat | **yes** |

**RapidAPI-hosted social APIs** are a whole category of resellers wrapping the same scraping, with per-call freemium tiers. Not priced here: they are a marketplace of individually-maintained listings, so "RapidAPI" is not a vendor you can evaluate — each listing is. Named so the category is not mistaken for an unexplored option.

### What this costs at 100 tracked creators, daily

Model: 100 creators × 4 platforms × 1 poll/day × ~10 records = **4,000 records/day ≈ 120,000 records/month**.

| Provider | Cost at 120k records/month |
|---|---|
| Bright Data, pay-as-you-go | **~$180** |
| Bright Data, Scale | **$499** (covers 384k, so ~3× headroom) |
| Apify (at the TikTok actor's $1.70/1K) | **~$204** of credit — the $199 Scale plan does not quite cover it |
| ScrapeCreators, Business rate | **~$119** of credit; $497 buys roughly four months |
| EnsembleData | **$200 – $1,400** depending on units-per-call (1–10). The spread is the whole risk. |

**The finding the packet asked for.** That is **$1.20 – $5.00 per tracked creator per month** in raw data cost, before a single Worker request, before D1, before Jev. Any plan that lets a customer track ten competitors at under roughly $20/month is **underwater on data alone** on any of these providers. The zero-spend set is not a cost optimisation — it is what makes the unit economics exist at all.

**EnsembleData deserves one extra warning.** Its quota is **per day**, not per month, so a backfill or a retry storm cannot borrow from tomorrow — it just fails. And "units" are 1–10 per endpoint with some variable by result count, so the monthly bill is not knowable in advance from the price page. That is the opposite of what a cost-capped product wants.

### Recommendation on spend

**Buy nothing yet.** The four zero-spend MVP routes are proven and free, and two free signups (Bluesky app password, Twitch developer app) convert the two highest-value unproven rows to rank A at no cost. Revisit paid providers only when a **named, measured** gap survives that work.

**If and when a provider is bought**, the shape of the decision is:

- **ScrapeCreators** is the cheapest per record at scale ($0.99/1K on Business), credits never expire, and its 37+ APIs cover more of our platform list than anyone else — including Threads and Bluesky, our two weakest rows. Best fit on paper.
- **Bright Data** is the most predictable — flat per-record pricing, a published Scale tier, and the broadest LinkedIn coverage, which is the one platform nothing else reaches.
- **Apify** is the most flexible and the least predictable, because pricing is per actor and the plan page publishes no per-result rate.
- **EnsembleData** is the one to avoid for a cost-capped product, for the daily-quota and variable-unit reasons above.

**The single money decision for Nish:** *do we buy any creator data at all, and if so, is it ScrapeCreators Business at $497 (≈ four months of 100-creator coverage, credits that never expire) or Bright Data Scale at $499/month (384,000 records, predictable, best LinkedIn)?* Everything else in this document is free and needs no decision.

---

## Findings the rebuild must not inherit

1. **TikTok's oEmbed endpoint is open and returns real captions** (`200`, `1,906 B`, caption with hashtags and collab handles) — but it needs a URL you already have. TikTok's problem is discovery, not enrichment, and the SERP solves discovery. I proved the whole chain.
2. **Instagram's logged-out page gives counts and nothing else.** Zero post shortcodes in 633 KB. And the count is **rounded** ("9M"), so week-over-week deltas are invisible for large accounts.
3. **Patreon refuses an honest User-Agent as readily as a spoofed one** — the opposite of DuckDuckGo. There is no UA trick here; it is a Cloudflare challenge.
4. **Twitch is free and easy and we have not done the signup.** A 401 saying "OAuth token is missing" is not a closed door.
5. **A stale YouTube channel id returns 404 HTML, not an empty feed.** Resolve once, cache on the entity, alert on 404.
6. **LinkedIn serves an exact follower count on a logged-out company page** and redirects to a country subdomain. Canonicalise the URL or you will track one company twice.
7. **No Browser Rendering route in this document is proven**, because this host has no Cloudflare credentials. Every "needs Browser Run" verdict is an inference from markup. Do not report them as working.
