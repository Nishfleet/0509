# REBUILD mentions — every route to a brand mention, probed

Umbrella #3842. Written by the Opus deputy, **2026-09-21**. This replaces the worker-written `docs/REBUILD-MENTIONS.md` wholesale; nothing was carried over, and every row below rests on a probe I ran for this document.

**Brand under test: Gymshark** (`gymshark.com`, `@gymshark`), the same brand the keep-list used — big enough to trip the bot-gating that small brands do not.

## Method, and the vantage point that decides half the answers

Every probe ran from **this VPS (netcup, a datacenter IP)** with `curl`, on **2026-09-21 between 12:00 and 12:04 UTC**. Times below are UTC.

That vantage point is not incidental — it is the same one workerd egresses from, and it is what separates "this API is open" from "this API is open to a browser". Where a route behaves differently from a datacenter IP than the docs imply, the row says so with the status code and what the body actually was.

**Two conventions:**
- A route with no live response is reported as **unproven**, never as working.
- A **200 with an empty result set** is recorded as a block, not as "no mentions". Substack is exactly this case, and it is the most dangerous failure mode in this document.

## The scoreboard

Status and byte counts are from my probes; a record id or URL is quoted for every route that returned data.

| # | Source | Route probed | Status | Verdict |
|---|---|---|---|---|
| 1 | Hacker News | `hn.algolia.com/api/v1/search_by_date` | **200**, 4,693 B | **WORKS**, no key |
| 2 | Reddit | `reddit.com/search.rss` (unauth) | **200**, 76,579 B, 25 entries | **WORKS**, no key — but rate-limited |
| 2b | Reddit | `reddit.com/search.json` (unauth) | **403**, 189,908 B of HTML | **BLOCKED** |
| 2c | Reddit | `reddit.com/r/Gymshark/new.rss`, 2nd request in ~15 s | **429**, 0 B | **RATE-LIMITED** |
| 3 | Mainstream media | `news.google.com/rss/search` | **200**, 125,875 B, **100 items** | **WORKS**, no key |
| 4 | Blogs (Medium) | `medium.com/feed/tag/gymshark` | **200**, 17,155 B, 10 items | **WORKS**, no key |
| 5 | Pinterest | `pinterest.com/gymshark/feed.rss` | **200**, 23,333 B, 25 items | **WORKS**, own account only |
| 6 | YouTube | `youtube.com/feeds/videos.xml?channel_id=…` | **200**, 22,556 B, 15 entries | **WORKS**, no key, own channel only |
| 7 | Substack | `substack.com/api/v1/post/search` | **200**, 89 B, **zero results for every query** | **SILENTLY BLOCKED** |
| 7b | Substack | a known publication's `/feed` | **200**, 314,977 B | **WORKS** once you know the publication |
| 8 | Bluesky | `public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` | **403**, 2,334 B HTML block page | **BLOCKED** from a datacenter IP |
| 8b | Bluesky | `api.bsky.app/xrpc/…` | **403**, 94 B, *"Request forbidden by administrative rules."* | **BLOCKED** |
| 9 | Threads | `threads.com/@gymshark` | **200**, 279,358–612,489 B HTML | **READABLE**, server-rendered, own profile only |
| 10 | X | `x.com/gymshark` | **200**, 185,800 B — a JS shell | **NOT USABLE** as-is |
| 10b | X | `syndication.twitter.com/srv/timeline-profile/screen-name/gymshark` | **429**, 20 B, `Rate limit exceeded` | **BLOCKED** |
| 10c | X | `nitter.poast.org/search` | **000** — connection failed | **DEAD** |
| 10d | X | the SuperGrok seat | **not wired** — see §10 | **DEAD** |
| 11 | SERP (DuckDuckGo) | `html.duckduckgo.com/html/` | **200**, 42,890 B, 10 links *and* **202**, ~14 KB, 0 links | **INTERMITTENT** — both outcomes reproduced from this VPS |
| 11b | SERP (Bing) | `bing.com/search?format=rss` | **200**, 4,973 B | **WORKS technically, blocked by its own terms** |
| 12 | GDELT | `api.gdeltproject.org/api/v2/doc/doc` | **429** | **PACED-CRON ONLY** |

---

## 1. Hacker News — Algolia Search API

**Route:** `https://hn.algolia.com/api/v1/search_by_date?query=<brand>&tags=story`
**Probed 2026-09-21 12:00:32 UTC → 200, 4,693 B, `application/json`.** The payload carried real hits including a story whose `story_text` matched `gymshark` from author `kalebestavillo1`.

