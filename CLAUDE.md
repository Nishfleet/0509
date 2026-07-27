# 0509.io — Five to Nine

## Agent operating model (Nish, 2026-07-19)

Three roles, kept separate — this split shipped the 2026-07-19 product-readiness stack and Nish endorsed it as the standing model:

- **Builders** (fast models: Grok, Cursor Composer): implement from meticulous work-package specs (`docs/PRODUCT-READINESS-SPEC-*` pattern — anchor strings, acceptance criteria, guardrails). Builders never merge or deploy their own work.
- **Prod-touchers** (Codex or any TTY session that can pass safe-deploy admin auth, or Nish): merges that trigger deploys, remote D1 migrations, secrets, restore drills, provider mutations. Headless agent sessions are fail-closed by the safe-deploy wrapper — by design; do not route around it.
- **Reviewer/coordinator** (Claude): audits, spec authoring, independent multi-domain review of every builder stack BEFORE merge (`docs/REVIEW-FIXES-*` pattern), landing-order coordination across agents, live prod verification after deploy.

Every substantial builder stack gets an independent review pass before merge — the 2026-07-19 stack had 3 blockers and 6 customer-facing email bugs caught this way. Deploy-gate e2e (Gate-B journeys, restore-evidence) is Codex-owned; product changes that alter public copy/states require the gate specs to be updated in the same landing sequence.

## Build
```bash
npm run build
npm test
```

## Dev
```bash
npm run dev
```

## Stack

- React Router v7 on Cloudflare Workers
- Better Auth (email + OAuth)
- D1 (Cloudflare SQLite)
- Optional R2 (artifact storage retention)
- Cloudflare Email Service (email delivery via the `EMAIL` send_email binding) — replaced Postmark on 2026-06-11; see `app/lib/delivery.server.ts`
- Dormant WhatsApp Cloud API and Slack webhook code retained behind product gates; email is the verified GA delivery channel
- Dodo Payments (live checkout + signed webhooks); legacy secondary payment routes have been removed
- Cloudflare Browser Rendering (primary ad discovery scrapes the Meta Ad Library; the Meta API token is a gated fallback)
- Cloudflare Workers AI (creative-text OCR) and Cloudflare Workflows (monitoring fan-out — live in prod via `MONITORING_FANOUT_MODE=fanout`, see Production Reality)
- Pure CSS via `app/app.css` (no Tailwind, no CSS-in-JS)
- Vitest for testing

## Architecture

- `app/routes/` — React Router v7 routes (loaders/actions)
- `app/lib/*.server.ts` — server-side logic (D1 queries, ad discovery, monitoring, analysis, delivery, billing)
- `app/lib/*.ts` — shared logic (language classifier, types, display helpers)
- `workers/app.ts` — Cloudflare Worker entry with scheduled event handler
- `workers/monitoring-workflow.ts` — Cloudflare Workflow for watchlist scans (active in prod when `MONITORING_FANOUT_MODE=fanout`; gate is `resolveMonitoringFanoutMode()` in `app/lib/monitoring-fanout.server.ts`)
- `workers/schedule.ts` — cron string → scheduled task mapping
- `migrations/` — D1 schema migrations (sequential numbered SQL; `0004` intentionally absent, currently through `0065`; post-deploy cleanup allowlist in `scripts/d1-migration-sync-check.lib.mjs` is empty)
- `tests/` — Vitest coverage for search, monitoring, analysis, onboarding, plan limits, reporting, billing webhooks, and route exposure
- `scripts/` — deploy, prod canaries, launch-readiness canary, D1 backup
- `docs/launch-readiness.md` — launch gate definition (accurate, maintained)
- `legacy/` — pre-Cloudflare reference material (`legacy/src/` Next.js prototype, `legacy/supabase/` old backend config). Historical reference only — not part of the live build. See `legacy/README.md`.

## Key Files

