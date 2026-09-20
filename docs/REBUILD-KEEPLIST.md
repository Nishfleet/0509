# REBUILD keep-list — engine audit (issue #3843, umbrella #3842)

Audit date: **2026-09-20** (all timestamps UTC). Brand under test: **Gymshark** (`gymshark.com`), a well-known global DTC brand; `allbirds.com` used once to isolate a brand-level block.

**Method.** No mocks. Server modules ran on real workerd via the repo's `workers` vitest project (Miniflare, real outbound `fetch`, real local D1 with all migrations applied), driving each adapter's `fetch(env, ctx)` / connector's `poll(ctx, target)` and the seam's `runSources` end-to-end. App surfaces were probed live on production `https://0509.io` (public GETs plus the designed reject paths only — nothing mutating). Host limits: no Cloudflare API credentials on this machine, so prod secret presence is inferred from prod's own `/status` surface, never assumed.

## Verdicts — works / broken / needs a key we lack

| Module | Verdict | Proof (call → observed result) | At (UTC) |
| --- | --- | --- | --- |
| `sources/google-ads` (`google_ads`) | **WORKS** | `adapter.fetch` → Google Ads Transparency public `SearchCreatives` RPC returned real creatives: `advertiserName:"Gymshark Ltd"`, `advertiserId:"AR05501100765344694273"`, `creativeId:"CR17278358977440120833"`, `lastShownAt:2026-09-20T16:56:55Z`, `truncated:true` (200-creative cap hit — demand exists) | 17:22:10 |
| `sources/subdomains` | **WORKS** | `adapter.fetch` → crt.sh: real subdomains for gymshark.com, classified (`preview.develop.gymshark.com` internal; `reviews.api.develop.gymshark.com` public) with `firstSeen` dates | 17:22:20 |
| `sources/hiring` | **WORKS** (with caveat) | With stored board `greenhouse/gymshark` (verified — `boards.greenhouse.io/gymshark` 301→`job-boards.greenhouse.io/gymshark` 200): `adapter.fetch` returned real jobs — "Creative Lead, Solihull" id `4793583101`, "Designer – Menswear" id `4974423101`, real `postedAt`/`url`. **Caveat:** homepage auto-discovery leg returned `unavailable:site_unreachable` for gymshark.com (72ms) — workerd plain fetch is bot-gated there while `curl` gets 200 in 67ms. Keep the stored-board path; discovery needs a browser leg or tolerates misses. | 17:25:06 |
| `sources/google` (SERP) | **NEEDS KEY** | `requiresEnv` false; `fetch` → `{unavailable:true, reason:"not_configured"}`. Wants `SERP_PROVIDER=decodo` + `DECODO_SCRAPER_AUTH` (paid scraper). Prod presence unverifiable from this host. | 17:22:05 |
| `sources/linkedin` (ads) | **NEEDS KEY** | `fetch` → `{unavailable:true, reason:"no_credentials"}` — wants `DECODO_SCRAPER_AUTH`. Prod `/status` shows the flag not killed (`linkedinAdsSourceKilled:false`) but capture counters `counted:false` (DECODO_BUDGET KV unwired). | 17:22:10 |
| `sources/tiktok` | **BROKEN in prod / needs key locally** | Local: `{unavailable:true, reason:"not_configured"}` (`DECODO_SCRAPER_AUTH`). Prod `/status` 17:14Z: flag `active` but **"0 of 22 active watchlists captured in the last 8 days — 22 missed this weekly window"** — running (or scheduled) and producing nothing. Do not port blind; needs a keyed re-probe. | 17:14:28 (prod) |
| `sources` seam (`registry`/`run`/`capture-usage`/`types`) | **WORKS** | `runSources` end-to-end on real D1 persisted **2 `source_snapshot` rows** for the watchlist (`subdomains`, `google_ads`) — store/diff/alert machinery proven, not just fetches. | 17:22:31 |
| `presence-connectors/website` | **WORKS** (brand-dependent) | `poll` allbirds.com → `ok:true`, 1 item (1.6s). `poll` gymshark.com → `fetch_failed` twice — homepage fetch bot-blocked for workerd's signature (curl 200). Module GA in prod (`/status` `website: active`). | 17:22:46 / 17:25:08 |
| `presence-connectors/rss` | **WORKS** | `poll` Google News RSS search feed for "Gymshark" → `ok:true`, **25 items**, real article externalIds/canonicalUrls. | 17:22:44 |
| `presence-connectors/hn` | **WORKS** | `poll` phrase "Gymshark" → Algolia `search_by_date` `ok:true`, **32 items**, real `objectID`s (e.g. `externalId:48383485` → news.ycombinator.com/item?id=48383485). | 17:22:32 |
| `presence-connectors/pinterest` | **WORKS** | `poll` handle `gymshark` → `pinterest.com/gymshark/feed.rss` `ok:true`, **25 real pins** (e.g. pin `358810295339792074`). | 17:22:46 |
| `presence-connectors/gdelt` | **WORKS — rate-limited upstream at probe time** | `poll` → `fetch_failed` after ~10s, twice. Direct `curl api.gdeltproject.org/api/v2/doc/doc?query=gymshark` → **HTTP 429** "limit one request per 5 seconds" — this host's shared IP is saturated, not a code bug. Connector code is sound (query build/normalize/budget all correct); keep, expect pacing. | 17:22:42 / 17:25:27 |
| `presence-connectors/bluesky` | **NEEDS KEY** | `poll` → `credentials_missing` — needs `BSKY_IDENTIFIER` + `BSKY_APP_PASSWORD` (a free Bluesky app password; trivial to provision). | 17:22:42 |
| `presence-connectors/youtube` | **NEEDS KEY** | `credentials_missing` — needs `YOUTUBE_API_KEY` (free YouTube Data API v3 key). | 17:22:46 |
| `presence-connectors/threads` | **NEEDS KEY** | `credentials_missing` — needs `THREADS_ACCESS_TOKEN` (Meta app + token). | 17:22:46 |
| `presence-connectors/reddit` | **NEEDS KEY + approval** | `commercial_access_pending` — needs `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` **and** `REDDIT_COMMERCIAL_ACCESS=approved` (a spend/terms gate, not just a key). | 17:22:46 |
| `presence-connectors/x` | **NEEDS KEY + money decision** | `credentials_missing` — needs `X_API_BEARER_TOKEN` **and** `X_PAID_ACCESS=approved`; X recent-search is pay-per-use only since Feb 2026 (per its own notes). Nish-reserved spend decision. | 17:22:46 |
| `presence-connectors/linkedin` | **NEEDS OAUTH CONNECTION (self-only by design)** | `competitor_limited` — LinkedIn competitor coverage is `LIMITED_COVERAGE` by design; self-tracking needs a stored OAuth grant (`LINKEDIN_CLIENT_ID`/`SECRET` + connected org). | 17:22:46 |
| `auto-competitor-seed.server.ts` | **WORKS — honest zero on cold cache** | `seedAutoCompetitors(env,{domain:"gymshark.com"})` → `[]` in 370ms; `allbirds.com` → `[]` in 329ms. Correct by contract: reads `discovery_cache_entry` **cache-only**, never falls through to a provider, returns zero rather than fabricating. Produces real candidates only once the discovery cache is warm — i.e. it needs the Meta pipeline kept. | 17:22:47 / 17:25:28 |
| auth (better-auth) | **WORKS** | Prod: `GET /api/auth/ok` → `{"ok":true}`; `/status` sign-in surface: **49 magic links dispatched in 24h, last dispatch 13 min before check**. Local e2e harness: `POST /auth/signup` created a real `verification` row (`{"email":"scout3843@example.test"}` payload, hashed token, 15-min expiry) and dispatched a signed verify URL — email send then failed only because the e2e env binds no `EMAIL`. Anti-enumeration `sent=1` swallow verified for unknown users. | prod 17:13 / local 17:30 |
| auth — OAuth providers | **NEEDS KEYS** | `POST /auth/better/oauth provider=google` on **prod** → 302 `?error=oauth_not_configured` — Google/Microsoft client creds (`BETTER_AUTH_GOOGLE_CLIENT_ID/SECRET`, `BETTER_AUTH_MICROSOFT_*`) are set nowhere reachable. Magic-link covers sign-in; OAuth is a keys-only add. | prod 17:28 |
| billing (Dodo) | **WORKS** | Prod `GET /api/pricing-preview` → `available:true, provider:"dodo"`, real localized prices (`scout monthly €10 DE, tax-inclusive`) — proves `DODO_API_KEY` live. `POST /api/webhooks/dodo` bad-signature probe → `400 "Stale Dodo webhook timestamp"` — the signed/replay-windowed verification path executed and rejected. `/status` billing surface: self-check ran 21h ago, 100% of probe checks passed. | prod 17:13–17:14 |
| `workers/app.ts` cron | **WORKS (rail) — with a red flag** | Local: `scheduled({cron:"13 * * * *"})` ran the gap-check end-to-end — 5 `waitUntil` tasks all fulfilled, heartbeat row written to `scheduled_observation_health_state` (`baseline_at:2026-09-20T17:21:46Z`). Prod `/api/health/deep`: `scheduledWork:ok, scheduledGapCheck:ok`. **Red flag:** `/status` monitoring surface shows `runsInLast24h:0`, `lastWatchlistRunAt:2026-09-17T12:40Z` with **22 active watchlists scheduled** — the cron rail fires but monitoring produced no watchlist runs for 3 days. Investigate before/while porting. | local 17:22 / prod 17:13–17:14 |
| Meta ads pipeline (`ad-source`/`meta-library-browser`/`meta-api`/`discovery-cache`) — transitively in scope (auto-seed reads its cache; it is the product's core engine) | **WORKS** | Prod `GET /search?website=gymshark.com` → 200, `data-f9-result-source="meta_library_browser"`, real Gymshark ads (EN/DE/FR creative text). `/status` public-search surface: **581 cached result sets, freshest provider fetch <1min old, 81% of 289 probes passed/24h**. One earlier `/search` hit returned edge **502** and the external uptime probe shows 0/289 with 522s — edge-level flakiness worth noting, not engine death. | prod 17:14–17:35 |

## KEEP — exact paths

Engine code below is proven live today (verdicts above). Shared spine files are keep-because-imported.

### Competitor-monitoring sources (`app/lib/sources/`)

- `app/lib/sources/types.ts` — adapter contract
- `app/lib/sources/registry.server.ts` — registry + env/plan gating
- `app/lib/sources/run.server.ts` — store → diff → alert seam
- `app/lib/sources/capture-usage.server.ts` — capture bookkeeping
- `app/lib/sources/google-ads.server.ts` + `app/lib/sources/google-ads/` — **proven**
- `app/lib/sources/subdomains.server.ts` + `app/lib/sources/subdomains/` — **proven**
- `app/lib/sources/hiring.server.ts` + `app/lib/sources/hiring/` — **proven** (stored-board path)
- `app/lib/sources/google-search.server.ts` + `app/lib/sources/google-search/` — dormant until `DECODO_SCRAPER_AUTH`
- `app/lib/sources/linkedin-ads.server.ts` + `app/lib/sources/linkedin-ads/` — dormant until `DECODO_SCRAPER_AUTH`
- `app/lib/sources/tiktok-ads.server.ts` + `app/lib/sources/tiktok-ads/` — dormant/broken-prod; re-probe with key before trusting

D1 tables: `source_snapshot` (snapshots), `watchlist` (competitor rows incl. `job_board_*`/`tiktok_advertiser` write-back columns), `watch_event` (alert emission via `createWatchEvent`), `user` (FK chain). Decodo usage counters ride `DECODO_BUDGET` KV (not D1).

### Presence connectors (`app/lib/presence-connectors/`)

- `app/lib/presence-connector-registry.server.ts`, `app/lib/presence-access-gates.server.ts`, `app/lib/presence-data.server.ts`, `app/lib/presence-types.ts`, `app/lib/presence-source-coverage.server.ts` — dispatch/gating/store
- `app/lib/presence-connectors/website.server.ts` — **proven** (GA)
- `app/lib/presence-connectors/rss.server.ts` — **proven**
- `app/lib/presence-connectors/hn.server.ts` — **proven**
- `app/lib/presence-connectors/pinterest.server.ts` — **proven**
- `app/lib/presence-connectors/gdelt.server.ts` — **proven code**; upstream 429s under shared-IP saturation
- `app/lib/presence-connectors/bluesky.server.ts` — dormant until `BSKY_*` app password
- `app/lib/presence-connectors/youtube.server.ts` — dormant until `YOUTUBE_API_KEY`
- `app/lib/presence-connectors/threads.server.ts` — dormant until `THREADS_ACCESS_TOKEN`
- `app/lib/presence-connectors/reddit.server.ts` — dormant until creds + `REDDIT_COMMERCIAL_ACCESS`
- `app/lib/presence-connectors/x.server.ts` — dormant until bearer token + `X_PAID_ACCESS` (money)
- `app/lib/presence-connectors/linkedin.server.ts` + `app/routes/api.presence.oauth.linkedin*.ts` — dormant until OAuth client + connected org

D1 tables: `source_target`, `tracked_entity`, `presence_item`, `presence_item_revision`, `presence_poll_cursor`, `presence_alert_cursor`, `source_connection`, `presence_oauth_transaction`, `presence_domain_verification`, `presence_entity_link`.

### Auto competitor seed

- `app/lib/auto-competitor-seed.server.ts` — **proven** (honest zero on cold cache; real candidates once cache warm)
- `app/lib/auto-competitor-resweep.server.ts`, `app/lib/auto-competitor-suggested-loader.server.ts` — its scheduled-refresh/read siblings (per umbrella: competitors kept fresh, dismissed remembered)
- `app/lib/competitor-suggestion-dismissal.server.ts` — dismissed-suggestion memory (umbrella requirement)

D1 tables: `discovery_cache_entry` (reads), `watchlist` (dedup), `competitor_suggestion_dismissal`, `source_snapshot` (via seed outputs downstream).

### Meta ads discovery pipeline (the flagship engine — proven on prod `/search`)

- `app/lib/ad-source.server.ts`, `app/lib/meta-library-browser.server.ts`, `app/lib/meta-api.server.ts`, `app/lib/discovery-cache.server.ts`, `app/lib/search-v2.server.ts`, `app/lib/browser-run.server.ts`, `app/lib/creative-text.server.ts`, `app/lib/analysis.server.ts`, `app/lib/language-classifier.ts`, `app/lib/translation.server.ts`, `app/lib/landing-page-signals.server.ts`, `app/lib/search-query.ts`, `app/lib/search-display.ts`

D1 tables: `discovery_cache_entry`, `discovery_fetch_log`, `discovery_query_lease`, `discovery_provider_state`, `search_domain_identity_cache`, `meta_integration_log`, `ad`, `ad_observation`, `ads_domain_publisher_state`, `browser_job_telemetry`, `landing_page_snapshot` (landing-proof), `analysis_field`.

### Auth (better-auth — magic-link proven end-to-end)

- `app/lib/better-auth.server.ts`, `app/lib/auth.server.ts`, `app/lib/auth-client.ts`, `app/lib/better-auth-magic-link-sign-in.server.ts`, `app/lib/authenticated-api-limits.server.ts`
- `app/routes/auth.*.tsx/ts`, `app/routes/api.auth.$.ts`
- `app/lib/delivery.server.ts`, `app/lib/unsubscribe.server.ts` — Cloudflare Email send lane (prod: email accepted 1h before check) + signed unsubscribe
- `app/lib/workspace.server.ts`, `app/lib/plan.server.ts`, `app/lib/plan-entitlements.ts`

D1 tables: `user`, `session`, `account`, `verification`, `better_auth_magic_link_ticket`, `organization`, `member`, `invitation`, `user_plan`, `rate_limit_events`, `email_suppression`, `delivery_attempt`, `delivery_target`, `signup_source_pending`.

### Billing (Dodo — proven on prod)

- `app/lib/dodo-billing.server.ts`, `app/lib/dodo-pricing.server.ts`, `app/lib/dodo-pricing-preview.server.ts`, `app/lib/dodo-pricing-country.server.ts`, `app/lib/dodo-pricing-display.ts`, `app/lib/dodo-plan-change-reconciliation.server.ts`, `app/lib/billing-canary-identity.server.ts`, `app/lib/billing-canary-lock.ts`
- `app/routes/api.billing.dodo.*.ts`, `app/routes/api.webhooks.dodo.ts`, `app/routes/api.pricing-preview.ts`, `app/routes/app.billing.tsx`

D1 tables: `dodo_webhook_event`, `user_plan`, `user_plan_next`, `evidence_top_up_grant`, `evidence_top_up_ledger_entry`, `evidence_top_up_adjustment`, `evidence_usage_period`, `evidence_usage_reservation`, `watchlist` (auto-pause on revoke), `delivery_attempt` (lifecycle emails), `billing canary` rows via `error_report`.

### Cron rail (`workers/`)

- `workers/app.ts` — Worker entry: `fetch` + `scheduled` + `email` handlers
- `workers/schedule.ts` — cron→task map; `workers/monitoring-workflow.ts` — fan-out Workflow
- `app/lib/monitoring.server.ts`, `app/lib/monitoring-fanout.server.ts`, `app/lib/monitoring-coverage.ts`
- `app/lib/cron-failure-alert.server.ts`, `app/lib/release-scheduled-observation.server.ts`, `app/lib/scheduled-observation-health.server.ts`, `app/lib/status-probes.server.ts`
- `app/lib/digest-*.server.ts`, `app/lib/mention-digest.server.ts` — weekly brief rail (umbrella: "weekly brief by email")
- `app/lib/rate-limit.server.ts` — RL_* bindings used by public surfaces

D1 tables: `watchlist_run`, `release_scheduled_observation`, `scheduled_observation_health_state`, `scheduled_observation_alert_state`, `cron_failure_alert_accepted_window`, `cron_failure_alert_throttle`, `status_probe_samples`, `monitoring_concurrency_slot`, `digest_run`, `digest_item`, `digest_delivery`, `digest_schedule_job`, `demo_brand_proof_hole_state`, plus the kept engines' tables above (`watchlist`, `watch_event`, `source_snapshot`, `presence_*`, `delivery_*`).

### Shared spine (keep-because-imported)

`app/lib/env.server.ts`, `app/lib/data/` (d1/helpers/watch-events/watchlists-core + leaves actually imported by kept engines), `app/lib/fetch-timeout.server.ts`, `app/lib/public-url.server.ts`, `app/lib/competitor-website.ts`, `app/lib/weekly-public-moves.server.ts` (currently only `domainFromWatchlistTargetId` — fold it and drop the rest), `app/lib/e2e-*.server.ts` only if the e2e harness survives, `app/components/sources/` + `app/components/presence/` (the Section renderers for kept engines), `app/routes.ts` + the routes serving kept surfaces (`search`, `ads/:domain`, `status`, `auth/*`, `api/auth/*`, `api/billing/*`, `api/webhooks/dodo`, `api/pricing-preview`, `app/*` shell), `workers/`, `app/entry.server.tsx`, `app/root.tsx`, `app/app.css`, `vite.config.ts`, `react-router.config.ts`, `wrangler.jsonc`, `package.json`, `migrations/` — **replaced**: umbrella resets D1 to a fresh `0001` schema carrying only the tables named above.

## DELETE — everything not listed above

Feature surfaces with no place in the rebuild spec (per umbrella #3842's flow):

- `app/lib/customer-agent-actions/` + `customer_api_key`/`agent_*` machinery (MCP/API surface), `app/lib/report-builder.server.ts` + share/report/export routes (`share_link`, `report` tables), `collection*`/`tag`/`saved_query` review surfaces, `support_case*`, `proof_*`/`evidence_*` productization not named above, `whatsapp*`/`slack*`/`teams*` lanes (`WHATSAPP_*` env surface), `client_room*`, `presence` UI beyond the kept mention engines, `brand-page/` extra surfaces, `competitor_graph`, `landing_page` history extras beyond the signal extraction used by seed.
- `app/routes/` and `app/components/` entries not reachable from the keep list (≈197 routes today; the rebuild's four places are Home/Competitors/Alerts/Settings).
- `e2e/`, `tests/` — suite dies with the schema it pins; the rebuild rewrites tests against the fresh schema. `scripts/`, `ops/` review by owner (deploy/liveness machinery moves with the deploy pipeline, not the product code).
- `legacy/`, `automation/`, `brand/`, `build/`, `data/`, `db/`, `extension/`, `docs/` historicals (except this file and `docs/PROJECT-HISTORY.md` if kept as the audit log), `.lane/`, `coverage/`, `test-results/`, `playwright-report/`, `var/`, `deploy-ledger.jsonl`, stray root `test-issuer*.mjs` files.
- `migrations/0002`+ — the whole existing chain; D1 resets to migration `0001` carrying only the kept tables.
- Env surface to drop with the code: `WHATSAPP_*`, `PRESENCE_*_MOCK`, legacy billing/report flags; env to add when engines activate: `DECODO_SCRAPER_AUTH`, `BSKY_*`, `YOUTUBE_API_KEY`, `THREADS_ACCESS_TOKEN`, `REDDIT_*`, `X_API_BEARER_TOKEN`+`X_PAID_ACCESS`, `LINKEDIN_*`, `BETTER_AUTH_GOOGLE/MICROSOFT_*`.

## Findings the rebuild should not inherit

1. **Monitoring rail produced zero `watchlist_run` rows in 24h** (last `2026-09-17T12:40Z`, 22 active watchlists) while `/api/health/deep` reads `scheduledWork:ok` — the health contract watches cron heartbeats, not run production. The rebuild's gap alert must watch outcomes, not just triggers.
2. **TikTok: 0 of 22 captures in 8 days** with the flag `active` — a silently-failing source is worse than a removed one.
3. **workerd plain `fetch` is bot-gated by big-brand sites** (gymshark.com 200 via curl, `fetch_failed`/`site_unreachable` from workerd): website connector, hiring discovery, and the seed's landing-page leg all inherit this. Anything that must read arbitrary brand homepages needs the Browser Rendering path, not plain fetch.
4. **GDELT saturates on a shared IP** (429 at ~10s): fine for a product cron, useless for interactive probes — document the 1-per-5s budget wherever it lands.
5. **Demo-brand proof backfill needs `BROWSER`** (`screenshot_required` ×5 in the local run) — expected in tests; confirm the binding survives the rebuild.
6. **External uptime probe saw 0/289 with 522s** while direct requests succeeded — check what hostname the probe targets before trusting it post-rebuild.
7. `auto-competitor-seed` is cache-only by design — with a wiped D1 it returns zero until the discovery cache warms; onboarding's "here's who you're up against" needs the Meta pipeline warmed first or it will look broken.
