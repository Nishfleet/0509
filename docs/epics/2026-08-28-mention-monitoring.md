# EPIC decomposition: track competitor AND self mentions across the internet

Epic: Nishfleet/0509#1368
Product direction (Nish, 2026-08-28, verbatim): "tracking both competitor and
self mentions automatically across the internet (we could try reddit, x,
pinterest, traditional and new media, blogs, etc. etc.)".
Process used: scout-and-plan → evals before specs → spec-gate → scoped queue
items. No implementation until specs exist. This document is the scout + eval
design; the scoped items are filed as issues referencing #1368 (listed in §6).

## 1. Scout — what exists today (reuse, never reimplement)

The repo already ships most of the building blocks. Mention monitoring is a new
*composition* over existing presence primitives + one new zero-spend connector
(RSS/Atom for blogs, Substacks, Medium, YouTube channel feeds, podcast feeds,
news sites), not a fresh machinery stack.

| Capability | File | Reuse role in mention monitoring |
|---|---|---|
| Unified entity model (self / competitor), source targets, normalized items | `migrations/0055_presence_tracking.sql`, `app/lib/presence-types.ts`, `app/lib/presence-data.server.ts` | The durable substrate. A "mention" IS a `presence_item` row keyed off a `source_target` whose `connectorId` is the source. The mention sources are new connector rows in the same registry, not a parallel table. |
| Connector registry (validate / poll / health) | `app/lib/presence-connector-registry.server.ts`, `app/lib/presence-connectors/*.server.ts` | Adding a mention source = adding a connector file conforming to the existing interface (`validateTarget`, `healthCheck`, `poll`, `estimateCost`). Reuses coverage-label semantics, cursor persistence, and `connectorHasCustomerPollPath` gating for free. |
| Source coverage policy (rollout gates, honesty, "no fake claim") | `app/lib/presence-source-coverage.server.ts` | The "is this source live for the customer?" answer. Every mention source gets one entry here. The same `presenceSourceCoverageForDocs()` table surfaces truth on the public docs page. |
| Connector rollout gating (disabled / internal / pilot / GA) | `app/lib/presence-access-gates.server.ts` | Each new mention source has its own rollout env (e.g. `PRESENCE_RSS_ROLLOUT`). The Reddit commercial-access gate already lives here — reused as-is. |
| Plan gating (free / starter / agency) | `app/lib/presence-entitlements.ts`, `app/lib/plan.server.ts` | Mention tracking rides on the existing presence entitlements; self mentions already require Starter+, competitor mentions already exist on paid tiers. No new plan concept. |
| Presence digest delivery (already wired to Cloudflare Email Service) | `app/lib/presence-digest.server.ts`, `app/lib/delivery.server.ts` | Mention updates flow through the same digest path; no new delivery stack. |
| Scheduled fan-out | `app/lib/monitoring-fanout.server.ts`, `workers/schedule.ts` | Mention-source polling reuses the same fan-out orchestration; no new dispatcher (per global-standing-rules "Everything runs through Pi"). |
| Public-web safe-fetch + SSRF guard | `app/lib/public-url.server.ts`, `app/lib/presence-robots.server.ts`, `app/lib/bounded-response.server.ts`, `app/lib/fetch-timeout.server.ts` | Every mention-source network hop reuses these. RSS feeds and news pages fetch through the same hardened path the website connector already uses. |
| URL + content hash for dedup | `app/lib/presence-hash.ts` | Mention items dedupe by `urlHash` (canonical URL) and `contentHash` (body) — already in place. |
| Honest empty state, "no fake insight" wedge | `app/lib/competitor-dossier.server.ts` | The truthfulness wedge every mention surface inherits: empty mention set = honest empty state, never fabricated mentions. |