- `app/lib/data.server.ts` — D1 CRUD layer (~9,000 lines; overdue for a split by domain)
- `app/lib/customer-agent-actions.server.ts` — customer agent action dispatch (~2,600 lines)
- `app/lib/browser-run.server.ts` — Browser Rendering snapshot runner (~700 lines)
- `app/lib/evidence-usage.server.ts` — proof/evidence credit ledger (~790 lines)
- Presence subsystem — `app/lib/presence-*.server.ts` (rollout-flag gated via `wrangler.jsonc` `PRESENCE_*` vars; website connector is GA, digest/X/Reddit/LinkedIn remain disabled)
- `app/lib/ad-source.server.ts` — commercial discovery resolver (browser scraping primary, Meta API fallback, honest demo mode)
- `app/lib/meta-library-browser.server.ts` — Browser Rendering scraper for the Meta Ad Library
- `app/lib/meta-api.server.ts` — Meta Ad Library API client
- `app/lib/monitoring.server.ts` — watchlist monitoring + digests + proof budgets
- `app/lib/monitoring-fanout.server.ts` — scheduled monitoring fan-out orchestration (`resolveMonitoringFanoutMode()`; inline is only the unset-var default/fallback)
- `app/lib/delivery.server.ts` — email (Cloudflare Email Service) delivery plus dormant WhatsApp/Slack code paths with idempotency keys, attempt records, and unsubscribe headers
- `app/lib/unsubscribe.server.ts` — HMAC-signed unsubscribe tokens for the `/unsubscribe` route
- `app/lib/whatsapp.server.ts` — WhatsApp Cloud API templates, webhook signature verification, target validation
- `app/lib/dodo-billing.server.ts` — Dodo webhook verification + plan/credit grants
- `app/lib/analysis.server.ts` — ad analysis (hook, offer, destination, language)
- `app/lib/landing-page-signals.server.ts` — CTA, price, form extraction
- `app/lib/language-classifier.ts` — 34-language detection: English/Hindi/Hinglish, 8 Indic scripts ("Regional"), 10 global scripts incl. Ethiopic ("Global"), and 14 Latin-script languages via cue-word profiles (es/pt/fr/de/it/nl/tr/pl/id/vi/sw/af/ha/yo). Short ambiguous Latin copy falls back to English; `translation.server.ts` then runs a Workers AI detect-and-translate fallback (llama-3.2-3b) at selection time. All non-English labels auto-translate via m2m100.
- `app/lib/creative-text.server.ts` — creative text OCR (HTML + Workers AI)
- `app/lib/plan.server.ts` — user plan lookup and free/starter/agency gating
- `app/lib/rate-limit.server.ts` — D1-backed rate limiting (public search, auth, writes)
- `app/lib/report-builder.server.ts` — shareable report assembly for collections and watchlists
- `app/lib/ai-guarded-generation.server.ts` — shared scaffold for guarded Workers AI text generators (untrusted `<<<DATA>>>` envelope builder, prompt-field sanitizer, bounded never-throwing run wrapper, and grounding validation primitives). Used by `search-steal-summary.server.ts`, `counter-brief.server.ts`, and `digest-strategy.server.ts` — each keeps its own prompt/model/gates/output shape.
- `app/lib/search-display.ts` — pure display/formatting/accumulation/URL helpers for the `/search` route (extracted from `search.tsx`; the route re-exports the test-facing names so `~/routes/search` imports still resolve)
- `app/components/pill.tsx` — the one `<Pill>` badge component (families via `variant`: status / longevity / angle; `is-*` modifier via `state`). Replaced the scattered longevity/variant/angle/Sample/status pill markup
- `app/components/search/result-card.tsx` — `SearchResultCard`, the per-ad card extracted from the `/search` results list
- `app/lib/watchlist-route-loader.server.ts` / `app/lib/watchlist-route-actions.server.ts` — the `/app/watchlists` loader and action, moved out of the route verbatim (BL-007) so the route file stays under the 800-line ceiling; the route re-exports them as `loader` / `action`
- `app/lib/watchlist-detail-tabs.ts` / `app/lib/watchlist-detail-display.ts` — URL-addressable competitor detail tabs (What changed · Evidence · Creative · Delivery · Setup) and the detail's pure presentation (status-strip cells, fact rail, delivery lines, one hard-failure count shared with the board)
- `app/lib/watchlist-display.ts` — pure watchlist presentation/formatters (scan presentation, empty-event copy resolvers, run status/timing labels, delivery-channel visibility, proof summaries) extracted from `app/routes/app.watchlists.tsx`; the route re-exports the test-facing resolver names
- `app/components/watchlists/` — presentational pieces of the watchlists route (FirstScanBanner, BulkSelectBar, DeliverySettingsCard, DeliveryTargetsSection, RecentChecksSection, RecentEvidenceChecksCard, CandidateHistory, EventChangesSection, CompetitorDetail, DetailTabBar, CompetitorRail, WatchlistSetupCard, WatchlistProofAge). All are read-only over loader data + scalar plan flags — props threaded explicitly, no context. `WatchlistProofAge` is re-exported from the route for its hydration test

## Current Phase: Pre-Commercial-Launch Hardening

