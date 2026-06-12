# 0509.in — Meta Competitor Analysis Workspace

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
- WhatsApp Cloud API (template-based delivery) + Slack webhooks as additional digest/alert channels
- Dodo Payments (live checkout + signed webhooks); legacy Razorpay routes still present but Dodo is the active processor
- Cloudflare Browser Rendering (primary ad discovery scrapes the Meta Ad Library; the Meta API token is a gated fallback)
- Cloudflare Workers AI (creative-text OCR) and Cloudflare Workflows (monitoring fan-out — currently bypassed in prod, see below)
- Pure CSS via `app/app.css` (no Tailwind, no CSS-in-JS)
- Vitest for testing

## Architecture

- `app/routes/` — React Router v7 routes (loaders/actions)
- `app/lib/*.server.ts` — server-side logic (D1 queries, ad discovery, monitoring, analysis, delivery, billing)
- `app/lib/*.ts` — shared logic (language classifier, types, display helpers)
- `workers/app.ts` — Cloudflare Worker entry with scheduled event handler
- `workers/monitoring-workflow.ts` — Cloudflare Workflow for watchlist scans (currently dead code in prod: `shouldRunScheduledMonitoringInline` always selects the inline loop when `BROWSER` is bound)
- `workers/schedule.ts` — cron string → scheduled task mapping
- `migrations/` — D1 schema migrations (sequential numbered SQL; `0004` intentionally absent, currently through `0019`)
- `tests/` — Vitest coverage for search, monitoring, analysis, onboarding, plan limits, reporting, billing webhooks, and route exposure
- `scripts/` — deploy, prod canaries, launch-readiness canary, D1 backup
- `docs/launch-readiness.md` — launch gate definition (accurate, maintained)
- `legacy/` — pre-Cloudflare reference material (`legacy/src/` Next.js prototype, `legacy/supabase/` old backend config). Historical reference only — not part of the live build. See `legacy/README.md`.

## Key Files

- `app/lib/data.server.ts` — D1 CRUD layer (~4,500 lines; overdue for a split by domain)
- `app/lib/ad-source.server.ts` — commercial discovery resolver (browser scraping primary, Meta API fallback, honest demo mode)
- `app/lib/meta-library-browser.server.ts` — Browser Rendering scraper for the Meta Ad Library
- `app/lib/meta-api.server.ts` — Meta Ad Library API client
- `app/lib/monitoring.server.ts` — watchlist monitoring + digests + proof budgets
- `app/lib/delivery.server.ts` — email (Cloudflare Email Service)/WhatsApp/Slack delivery with idempotency keys, attempt records, and unsubscribe headers
- `app/lib/unsubscribe.server.ts` — HMAC-signed unsubscribe tokens for the `/unsubscribe` route
- `app/lib/whatsapp.server.ts` — WhatsApp Cloud API templates, webhook signature verification, target validation
- `app/lib/dodo-billing.server.ts` — Dodo webhook verification + plan/credit grants
- `app/lib/analysis.server.ts` — ad analysis (hook, offer, destination, language)
- `app/lib/landing-page-signals.server.ts` — CTA, price, form extraction
- `app/lib/language-classifier.ts` — Hindi/Hinglish/English/Regional detection
- `app/lib/creative-text.server.ts` — creative text OCR (HTML + Workers AI)
- `app/lib/plan.server.ts` — user plan lookup and free/starter/agency gating
- `app/lib/rate-limit.server.ts` — D1-backed rate limiting (public search, auth, writes)
- `app/lib/report-builder.server.ts` — shareable report assembly for collections and watchlists

## Current Phase: Pre-Commercial-Launch Hardening

The checked-in Cloudflare app is the active production runtime and billing is wired:

- onboarding, collections, watchlists, digests, reports, share/export flows, customer API keys, and MCP endpoint exist in `app/`
- **billing IS live via Dodo Payments**: `api.billing.dodo.checkout.ts` (303 to hosted checkout) + `api.webhooks.dodo.ts` (signed, idempotent). `payment.succeeded` grants plans/credits; `subscription.cancelled/expired/failed/on_hold` revoke to free with the same monotonic-timestamp ordering (2026-06-11). The Dodo dashboard webhook must have subscription events enabled. Still missing: in-app billing management UI (plan display/cancel/invoices) and refund-event handling. Do not describe billing as "not live."
- `/app?checkout=dodo` shows a checkout-return banner that polls plan activation (`CheckoutReturnBanner` in `app.dashboard.tsx`)
- support contact is `support@0509.in` (`app/lib/support.ts`), surfaced on marketing footer, app sidebar, /terms, /privacy, /unsubscribe, and email footers; inbound routing is Cloudflare Email Routing (dashboard-configured)
- legacy Razorpay routes (`api.billing.razorpay.subscription.ts`, `api.webhooks.razorpay.ts`) still exist; Dodo is the active processor. Stripe was never wired; tests assert no Stripe route exposure.
- region-aware pricing was REMOVED in `migrations/0016_drop_region_pricing.sql`; pricing is live-loaded from Dodo (`app/lib/dodo-pricing.server.ts`, `/api/pricing-preview`)
- plan gating is enforced at creation time (`checkPlanLimit`); known gaps: manual watchlist refresh is ungated, downgrades don't deactivate over-limit watchlists
- a full launch audit (security, code, architecture, DB, business) was completed 2026-06-11. RESOLVED since: support contact, email unsubscribe headers, subscription lifecycle revocation, cron per-watchlist error isolation, digest retry, checkout-return UX. STILL OPEN: SSRF gap in `creative-text.server.ts`, open redirect on auth `redirectTo`, `listDigests` D1 100-param limit, missing D1 indexes/retention, share-link expiry, refund-policy depth, in-app billing management UI

