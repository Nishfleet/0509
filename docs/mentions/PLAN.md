# Mentions — source inventory, feasibility, data model and MVP plan

Planning slice: Nishfleet/0509#3170 · Epic: Nishfleet/0509#3171
Prior decomposition (shipped): `docs/epics/2026-08-28-mention-monitoring.md` (epic #1368)

Product direction (Nish, 2026-09-12): "basically we tracking self and
competition for people and brands across the internet." Mentions ride the same
product shape as ads: track a brand or person → capture → timeline → change
alerts and digests → briefs. Self AND competitors.

Constraints carried from the epic: public surfaces only; per-source kill flag;
capture-validity gate applies; honest coverage copy; no paid data vendors
without a MONEY flag.

---

## 1. What already exists — do not rebuild

The 2026-08-28 mention epic shipped its substrate. This plan is a composition
over it, not a greenfield build.

| Capability | Where | Role |
|---|---|---|
| `tracked_entity` / `source_target` / `presence_item` / `presence_poll_cursor` | `migrations/0055_presence_tracking.sql` | The canonical mention store. A mention IS a `presence_item` row. |
| Connector registry + interface (`validateTarget` / `poll` / `healthCheck` / `estimateCost`) | `app/lib/presence-connector-registry.server.ts`, `app/lib/presence-types.ts` | New source = new connector file + registry/coverage/gate entries. |
| Live connectors: `website`, `x`, `reddit`, `linkedin`, `rss` | `app/lib/presence-connectors/*.server.ts` | All rollout-gated, disabled by default (`PRESENCE_*_ROLLOUT`). |
| Per-source kill flags + credential gates | `app/lib/presence-access-gates.server.ts` | `PRESENCE_<S>_ROLLOUT` env per connector; Reddit additionally gated on `REDDIT_COMMERCIAL_ACCESS=approved`. |
| Honest coverage table ("is this source live for the customer?") | `app/lib/presence-source-coverage.server.ts` | Every source below gets exactly one entry; nothing ships as "live" that isn't. |
| Plan entitlements + caps | `app/lib/presence-entitlements.ts`, `app/lib/plan-entitlements.ts` | `presence_self_tracking`, `presence_competitor_tracking`, `presence_website_sources`, `presence_social_connect`, `presence_digest_alerts`. |
| Dedup primitives | `app/lib/presence-hash.ts` | `url_hash` (unique per target), `content_hash` (title+excerpt+author+date). |
| SSRF-hardened fetch path | `app/lib/public-url.server.ts`, `app/lib/presence-robots.server.ts`, `app/lib/bounded-response.server.ts`, `app/lib/fetch-timeout.server.ts` | Every network hop for every connector below goes through these. A raw `fetch` to a source is a regression. |
| Scheduled fan-out + digest | `app/lib/monitoring-fanout.server.ts`, `workers/schedule.ts`, `app/lib/presence-digest.server.ts` | Mention polling and digests ride the existing lanes. |
| Mention surfaces | entity panel (#1377), digest extension + re-sweep (#1379), `app/lib/mention-resweep.server.ts` | Shipped. |
| Legacy parallel tables `web_mention_target` / `web_mention_observation` | `migrations/0028_tracking_roles_and_web_mentions.sql` | Superseded by the presence substrate — see §3. |

## 2. Source inventory

Every row cites the public surface and its terms. Feasibility claims are
sourced in §8; anything unverifiable is labelled as such, never asserted.

Legend — Feasibility: **today** (works through existing connector), **build**
(new connector, free surface, no external approval), **approval** (free but
gated on a platform review/approval), **money** (paid surface — MONEY flag),
**none** (no public surface for the job).

| Source | Public surface | Feasibility | ToS / legal posture | Cost | Freshness | Rate budget |
|---|---|---|---|---|---|---|
| **Mainstream news — GDELT DOC 2.1** | `https://api.gdeltproject.org/api/v2/doc/doc` (`mode=artlist`, `format=json`) | **build** — new `gdelt` connector, no auth | "Unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee"; citation required. [terms](https://www.gdeltproject.org/about.html#termsofuse) · [docs](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | $0 | Near-real-time; rolling 3-month search window; 65 machine-translated languages | Serialized ~1 req per few seconds (fair-use guidance); ≤250 records/query. Enough for per-entity polls at digest cadence |
| **Mainstream news — Google News RSS** | `https://news.google.com/rss/search?q=<phrase>&hl=<lang>&gl=<country>&ceid=<c>:<lang>` | **today** — rides the existing `rss` connector as a *query feed* target | **Undocumented surface.** Google has never published a spec or API contract for these feeds (official News API retired 2016); they work but can change without notice. Item links are `news.google.com` redirects, not canonical publisher URLs — must be resolved before hashing. [community docs](https://www.newscatcherapi.com/blog-posts/google-news-rss-search-parameters-the-missing-documentaiton) · Google ToS applies | $0 | Minutes-level for indexed news | No published limit. Conservative budget: 1 fetch per query feed per poll; 100-item cap per query is a hard ceiling |
| **Mainstream news — publisher RSS** | Per-publisher feeds (e.g. `feeds.bbci.co.uk/news/rss.xml`) | **today** — rides the existing `rss` connector | **Per-publisher terms; business use is not automatically free.** BBC explicitly requires a licence/permission for business use of its feeds ([BBC terms](https://www.bbc.co.uk/usingthebbc/terms/can-i-use-bbc-content/)). Posture: headline + link + short excerpt only, attributed, never full-text republish; each publisher's feed terms are checked at target-onboarding time; a feed whose terms disallow business use is rejected at `validateTarget` | $0 | Per feed (typically minutes–hourly) | Per-publisher politeness; 1 fetch per feed per poll; honor `Cache-Control`/`ETag` via `presence_poll_cursor` |
| **X** | X API v2 recent search `GET /2/tweets/search/recent` | **money** — connector `x` exists and is credential-gated; the *search* surface is paid-only | X Developer Agreement + Policy. Since Feb 2026 X sells pay-per-use only — no free read tier for new developers (legacy $200/mo Basic / $5,000/mo Pro closed to new signups). [terms](https://developer.x.com/en/developer-terms/policy) · [docs](https://developer.x.com/en/docs/x-api) | **~$0.005 per post read** under pay-per-use → `paid_source_pending_nish`. If a legacy paid subscription already exists, this is a $0 wiring task | Real-time | Per-endpoint windows under pay-per-use; spend metered per entity before activation (#3255) |
| **Substack** | `https://<pub>.substack.com/feed` per publication — [official docs](https://support.substack.com/hc/en-us/articles/360038239391) | **today** — rides `rss` connector | [Substack ToS](https://substack.com/terms). RSS is the platform's own syndication surface; we store headline/link/excerpt, attribute the publication. Coverage = *named publications only* — there is no free global Substack search; honest coverage copy must say so | $0 | On new posts | 1 fetch per feed per poll |
| **Medium** | `medium.com/feed/@user`, `medium.com/feed/<pub>`, `medium.com/feed/tag/<tag>` — [official docs](https://help.medium.com/hc/en-us/articles/214874118) | **today** — rides `rss` connector | [Medium ToS](https://medium.com/policy/medium-terms-of-service). Same syndication posture as Substack; named profiles/publications/tags only, no global free search | $0 | On new posts | 1 fetch per feed per poll |
| **Pinterest** | [Pinterest API v5](https://developers.pinterest.com/docs/api/v5/) | **none at zero-spend** — no free public mention-search endpoint exists; reads are per-user OAuth after app approval | [Developer terms](https://developers.pinterest.com/terms/). Trial access = 1,000 req/day/app; Standard = 100 req/s/user/app — both behind app review ([access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/), [rate limits](https://developers.pinterest.com/docs/reference/rate-limits/)). Community reports approval delays/denials | $0 surface, but approval-gated | — | Parked: `manual_only` until a grants[] decision (matches prior epic #1380) |
| **Reddit** | [Reddit Data API](https://www.reddit.com/dev/api) — connector `reddit` exists, gated | **approval** — code shipped; commercial use needs Reddit's written approval | [Data API Terms](https://redditinc.com/policies/data-api-terms): OAuth required, no unauthenticated use; **commercial use requires explicit written approval** — serving paying customers is commercial use. Gate already exists: `REDDIT_COMMERCIAL_ACCESS=approved`. [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) | $0 once approved (free tier) | Near-real-time within rate limits | **100 QPM per OAuth client id**, averaged over a 10-minute window ([Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)) |
| **YouTube** | (a) channel feed `youtube.com/feeds/videos.xml?channel_id=<id>` — free via `rss` connector; (b) [Data API v3 `search.list`](https://developers.google.com/youtube/v3/docs/search/list) for keyword mentions | (a) **today** via `rss`; (b) **approval** — free but quota-capped + Google Cloud project | [YouTube API Services ToS](https://developers.google.com/youtube/terms/api-services-terms-of-service). Default allocation per the [official quota page](https://developers.google.com/youtube/v3/determine_quota_cost): **100 `search.list` calls/day** (dedicated bucket) + 10,000 units/day for other calls; more quota requires a Google compliance audit, cannot be bought | $0 | Channel feeds: on publish. Search: near-real-time | 100 searches/day total across ALL brands — keyword search stays a thin, low-cadence surface; channel feeds carry the load |
| **LinkedIn posts** | [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) | **self only** — existing `linkedin` connector covers own-org/own-member posts; competitor = `LIMITED_COVERAGE` | `r_member_social` is restricted (approval-only); `r_organization_social` requires the member to hold a company-page admin role on the target org — i.e. you can only read orgs you administer. No public keyword search of others' posts. LinkedIn ToS prohibit scraping | $0 | On read | Per-member/per-org API limits after approval; irrelevant for competitor coverage (not available) |
| **Threads** | [Threads API keyword search](https://developers.facebook.com/docs/threads/keyword-search/) + [mentions](https://developers.facebook.com/docs/threads/threads-mentions/) | **approval** — free API, needs a Meta app with `threads_keyword_search` (and `threads_manage_mentions` advanced access for others' posts) | Meta Platform Terms. Keyword search: **2,200 queries per user per rolling 24h** (across apps). App review lead time is the real cost. [rate limits](https://developers.facebook.com/docs/threads/overview/) | $0 | Near-real-time | ≤2,200 queries/user/24h — connector must track usage in `presence_poll_cursor` |
| **Bluesky** | `app.bsky.feed.searchPosts` XRPC ([docs](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts)) | **build** — new `bluesky` connector, free | Bluesky ToS + open AT Protocol. Rate limits documented as "generous… contact us if you encounter rate-limiting" ([rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)). Caveat: unauthenticated `searchPosts` on `public.api.bsky.app` has been intermittently 403'd upstream — use an authenticated app-password session | $0 | Near-real-time | Generous; serialize polls anyway |
| **Hacker News** | [Algolia HN Search API](https://hn.algolia.com/api) `search` / `search_by_date` | **build** — new `hn` connector, no auth at all | Free public API operated by Algolia for HN. No published rate limit — the ~10,000 req/hr/IP figure is community-observed courtesy, not an SLA; ~1,000 retrievable results per query cap. Official alternative ([Firebase HN API](https://github.com/HackerNews/API)) has no search | $0 | Near-real-time | Courtesy budget ~10k req/hr/IP; serialized low-cadence polls are nowhere near it |

## 3. Data model — a "mention" beside an "ad"

`ad` (migrations/0001) is the paid-ads store: advertiser, creative fields,
`platforms_json`, first/last seen, `raw_json`. The mention substrate already
exists beside it — `presence_item` is the mention row:

```sql
-- migrations/0055_presence_tracking.sql (shipped)
presence_item: id, source_target_id, tracked_entity_id, user_id,
  connector_id, external_id, canonical_url, url_hash, title, body_excerpt,
  author, published_at, observed_at, content_hash, raw_json, is_tombstone
source_target:  id, tracked_entity_id, user_id, connector_id, target_key,
  target_url, target_handle, metadata_json, coverage_label, is_active
```

A mention = a `presence_item` whose `source_target` is a mention source.
Two target shapes cover every row above:

- **feed targets** — `target_key` = feed host/path; the connector emits items,
  a match step stamps which entity phrase each item names
  (publisher RSS, Substack, Medium, YouTube channel feeds)
- **query targets** — `target_key` = the entity's match phrase;
  the surface's own search pre-filters (GDELT, Google News RSS, Bluesky, HN,
  Threads, X, Reddit)

### Migration sketch (expand-only, one phase per PR per the D1 rule)

```sql
-- NEW FILE (per connector, e.g. migrations/0097): widen the connector CHECK.
-- Follows the shipped pattern in migrations/0093_widen_source_target_connector_rss.sql.
-- Recreate source_target with CHECK (connector_id IN (..., 'gdelt')) — expand only,
-- never DROP/rename/NOT-NULL-without-DEFAULT in the same PR as code.

-- OPTIONAL (only if raw_json proves wrong for match metadata — filed separately):
ALTER TABLE presence_item ADD COLUMN matched_phrase TEXT;      -- which entity phrase matched
ALTER TABLE presence_item ADD COLUMN mention_class TEXT;       -- 'news' | 'social' | 'blog' | 'forum'
```

The legacy `web_mention_target` / `web_mention_observation` tables (migration
0028) predate the presence substrate and carry a hard-coded source CHECK
(`reddit,x,blog,youtube,substack,web`). Posture: **superseded** — no new
writes; they stay in place untouched (rollback rolls back code, never data).
No DROP is proposed anywhere in this plan.

## 4. Dedup and ranking

Dedup (mostly already built):

- Within a source: `UNIQUE (source_target_id, url_hash)` on `presence_item`
  plus `content_hash` change detection (revision history exists).
- Cross-source: normalize `canonical_url` before hashing — strip tracking
  params (`utm_*`, `fbclid`, `gclid`), upgrade http→https, strip fragments.
  **Google News RSS items must resolve the `news.google.com` redirect to the
  publisher URL first** or the same story lands under different keys per
  surface. That resolution is one bounded fetch through the SSRF path, spec'd
  in #3250.
- Near-dups (same story, different URL — syndication): normalized-title hash
  (`lower(trim(title))`) groups them at read time; keep every source row,
  collapse in the UI. Never delete a row to dedupe.

Ranking (mention-signal score, computed at read/digest time — no schema):

1. **Match strength**: entity phrase in title > in excerpt > only in the
   surface's own search index.
2. **Source class**: `news` (GDELT/publisher/Google News) > `social`
   (Bluesky/Threads/X/Reddit) > `forum` (HN comments) — source class lives in
   `source_target.metadata_json`.
3. **Free engagement signals**: HN `points`/`num_comments`, Reddit score,
   Bluesky like/repost counts — captured into `raw_json` when the surface
   gives them free; never paid enrichment.
4. **Recency decay** for digest ordering.

Evals (from the shipped epic doc, still the bars): recall ≥60% on the eval
panel per source; precision ≥85%; no single source >70% of a brand's items;
honesty 100% — an empty mention set renders an honest empty state.

## 5. Plan-cap and pricing implications

Current presence caps (`app/lib/presence-entitlements.ts`):

| Plan (internal → display) | Entities | Self | Competitor | Website sources/entity | Social sources/entity |
|---|---|---|---|---|---|
| free | 0 | 0 | 0 | 0 | 0 |
| scout → Starter | 3 | 0 | 3 | 2 | 0 |
| starter → Agency | 8 | 2 | 8 | 4 | 2 |
| agency | 30 | 10 | 30 | 8 | 4 |

Findings:

- **Free has zero presence today.** The epic asks for self-brand tracking on
  Free (1 self brand, per the Free-is-barebones decision). That is a plan
  change — `FREE_FEATURES` + `presence_self_tracking`, `maxSelfEntities` 0→1 —
  and a product/pricing implication, not a code detail. Recommended: Free gets
  1 self entity with query-type mention sources only (GDELT + Google News RSS
  query feed — both $0), no social connect, no digest cadence beyond the
  existing `first_only` brief policy. Flagged for Nish alongside the MONEY
  flag below — it is the cheapest "feel the product" wedge but it does move
  the Free line.
- Mention sources need their own cap. Today a query target would count as a
  "website" or "social" source; sketch: `maxMentionSourcesPerEntity`
  (Free 1 / Starter 3 / Agency 6) so plan caps survive the wider source list.
- **COGS stays ~$0**: the MVP backbone (RSS + GDELT + Bluesky + HN) is all
  free surfaces; infra cost is bounded fetches through the existing fan-out.
- **MONEY flags** (no spend without a Nish decision): X pay-per-use reads
  (~$0.005/post — #3255); Reddit commercial approval (free but written
  approval required — existing gate); Pinterest (no public surface —
  manual_only); YouTube keyword search beyond 100/day (audit-gated);
  LinkedIn competitor posts (not available at any price via API).

## 6. MVP — 3 sources, 2-week build plan

MVP sources (all zero-spend, all public surfaces):

1. **RSS mention backbone** — publisher RSS + Substack + Medium + Google News
   query feeds via the existing `rss` connector (#3250). Covers mainstream
   news (partial), Substack, Medium, YouTube channel feeds in one move.
2. **GDELT DOC 2.1** — mainstream-news query surface, 65 languages, free,
   terms explicitly allow commercial use (#3251).
3. **Bluesky** — the only free public social-search surface that needs no
   platform approval (#3252).

X is deliberately NOT in the MVP: research found it is pay-per-use only since
Feb 2026 — the epic's "X public search surface" assumption predates that
change. It is filed parked with the MONEY flag (#3255).

| Days | Work |
|---|---|
| 1–3 | #3250 — RSS backbone: query-feed targets, mention-match stamping, Google News redirect resolution, integration test |
| 4–6 | #3251 — GDELT connector + CHECK-widen migration + coverage/gate wiring |
| 7–9 | #3252 — Bluesky connector + session auth + migration + wiring |
| 10–11 | Cross-source canonical-URL normalization + normalized-title near-dup grouping at read time |
| 12–13 | Eval pass on the demo brand panel (recall/precision/coverage/honesty bars above); fix precision filters below bar |
| 14 | Internal → pilot rollout call per connector; coverage table copy review (honesty) |

Kill flags: every source ships behind its own `PRESENCE_<S>_ROLLOUT`
(disabled default). No connector can poll without the flag plus its
credential check.

## 7. Follow-up issues filed (all spec-gate-passing bodies)

| Issue | Source | Budget | Status |
|---|---|---|---|
| #3250 | rss (publisher RSS, Substack, Medium, Google News query feeds) | $0 public HTTP | MVP 1/3 |
| #3251 | gdelt (DOC 2.1 API) | $0, ~1 req/few sec | MVP 2/3 |
| #3252 | bluesky (searchPosts) | $0, app-password session | MVP 3/3 |
| #3253 | hn (Algolia HN Search) | $0, ~10k req/hr courtesy | fast-follow |
| #3254 | threads (keyword_search) | $0, 2,200 queries/user/24h, Meta app review | fast-follow, approval-gated |
| #3255 | x (recent search) | ~$0.005/post read — **MONEY flag** | parked |

Not filed (decisions, not work items): Reddit mention activation (blocked on
`REDDIT_COMMERCIAL_ACCESS` approval — connector shipped), Pinterest
(no free surface — prior epic #1380 parked it), LinkedIn competitor posts
(no API exists), YouTube keyword search (100/day quota is too thin to matter
until the audit path is a named need), free open-web mention search for the
blog long tail (prior epic's Phase 5 — parked pending a proven free provider).

## 8. Research log

Official docs/terms read for this plan (2026-09-12):

- GDELT: [terms](https://www.gdeltproject.org/about.html#termsofuse)
  (unrestricted incl. commercial, citation required),
  [DOC 2.0 API debut](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)
  (`api.gdeltproject.org/api/v2/doc/doc`, JSON/artlist mode, 3-month window,
  65 languages). Note: `gdeltcloud.com` is a separate newer paid product —
  this plan uses only the classic free `api.gdeltproject.org` API.
- X: [developer terms](https://developer.x.com/en/developer-terms/policy);
  pay-per-use pricing change Feb 2026 — free read tier removed for new
  developers (press/analyst coverage of the official pricing change:
  [heise](https://www.heise.de/en/news/Usage-based-instead-of-flat-rate-X-changes-costs-of-its-developer-interface-11169806.html),
  [postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)).
- Reddit: [Data API Terms](https://redditinc.com/policies/data-api-terms),
  [Data API Wiki rate limits](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
  (100 QPM/OAuth client, 10-min averaging window, OAuth mandatory),
  [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
  (commercial use needs written approval).
- YouTube: [quota cost page](https://developers.google.com/youtube/v3/determine_quota_cost)
  (default 100 search.list calls/day + 10k units/day; audit for more),
  [API ToS](https://developers.google.com/youtube/terms/api-services-terms-of-service).
- LinkedIn: [Posts API permissions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
  (`r_member_social` restricted; `r_organization_social` needs page-admin role).
- Threads: [keyword search docs](https://developers.facebook.com/docs/threads/keyword-search/)
  (2,200 queries/user/24h), [mentions docs](https://developers.facebook.com/docs/threads/threads-mentions/),
  [overview rate limiting](https://developers.facebook.com/docs/threads/overview/).
- Bluesky: [searchPosts API ref](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts)
  (public GETs on `public.api.bsky.app`; auth to own PDS),
  [rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)
  ("generous"); upstream evidence unauth `searchPosts` has intermittently
  403'd — [bsky-docs#332](https://github.com/bluesky-social/bsky-docs/issues/332),
  [atproto#3583](https://github.com/bluesky-social/atproto/issues/3583).
- Hacker News: [Algolia HN Search API](https://hn.algolia.com/api) (no auth;
  ~1k results/query cap; ~10k req/hr/IP is community-observed, not an SLA),
  [official Firebase API](https://github.com/HackerNews/API) (no search).
- Pinterest: [API v5 access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/),
  [rate limits](https://developers.pinterest.com/docs/reference/rate-limits/)
  (Trial 1,000 req/day/app, Standard 100 req/s/user/app, app approval).
- Substack: [official RSS help](https://support.substack.com/hc/en-us/articles/360038239391)
  (`<pub>.substack.com/feed`), [ToS](https://substack.com/terms).
- Medium: [official RSS help](https://help.medium.com/hc/en-us/articles/214874118)
  (profile/publication/tag feeds), [ToS](https://medium.com/policy/medium-terms-of-service).
- Publisher RSS business use: [BBC content/RSS terms](https://www.bbc.co.uk/usingthebbc/terms/can-i-use-bbc-content/)
  (business use of feeds requires permission/possible fee — drives the
  per-publisher ToS check at target onboarding).
- Google News RSS: no official documentation exists (News API retired 2016);
  community-maintained format reference used:
  [newscatcher](https://www.newscatcherapi.com/blog-posts/google-news-rss-search-parameters-the-missing-documentaiton),
  [cloro](https://cloro.dev/blog/google-news-rss/). Treated as an
  undocumented surface in the coverage table.

Open-source collector survey (`gh search repos`, 2026-09-12): no
production-grade general mention collector exists to adopt wholesale —
`openstream/open-social-media-monitoring` (132★, stale suite),
`news-r/auritus` (31★), `gdelt/gdelt.github.io` (79★, GDELT's own interface).
Conclusion: reuse our shipped connector pattern + proven parsers instead of
adopting a suite. Package-registry check: `rss-parser@3.13.0`,
`@atproto/api@0.20.44` available if a connector wants them — the existing RSS
connector already parses feeds itself, so no dependency is required for the
MVP.

Prior art inside the repo: `docs/epics/2026-08-28-mention-monitoring.md`
(scout + evals + phases, shipped as #1375/#1377/#1378/#1379/#1380),
`app/lib/presence-connectors/*.server.ts`, `migrations/0055` + `0093`,
`docs/adr/2026-09-05-adyntel-meta-data-strategy.md` (the ads-side sibling).
