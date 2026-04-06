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
- Resend (email delivery)
- Pure CSS via `app/app.css` (no Tailwind, no CSS-in-JS)
- Vitest for testing

## Architecture

- `app/routes/` — React Router v7 routes (loaders/actions)
- `app/lib/*.server.ts` — server-side logic (D1 queries, Meta API, monitoring, analysis)
- `app/lib/*.ts` — shared logic (language classifier, types, display helpers)
- `workers/app.ts` — Cloudflare Worker entry with scheduled event handler
- `migrations/` — D1 schema migrations (sequential numbered SQL)
- `tests/` — Vitest coverage for search, monitoring, analysis, onboarding, plan limits, reporting, and route exposure
- `src/` — legacy Next.js prototype (historical reference only)

## Key Files

- `app/lib/data.server.ts` — D1 CRUD layer (~36KB)
- `app/lib/meta-api.server.ts` — Meta Ad Library API client
- `app/lib/monitoring.server.ts` — watchlist monitoring + digests
- `app/lib/analysis.server.ts` — ad analysis (hook, offer, destination, language)
- `app/lib/landing-page-signals.server.ts` — CTA, price, form extraction
- `app/lib/language-classifier.ts` — Hindi/Hinglish/English/Regional detection
- `app/lib/creative-text.server.ts` — creative text OCR (HTML + Workers AI)
- `app/lib/plan.server.ts` — user plan lookup and free/starter/agency gating
- `app/lib/report-builder.server.ts` — shareable report assembly for collections and watchlists

## Current Phase: Live On Direct Cloudflare Custom Domains

The checked-in Cloudflare app is already the active production runtime:

- onboarding, collections, watchlists, digests, reports, share/export flows, and region-aware pricing exist in `app/`
- plan gating is scaffolded in code and tests
- billing is still intentionally not live; tests assert there is no checkout or Stripe webhook route exposure
- `0509.in` and `www.0509.in` now point directly at the Cloudflare Worker through Worker-managed custom domains

Last local verification on 2026-04-06:

- `npm test` passed (`21` files / `69` tests)
- `npm run build` passed
- `https://0509.in` and `https://0509.in/search` returned the current app HTML
- `https://www.0509.in` returned the current app HTML
- auth POSTs through `https://0509.in` reached Better Auth successfully

## Production Reality

- `https://0509.in` now serves the current Cloudflare app under `app/` and `workers/`
- `https://www.0509.in` also serves the same app through a Cloudflare Worker custom domain
- `https://api.0509.in` also serves the same app through a Cloudflare Worker custom domain
- Cloudflare deploy progress as of 2026-04-06:
  - D1 database `0509` created and bound in `wrangler.jsonc`
  - remote migrations `0000_auth.sql` through `0006_plan.sql` applied successfully
  - `BETTER_AUTH_SECRET` uploaded to the Cloudflare Worker
  - R2 bucket `0509-landing-page-artifacts` created and bound as `LANDING_PAGE_ARTIFACTS`
  - Cloudflare preview is now live at `https://0509.nishant345.workers.dev`
  - the Cloudflare zone for `0509.in` is active and delegated at the registrar
  - `0509.in`, `www.0509.in`, and `api.0509.in` are attached as Worker custom domains
- auth/origin logic should stay proxy-aware for Cloudflare and any future front-door changes:
  - `app/lib/env.server.ts` must respect `Forwarded` and `x-forwarded-*` headers
  - `tests/env.server.test.ts` covers that behavior

## Paperclip

This project is managed by Paperclip under company Swish.
- **Project:** 0509.in (URL key: `0509-in`)
- **SaaS Builder** handles implementation tasks
- **SaaS Reviewer** + **Codex Reviewer** review completed work

## Product Shape

- Analysis is the hook.
- Monitoring is the retention loop.
- Workspace memory is the compounding layer.

## Conventions

- Keep new work in the Cloudflare app unless explicitly touching legacy reference code.
- Favor honest product behavior over optimistic marketing claims.
- If a Meta token is configured and live search fails, monitoring should fail honestly rather than silently degrading into demo-backed success.
- Verify the active runtime before making topology assumptions. Today the canonical public hosts all run through Cloudflare Worker custom domains.
- For local Worker development, prefer `.dev.vars` over `.env.local`.
- Cloudflare cost policy: stay on included/free usage by default. Only enable usage-billed add-ons when the missing capability is materially hampering product quality, operations, or launch.
- `LANDING_PAGE_ARTIFACTS` should stay optional unless persisted HTML snapshots become operationally important enough to justify enabling R2.
- Immutability: create new objects, never mutate existing ones.
- File organization: 200-400 lines typical, 800 max.
- D1 queries: always use parameterized `.bind()` — never string interpolation.

## Design System

See `DESIGN.md` in the repo root for the canonical design reference. The picked aesthetic is **Vercel** (from the awesome-design-md collection). Read `DESIGN.md` before any UI work and align styling decisions with the documented patterns: color palette, typography, spacing, shadows, radii, component shapes.

Per Nish's "delightmaxxing >>>>>" preference (2026-04-06): do not ship generic AI-default styling. If a UI change can be more delightful, more polished, or more consistent with Vercel's aesthetic, take the extra time to do it.

Source: https://github.com/VoltAgent/awesome-design-md