The checked-in Cloudflare app is the active production runtime and billing is wired:

- onboarding, collections, watchlists, digests, reports, share/export flows, customer API keys, and MCP endpoint exist in `app/`
- **billing IS live via Dodo Payments**: `api.billing.dodo.checkout.ts` (303 to hosted checkout) + `api.webhooks.dodo.ts` (signed, idempotent). `payment.succeeded` grants plans/credits; `subscription.cancelled/expired/failed/on_hold` revoke to free with the same monotonic-timestamp ordering (2026-06-11). The Dodo dashboard webhook must have subscription events enabled (including refund events). As of 2026-06-12: `subscription.failed/on_hold` are a dunning grace state (plan kept, `dodo_status` flagged, banner shown) — only `cancelled/expired` revoke; `refund.succeeded` revokes plan + expires credits; a `dodo_webhook_event` ledger dedupes redeliveries; a ±5min replay window is enforced; `/app/billing` shows plan/usage/cancel guidance; checkout blocks double-subscriptions. Do not describe billing as "not live."
- Dodo returns to `/app/billing?checkout=dodo`, which renders a checkout-return notice that polls plan activation ~20x every 3s (`CheckoutReturnNotice` in `app/components/checkout-return-notice.tsx`, rendered on the billing page)
- support contact is `support@0509.io` (`app/lib/support.ts`), surfaced on marketing footer, app sidebar, /terms, /privacy, /unsubscribe, and email footers; inbound routing is Cloudflare Email Routing (dashboard-configured)
- Dodo is the only active billing processor. Stripe was never wired; tests assert no Stripe route exposure.
- region-aware pricing was REMOVED in `migrations/0016_drop_region_pricing.sql`; pricing is live-loaded from Dodo (`app/lib/dodo-pricing.server.ts`, `/api/pricing-preview`)
- plan gating is enforced at creation time (`checkPlanLimit`), on manual refresh (free plan blocked), on watchlist resume, and on downgrade/revocation/refund (over-limit watchlists auto-pause, newest kept); authenticated live search is rate-limited per account (60/10min)
- a retention audit (first-week experience, signal quality, promise-vs-delivery, churn lifecycle) followed on 2026-06-12 and a 12-PR program (#160-#172) landed the same day: Dodo subscription grants fixed for real payloads (subscription payments carry NO product_cart — grants come from checkout metadata; subscription.active/renewed handled; migration 0023 rebuilt user_plan absorbing remote drift and added subscription/customer/next-billing linkage), first scan on watchlist creation, all-quiet heartbeat digests, baseline event instead of first-scan ad_new flood, canonical-URL diffing + 48h per-field suppression + stale-cache-honest scans, paused-watchlist visibility + auto-resume on grant, per-plan daily proof caps (agency math now reachable), Dodo customer portal + cancel-at-period-end guard, scan-failure notices + nightly customer-at-risk operator email, before/now diffs + links in alert emails, /app/account (password/email/sessions/delete), honest cadence copy, hidden-value pricing bullets + agency scan priority. A live-mode Dodo API key lives at ~/.config/dodo/claude-api-key. RESOLVED 2026-06-12 (verified via Dodo API): the production webhook ep_3DyWwxkqJjUoAInxV07esfVvUDb subscribes to all 8 handled events (payment.succeeded, refund.succeeded, subscription.active/renewed/cancelled/expired/failed/on_hold) — filter_types match the handler exactly.
- a full launch audit (security, code, architecture, DB, business) was completed 2026-06-11 and a 13-PR hardening program (#138-#158) landed 2026-06-12 resolving: SSRF in creative-text, open redirect on auth `redirectTo`, D1 100-param crashes, missing indexes (0022) + retention sweep, share-link expiry/revocation (+ `/app/shares`), password reset, billing page + double-subscription guard, dunning grace + refund handling + Dodo event ledger, digests-before-scans + cron deadline guard, digest-only Mondays, scraper advertiser/CTA honesty, instant-alert retry + quiet-hours flush, watchlist pause/resume + collection delete + send-test-email, cost gates. CURRENT GA POSTURE: Email is the verified delivery lane; WhatsApp and Slack are dormant/non-GA customer channels; Workflow-based monitoring fan-out is live in prod (`MONITORING_FANOUT_MODE=fanout`, max 8 in-flight).
- a round-3 audit program (waves A/B/C + ops) landed 2026-06-12 as PRs #176-#186: scan-reliability interaction fixes (deletion guard, operator-alert FK, email-change target migration, paused_reason, in-flight scan guard with lazy scan thunks, soft-failure classification, capacity staleness signals), pending states + first-scan live pulse, tab titles/favicon/PNG og-image, the GLOBAL-FIRST pass (see Conventions; migrations 0024-0025), email dark-mode hardening, dashboard wake-up greeting, creative thumbnails (creativeImageUrl on AdRecord raw_json), Boards rename + ad-longevity badges, weekly business-numbers operator email (Monday cron), D1→R2 weekly backups (npm run backup:d1:r2 + scheduled task on Nish's Mac; docs/ops-backup-uptime.md), and agency report branding (migration 0026, /app/account, plan-gated). Remote D1 migrations applied through 0026. PENDING NISH (see docs/ops-backup-uptime.md): UptimeRobot monitor on /api/health, Dodo dashboard customer-portal "Allow Subscription Updates" toggle, WhatsApp Meta-side setup.

Last local verification on 2026-06-11:

- `npm test` passed (`74` files / `502` tests)
- `npm run build` passed
- remote D1 migration state checked via `wrangler d1 migrations list 0509 --remote`

## Production Reality

- `https://0509.io`, `https://www.0509.io`, and `https://api.0509.io` are the primary production domains for the current Cloudflare app under `app/` and `workers/`.
- **Deploys go through CI, not your terminal.** Every push to `main` auto-deploys via `.github/workflows/deploy-production.yml` (the Cloudflare deploy token lives in the GitHub `production` environment). That workflow runs typecheck → full tests → materializes private remote-restore evidence → `npm run deploy` → verifies the release evidence set. `npm run deploy` executes `scripts/deploy-production-plan.mjs`: D1 migration-sync blocks; `launch:readiness:predeploy` (typecheck, tests, build, audit, and `e2e:local:release`) plus `verify-deploy-readiness.mjs` require a strict first-attempt Chromium `local-release` 66-entry Gate-B proof and block release; `cross_browser_risk_proof` (`scripts/run-cross-browser-risk-proof.mjs`) is a non-blocking diagnostic (`nonBlockingDiagnostic: true`); `remote_restore_evidence` (`scripts/verify-remote-restore-evidence.mjs`) blocks under policy `fresh-exact-24h` for migration-bearing deploys and `verified-ledger-7d` otherwise; post-deploy steps include rollback-target verification, launch-readiness canary cycle, version-bound release canary, Gate-C soak start, live public truth, and `e2e:prod:public` smoke. Do NOT also run `npm run deploy` locally for routine ships — on 2026-07-13 a local deploy interleaved with CI deploys, hashed asset names flip-flopped between versions, and live sessions (including the owner mid-sign-in) got unstyled pages and root error boundaries. Local deploy is break-glass only, when Actions is down and after checking no CI deploy run is in flight.
- `0509.in`, `www.0509.in`, and `api.0509.in` are redirect compatibility routes only. Do not introduce new `.in` product copy, auth origins, SEO links, or support addresses.
- Cloudflare deploy state is represented by `wrangler.jsonc`: D1 database `0509`, R2 bucket binding `LANDING_PAGE_ARTIFACTS`, Browser Rendering, Workers AI, Cloudflare Email Service, and `MonitoringWorkflow` bindings are configured there. `wrangler.jsonc` sets `MONITORING_FANOUT_MODE: "fanout"` and `MONITORING_FANOUT_GLOBAL: "1"` (max 8 in-flight via `MONITORING_FANOUT_MAX_INFLIGHT`).
- Remote D1 migrations: remote D1 and the repo migration chain are through `0070_release_scheduled_observations.sql`. The post-deploy cleanup allowlist in `scripts/d1-migration-sync-check.lib.mjs` is empty.
- Crons: `17 */6 * * *` (warmup), `0 4 * * *` (daily monitoring), and `0 5 * * MON` (weekly cadence).
- scheduled monitoring runs via the `MonitoringWorkflow` fan-out path (not inline). The real gate is `resolveMonitoringFanoutMode()` in `app/lib/monitoring-fanout.server.ts` — inline is only the unset-var default/fallback. There is no `shouldRunScheduledMonitoringInline` helper.
- auth/origin logic should stay proxy-aware for Cloudflare and any future front-door changes:
  - `app/lib/env.server.ts` must respect `Forwarded` and `x-forwarded-*` headers
  - `tests/env.server.test.ts` covers that behavior
  - `BETTER_AUTH_URL` is set to `https://0509.io` in `wrangler.jsonc` vars so auth origin trust and unsubscribe-link generation never derive from client-supplied forwarded headers.

## Paperclip

This project is managed by Paperclip under company Swish.
- **Project:** 0509.in (URL key: `0509-in`)
- **SaaS Builder** handles implementation tasks
- **SaaS Reviewer** reviews completed work (Codex Reviewer retired 2026-06-12)

## Brand

The product is **Five to Nine**; **0509.io** is its current production domain (05:09 = five-to-nine). Use "Five to Nine" in customer-facing prose and the wordmark. Refunds: Nish's global no-refunds policy applies (digital product, purchases final, paired with the 100%-satisfaction support promise) — see global CLAUDE.md; keep refund-webhook revocation code in place for goodwill/dispute cases.

## Product Shape

- Analysis is the hook.
- Monitoring is the retention loop.
- Workspace memory is the compounding layer.

## Conventions

- **Global-first (Nish, 2026-06-12): no IST/India defaults anywhere.** 0509 may be India-first in marketing motion, but the product is built for the global market. UI timestamps render in the viewer's browser timezone/locale (`app/components/local-time.tsx`); emails use the workspace delivery timezone else UTC-labeled; search country defaults to the visitor's `cf-ipcountry` geo (`app/lib/countries.ts`) else "all" — never a hardcoded country; watchlists persist `target_country` at creation (migration 0025; NULL legacy rows keep their original India scan country so diffs stay coherent). Pricing is already served in the visitor's local currency via Dodo adaptive currency.

- Keep new work in the Cloudflare app unless explicitly touching legacy reference code.
- Favor honest product behavior over optimistic marketing claims.
- If a live discovery provider is configured (browser scraping or Meta token) and live search fails, monitoring must fail honestly rather than silently degrading into demo-backed success. Demo mode is only for the explicitly unconfigured state and must always be labeled. `searchAds` in `meta-api.server.ts` defaults `allowDemoFallback` to `false`; callers that intentionally want demo on live failure must pass `allowDemoFallback: true`.
- Verify the active runtime before making topology assumptions. Today the canonical public hosts all run through Cloudflare Worker custom domains.
- For local Worker development, prefer `.dev.vars` over `.env.local`.
- Cloudflare cost policy: stay on included/free usage by default. Only enable usage-billed add-ons when the missing capability is materially hampering product quality, operations, or launch. Note: monitoring already depends on usage-billed products (Browser Rendering, Workers AI, Workflows) — the account must be on Workers Paid for the cron design to function.
- Email always goes through the Cloudflare Email Service `EMAIL` binding via `delivery.server.ts` with an idempotency key, a `delivery_attempt` record, and `List-Unsubscribe` headers — never add ad-hoc email sends. Cloudflare Email Service has no delivery webhooks; email `webhookStatus` stays `provider_unknown` (bounce data is in the dashboard Activity log / GraphQL API). Legacy `delivery_attempt` rows with `provider = 'postmark'` remain valid history.
- `LANDING_PAGE_ARTIFACTS` should stay optional unless persisted HTML snapshots become operationally important enough to justify enabling R2.
- Immutability: create new objects, never mutate existing ones.
- File organization: 200-400 lines typical, 800 max.
- D1 queries: always use parameterized `.bind()` — never string interpolation.
- Prod schema changes go through ONE door: a numbered file in `migrations/` applied with `npx wrangler d1 migrations apply 0509 --remote`. Never run DDL via `wrangler d1 execute --remote`. `npm run deploy` enforces this via `scripts/check-d1-migrations-synced.mjs`, which fails the deploy while remote D1 is behind `migrations/` except for an explicitly allowlisted post-deploy cleanup migration (`POST_DEPLOY_CLEANUP_MIGRATIONS` in `scripts/d1-migration-sync-check.lib.mjs` — currently empty after `0060` completed). (Lesson from the 0019_slack_delivery drift incident, 2026-06-11: schema was changed out-of-band, the migration ledger lied, and the next apply crashed on it.)

## Design System

See `DESIGN.md` in the repo root for the canonical design reference. The picked aesthetic is **Vercel** (from the awesome-design-md collection). Read `DESIGN.md` before any UI work and align styling decisions with the documented patterns: color palette, typography, spacing, shadows, radii, component shapes.

Per Nish's "delightmaxxing >>>>>" preference (2026-04-06): do not ship generic AI-default styling. If a UI change can be more delightful, more polished, or more consistent with Vercel's aesthetic, take the extra time to do it.

Source: https://github.com/VoltAgent/awesome-design-md