**Connectors that exist today for mentions:**
- `reddit` — official Reddit API read (commercial-access gated); `validateTarget` accepts subreddit names, `poll` returns items with canonical URL + author + excerpt; rollout-gated by `PRESENCE_REDDIT_ROLLOUT` + `REDDIT_COMMERCIAL_ACCESS`.
- `x` — official X API; rollout-gated by `PRESENCE_X_ROLLOUT` + `X_API_BEARER_TOKEN`.
- `linkedin` — self-brand OAuth only; competitor tracking is `LIMITED_COVERAGE` (LinkedIn's policy).

**Catalog sources already declared but not connected:**
- `youtube` — `planned`, "requires official API credentials, quota approval, and a rollout decision". Not zero-spend at the YouTube Data API's 10,000-unit daily ceiling for search.list — needs a quota + product decision.
- `amazon` — `manual_only`, "Automated Amazon marketplace monitoring is not launched". Not a mention source by design.
- `context_dev` — `planned`, optional backend open-web provider. Off the critical path.

**Gaps that need filling (Phase 1 / 2 / 5):**
- `rss` — RSS / Atom / JSON Feed connector for blogs, Substacks, Medium publications, podcast feeds, YouTube channel feeds (`/feeds/videos.xml`), news sites with RSS. **Free, no auth, no quota — the zero-spend backbone for "blogs, traditional + new media"**. Phase 1.
- `web_mention_search` — open-web mention search (a query like `"<brand>" OR "<brand name>"` run through a free search provider). The "whatever sources prove viable" bucket. Phase 5, gated on a real free provider being identified — not assumed.
- **Pinterest** has no free public mention-search API; Pinterest's official surface is user/board/pin reads behind partner approval. Adding Pinterest requires a Nish decision (money / partner access). Filed as Phase 5 + parked pending `grants[]` row in `config/geo-aeo-policy.json` (per the GEO/AEO ledger 2026-08-27). Until then, Pinterest coverage reports as `manual_only` with a manual-proof-only action.

## 2. The surfaces Nish named, mapped to mention signals

Nish named the surface categories, not the connectors. Mapping them honestly:

| Surface | Free / zero-spend source(s) | Existing connector | Required new connector | Why this mapping |
|---|---|---|---|---|
| Reddit | Official Reddit API (commercial-access gated; rate-limited free reads exist) | `reddit` (gated) | None — reuse `reddit` | The existing connector already implements subreddit + post polling. Enabling it for mentions is a rollout decision + an integration test, not new machinery. |
| X | Free tier (~1500 tweets/month, user-auth OAuth), Paid tier (API v2) | `x` (gated) | None — reuse `x` | Same shape. The X free tier is enough for "mention search by query" on a single self or competitor brand at low cadence; anything heavier needs the paid tier and is a Nish decision. |
| Pinterest | **No free public mention-search API exists** | None | None — `manual_only` | Pinterest's policy + API surface don't support free mention search. Honest answer in coverage table; a Nish grants[] row unlocks Phase 5. |
| Traditional media (news sites) | RSS / Atom feeds on most major publishers; Bing News / Google News RSS variants | None | `rss` (Phase 1) | RSS is the universal free pipe; news sites with RSS coverage are huge in India (English + Hindi). |
| New media (Substack, Medium publications, podcasts, YouTube channels) | Substack RSS on every publication (`<sub>.substack.com/feed`); Medium publication RSS; podcast RSS via Apple Podcasts / Podcast Index; YouTube channel feed (`/feeds/videos.xml`) | None | `rss` (Phase 1) | One connector, many free feeds. The YouTube-channel RSS is the natural bridge to YouTube without paying for the YouTube Data API search quota. |
| Blogs (open web) | RSS / Atom / JSON Feed (when present) + a free mention-search provider for blogs without feeds | None | `rss` (Phase 1), `web_mention_search` (Phase 5) | Same. The blog-without-RSS long tail needs a free search provider, which is Phase 5 + a free provider proven viable, never assumed. |

**Why the RSS connector is the core, not Reddit + X:** Reddit and X are gated
behind platform policies and rollout decisions that are not Nish-callable at
worker scope; the platform approval pipelines are owned by Nish. RSS is the
only zero-spend surface that is fully under our control today, and it covers
five of the six categories Nish named (traditional + new media, blogs, plus
Substack/Medium/YouTube-channel feeds). The connector model is also designed
for this — Reddit and X already use the same validate/poll/health surface an
RSS connector would.

## 3. Evals before specs

Evals are defined before specs (development-workflow §1). Each scoped issue's
acceptance criteria reference these. The presence source-coverage table is the
"is this source live?" surface; these evals measure "does it find real
mentions, and does it tell the truth when it can't?"

### 3.1 Recall eval (does it find known mentions?)
Ground truth: for each of the eval-panel brands (the `DISCOVERY_EVAL_PANEL` /
demo brand set already used by the presence + competitor discovery evals), a
hand-verified set of REAL mentions on each enabled surface (RSS feeds, Reddit
subreddit, X handle/keyword). Metric: of the known mentions, what fraction does
the mention pipeline surface? **Pass bar: ≥60% on the panel** per enabled
source (some sources have noisier signal; the bar is honest per source).

### 3.2 Precision eval (are surfaced mentions real, not noise?)
Metric: of the surfaced items, what fraction is a real mention (brand or
competitor name appears in title/excerpt/canonical URL) vs. noise (RSS item
unrelated to brand). Sample = 30 items per source per eval panel brand,
hand-labeled. **Pass bar: ≥85% precision.** Lower than auto-discovery
(≥70%) because mentions carry natural noise (RSS feeds mention adjacent
brands, news aggregators mix stories). Below the bar, the ranker needs a
stronger mention-signal filter before shipping.

### 3.3 Coverage / diversity eval (sources aren't dominated by one platform)
Metric: for a panel brand, the mention feed over a 7-day window — what
fraction of items come from the top source vs. the long tail? **Pass bar: no
single source contributes >70% of items** when ≥3 sources are enabled for that
brand. Catches a pipeline that's "X-only" or "Reddit-only" and presents
itself as multi-source.

### 3.4 Honesty eval (no fabricated mentions)
Metric: every mention that reaches a UI surface (entity brief, digest email,
review surface) carries a `sourceTargetId` pointing to a real `source_target`
row whose `connectorId` matches the displayed source; every mention has a
`canonicalUrl` that resolves through the SSRF-hardened fetcher; an empty
mention set renders an honest empty state, never a fabricated mention.
**Pass bar: 100%.** A mention that renders without a backing `source_target`
or with a non-resolving URL is a hard failure. Inherits the presence truthfulness
wedge (`competitor-dossier.server.ts`: "never a fake insight").

### 3.5 Zero-spend ceiling eval (no paid source added without Nish decision)
Metric: the connector registry's `estimateCost()` units sum across an active
brand's mention pipeline equals zero for every connector in the zero-spend
backbone (Reddit free tier, X free tier, RSS, free web search). Any nonzero
unit from a paid source surfaces as a `paid_source_pending_nish` status in
coverage, blocking activation. **Pass bar: 100% on the zero-spend backbone.**
Reuses the `coverageLabelForConnector` shape; a paid source gets `manual_only`
until the grants[] row lands.

### 3.6 Plan-respect eval (presence gating holds)
Metric: self-mention tracking on free plan renders the honest
`presence_self_tracking not in plan` empty state, not a fabricated mention
summary. Competitor mentions on free plan render the same. **Pass bar:
100%.** Reuses the existing presence plan gating.

## 4. Phased scope (smallest durable first)

Each phase is one filed issue (§6). Phases are ordered so each is independently
shippable and the first delivers the zero-spend backbone.

- **Phase 1 — RSS / Atom / JSON Feed connector (zero-spend backbone).** A new
  `rss` connector conforming to the existing presence connector interface:
  validateTarget accepts a feed URL (or auto-discovers feeds from a site URL
  via well-known `<link rel="alternate">`); poll returns normalized
  `presence_item` rows (title, canonical URL, author, publishedAt, bodyExcerpt);
  healthCheck verifies the feed parses and is reachable through the SSRF-
  hardened fetcher. Pure library function + workerd/D1 integration test.
  Catalog entry: `rss` joins `website / x / reddit / linkedin` in the connector
  set + the source-coverage table. No UI yet.
- **Phase 2 — Mention query surface + digest.** A "Mentions" panel on the
  existing presence entity page (reuses `app.presence.$entityId.tsx` route
  shape) renders recent items from the entity's enabled sources, each tagged
  with `connectorId` and the coverage label, with a "no mentions yet" honest
  empty state. The presence digest (`presence-digest.server.ts`) is extended
  to include mention items alongside website items, gated by the existing
  `PRESENCE_DIGEST_ROLLOUT` env.
- **Phase 3 — Reddit + X mention-source activation.** Enable the existing
  `reddit` and `x` connectors as mention sources through the rollout gates
  already in `presence-access-gates.server.ts`. Pure function: a mention
  query for an entity builds the right subreddit list / X query string and
  flows through the existing `pollPresenceTarget` path. No new connector
  code; the work is the rollout env wiring + the integration test proving
  the mention path works end-to-end with the existing connector.
- **Phase 4 — Periodic mention re-sweep + alert surfacing.** A scheduled task
  re-polls the enabled mention sources on the existing fan-out cadence and
  surfaces net-new mentions in the digest. Reuses
  `monitoring-fanout.server.ts` + `workers/schedule.ts`. No new dispatcher.
- **Phase 5 — Pinterest + free web-mention-search (Nish-gated).** Two
  parked follow-ups filed together: (a) Pinterest mention coverage if a
  grants[] row lands in `config/geo-aeo-policy.json` (per GEO/AEO ledger
  2026-08-27, fleet-ops#1245); (b) a free open-web mention-search provider
  (Brave Search free tier / DuckDuckGo / Bing) for blogs without RSS, gated
  on a real free provider being identified (NOT assumed). Both ship only if
  their coverage eval + zero-spend eval pass.

## 5. Out of scope for this epic

- Full-site competitor tracking (any change anywhere on their website) —
  epic (b), tracked separately as Nishfleet/0509#1367 and shipped via
  `competitor-site-monitor.server.ts`. The two epics share the
  source-target + presence-item substrate but are independent capabilities.
- Auto-competitor-watch (auto-discovering competitors without the customer
  adding them) — epic (a), tracked separately as Nishfleet/0509#1366.
  Mentions are about what the world says about a brand the customer named,
  not about discovering new brands.
- New paid data sources (paid X tier, paid Reddit commercial, paid Pinterest
  partner, paid news APIs). Zero-spend rule: free/API-light first
  (epic-intent hard constraint). A paid source surfaces as
  `paid_source_pending_nish` and is gated behind a Nish grants[] row.
- Auto-publishing to social channels. Mention monitoring is a passive
  observation capability; publishing outbound is a separate, much larger
  product surface and a Nish decision.
- Sentiment scoring. The mention surface shows what was said; a sentiment
  classifier is its own capability, requires labeled training data, and is
  not zero-spend if it uses a paid LLM endpoint. Filed separately if Nish
  asks for it.

## 6. Filed scoped items (this epic's queue)

Filed as issues in Nishfleet/0509, each with a spec-gated body (termination
command, deterministic-required vs AI-advisory split, exact files, must-not-
touch, acceptance, evidence link) and referencing #1368. Filed cap-aware: the
first two carry `agent-ready` (within fleet pickup capacity); the remainder
are filed without it and will be labeled `agent-ready` as the queue drains, so
the fleet is not over-saturated (current agent-ready count post-decomposition
is checked below).

| Phase | Issue | Status |
|---|---|---|
| 1 | #1375 | agent-ready |
| 2 | #1377 | agent-ready |
| 3 | #1378 | queued (no agent-ready yet) |
| 4 | #1379 | queued (no agent-ready yet) |
| 5 | #1380 | queued (no agent-ready yet; PARKED — Nish-gated) |

(Note: #1376 was filed by another agent between this PR's filing calls and is
unrelated to this epic. Phase numbering in the doc body matches the issue
numbers above.)

The spec-gate (`fleet-spec-gate.sh`) runs at pickup time before any
implementer touches a packet; this epic's decomposition produces the
spec-gated bodies, the gate ratifies them.
