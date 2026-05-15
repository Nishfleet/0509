# 0509

`0509` is the internal repo and domain handle for `Five to Nine`.

`Five to Nine` is the customer-facing product name: proof-backed competitor monitoring for growth teams.

## North Star

- Promise: `See what changed, with proof.`
- Story: `Five to Nine` closes the gap between when a team stops checking and when the next decision gets made.
- Positioning: lead with proof-backed competitor monitoring, not a generic competitor-analysis workspace.
- Product shape: search is the hook, monitoring is the product, workspace memory is the compounding layer.

Canonical strategy note: `docs/superpowers/artifacts/2026-04-22-five-to-nine-north-star.md`

## Product shape

- `Analysis` is the public hook: search competitor ads, inspect the hook/offer/CTA/landing page, and save useful findings.
- `Monitoring` is the retention loop: watchlists, run history, change detection, daily briefs, and weekly digests.
- `Workspace memory` is the compounding layer: collections, notes, tags, exports, and share links.

## Current stack

- React Router v7 on Cloudflare Workers
- Better Auth on Cloudflare D1 for active auth and sessions
- D1 for product data
- Optional R2 for landing-page artifact retention
- Resend for digest delivery

Auth runtime decision: `docs/auth-runtime.md`

## Routes

- `/` marketing site
- `/search` public analysis flow
- `/privacy`
- `/terms`
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
- `CANARY_BYPASS_TOKEN`
- `ALLOW_PLATFORM_META_API_FALLBACK`
- `META_AD_LIBRARY_TOKEN`
- `META_AD_LIBRARY_API_VERSION`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_PLAN_STARTER_MONTHLY`
- `RAZORPAY_PLAN_STARTER_YEARLY`
- `RAZORPAY_PLAN_AGENCY_MONTHLY`
- `RAZORPAY_PLAN_AGENCY_YEARLY`

## Notes

- For the current Cloudflare Worker app, use `.dev.vars` for local secrets. A starter template now lives at `.dev.vars.example`.
- Supabase is legacy-only under `legacy/`; it is not part of the active `app/` or `workers/` runtime.
- Stytch is deferred until there is a real B2B auth need such as SSO, SCIM, organization admin, or enterprise RBAC.
- `.env.local` and `.env.local.example` are legacy Next.js env files for the old `src/` runtime and should not be treated as the source of truth for the Worker app.
- Meta ads tracking is a beta feature until the production canary proves fresh discovery, proof capture, and digest delivery are reliable.
- `META_AD_LIBRARY_TOKEN` should not be treated as proof that live India commercial-ad discovery is production-ready. The official Meta API is diagnostic-only by default. Customer-facing Meta API fallback requires a customer-owned Meta connection that is test-before-save and stored encrypted; the platform token can only be used if `ALLOW_PLATFORM_META_API_FALLBACK=true` is deliberately configured.
- If no live commercial discovery provider is configured, the app should operate only in explicit demo mode. Production should not silently fall back to demo data on live-provider failures.
- Daily briefs and weekly digests share the same proof-backed event model. Each digest item should carry a priority score, next action, source proof trail, timestamp, and confidence label.
- Cloudflare cost policy: stay on the included/free tier by default. Do not enable usage-billed add-ons just because they exist; enable them when the missing capability is materially hampering product quality, operations, or launch.
- `LANDING_PAGE_ARTIFACTS` is optional right now. If R2 is not enabled, landing-page snapshots still work and simply return `artifactKey: null` instead of persisting raw HTML.
- R2 is now provisioned for `0509` as the `0509-landing-page-artifacts` bucket, but it is still an enhancement path rather than a launch blocker.
- Razorpay Subscriptions are the approved billing path for India checkout. The routes stay hidden unless Razorpay keys, plan ids, and webhook secret are configured; plan upgrades only happen after a signed Razorpay subscription webhook marks the subscription active.
- Broad launch is gated by `npm run launch:readiness`, including the production canary. `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret so the canary can prove it bypassed cache and provider cooldown. The production canary also checks recent monitoring, proof capture, and sent digest signals. If fresh commercial discovery is cached, degraded, demo, stale, unsent, or the bypass token is missing, the product should be framed as pilot-readiness rather than broad self-serve launch.
- Use `npm run provider:bakeoff:launch` when comparing discovery providers for launch. The default bakeoff is useful for debugging, but the launch gate requires `current_0509` to return fresh live Ad Library results, not API fallback or cached live results.
- The old `src/` Next.js app remains in the repo as legacy reference material and is no longer the live production runtime.
- Production note: as of 2026-04-06, `https://0509.in`, `https://www.0509.in`, and `https://api.0509.in` now serve the current Cloudflare app directly through Worker custom domains.
- Cloudflare readiness note: the D1 database exists, remote migrations have been applied, the `0509-landing-page-artifacts` R2 bucket is provisioned and bound, the Cloudflare zone is active, and the Worker preview remains live at `https://0509.nishant345.workers.dev`.
- DNS note: Porkbun still owns the registration, but the registrar now delegates `0509.in` to Cloudflare nameservers and the old DNSSEC DS record has been removed.