Last local verification on 2026-06-11:

- `npm test` passed (`74` files / `502` tests)
- `npm run build` passed
- remote D1 migration state checked via `wrangler d1 migrations list 0509 --remote`

## Production Reality

- `https://0509.in` now serves the current Cloudflare app under `app/` and `workers/`
- `https://www.0509.in` also serves the same app through a Cloudflare Worker custom domain
- `https://api.0509.in` also serves the same app through a Cloudflare Worker custom domain
- Cloudflare deploy state as of 2026-06-11:
  - D1 database `0509` created and bound in `wrangler.jsonc`
  - remote migrations fully applied through `0019_slack_delivery.sql` — `wrangler d1 migrations list 0509 --remote` reports "No migrations to apply" (verified 2026-06-11). Note: 0019's schema had been applied out-of-band without a ledger row; it was verified column-by-column and reconciled into `d1_migrations` on 2026-06-11.
  - `BETTER_AUTH_SECRET` uploaded to the Cloudflare Worker
  - R2 bucket `0509-landing-page-artifacts` created and bound as `LANDING_PAGE_ARTIFACTS`
  - `BROWSER` (Browser Rendering), `AI` (Workers AI), and a `MonitoringWorkflow` workflow binding exist in `wrangler.jsonc`
  - crons: `17 */6 * * *` (warmup), `0 4 * * *` (daily monitoring), `0 5 * * MON` (weekly — currently maps to a full monitoring task, so Mondays double-scan)
  - Cloudflare preview is live at `https://0509.nishant345.workers.dev`
  - `0509.in`, `www.0509.in`, and `api.0509.in` are attached as Worker custom domains
- scheduled monitoring runs INLINE in the main Worker (sequential loop in `ctx.waitUntil`), not via the Workflow — capacity ceiling is roughly 15–40 watchlists per nightly run
- auth/origin logic should stay proxy-aware for Cloudflare and any future front-door changes:
  - `app/lib/env.server.ts` must respect `Forwarded` and `x-forwarded-*` headers
  - `tests/env.server.test.ts` covers that behavior
  - `BETTER_AUTH_URL` is set to `https://0509.in` in `wrangler.jsonc` vars (2026-06-11) so auth origin trust and unsubscribe-link generation never derive from client-supplied forwarded headers; note this pins auth to the custom domain, so auth flows on the `workers.dev` preview host are not expected to work

## Paperclip

This project is managed by Paperclip under company Swish.
- **Project:** 0509.in (URL key: `0509-in`)
- **SaaS Builder** handles implementation tasks
- **SaaS Reviewer** reviews completed work (Codex Reviewer retired 2026-06-12)

## Product Shape

- Analysis is the hook.
- Monitoring is the retention loop.
- Workspace memory is the compounding layer.

## Conventions

- Keep new work in the Cloudflare app unless explicitly touching legacy reference code.
- Favor honest product behavior over optimistic marketing claims.
- If a live discovery provider is configured (browser scraping or Meta token) and live search fails, monitoring must fail honestly rather than silently degrading into demo-backed success. Demo mode is only for the explicitly unconfigured state and must always be labeled. Caution: `searchAds` in `meta-api.server.ts` still *defaults* to demo fallback — production callers must pass `allowDemoFallback: false`.
- Verify the active runtime before making topology assumptions. Today the canonical public hosts all run through Cloudflare Worker custom domains.
- For local Worker development, prefer `.dev.vars` over `.env.local`.
- Cloudflare cost policy: stay on included/free usage by default. Only enable usage-billed add-ons when the missing capability is materially hampering product quality, operations, or launch. Note: monitoring already depends on usage-billed products (Browser Rendering, Workers AI, Workflows) — the account must be on Workers Paid for the cron design to function.
- Email always goes through the Cloudflare Email Service `EMAIL` binding via `delivery.server.ts` with an idempotency key, a `delivery_attempt` record, and `List-Unsubscribe` headers — never add ad-hoc email sends. Cloudflare Email Service has no delivery webhooks; email `webhookStatus` stays `provider_unknown` (bounce data is in the dashboard Activity log / GraphQL API). Legacy `delivery_attempt` rows with `provider = 'postmark'` remain valid history.
- `LANDING_PAGE_ARTIFACTS` should stay optional unless persisted HTML snapshots become operationally important enough to justify enabling R2.
- Immutability: create new objects, never mutate existing ones.
- File organization: 200-400 lines typical, 800 max.
- D1 queries: always use parameterized `.bind()` — never string interpolation.
- Prod schema changes go through ONE door: a numbered file in `migrations/` applied with `npx wrangler d1 migrations apply 0509 --remote`. Never run DDL via `wrangler d1 execute --remote`. `npm run deploy` enforces this via `scripts/check-d1-migrations-synced.mjs`, which fails the deploy while remote D1 is behind `migrations/`. (Lesson from the 0019_slack_delivery drift incident, 2026-06-11: schema was changed out-of-band, the migration ledger lied, and the next apply crashed on it.)

## Design System

See `DESIGN.md` in the repo root for the canonical design reference. The picked aesthetic is **Vercel** (from the awesome-design-md collection). Read `DESIGN.md` before any UI work and align styling decisions with the documented patterns: color palette, typography, spacing, shadows, radii, component shapes.

Per Nish's "delightmaxxing >>>>>" preference (2026-04-06): do not ship generic AI-default styling. If a UI change can be more delightful, more polished, or more consistent with Vercel's aesthetic, take the extra time to do it.

Source: https://github.com/VoltAgent/awesome-design-md