- **Key:** none. **Cost:** free.
- **Rate limit:** documented at 10,000 requests/hour per IP for the search endpoints (<https://hn.algolia.com/api>). We will use single digits per brand per day.
- **Freshness:** `search_by_date` is ordered newest-first and HN's index is near-real-time. Use `search_by_date` and never `search` — the latter sorts by relevance, which means a poll can return the same old thread forever and miss today's.
- **Record shape:** `objectID` (the HN item id, a stable permanent id), `created_at_i` (epoch), `title`, `url`, `author`, `points`, `num_comments`, `story_text`.
- **Cursor:** `numericFilters=created_at_i>{last_seen}`. This is the cleanest incremental cursor of any source in this document.

**Anti-pattern:** treating a comment hit and a story hit as the same record. `tags=story` and `tags=comment` are different polls with different canonical URLs; merging them makes dedup impossible.

---

## 2. Reddit — the RSS endpoint is open, the JSON endpoint is not

**This corrects the inherited claim that Reddit is a flat 403 unauthenticated.** It is not. The two endpoints behave differently from the same IP, seconds apart:

- `https://www.reddit.com/search.json?q=gymshark&sort=new&limit=3` → **403**, 189,908 B of Reddit's own HTML error page, 12:00:33 UTC.
- `https://www.reddit.com/search.rss?q=gymshark&sort=new` → **200**, 76,579 B, `application/atom+xml`, **25 `<entry>` elements**, 12:00:35 UTC.

First entry from that Atom feed, verbatim fields:

```
id:      t5_3atwd
author:  /u/NOU_TURN
title:   Be a Visionary
link:    https://www.reddit.com/r/Gymshark/
updated: 2015-11-16T05:09:06+00:00
```

**Two things that record teaches, and both are load-bearing.**

1. **`search.rss` mixes subreddits (`t5_`) into post results (`t3_`).** The top hit is the *subreddit* r/Gymshark from 2015, not a mention. A mentions poll must filter on the `t3_` prefix in `<id>` or it will ingest a decade-old community page as today's news. I tried `&type=link` to filter server-side: it returns **0 entries**, so the parameter is not supported on the RSS endpoint. The filter is ours, client-side, on the id prefix.
2. **`sort=new` does not fully order the feed.** A 2015 entry came back first under `sort=new`. Sort by the parsed `<updated>` yourself.

**Rate limiting is the real constraint.** My second Reddit request in about fifteen seconds — `https://www.reddit.com/r/Gymshark/new.rss` at 12:01:40 UTC — returned **429 with a zero-byte body**. From a datacenter IP, Reddit's unauthenticated RSS tolerates roughly one request at a time and no burst. Design for it: one Reddit poll per tick for the whole workspace, spaced, through a Queue consumer with `max_concurrency: 1` — not one fetch per tracked brand fired in parallel.

- **Key:** none for RSS. **Cost:** free.
- **Freshness:** minutes.
- **Record shape:** `<id>` (`t3_…` — the stable Reddit fullname), `<title>`, `<link href>`, `<updated>`, `<author><name>` (`/u/…`), `<content type="html">`, and `<category term>` carrying the subreddit.
- **Cursor:** max `<updated>` seen per query. There is no `after` parameter on RSS.

**The official API, for the record.** Reddit's Data API requires an OAuth app and, for anything commercial, an approved commercial-access agreement. I could not retrieve the current terms from this host: `support.reddithelp.com/hc/en-us/articles/16160319875092` → **403**, and `redditinc.com/policies/data-api-terms` → **301**. Recorded as **not retrievable from this vantage point**, not as "free". The free RSS route above is what the MVP uses; the OAuth route is a later upgrade whose terms Nish must read before we rely on it commercially.

---

## 3. Mainstream media — Google News RSS

**Route:** `https://news.google.com/rss/search?q=%22<Brand>%22&hl=en-US&gl=US&ceid=US:en`
**Probed 12:00:35 UTC → 200, 125,875 B, `application/xml`, 100 `<item>` elements.**

First item, verbatim:

```
title: Gymshark Hit With Class Action Over Alleged Influencer Marketing Practices
       (via Passle) - Frankfurt Kurnit Klein & Selz
guid:  CBMiuwFBVV95cUxQQWtPbTkxR2Z5WGUxaHJFN2FJdEdleThJOGJtM0ZGa2xXaG5XUkQ5dTJfdXo5VVQ0…
link:  https://news.google.com/rss/articles/CBMiuwFBVV95cUxQQWtPbTkx… ?oc=5
```

That single item is the argument for this source: a class action over influencer marketing, surfaced the same day, from a law firm's blog that no per-publisher feed list would have contained.

- **Key:** none. **Cost:** free. **Freshness:** minutes to a couple of hours.
- **Quoting matters.** `q="Gymshark"` with the quotes is what keeps "gym shark" and "gym sharks" out. Unquoted, precision collapses for any brand whose name is two common words.
- **Record shape:** `title` (which carries ` - <Publisher>` as a suffix — split on the last ` - ` to get the publisher), `link`, `guid` (opaque but stable), `pubDate`, `source` element with `url`.
- **Cursor:** max `pubDate`. Dedup on `guid`.

**The one real problem: `link` is a Google redirect, not the article.** The `guid` is a base64-ish blob, not a URL.

**Rule: the opaque `news.google.com/rss/articles/…` URL is never stored as `canonical_url`.** Two different Google News queries produce two different opaque URLs for the *same* article. Store either one and `url_hash` stops being a dedup key — the same story lands twice for one brand, and a story found by both Google News and any other source lands twice again. `REBUILD-SCHEMA.md` requires every mention to carry `canonical_url` and `url_hash`, so a Google News item **is not a storable mention until its real URL is resolved**.

**How it is resolved is not this document's call.** Resolution is a real engine step with real cost — one request per *new* item that survives `guid` dedup, not one per poll — and it belongs to **D8** in the architect's engine design, which owns fetching, retries and the Browser Run fallback for items a plain `fetch` cannot follow. This document's contribution is the constraint, not the mechanism: no canonical, no signal row.

---

## 4. Blogs — Medium tag feeds, plus the general blog problem

**Route:** `https://medium.com/feed/tag/<tag>`
**Probed 12:00:37 UTC → 200, 17,155 B, 10 `<item>` elements.** Channel title `Gymshark on Medium`.

First item, verbatim:

```
title:      What Gymshark Teaches Every Startup Founder
link:       https://medium.com/@startuporigins4u/what-gymshark-teaches-every-startup-founder-bd5a0a82d407?source=rss------gymshark-5
guid:       https://medium.com/p/bd5a0a82d407
pubDate:    Mon, 14 Sep 2026 13:14:43 GMT
dc:creator: Startuporigins
```

- **Key:** none. **Cost:** free. **Freshness:** hours. **Depth:** 10 items, no pagination.
- **`guid` is the canonical**, not `link` — `link` carries a `?source=rss------<tag>-<n>` tracking suffix that changes with the tag and the position, so two tags produce two "different" URLs for one post. Store `guid`; strip the query string from `link`.
- **Coverage is only as good as the tag.** A post that mentions Gymshark without tagging it is invisible here. Medium is a cheap, precise supplement, never the blog strategy.

**The general blog problem, stated rather than hidden.** There is no feed for "blogs that mentioned my brand". The routes that actually cover it are the SERP (§11) and Google News, which indexes far more than newspapers — the first Google News item above is a law-firm blog. **Per-publisher RSS is for brands you already know matter**, and `@extractus/feed-extractor` (see `REBUILD-STACK.md` §5.3) handles RSS, Atom and RDF from one adapter, so adding a watched blog is a `source_target` row and nothing else.

---

## 5. Pinterest — own account only

**Route:** `https://www.pinterest.com/<handle>/feed.rss`
**Probed 12:00:46 UTC → 200, 23,333 B, 25 `<item>` elements.** Channel title `Gymshark`, description `We Do Gym.`

First item, verbatim:

```
link:    https://www.pinterest.com/pin/358810295339792074/
guid:    https://www.pinterest.com/pin/358810295339792074/
pubDate: Wed, 10 Jun 2026 11:59:58 GMT
title:   Thick, cosy material to keep you warm / Style it up or down with minimal logos / …
```

- **Key:** none. **Cost:** free. **Freshness:** as fast as the account pins.
- **This is a publishing feed, not a mentions feed.** It answers "what did this brand pin", which is a competitor-activity signal, not a mention. There is no zero-spend route to "who pinned my product" — Pinterest's own search is JS-rendered and its API is partner-gated.
- **Record shape:** `guid` is the pin permalink and is a clean canonical. `title` carries the pin description with embedded newlines; normalise whitespace before hashing.

**Honest placement: Pinterest is a competitor-activity source, filed under mentions only because the packet listed it there.** Recorded so nobody later reports it as a mentions gap.

---

## 6. YouTube — channel feeds, no key

**Route:** `https://www.youtube.com/feeds/videos.xml?channel_id=<UC…>`
**Probed 12:01:55 UTC → 200, 22,556 B, 15 `<entry>` elements.** Channel title `Gymshark`.

First entry, verbatim:

```
yt:videoId: QVx0PY1lf-s
title:      GYMSHARK ONYX V1 RETURNS
published:  2026-07-14T13:42:02+00:00
author:     Gymshark
```

**The channel id is the whole difficulty, and it is a real trap.** My first probe used a channel id carried over from an earlier note — `UCkF3Ry7Z0YqJbGVxFpqGVCw` — and returned **404, 1,613 B** at 12:00:46 UTC. The correct id is `UCma7hhYJ3bfEhZgw3xl77ww`, which I recovered by fetching `https://www.youtube.com/@Gymshark/about` with a browser UA (200, 2,068,147 B) and taking the most frequent `UC…` token in the page — it appeared 182 times against 7 for the runner-up.

So resolution is: handle → channel page → `UC…` id, **once**, cached on the entity. Never per poll. That page fetch is a bot-gated 2 MB HTML document and belongs on the Browser Run path (`REBUILD-STACK.md` §4.3), not on plain `fetch`.

- **Key:** none for the feed. **Cost:** free. **Depth:** 15 entries, no pagination, no history.
- **Freshness:** minutes.
- **Record shape:** `yt:videoId` (canonical id), `title`, `published`, `updated`, `author/name`, `media:group` with description, thumbnail and `media:statistics`.
- **Mentions vs. own-channel.** The feed is own-channel only. Finding *other people's* videos about a brand needs the YouTube Data API `search.list` (an API key, 100 quota units per search against a default 10,000/day — so ~100 searches/day) or the SERP. The feed is the free half; the keyed half is a later upgrade.

---

## 7. Substack — a 200 that means "no"

**This is the most dangerous result in this document.**

```
GET https://substack.com/api/v1/post/search?query=gymshark&limit=3
→ 200, 89 bytes, application/json
{"focused":[],"results":[],"resultsWithTrackingParams":[],"more":false,"publications":[]}
```

Probed 12:00:46 UTC. So I ran a control at 12:02:12 UTC — `query=nike`, the most-written-about brand on the internet — and got **byte-identical output**: 200, 89 bytes, zero results. `https://substack.com/api/v1/publication/search?query=fitness` returned **200, 14 B, `{"results":[]}`**.

**An endpoint that returns an empty set for "nike" is not reporting absence. It is blocking, silently, with a 200.** A poller that trusts the status code records "0 mentions this week" forever and no alarm ever fires. Any Substack adapter must carry a **canary query with a known-nonzero expected result**, and treat a zero return on the canary as a source failure, not as data.

**What does work:** a known publication's feed.

```
GET https://www.bigtechnology.com/feed  → 200, 314,977 bytes, RSS 2.0
```

Probed 12:02:12 UTC. Every Substack publication serves `/feed` at its custom domain or `<name>.substack.com/feed`, and `@extractus/feed-extractor` parses it with no special case.

**So Substack splits in two:** *discovery* of which publications mention a brand is blocked from this vantage point and falls back to the SERP (§11); *tracking* a publication once known is free, open RSS and shares the blog adapter. For the MVP, Substack is the blog adapter with Substack domains in it — not a source of its own.

---

## 8. Bluesky — closed from a datacenter IP, open with an app password

Two hosts, two 403s, both 2026-09-21:

```
GET https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=gymshark&limit=3
→ 403, 2,334 B, text/html  — an HTML block page, not API JSON        (12:00:33 UTC)

GET https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=gymshark&limit=2
→ 403, 94 B: "<html><body><h1>403 Forbidden</h1>
   Request forbidden by administrative rules."                        (12:02:54 UTC)
```

The first body is an HTML challenge page with an embedded SVG background — an edge block, not an API rejection. This matches the keep-list's independent finding and is a **vantage-point** block, not a policy one: the same endpoint is open from a residential IP.

**The route that costs nothing but a credential:** authenticate with an **app password** (Bluesky Settings → App Passwords — a revocable secondary credential, never the account password), call `com.atproto.server.createSession` for an access JWT, then `app.bsky.feed.searchPosts` against the authenticated host. Per the charter's creator guardrails this uses a **dedicated throwaway identity**, never Nish's account.

- **Key:** an app password on a throwaway handle. **Cost:** free.
- **Freshness:** seconds — the firehose is public and search is near-real-time.
- **Record shape:** `uri` (an `at://did:plc:…/app.bsky.feed.post/<rkey>` AT-URI — the canonical id), `cid`, `author.did` + `author.handle`, `record.text`, `record.createdAt`, `replyCount`, `repostCount`, `likeCount`.
- **Canonical URL** for display is `https://bsky.app/profile/<handle>/post/<rkey>`, derived from the AT-URI. Store the AT-URI as the id and the derived URL as `canonical_url`; a handle can change, a DID cannot.

**Unproven, and stated as such:** I did not create a throwaway Bluesky identity or run an authenticated call, so the authenticated route carries **no live proof in this document**. The 403s are proven; the fix is not. It is a five-minute signup and the first thing to verify in P3.

---

## 9. Threads — server-rendered HTML, own profile only

```
GET https://www.threads.com/@gymshark
→ 200, 612,489 B (12:00:46 UTC) and 279,358 B on a repeat (12:02:12 UTC), text/html
```

The profile page **is** server-rendered — the markup carries Instagram CDN asset links and Meta's own `_9dls` class names, not an empty JS shell. The 2.2× size difference between two fetches of the same URL minutes apart is Meta varying the embedded payload per request; an adapter must not assume a stable document shape.

`https://www.threads.com/oembed?url=…` returned **200 with the same 279,357-byte profile HTML** — there is no working public oEmbed endpoint; it falls through to the page.

- **Key:** none for the public profile. **Cost:** free, but this is a **markup-dependent route** and therefore the least robust in this document. It breaks whenever Meta reorganises its payload, and it breaks silently.
- **Scope:** own profile only. There is no public mentions search.
- **The official route** is the Threads API (`graph.threads.net`), which is **own-account only** — it authorises a user to read their own Threads data, not to search other people's. For competitor tracking it is useless by design; for the creator's *own* account it is the correct route (see `REBUILD-CREATORS.md`).

**Recommendation: Threads is out of the MVP mentions set.** A brittle markup scrape of a 600 KB page, for own-profile posts we can get from the official API, is the worst trade in this document.

---

## 10. X — every zero-spend route is closed today

Four probes, four failures, all 2026-09-21:

```
GET https://x.com/gymshark
→ 200, 185,800 B — a JS application shell (data-app-version=a8fead38…). No posts in the HTML.

GET https://syndication.twitter.com/srv/timeline-profile/screen-name/gymshark
→ 429, 20 B: "Rate limit exceeded"                                    (12:02:54 UTC)

GET https://nitter.poast.org/search?f=tweets&q=gymshark
→ 000 — connection failed                                             (12:02:54 UTC)
```

**And the fourth: the SuperGrok seat is not wired.** The umbrella's open question named "an undocumented consumer proxy on the SuperGrok seat" as the proven zero-spend X route. I read the live router config, `~/.config/fleet-ops/litellm-proxy.yaml`, today: there is **no uncommented `grok` deployment**. The only occurrence is line 5, in the dead-rung comment block at the top of the file:

```
#   openai/grok-4.6 @ cli-chat-proxy.grok.com           : 403 personal-team
```

`403 personal-team`. The seat is out, and that route is therefore **not available** regardless of policy.

**So X is now purely a money question**, which is Nish's alone. Two paid routes, and I could not price either one honestly from this host:

- **xAI's agent tooling.** `docs.x.ai/docs/guides/live-search` now documents a **Web Search tool** rather than the older `search_parameters` Live Search shape, and neither `docs.x.ai/docs/models` nor that guide states a per-source or per-search price — Grok 4.6 token pricing is published ($2.00/M input, $6.00/M output under 200k), **search tool pricing is not**. Recorded as **not stated on those pages**, not guessed.
- **The X API.** `developer.x.com/en/portal/products` returned **402 Payment Required** to an unauthenticated fetch and `developer.x.com/en/products/twitter-api` returned **307**; `docs.x.com/x-api/introduction` returned 200 but the tier table is behind the portal. Recorded as **not retrievable from this vantage point**.

**Recommendation: X ships dark in the MVP.** Mentions land from ten other sources; X is a source registry row with `enabled = 0` until Nish makes a spend decision with real prices in front of him. That is one row, not a migration — which is the whole point of the `source` registry in `REBUILD-SCHEMA.md`.

---

## 11. The SERP route — and a caveat that inverts expectations

The SERP is the only route that covers "any blog, any forum, any site that mentioned us". Two endpoints, two different problems.

### DuckDuckGo HTML — INTERMITTENT, and that is worse than broken

Two agents probed the same endpoint from the same VPS on the same day and got different answers. Both sets of results stand.

```
--- my probes, 2026-09-21 -------------------------------------------------
GET https://html.duckduckgo.com/html/?q=gymshark
  UA: Mozilla/5.0 (compatible; 0509-research/1.0)
→ 200, 42,890 B, 10 result links                                      (12:02:39 UTC)

GET https://html.duckduckgo.com/html/?q=gymshark
  UA: Mozilla/5.0 (compatible; 0509-research/1.0)
→ 200, 37,629 B                                                       (12:00:46 UTC)

GET https://html.duckduckgo.com/html/?q="gymshark" review
  UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/141.0
→ 202, 14,234 B, 0 result links — a challenge page                    (12:02:28 UTC)

--- the deputy's probes, same day, same host ------------------------------
five requests, three seconds apart, browser UA
→ 202, ~14 KB, 0 result links, every time
```

**Verdict: INTERMITTENT, and therefore out of the MVP.** Intermittence is worse than consistent failure here, and the reason is the failure shape: a 202 is a **success status carrying an empty result set**. A one-off check passes, the adapter ships, and then it returns nothing for days without ever erroring. That is the same class of failure as Substack's 200-with-zero-results (§7) — the most expensive kind, because nobody goes looking.

**On the User-Agent, precisely, because the pattern is suggestive and the sample is small.** Across all eight observations the correlation is clean: honest identifying UA → 200 with results (2 of 2); spoofed browser UA → 202 challenge (6 of 6). So "do not spoof a browser UA on the SERP route" is a good working hypothesis and the opposite of the usual scraping instinct. It is **not proven**, for two reasons: eight probes inside four minutes is not a sample, and my one browser-UA failure also carried a *quoted, two-term* query while both successes were a single bare term — so query shape is an uncontrolled second variable. Anyone who wants to promote DuckDuckGo to the MVP owes a proper matrix: both UAs × both query shapes × several hours apart.

This does correct the inherited claim that `html.duckduckgo.com` flatly 202-challenges from a datacenter IP — it does not always. It just cannot be relied on to not.

- **Key:** none. **Cost:** free.
- **Parsing, for whenever it is wired:** results are `<a class="result__a" href="//duckduckgo.com/l/?uddg=<percent-encoded-target>">`, and `uddg` must be percent-decoded to get the real URL. **The first results are ads** — in my 200 response, two `ad_provider=bingv7aa` redirect chains before any organic result. An adapter that takes `results[0]` ingests an advertisement as a brand mention.
- **Freshness:** whatever the index holds — days, not minutes. The SERP is a **breadth** source, not a fast one. Nothing time-sensitive should depend on it.
- **If it is ever wired**, it needs a canary (§ the record spec) and an explicit check that a 202 is treated as a source failure, never as zero results.

### Bing RSS — works technically, and its own terms forbid us

```
GET https://www.bing.com/search?q=%22gymshark%22&format=rss&count=5
→ 200, 4,973 B, text/xml
```

Real results, first item `https://de.gymshark.com/`. But the feed ships its own `<copyright>` element, and it is not boilerplate:

> *"Diese XML-Ergebnisse dürfen ausschließlich zum privaten und nichtkommerziellen Gebrauch auf die Art und Weise und zu dem Zweck verwendet … dass die Ergebnisse von Bing innerhalb eines RSS-Aggregators übertragen werden. Jegliche andere Nutzung dieser Ergebnisse bedarf der ausdrücklichen schriftlichen Genehmigung von Microsoft Corporation."*

Private and non-commercial use, inside an RSS aggregator, only. Anything else needs Microsoft's express written permission. **0509 is a commercial product and is not an RSS aggregator**, so this route is closed by terms, not by technology. Recorded in full because "it returns 200" would otherwise make it look like the best SERP option available.

**Result: there is no dependable zero-spend SERP route today.** DuckDuckGo is intermittent from our egress and Bing is closed by its own terms. That is a real gap, and it matters most for the two jobs only a SERP does: finding arbitrary blogs and forums that mentioned a brand, and resolving which Substack publication or TikTok video to track in the first place.

What it does **not** block: the MVP. Google News indexes far more than newspapers — the first item in §3 is a law-firm blog — so blog coverage degrades rather than disappears. Record this as a gap to close with evidence, not as a source to ship on a single green probe.

---

## 12. GDELT — paced cron only

```
GET https://api.gdeltproject.org/api/v2/doc/doc?query="Gymshark"&mode=ArtList&format=json&timespan=7d
→ 429                                                                  (12:00:46 UTC)
Body: "Please limit requests to one every 5 seconds or contact … All high-traffic users
       should switch to our ngrams dataset …"
```

Same result the keep-list got on two attempts twelve seconds apart. The 5-second budget is **per IP**, and a shared datacenter IP is already saturated by other tenants before we send anything.

- **Verdict: usable from a paced cron, never from a request path.** One call, with retry-on-429 and backoff, inside the Queue consumer.
- **The serviceable window is 7 days.** The prior doc's `timespan=3months` returns an empty set — that correction was made by the worker-written version and I am carrying it forward because it is a fact about the upstream, not a design choice.
- **Overlap:** GDELT and Google News cover much of the same ground. GDELT's edge is non-English and long-tail international coverage; its cost is a 429-prone endpoint. **Not in the MVP set** — it is the first addition once the MVP is stable, and it is one `source` row.

---

## Recommended MVP set

Five sources. Every one of them returned real data from this VPS today, on every attempt, needs no key, and costs nothing.

| Source | Plugin key | Reliability (per `REBUILD-SCHEMA.md`) | Cadence |
|---|---|---|---|
| Google News RSS | `news.google_rss` | `rss` | daily |
| Reddit `search.rss` | `reddit.search_rss` | `rss` | daily, concurrency 1 |
| Hacker News Algolia | `hn.algolia` | `official_api` | daily |
| YouTube channel feed | `youtube.channel_rss` | `rss` | daily |
| Medium tag feed | `medium.tag_rss` | `rss` | daily |
Plus **Pinterest `pinterest.user_rss`** where the brand has a handle — filed as competitor activity, not mentions (§5).

**Deliberately out of the MVP, each for a stated reason:**

| Out | Because |
|---|---|
| X | every zero-spend route is closed and the SuperGrok seat is dead (§10). Money decision. |
| Bluesky | 403 from our egress; needs a throwaway app password, unproven here (§8). First thing to fix in P3. |
| Threads | markup-dependent scrape of a 600 KB page for own-profile data the official API already gives (§9). |
| Substack | search is silently blocked; tracking is just the blog adapter (§7). |
| GDELT | 429-prone; overlaps Google News (§12). |
| Bing RSS | terms forbid commercial, non-aggregator use (§11). |
| DuckDuckGo HTML | **intermittent** — 200-with-results and 202-with-nothing both reproduced from this host the same day (§11). A 202 is a success status carrying an empty set, so it fails silently. Needs a proper probe matrix before it ships. |

**Cost at 100 tracked brands, daily.** Five polls per brand per day = 500 fetches/day ≈ 15,000/month. Against the Workers Paid allowance of 10M requests/month that is **0.15%**, and no source charges anything. Per `REBUILD-SCHEMA.md` this writes **one `snapshot` row per watch per tick** — 500 D1 rows/day, ~15,000/month against 50M included rows-written — plus `signal` rows only for items that survive judgment. The bodies go to R2. Nothing here approaches the 2026-09-17 rows-written anti-pattern.

**The real budget is rate limits and bot-gating, not money.** Reddit 429s on a second request within fifteen seconds; GDELT 429s at twelve-second spacing; DuckDuckGo challenges unpredictably. Two engineering consequences:

1. Polls go through a **Queue consumer with `max_concurrency: 1`** for the rate-limited sources (Reddit today; GDELT and DuckDuckGo if either is ever added), not a `Promise.all` over brands.
2. The tick is **cron → enqueue → consumer**, never work done inline in `scheduled` (`REBUILD-STACK.md` §4.10).

---

## The unified mention record

Aligned to `docs/REBUILD-SCHEMA.md` on main. **A mention is not its own table.** It is a `signal` row with `kind = 'mentions'`, and `mention` is a view over `signal` — so the vocabulary in the issue maps to a real schema object without a second store.

**What the poll writes** (the cost boundary, `REBUILD-SCHEMA.md`): one `snapshot` row per `watch` per tick — `payload_r2_key`, `payload_hash`, `item_count`, `fetched_at` — with the raw feed body in R2. An unchanged feed is a hash comparison, not a write.

**What survives judgment (D5) becomes a `signal` row.** The per-kind CHECK on the spine already requires `canonical_url` and `url_hash` for `kind = 'mentions'`. The shape each adapter must produce:

| Field | Type | Meaning | Per-source source of truth |
|---|---|---|---|
| `source_id` | FK → `source` | the registry row; `platform` + `kind` + `plugin_key` | — |
| `external_id` | TEXT | the platform's own stable id — **never a URL** | HN `objectID`; Reddit `<id>` (`t3_…`); Google News `guid`; Medium `guid`; Pinterest pin id; YouTube `yt:videoId`; Bluesky AT-URI; DDG none → derive from `url_hash` |
| `canonical_url` | TEXT | the resolved, tracking-stripped public URL | **Google News: after following the redirect.** Medium: `guid`, not `link`. DDG: the decoded `uddg` value. |
| `url_hash` | TEXT | hash of `canonical_url` | the dedup key across sources — one article found by both Google News and the SERP is **one** signal |
| `occurred_at` | TEXT ISO-8601 | when the item was published upstream | HN `created_at_i`; Reddit `<updated>`; RSS `pubDate`; YouTube `published`; Bluesky `record.createdAt`; **DDG: unknown — see below** |
| `observed_at` | TEXT ISO-8601 | when we fetched it | ours |
| `title` | TEXT | — | — |
| `body_text` | TEXT | the mention text, plain | via `HTMLRewriter` for HTML sources (`REBUILD-STACK.md` §5.1) |
| `author_handle` | TEXT | `/u/NOU_TURN`, `@gymshark`, `Startuporigins` | null where the source has no author |
| `publisher` | TEXT | outlet or community | Google News: the ` - <Publisher>` suffix. Reddit: the `<category term>` subreddit. |
| `lang` | TEXT | BCP-47 | — |
| `metrics_json` | TEXT | engagement, per source | HN `points`/`num_comments`; Reddit none on RSS; Bluesky like/repost/reply; YouTube `media:statistics` |
| `payload_r2_key` | TEXT | the snapshot this came from | proof trail |
| `snapshot_id` | FK → `snapshot` | — | — |

**Three rules the adapters must share, each earned from a probe above:**

1. **`url_hash` is the cross-source dedup key.** Google News, a SERP and a Medium tag feed will all surface the same article. Dedup on the resolved canonical URL, not on `external_id`, or the user sees it three times. **This is also why Google News cannot store its own link** — see the rule below.
2. **`occurred_at` may be unknown, and unknown is not `now()`.** The SERP has no publish date. Leave it null and sort those rows by `observed_at`, with the UI saying "found today" rather than inventing a publication date. Stamping `now()` corrupts every "this week vs last week" comparison the product is built on.
3. **A source with a known-good canary that returns zero is a failure, not a quiet day.** Substack's 200-with-nothing (§7) is the reason this rule exists. Store the canary result alongside `item_count` on the `snapshot` row, and alert on the source, not on the brand.

---

## Findings the rebuild must not inherit

1. **The Google News `articles/…` URL is not a canonical URL.** Two queries produce two opaque URLs for one article, which breaks `url_hash` dedup at the source. Resolution is D8's job; the constraint is absolute — no canonical, no signal row.
2. **Reddit's RSS endpoint is open unauthenticated; its JSON endpoint is not.** Both were probed within two seconds of each other. Any doc saying "Reddit is 403" is describing `search.json` only.
3. **Substack returns 200 with zero results for every query, including `nike`.** A silent block. Every source adapter needs a canary.
4. **The SuperGrok X route is dead** — no uncommented grok rung in the live router config; the only mention is a dead-rung comment reading `403 personal-team`. X is a spend decision, not a wiring task.
5. **DuckDuckGo is intermittent from our egress, and its failure is a 202 carrying an empty set.** Two agents, same host, same day: 200 with 10 result links, and five consecutive 202s with none. A success status with no results is the same silent-failure class as Substack (§7). Out of the MVP until a proper probe matrix says otherwise. The honest-UA-beats-spoofed-UA correlation held across all eight observations and is a hypothesis worth testing, not a finding to build on — query shape was an uncontrolled second variable.
6. **Bing's RSS terms forbid our use.** It works, and we cannot use it.
7. **Google News links are opaque redirects**, so a mention cannot be stored until the redirect is resolved — a real per-item cost, not a detail.
8. **Reddit 429s on a second request within fifteen seconds** from a datacenter IP. Concurrency 1, always.
9. **A stale YouTube channel id 404s silently-ish** — the feed returns a 404 HTML page, not an empty feed. Resolve the handle once, cache it on the entity, and treat a 404 as a source failure rather than "no videos".
