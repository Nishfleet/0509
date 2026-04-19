# 0509

0509 is a Meta competitor analysis workspace for growth teams.

## Product shape

- `Analysis` is the public hook: search competitor ads, inspect the hook/offer/CTA/landing page, and save useful findings.
- `Monitoring` is the retention loop: watchlists, run history, change detection, and weekly digests.
- `Workspace memory` is the compounding layer: collections, notes, tags, exports, and share links.

## Current stack

- React Router v7 on Cloudflare Workers
- Better Auth
- D1
- Optional R2 for landing-page artifact retention
- Resend for digest delivery

## Routes

- `/` marketing site
- `/search` public analysis flow
- `/pricing-region`
- `/auth/login`
- `/auth/signup`
- `/app/onboard`
- `/app` workspace dashboard
- `/app/collections`
- `/app/watchlists`
- `/app/digests`
- `/app/reports/:id`
- `/share/:token`
- `/export/:resourceType/:resourceId`

## Environment

Important bindings and secrets:

- `DB`
- `LANDING_PAGE_ARTIFACTS` (optional)
- `BETTER_AUTH_SECRET`
- `META_AD_LIBRARY_TOKEN`
- `META_AD_LIBRARY_API_VERSION`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Notes

- For the current Cloudflare Worker app, use `.dev.vars` for local secrets. A starter template now lives at `.dev.vars.example`.
- `.env.local` and `.env.local.example` are legacy Next.js env files for the old `src/` runtime and should not be treated as the source of truth for the Worker app.
- `META_AD_LIBRARY_TOKEN` should not be treated as proof that live India commercial-ad discovery is production-ready. The official Meta API is now diagnostic-only for this use case.
- If no live commercial discovery provider is configured, the app should operate only in explicit demo mode. Production should not silently fall back to demo data on live-provider failures.
- Cloudflare cost policy: stay on the included/free tier by default. Do not enable usage-billed add-ons just because they exist; enable them when the missing capability is materially hampering product quality, operations, or launch.
- `LANDING_PAGE_ARTIFACTS` is optional right now. If R2 is not enabled, landing-page snapshots still work and simply return `artifactKey: null` instead of persisting raw HTML.
- R2 is now provisioned for `0509` as the `0509-landing-page-artifacts` bucket, but it is still an enhancement path rather than a launch blocker.
- Billing is not live yet. The repo includes plan storage and region-aware pricing display, but checkout and Stripe webhook routes are intentionally not exposed.
- The old `src/` Next.js app remains in the repo as legacy reference material and is no longer the live production runtime.
- Production note: as of 2026-04-06, `https://0509.in`, `https://www.0509.in`, and `https://api.0509.in` now serve the current Cloudflare app directly through Worker custom domains.
- Cloudflare readiness note: the D1 database exists, remote migrations have been applied, the `0509-landing-page-artifacts` R2 bucket is provisioned and bound, the Cloudflare zone is active, and the Worker preview remains live at `https://0509.nishant345.workers.dev`.
- DNS note: Porkbun still owns the registration, but the registrar now delegates `0509.in` to Cloudflare nameservers and the old DNSSEC DS record has been removed.
