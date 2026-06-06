# 0509

`0509` is the internal repo and domain handle for `Five to Nine`.

`Five to Nine` is the customer-facing product name: proof-backed competitor monitoring for growth teams.

## North Star

- Promise: `See what changed, with proof.`
- Story: `Five to Nine` closes the gap between when a team stops checking and when the next decision gets made.
- Positioning: lead with proof-backed competitor monitoring, not a generic competitor-analysis workspace.
- Product shape: the public hook is a sample proof loop; account-gated search starts the real monitoring product, and workspace memory is the compounding layer.

Canonical strategy note: `docs/superpowers/artifacts/2026-04-22-five-to-nine-north-star.md`

## Product shape

- `Demo proof` is the public hook: show a sample competitor, proof trail, digest preview, and export shape without exposing live search.
- `Analysis` is account-gated: signed-in users search competitor ads, inspect the hook/offer/CTA/landing page, and save useful findings.
- `Monitoring` is the retention loop: watchlists, run history, change detection, insight-depth summaries, daily briefs, and weekly digests.
- `Workspace memory` is the compounding layer: collections, notes, tags, CSV/API JSON/Slack-ready exports, customer API keys, Slack delivery, and share links.

## Current stack

- React Router v7 on Cloudflare Workers
- Better Auth on Cloudflare D1 for active auth and sessions
- D1 for product data
- Optional R2 for landing-page artifact retention
- Postmark for digest and instant-alert email delivery
- Slack incoming webhooks for configured digest and instant-alert delivery

Auth runtime decision: `docs/auth-runtime.md`

## Routes

- `/` marketing site
- `/api/demo-proof` sample public proof payload for buyer and agent evaluation
- `/api/mcp` read-only MCP JSON-RPC endpoint for account-owned collection, watchlist, and digest exports with a customer API key
- `/api/v1` customer API docs for read-only account export endpoints
- `/api/v1/:resourceType/:resourceId` customer API-key export endpoint for account-owned collections, watchlists, and digests
- `/search` account-gated analysis flow; logged-out requests redirect to signup while private canary probes can bypass with the configured token
- `/privacy`
- `/terms`
- `/api/pricing-preview`
- `/api/billing/dodo/checkout`
- `/api/webhooks/dodo`
- `/auth/login`
- `/auth/signup`
- `/app/onboard`
- `/app` workspace dashboard
- `/app/collections`
- `/app/watchlists`
- `/app/digests`
- `/app/reports/:id`
- `/app/sources` tracking access, customer API keys, and Slack delivery setup
- `/share/:token`
- `/export/:resourceType/:resourceId` authenticated CSV export; `?format=json` returns account-scoped API JSON and `?format=slack` returns Slack-ready markdown

## Environment

Important bindings and secrets:

- `DB`
- `LANDING_PAGE_ARTIFACTS` (optional)
- `BETTER_AUTH_SECRET`
- `CANARY_BYPASS_TOKEN`
- `ALLOW_PLATFORM_META_API_FALLBACK`
- `META_AD_LIBRARY_TOKEN`
- `META_AD_LIBRARY_API_VERSION`
- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_FROM_EMAIL`
- `POSTMARK_MESSAGE_STREAM`
- `META_TOKEN_ENCRYPTION_SECRET` for encrypted customer Meta tokens and Slack webhook URLs
- `DODO_PAYMENTS_API_KEY` or `DODO_0509_API_KEY`
- `DODO_0509_BRAND_ID`
- `DODO_0509_ENVIRONMENT`
- `DODO_0509_PRODUCT_SCOUT_MONTHLY_ID`
- `DODO_0509_PRODUCT_SCOUT_YEARLY_ID`
- `DODO_0509_PRODUCT_STARTER_MONTHLY_ID`
- `DODO_0509_PRODUCT_STARTER_YEARLY_ID`
- `DODO_0509_PRODUCT_AGENCY_MONTHLY_ID`
- `DODO_0509_PRODUCT_AGENCY_YEARLY_ID`
- `DODO_0509_PRODUCT_PROOF_PACK_500_ID`
- `DODO_0509_PRODUCT_PROOF_PACK_2000_ID`
- `DODO_0509_PRODUCT_PROOF_PACK_7500_ID`
- `DODO_0509_WEBHOOK_SECRET`

## Operations

- Run `npm run backup:d1` before risky migrations or data-shape changes. It exports the remote Cloudflare D1 database into `backups/d1/`, which is intentionally gitignored.
- Apply pending D1 migrations before deploying code that reads new tables. `migrations/0012_rate_limit_events.sql` backs Worker request rate limiting; `migrations/0018_customer_api_keys.sql` backs customer API keys; `migrations/0019_slack_delivery.sql` backs Slack delivery channels.

## Notes

- For the current Cloudflare Worker app, use `.dev.vars` for local secrets. A starter template now lives at `.dev.vars.example`.
- Supabase is legacy-only under `legacy/`; it is not part of the active `app/` or `workers/` runtime.
- Stytch is deferred until there is a real B2B auth need such as SSO, SCIM, organization admin, or enterprise RBAC.
- `.env.local` and `.env.local.example` are legacy Next.js env files for the old `src/` runtime and should not be treated as the source of truth for the Worker app.
- Meta ads tracking is a beta feature until the production canary proves fresh discovery, proof capture, and digest delivery are reliable.
- `META_AD_LIBRARY_TOKEN` should not be treated as proof that live India commercial-ad discovery is production-ready. The official Meta API is diagnostic-only by default. Customer-facing Meta API fallback requires a customer-owned Meta connection that is test-before-save and stored encrypted; the platform token can only be used if `ALLOW_PLATFORM_META_API_FALLBACK=true` is deliberately configured.
- If no live commercial discovery provider is configured, the app should operate only in explicit demo mode. Production should not silently fall back to demo data on live-provider failures.
- Daily briefs and weekly digests share the same proof-backed event model. Each digest item should carry a priority score, next action, source proof trail, timestamp, and confidence label.
- Account insight-depth summaries are generated from real saved ads, watch events, and digest items: top hooks, media mix, creative timeline, and landing-page history. Customer API keys are live for read-only account-owned export data at `/api/v1`, `/api/mcp` exposes the same account-owned exports to agents, and Slack incoming-webhook delivery is live for configured account destinations. These do not imply unsupported TikTok, Google, LinkedIn, Pinterest, or public write API coverage.
- Cloudflare cost policy: stay on the included/free tier by default. Do not enable usage-billed add-ons just because they exist; enable them when the missing capability is materially hampering product quality, operations, or launch.
- `LANDING_PAGE_ARTIFACTS` is optional right now. If R2 is not enabled, landing-page snapshots still work and simply return `artifactKey: null` instead of persisting raw HTML.
- R2 is now provisioned for `0509` as the `0509-landing-page-artifacts` bucket, but it is still an enhancement path rather than a launch blocker.
- Public pricing display is Dodo-backed. The landing page and `/api/pricing-preview` load localized checkout preview from the Dodo 0509 brand using the shared Dodo account API key, `DODO_0509_BRAND_ID`, and 0509 product ids. Do not show hardcoded visible currency or fixed local prices as product truth. There is no free retained-monitoring plan. Buyers can review the public sample proof loop before signup. Current caps are Scout: 3 watchlists, 10 collections, weekly digests, 50 proof captures/month; Starter: 10 watchlists, 25 collections, weekly digests, 250 proof captures/month; Agency: 75 watchlists, 250 collections, daily and weekly briefs, 2,500 proof captures/month. Workspaces warn after 80% proof-capture usage. Usage bundles are overflow proof-capture packs, not unlimited monitoring, and Dodo webhooks grant purchased proof credits for 30 days.
- Broad launch is gated by `npm run launch:readiness`, including the production canary. `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret so the canary can prove it bypassed cache and provider cooldown. The production canary also checks recent monitoring, proof capture, and sent digest signals. If fresh commercial discovery is cached, degraded, demo, stale, unsent, or the bypass token is missing, the product should be framed as pilot-readiness rather than broad self-serve launch.
- Use `npm run provider:bakeoff:launch` when comparing discovery providers for launch. The default bakeoff is useful for debugging, but the launch gate requires `current_0509` to return fresh live Ad Library results, not API fallback or cached live results.
- The old `src/` Next.js app remains in the repo as legacy reference material and is no longer the live production runtime.
- Production note: as of 2026-04-06, `https://0509.in`, `https://www.0509.in`, and `https://api.0509.in` now serve the current Cloudflare app directly through Worker custom domains.
- Cloudflare readiness note: the D1 database exists, remote migrations have been applied, the `0509-landing-page-artifacts` R2 bucket is provisioned and bound, the Cloudflare zone is active, and the Worker preview remains live at `https://0509.nishant345.workers.dev`.
- DNS note: Porkbun still owns the registration, but the registrar now delegates `0509.in` to Cloudflare nameservers and the old DNSSEC DS record has been removed.
