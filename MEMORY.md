# 0509 Memory

Last updated: 2026-05-20

## Product

- `0509` is the internal repo and domain handle for `Five to Nine`.
- `Five to Nine` is the customer-facing product name: a proof-backed Meta competitor monitoring product for growth teams, India-first.
- The north-star promise is: `See what changed, with proof.`
- The core story is the gap between when a team stops checking and when the next decision gets made. `Five to Nine` closes that gap with trusted alerts.
- Three layers: public `analysis` → retained `monitoring` → reusable `workspace memory`.
- Pricing display is Dodo-backed: load local checkout preview for the buyer location and do not show hardcoded visible currency or fixed local prices as product truth. Do not revive India-vs-rest-of-world pricing.

## Current Product State

- Analysis Depth work is complete in the checked-in app: OCR (Workers AI vision + HTML fallback), translation, agency report/export scaffolding, persisted OCR/translation reuse, and public search without D1.
- The authenticated workspace already includes onboarding, watchlists, collections, digests, reports, share/export flows, and one-table pricing display.
- Plan gating is scaffolded in code now: `app/lib/plan.server.ts`, `migrations/0006_plan.sql`, and route tests cover unpaid/scout/starter/agency limits plus the onboarding flow.
- Dodo 0509 pricing preview is wired for subscription products and proof-capture usage bundles. Checkout/webhook routes now exist for Dodo, but billing should still be treated as verified-current only after product ids, webhook secret, remote migration, and live signed webhook proof are confirmed.
- Current commercial caps are intentionally generous but finite, with no free retained-monitoring plan: Scout has 3 watchlists, 10 collections, weekly digest delivery, and 50 proof captures/month; Starter has 10 watchlists, 25 collections, weekly digest delivery, and 250 proof captures/month; Agency has 75 watchlists, 250 collections, daily and weekly briefs, and 2,500 proof captures/month. Workspaces warn at 80% proof usage. Overflow bundles sell extra proof captures for 30-day spikes instead of unlimited monitoring.
- Production cutover is live on the primary Cloudflare custom domains: `https://0509.io`, `https://www.0509.io`, and `https://api.0509.io` serve the checked-in Cloudflare app under `app/`.
- Cloudflare readiness is complete for the current launch shape: D1 database `0509` exists, remote migrations are applied, Better Auth is the active auth provider, the R2 bucket `0509-landing-page-artifacts` is created and bound, the `0509.io` zone is active in Cloudflare, and the Worker preview is live at `https://0509.nishant345.workers.dev`.
- Legacy `0509.in`, `www.0509.in`, and `api.0509.in` are redirect compatibility only while the old domain is retired; do not use `.in` in product copy, outbound email, auth origin, SEO files, or new customer links.

## Key Library Files

- `app/lib/meta-api.server.ts` — Meta Ad Library API client
- `app/lib/analysis.server.ts` — structured analysis fields (hook, offer, destination, language)
- `app/lib/creative-text.server.ts` — OCR pipeline (HTML + Workers AI)
- `app/lib/translation.server.ts` — Workers AI translation (m2m100-1.2b)
- `app/lib/ad-persistence.server.ts` — raw D1 CRUD for ads + analysis fields
- `app/lib/data.server.ts` — D1 access layer with DB-guard wrappers
- `app/lib/monitoring.server.ts` — watchlist scans, digests, scheduling
- `app/lib/plan.server.ts` — user plan lookup and free/starter/agency limits
- `app/lib/report-builder.server.ts` — agency report assembly
- `app/lib/search-selection.server.ts` — search result hydration + analysis pipeline
- `app/lib/landing-pages.server.ts` — landing page snapshot + signal extraction

## Stack

- React Router v7 on Cloudflare Workers
- Better Auth (email magic links, D1 sessions, passkeys, gated Google/Microsoft OAuth)
- D1 (SQLite via Cloudflare)
- Optional R2 (artifact storage retention)
- Cloudflare Email Service `send_email` binding (digest and instant-alert email delivery)
- Workers AI (OCR + translation)
- Pure CSS (no Tailwind)
- Vitest

## Working Conventions

- Cloudflare app (`app/`) is source of truth. `src/` is legacy Next.js reference only.
- D1 guards: `hydrateAdsWithPersistedCreatives` and `upsertAd` in `data.server.ts` return early if `env.DB` is absent — public search works without D1.
- D1 queries: always parameterized `.bind()`, never string interpolation.
- Monitoring must fail honestly vs. silently degrade to demo state.
- Billing is intentionally not exposed yet even though plan storage exists.
- Cloudflare cost policy: stay on included/free usage by default. Only enable usage-billed add-ons when the missing capability is materially hampering product quality, operations, or launch.
- `app/lib/landing-pages.server.ts` treats `LANDING_PAGE_ARTIFACTS` as optional. Without R2, snapshots still work but `artifactKey` remains `null`.
- Auth/app origin logic must honor `Forwarded` and `x-forwarded-*` headers for Cloudflare-managed production traffic; see `app/lib/env.server.ts` and `tests/env.server.test.ts`.
- File size: 200–400 lines typical, 800 max.
- Immutability: always create new objects, never mutate.

## Repo Structure

- `app/routes/` — React Router v7 routes (loaders/actions/components)
- `app/lib/*.server.ts` — server-only logic
- `app/lib/*.ts` — shared/isomorphic logic
- `workers/app.ts` — Cloudflare Worker entry + scheduled handler
- `migrations/` — D1 schema (sequential numbered SQL)
- `tests/` — Vitest coverage for search, monitoring, analysis, plan limits, onboarding, and route exposure

## Durable Runtime Truth

- `app/` is the source of truth for current development.
- `src/` is legacy reference only; it is no longer the live production runtime.
- Any agent touching launch, deploy, or live-product work must verify both the active app runtime and the current hostname topology before making assumptions.
- For local Worker secrets, `.dev.vars` is the current path. `.env.local` is legacy runtime baggage.
