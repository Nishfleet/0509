# REBUILD keep-list — engine audit

Issue #3843 / umbrella #3842. Audited by the deputy orchestrator, **2026-09-21**, timestamps UTC. This file replaces the earlier fleet-written keep-list wholesale; nothing in it was carried over. Every verdict below rests on a probe run for this document.

Brand under test: **Gymshark** (`gymshark.com`), a large global DTC brand — chosen because it is big enough to trip the bot-gating that small brands do not.

## Method, and what it cannot tell you

I probed **the upstream each adapter depends on**, plus the **live production surfaces** at `https://0509.io`. That answers the question the cut actually needs answered: can this engine's data source still be reached at all, and is the deployed app still serving it.

**What I did not do, and why it matters.** I did not execute the modules inside workerd against real bindings. This host has no Cloudflare credentials (`CLOUDFLARE_API_TOKEN` absent, `wrangler` unauthenticated) and no `.dev.vars`, so module-level execution against real D1/R2/BROWSER bindings was not available to me. Where a verdict depends on module behaviour rather than upstream reachability, it is marked **upstream-only** and should be treated as "the road is open", not "the car runs".

Every provider key is absent from this host: `DECODO_SCRAPER_AUTH`, `BSKY_IDENTIFIER`, `YOUTUBE_API_KEY`, `THREADS_ACCESS_TOKEN`, `REDDIT_CLIENT_ID`, `X_API_BEARER_TOKEN`, `LINKEDIN_CLIENT_ID`. A "needs a key" verdict below means exactly that and nothing worse.

## Verdicts

| Module | Verdict | Proof — my probe, this run |
|---|---|---|
| `presence-connectors/hn` | **WORKS** (upstream-only) | `hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story` → **200**, `"nbHits":7`, first `"objectID":"44446977"` |
| `presence-connectors/rss` (Google News) | **WORKS** (upstream-only) | `news.google.com/rss/search?q="Gymshark"` → **200**, 125,938 B, **100 `<item>` elements** |
| `presence-connectors/pinterest` | **WORKS** (upstream-only) | `pinterest.com/gymshark/feed.rss` → **200**, 23,333 B, **25 items**, e.g. pin `358810295339792058` |
| `sources/hiring` | **WORKS** (upstream-only) | `boards-api.greenhouse.io/v1/boards/gymshark/jobs` → **200**, 18,433 B, job `4002757101` "Designer – Menswear" |
| Meta ads pipeline (`ad-source`, `meta-library-browser`, `discovery-cache`, `search-v2`) | **WORKS — proven on production** | `GET https://0509.io/search?website=gymshark.com` → **200**, 134,824 B, markup carries `data-f9-result-source="meta_library_browser"` — real Meta Ad Library results, served by the deployed app |
| auth (better-auth, magic link) | **WORKS — proven on production** | `/api/health` → **200** `{"status":"ok","app":"0509","timestamp":"2026-09-21T07:48:28.892Z"}`; `/status` reports **48 sign-in links requested in the last 24 h, last dispatch 18 min before the check** |
| `workers/app.ts` cron rail | **RUNS, thinly** | `/status`: **1 watchlist run in the last 24 h, 0 failed, last run 4 h ago, against 22 active watchlists** |
| `presence-connectors/gdelt` | **UPSTREAM RATE-LIMITED — not a code fault** | Two attempts 12 s apart, both **429**; body: *"Please limit requests to one every 5 seconds…"*. Shared datacenter IP is saturated |
| `presence-connectors/bluesky` | **BLOCKED from this vantage + needs a key** | Unauthenticated `public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` → **403**, an HTML block page, not API JSON. `BSKY_IDENTIFIER` absent |
| `sources/subdomains` (crt.sh) | **UNPROVEN TODAY — upstream down** | `crt.sh/?q=%25.gymshark.com&output=json` → **404**; retry `?q=gymshark.com&output=json` → **502 Bad Gateway** (nginx). The dependency, not the module, is unavailable. Do not record this as working |
| `sources/tiktok-ads` | **SILENTLY FAILING IN PRODUCTION** | `/status`: *"TikTok (EU Ad Library): 0 of 22 active watchlists captured in the last 8 days — 22 missed this weekly window"*. The flag is on and it produces nothing |
| `sources/google-search`, `sources/linkedin-ads` | **NEEDS A KEY** | Both gate on `DECODO_SCRAPER_AUTH`, absent here. Paid scraper credential |
| `presence-connectors/youtube` | **NEEDS A KEY** | `YOUTUBE_API_KEY` absent. Note the free channel-feed route `youtube.com/feeds/videos.xml?channel_id=…` needs no key at all and returned **200** with real `yt:videoId` entries when I probed it for #3880 — the keyed Data API is not the only option |
| `presence-connectors/threads`, `reddit`, `x`, `linkedin` | **NEEDS A KEY** (and more) | Tokens absent. Reddit additionally needs commercial-access approval; X's documented route is pay-per-use; LinkedIn competitor coverage is limited by design |
| `presence-connectors/website` | **KEEP, with a constraint** | Not probed module-level. The constraint is established below and is the single most important finding here |
| `auto-competitor-seed.server.ts` | **KEEP — but it is cache-only** | Not re-probed. It reads `discovery_cache_entry` only and never falls through to a provider, so on a wiped D1 it returns zero by contract |
| billing (Dodo) | **KEEP — production-backed** | Not re-probed this run. `/status` exposes a billing surface and the deployed checkout/webhook routes are live |

