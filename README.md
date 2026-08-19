# 0509

`0509` is the internal repo and domain handle for `Five to Nine`.

`Five to Nine` is the customer-facing product name: source-backed competitor monitoring for growth teams.

## North Star

- Promise: `Track your brand and competitors today. See what changed, with proof. Know what to do next.`
- Story: `Five to Nine` closes the gap between when a team stops checking and when the next decision gets made.
- Positioning: lead with proof-backed competitor monitoring (Market Desk) and entity tracking across declared sources (Presence Desk), not a generic internet scanner.
- Product shape: the public hook is a read-only search preview plus a sample watch; signed-in save and track starts the real monitoring product; workspace memory is the compounding layer.

Canonical strategy note: `docs/superpowers/artifacts/2026-04-22-five-to-nine-north-star.md`

## Product shape

- `Public trial` is the public hook: logged-out buyers can run a read-only search preview with explicit coverage/freshness truth and inspect a sample tracked competitor, source trail, and digest preview before creating an account.
- `Analysis` is available after the preview: signed-in users save searches, track competitors, inspect deeper evidence, and save useful findings.
- `Monitoring` is the retention loop: watchlists, run history, change detection, insight-depth summaries, observed campaign duration, daily and weekly digests.
- `Presence Desk` tracks your brand and competitors across declared sources with proof-backed entity briefs. Website/open-web is the active GA source; social and marketplace sources are gated, planned, or manual-only until provider approval. Additional entity kinds such as clients, products, and creators require the planned entity-kind metadata slice.
- `Workspace memory` is the compounding layer: collections, notes, tags, manual external evidence links, visible metric evidence fields, CSV/API JSON exports, customer API keys, narrow audited agent actions, agent memory, client rooms, email delivery, and share links.

## Current stack

- React Router v7 on Cloudflare Workers
- Better Auth on D1 for email-link auth, sessions, passkeys, and gated Google/Microsoft OAuth
- D1 for product data
- Optional R2 for landing-page artifact retention
- Cloudflare Email Service `send_email` binding for digest and instant-alert email delivery
- Dormant Slack and WhatsApp delivery code is retained behind product/configuration gates; neither channel is part of the public GA offer.

Auth runtime decision: `docs/auth-runtime.md`

## Routes

- `/` marketing site
- `/help` public setup, billing, delivery, and support help
- `/docs` public product and activation docs
- `/api/docs` public API and MCP docs
- `/status` public launch and operations status
- `/changelog` public product changelog
- `/trust` public trust and security basics
- `/api/demo-proof` sample public brief payload for buyer and agent evaluation
- `/api/mcp` MCP JSON-RPC endpoint for account-owned readiness, exports, and narrow audited workspace actions with a customer API key
- `/api/v1` machine-readable customer API index for workspace readiness, account exports, and audited agent actions
- `/api/v1/:resourceType/:resourceId` customer API-key export endpoint for account-owned collections, watchlists, and digests
- `/search` public read-only search preview with variable provider coverage; save, track, collections, and deeper evidence enrichment require an account while private canary probes can force fresh provider checks with the configured token
- `/privacy`
- `/terms`
- `/api/pricing-preview`
- `/api/billing/dodo/checkout`
- `/api/webhooks/dodo`
- `/auth/login`
- `/auth/signup`
- `/api/auth/*`
- `/auth/better/oauth`
- `/auth/better/magic-link`
- `/auth/logout`
- `/app` (persistent setup checklist for incomplete workspaces)
- `/app` workspace dashboard
- `/app/presence` Presence Desk — proof-backed entity tracking
- `/app/collections`
- `/app/watchlists`
- `/app/digests`
- `/app/reports/:id`
- `/app/sources` tracking access, customer API keys, and email delivery readiness
- `/share/:token`
- `/export/:resourceType/:resourceId` authenticated CSV export; `?format=json` returns account-scoped API JSON

## Environment

Important bindings and secrets:

- `DB`
- `LANDING_PAGE_ARTIFACTS` (optional)
- `APP_ORIGIN`
- `AUTH_PROVIDER=better-auth`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_GOOGLE_CLIENT_ID` / `BETTER_AUTH_GOOGLE_CLIENT_SECRET` only after Google branding is verified for Five to Nine/0509
- `BETTER_AUTH_MICROSOFT_CLIENT_ID` / `BETTER_AUTH_MICROSOFT_CLIENT_SECRET` only after Microsoft branding is verified for Five to Nine/0509
- `BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED=true` only after accepting same-email Microsoft account linking
- `BETTER_AUTH_MICROSOFT_TENANT_ID` (optional, defaults to `common`)
- `BETTER_AUTH_OAUTH_BRANDED_PROVIDERS` (optional comma-separated `google,microsoft`; OAuth stays hidden and unregistered until this includes the provider)
- `BETTER_AUTH_TRUSTED_ORIGINS` (optional comma-separated preview origins)
- `UNSUBSCRIBE_SIGNING_SECRET`
- `CANARY_BYPASS_TOKEN`
- `ALLOW_PLATFORM_META_API_FALLBACK`
- `META_AD_LIBRARY_TOKEN`
- `META_AD_LIBRARY_API_VERSION`
- `EMAIL` Cloudflare Email Service binding
- `EMAIL_FROM_EMAIL`
- `META_TOKEN_ENCRYPTION_SECRET` for encrypted customer Meta tokens, Slack webhook URLs, and delivery targets
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
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_DELIVERY_ENABLED`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_TEMPLATE_NAMESPACE`

## Operations

- Run `npm run backup:d1` before risky migrations or data-shape changes. It exports the remote Cloudflare D1 database into `backups/d1/`, which is intentionally gitignored.
- Backup and release claims are evidence-lane specific: dated local validation or fixed-candidate proof is not a current Gate B/C pass, and provider/dashboard, scheduled-workflow, and alert evidence remains Gate C operational proof. Gate D is target-buyer market validation only. The current restore posture requires an authorized remote-scratch drill after the local transform/import smoke.
- Every push to `main` must run `.github/workflows/deploy-production.yml`. That workflow uses the repo's production deploy script, then runs the public production smoke. If `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_API_TOKEN` is missing from GitHub repository or `production` environment secrets, the workflow fails loudly instead of letting merged code look shipped.
- Apply pending D1 migrations before deploying code that reads new tables. Destructive cleanup migrations that remove schema only after code stops reading it must run after the compatible Worker is deployed, with a fresh backup plus pre/post SQL evidence. `migrations/0012_rate_limit_events.sql` backs Worker request rate limiting; `migrations/0018_customer_api_keys.sql` backs customer API keys; `migrations/0019_slack_delivery.sql` backs dormant Slack delivery storage that is hidden from the GA offer; `migrations/0035_agent_action_audit.sql`, `0036_agent_memory.sql`, and `0037_client_rooms.sql` back audited agent actions, agent memory, and client rooms; `migrations/0042_better_auth_passkey.sql` backs Better Auth passkeys on databases that already ran the baseline auth migration.

## Notes

- `extension/` is a standalone Chrome extension (MV3, zero dependencies) that opens Five to Nine for the brand behind the current tab. It is not part of the app build or deploy; see `extension/README.md` for load-unpacked instructions and the store-submission checklist.
- For the current Cloudflare Worker app, use `.dev.vars` for local secrets. A starter template now lives at `.dev.vars.example`.
- Supabase is legacy-only under `legacy/`; it is not part of the active `app/` or `workers/` runtime.
- Better Auth is the active auth provider. D1 remains the source of truth for auth state, product data, billing linkage, watchlists, digests, collections, and customer API keys.
- Auth UI stays intentionally small: email link primary, passkeys after sign-in, plus Google/Microsoft only when the corresponding Better Auth OAuth credentials are configured and branded account chooser behavior is verified. Microsoft also requires an explicit same-email account-linking trust flag before it is registered. OAuth state cookies are HTTP-only, provider tokens are encrypted at rest, email-link confirmation is bound to a same-browser state cookie before token exchange, and callback tokens are never rendered into HTML.
- Current B2B scope is one account workspace per email because the product data model is keyed by local `user.id`. Multi-workspace organization membership is blocked until account data is organization-scoped.
- `.env.local` and `.env.local.example` are legacy Next.js env files for the old `src/` runtime and should not be treated as the source of truth for the Worker app.
- Meta ads tracking is graduated from beta: the production canary confirms fresh discovery, saved evidence, and digest delivery are reliable (Gate C passed for the live worker on 2026-08-09, re-verified 2026-08-11, and Gate C passed again on 2026-08-14). The public homepage leads with landing-page change monitoring; Meta Ad Library coverage is named as a public source and not promised as a scheduled first-class lane until the scheduled Meta discovery canary publishes a green state on a schedule. If the canary turns red again, restore the beta caveat before any customer-facing Meta claim.
- `META_AD_LIBRARY_TOKEN` should not be treated as confirmation that live commercial-ad discovery is production-ready. The official Meta API is diagnostic-only by default. Customer-facing Meta API fallback requires a customer-owned Meta connection that is test-before-save and stored encrypted; the platform token can only be used if `ALLOW_PLATFORM_META_API_FALLBACK=true` is deliberately configured.
- If no live commercial discovery provider is configured, the app should operate only in explicit demo mode. Production should not silently fall back to demo data on live-provider failures.
- Daily and weekly digests share the same source-backed event model. Each digest item should carry a priority score, next action, source trail, timestamp, and confidence label.
- Account insight-depth summaries are generated from real saved ads, manual external evidence links, watch events, and digest items: top hooks, media mix, observed campaign duration from first-seen/last-seen evidence, manual metric evidence, creative timeline, and landing-page history. Customer API keys are live for account-owned readiness, exports, and narrow audited workspace actions at `/api/v1/actions`; `/api/mcp` exposes the same account-owned context and safe actions to agents, including watchlist updates, collection creation, redacted delivery state, explicit-approval delivery settings, scoped memory, client rooms, and existing source-backed website/blog/Substack observations. Billing, team invites, secret setup, external delivery sends, unsupported-channel ingestion, and broad public write APIs are not exposed as agent actions. Slack incoming-webhook setup is not part of the public GA offer; existing stored Slack configuration is preserved behind product gates. Manual external evidence links can store TikTok, Google/YouTube, LinkedIn, Pinterest, Meta, landing-page, or other evidence in collections, including user-supplied visible spend, impression, and reach values. They do not imply automated non-Meta ingestion, X/Reddit/YouTube listening, or automated spend/reach/impression benchmarks.
- Cloudflare cost policy: stay on the included/free tier by default. Do not enable usage-billed add-ons just because they exist; enable them when the missing capability is materially hampering product quality, operations, or launch.
- `LANDING_PAGE_ARTIFACTS` is optional right now. If R2 is not enabled, landing-page snapshots still work and simply return `artifactKey: null` instead of persisting raw HTML.
- R2 is now provisioned for `0509` as the `0509-landing-page-artifacts` bucket, but it is still an enhancement path rather than a launch blocker.
- Public pricing display is Dodo-backed. The landing page and `/api/pricing-preview` load localized checkout preview from the Dodo 0509 brand using the configured Dodo account API key, brand id, and product ids. Do not show hardcoded visible currency or fixed local prices as product truth. There is no free retained-monitoring plan. Buyers can review public read-only search and the sample watch before signup. Current caps are Scout: 3 watchlists, 10 collections, weekly digests, 50 proof captures/month; Starter: 10 watchlists, 25 collections, daily and weekly digests, 250 proof captures/month; Agency: 75 watchlists, 250 collections, daily and weekly digests, 2,500 proof captures/month. Workspaces warn after 80% proof-capture usage. Usage bundles are overflow proof-capture packs, not unlimited monitoring; included proof captures reset monthly without rollover, and purchased proof-capture packs never expire and carry over until used.
- Broad launch is gated by `npm run launch:readiness`, including pricing, billing, evidence/email, production, and provider canaries. `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret so the canary can confirm it bypassed cache and provider cooldown. The production canary checks recent monitoring, saved evidence, sent email digest signals, and provider-canary success. Slack and WhatsApp are not public GA delivery channels; do not require or advertise them for launch unless a future product decision reintroduces them with verified evidence.
- Use `npm run provider:bakeoff:launch` when comparing discovery providers for launch. The default bakeoff is useful for debugging, but the launch gate requires `current_0509` to return fresh live Ad Library results, not API fallback or cached live results.
- The old `src/` Next.js app remains in the repo as legacy reference material and is no longer the live production runtime.
- Production note: as of 2026-06-15, `https://0509.io`, `https://www.0509.io`, and `https://api.0509.io` are the primary production domains. Legacy `0509.in`, `www.0509.in`, and `api.0509.in` custom domains remain only to redirect old safe requests to the matching `.io` host while preserving signed provider callbacks.
- Cloudflare readiness note (historical repo/config posture): the D1 database exists, remote migrations were applied through the then-current production ledger except branch-local pending migrations, the `0509-landing-page-artifacts` R2 bucket is provisioned and bound, the Cloudflare zones are active, and the Worker preview remains live at `https://0509.nishant345.workers.dev`. Run the current migration-sync and candidate checks before treating this as release proof.
- DNS note: `0509.io` is the primary domain. `0509.in` is legacy redirect compatibility only and must not be used in product copy, emails, auth origin, SEO files, or new customer links.