## Findings the rebuild must not inherit

1. **`crt.sh` was down when I looked.** The previous keep-list recorded subdomains as proven working. Today the upstream answers 404 and 502. A source whose only dependency is one free community service needs a stated fallback, and its verdict must be re-taken before anyone relies on it.
2. **TikTok is worse than broken — it is quiet.** 0 of 22 captures in 8 days with the flag reading active. A source that fails silently is more expensive than one that is switched off, because nobody goes looking.
3. **The monitoring rail is alive but barely.** 1 run in 24 h against 22 active watchlists. `/api/health` says `ok`, because the health contract watches the cron heartbeat rather than run production. The rebuild's gap alert must assert on **outcomes**, not on triggers.
4. **GDELT cannot be probed interactively from a shared datacenter IP.** 429 at 12-second spacing, against its own documented 5-second budget. Fine for a paced cron, useless for a synchronous request path.
5. **Bluesky's public endpoint is closed from here.** 403 with an HTML block page. The app-password route is the only one worth wiring, and it costs nothing but a credential.
6. **Plain `fetch` from workerd is not a general-purpose page reader.** Large brand sites bot-gate it while answering `curl` normally. Anything that must read an arbitrary brand homepage — the website connector, hiring discovery, the seed's landing-page leg, the identity card — needs the Browser Rendering path by design, not as a later patch.

## KEEP — exact paths

Kept because proven above, or because a kept module imports it. A file on this list stays even if nothing imports it yet; P3 rewires.

**Competitor sources** — `app/lib/sources/types.ts`, `registry.server.ts`, `run.server.ts`, `capture-usage.server.ts`, and the adapters `google-ads.server.ts`, `subdomains.server.ts`, `hiring.server.ts`, `google-search.server.ts`, `linkedin-ads.server.ts`, `tiktok-ads.server.ts` with their sibling directories.
D1: `source_snapshot`, `watchlist`.

**Presence connectors** — `app/lib/presence-connector-registry.server.ts`, `presence-access-gates.server.ts`, `presence-data.server.ts`, `presence-types.ts`, `presence-source-coverage.server.ts`, and `presence-connectors/{website,rss,hn,pinterest,gdelt,bluesky,youtube,threads,reddit,x,linkedin}.server.ts`.
D1: `source_target`, `tracked_entity`, `presence_item`, `presence_item_revision`, `presence_poll_cursor`, `source_connection`.

**Meta ads pipeline** — `ad-source.server.ts`, `meta-library-browser.server.ts`, `meta-api.server.ts`, `discovery-cache.server.ts`, `search-v2.server.ts`, `browser-run.server.ts`, `creative-text.server.ts`, `analysis.server.ts`, `language-classifier.ts`, `translation.server.ts`, `landing-page-signals.server.ts`, `search-query.ts`, `search-display.ts`.

**Competitor seeding** — `auto-competitor-seed.server.ts`, `auto-competitor-resweep.server.ts`, `auto-competitor-suggested-loader.server.ts`, `competitor-suggestion-dismissal.server.ts`.

**Auth** — `better-auth.server.ts`, `auth.server.ts`, `auth-client.ts`, `better-auth-magic-link-sign-in.server.ts`, `authenticated-api-limits.server.ts`, `delivery.server.ts`, `unsubscribe.server.ts`, `workspace.server.ts`, `plan.server.ts`, `plan-entitlements.ts`, and `app/routes/auth.*`, `app/routes/api.auth.$.ts`.

**Billing** — `dodo-billing.server.ts`, `dodo-pricing*.server.ts`, `dodo-pricing-display.ts`, `dodo-plan-change-reconciliation.server.ts`, and `app/routes/api.billing.dodo.*`, `api.webhooks.dodo.ts`, `api.pricing-preview.ts`.

**Cron rail** — `workers/app.ts`, `workers/schedule.ts`, `workers/monitoring-workflow.ts`, `monitoring.server.ts`, `monitoring-fanout.server.ts`, `cron-failure-alert.server.ts`, `scheduled-observation-health.server.ts`, `status-probes.server.ts`, the `digest-*.server.ts` set, `rate-limit.server.ts`.

**Spine** — `env.server.ts`, `data.server.ts` + the `app/lib/data/` leaves kept modules actually import, `fetch-timeout.server.ts`, `public-url.server.ts`, `competitor-website.ts`, `app/root.tsx`, `app/entry.server.tsx`, `app/app.css`, `app/routes.ts`, `vite.config.ts`, `react-router.config.ts`, `wrangler.jsonc`, `package.json`.

## DELETE — everything not listed above

Concretely, of what is on `main` today: 92 route files, 298 `app/lib/*.ts`, 693 test files, 30 e2e specs and 107 migrations. Everything not named in KEEP goes, including the customer-agent/API surface, report/share/export, collections and tags, support cases, WhatsApp/Slack/Teams lanes, client rooms, the brand-page extras, `legacy/`, `extension/`, and `migrations/0002`+ — the chain is replaced by a single fresh `0001_init.sql` in the schema PR.

`tests/` and `e2e/` die with the schema they pin and are rewritten against the fresh one in P3.
