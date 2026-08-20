# 0509.io — Five to Nine

## Agent operating model (Nish, 2026-07-19; revised 2026-08-06)

What separates is **duties, not identities**. The 2026-07-19 version assigned
roles by model — Claude reviews, Codex merges — which stopped matching how the
work is actually done: Claude now implements, reviews and lands changes here.
Naming models in a rule makes it go stale the moment the fleet changes, and a
stale rule gets argued with instead of followed. These are stated as duties so
they survive that.

The separations that matter, and why:

- **Nothing merges on its own author's say-so.** Every substantial change gets an
  independent review before merge — a different agent or Nish, never the author
  reviewing itself. This is the rule the other two exist to protect.
- **Builders do not land their own work.** A builder implements from a spec
  (`docs/PRODUCT-READINESS-SPEC-*` — anchor strings, acceptance criteria,
  guardrails) and stops at a pushed branch.
- **Production state stays gated regardless of who is asking.** Remote D1
  migrations, secrets, restore drills, and provider mutations need Nish's
  explicit authorization, recorded where it will outlive the session. Merging a
  reviewed PR is ordinary work; mutating production data is not.
- **Do not route around safe-deploy.** Headless agent sessions are fail-closed by
  the wrapper by design. If it blocks you, that is the control working — fix the
  cause or ask Nish, never bypass it.

Who may merge: anyone — Nish, Codex, or Claude — once the change has an
independent review and its checks are green. Do not merge over a failing or
pending required check, and never force-merge.

### Changing a protected verifier: the sole-admin attestation path

`.github/workflows/required-verifier-integrity.yml` blocks any PR that touches
a protected verifier definition — `ci.yml`, `secret-scan.yml`, the gate's own
workflow and scripts, and the production deploy-authorization chain
(`deploy-production.yml`, `finalize-production-soak.yml`,
`scripts/ci-verify-production-candidate.sh`,
`scripts/ci-verify-provider-main-cas.sh`) — unless the change is independently
approved. This repository has exactly one collaborator and GitHub forbids
approving your own pull request, so that requirement alone is impossible to
satisfy here.

Nish decided on 2026-08-20 to keep the gate and add a second, deliberately loud
remedy rather than allow self-approval. Two ways to unblock such a PR:

1. **Independent review (preferred).** A repository admin or maintainer other
   than the PR author submits an APPROVED review dated at or after the current
   head commit. This stays first-class and is tried first. The moment a second
   admin/maintainer exists on this repo, this becomes the only path to use and
   the attestation path should be deleted.
2. **Sole-admin attestation.** A repository **admin** posts a PR comment whose
   entire body is exactly:

   ```
   verifier-attest: <40-hex current head sha>
   ```

   Then re-run the `required-verifier-integrity` check.

Attestation rules worth knowing before reaching for it:

- Admin permission is verified through the collaborator-permission API, not
  from the comment or its `author_association`. `maintain` is not enough.
- The sha must equal the PR's **current** head sha. Pushing any new commit
  invalidates the attestation, exactly as it dismisses a stale approval — post
  a fresh one against the new sha.
- The body must match exactly. A comment that merely mentions the phrase in
  prose does not attest.
- Using it is never quiet: the job prints a `::warning::` annotation and writes
  a job-summary entry naming the attesting admin, the sha, and the fact that no
  independent reviewer saw the change. That record is the point — it is what
  makes this different from a `gh pr merge --admin` bypass, which leaves
  nothing behind.

Prefer remedy 1 whenever a second reviewer exists. Remedy 2 is a
single-collaborator accommodation, not a shortcut.

Deploy-gate e2e (Gate-B journeys, restore-evidence) is Codex-owned; product
changes that alter public copy/states require the gate specs to be updated in the
same landing sequence.

History: `docs/PROJECT-HISTORY.md`.

## Build
```bash
npm run build
npm test
npm run typecheck
```

**`npm run typecheck` is the only real type gate. `tsc --noEmit -p tsconfig.json` is a
no-op here and will pass on anything.** `tsconfig.json` is `"files": []` plus two project
references, so without `-b` it type-checks zero files and exits 0. `npm run typecheck` is
`cf-typegen && react-router typegen && tsc -b`, which is what CI's `codex-node-checks` runs
— the generated `worker-configuration.d.ts` and route types only exist after those first two
steps. PR #552 shipped a `verify:` line claiming `npx tsc --noEmit -p tsconfig.json → clean`
and CI failed it on a `TS2339` in the same diff. A gate that cannot go red is a missing gate,
not a weak one: never cite `tsc --noEmit -p tsconfig.json` as type evidence.

On the shared VPS, fleet and self-hosted-runner verification must use
`scripts/deploy-window-lock.sh run -- <command>` rather than calling `flock`
directly. The wrapper provides three bounded, temp-isolated verification lanes;
production `acquire`/`release` remains exclusive.

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
- `app/components/search/result-row.tsx` — `SearchResultRow`, one `/search` result as a `RuledRow` in the landing language (BL-031; replaced the bordered `result-card.tsx`). The creative, angle, offer, destination and language live in the detail pane; demo results state `Sample` in the row's status cell and cannot be quick-saved
- `app/lib/watchlist-route-loader.server.ts` / `app/lib/watchlist-route-actions.server.ts` — the `/app/watchlists` loader and action, moved out of the route verbatim (BL-007) so the route file stays under the 800-line ceiling; the route re-exports them as `loader` / `action`
- `app/lib/watchlist-detail-tabs.ts` / `app/lib/watchlist-detail-display.ts` — URL-addressable competitor detail tabs (What changed · Evidence · Creative · Delivery · Setup) and the detail's pure presentation (status-strip cells, fact rail, delivery lines, one hard-failure count shared with the board)
- `app/lib/watchlist-display.ts` — pure watchlist presentation/formatters (scan presentation, empty-event copy resolvers, run status/timing labels, delivery-channel visibility, proof summaries) extracted from `app/routes/app.watchlists.tsx`; the route re-exports the test-facing resolver names
- `app/components/watchlists/` — presentational pieces of the watchlists route (FirstScanBanner, BulkSelectBar, DeliverySettingsCard, DeliveryTargetsSection, RecentChecksSection, RecentEvidenceChecksCard, CandidateHistory, EventChangesSection, CompetitorDetail, DetailTabBar, CompetitorRail, WatchlistSetupCard, WatchlistProofAge). All are read-only over loader data + scalar plan flags — props threaded explicitly, no context. `WatchlistProofAge` is re-exported from the route for its hydration test

## Current Phase: Pre-Commercial-Launch Hardening

The checked-in Cloudflare app is the active production runtime and billing is wired:

- onboarding, collections, watchlists, digests, reports, share/export flows, customer API keys, and MCP endpoint exist in `app/`
- **billing IS live via Dodo Payments**: `api.billing.dodo.checkout.ts` redirects to hosted checkout; `api.webhooks.dodo.ts` is signed, replay-windowed, monotonic, and idempotent. Failed/on-hold subscriptions retain the plan as dunning grace; cancelled/expired subscriptions and successful refunds revoke it. `/app/billing` shows plan, usage, and cancellation guidance and blocks double subscriptions. Do not describe billing as "not live."
- Dodo returns to `/app/billing?checkout=dodo`, which renders a checkout-return notice that polls plan activation ~20x every 3s (`CheckoutReturnNotice` in `app/components/checkout-return-notice.tsx`, rendered on the billing page)
- support contact is `support@0509.io` (`app/lib/support.ts`), surfaced on marketing footer, app sidebar, /terms, /privacy, /unsubscribe, and email footers; inbound routing is Cloudflare Email Routing (dashboard-configured)
- Dodo is the only active billing processor. Stripe was never wired; tests assert no Stripe route exposure.
- region-aware pricing was REMOVED in `migrations/0016_drop_region_pricing.sql`; pricing is live-loaded from Dodo (`app/lib/dodo-pricing.server.ts`, `/api/pricing-preview`)
- plan gating is enforced at creation time (`checkPlanLimit`), on manual refresh (free plan blocked), on watchlist resume, and on downgrade/revocation/refund (over-limit watchlists auto-pause, newest kept); authenticated live search is rate-limited per account (60/10min)
Current GA posture: Email is the verified delivery lane; WhatsApp and Slack are dormant/non-GA customer channels; Workflow-based monitoring fan-out is live in prod (`MONITORING_FANOUT_MODE=fanout`, max 8 in-flight).

Audit-program, incident, and verification history: `docs/PROJECT-HISTORY.md`.

## Production Reality

- `https://0509.io`, `https://www.0509.io`, and `https://api.0509.io` are the primary production domains for the current Cloudflare app under `app/` and `workers/`.
- **Deploys go through CI, not your terminal.** Every push to `main` auto-deploys through `.github/workflows/deploy-production.yml`, which runs typecheck, full tests, restore-evidence materialization, `npm run deploy`, and release-evidence verification. Do not run `npm run deploy` locally for routine ships. Local deploy is break-glass only when Actions is down and no CI deploy is in flight. Full gate sequence and incident history: `docs/PROJECT-HISTORY.md`.
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
- Prod schema changes go through ONE door: a numbered file in `migrations/` applied with `npx wrangler d1 migrations apply 0509 --remote`. Never run DDL via `wrangler d1 execute --remote`. `npm run deploy` enforces migration sync through `scripts/check-d1-migrations-synced.mjs`; only migrations explicitly listed in `POST_DEPLOY_CLEANUP_MIGRATIONS` may trail, and that allowlist is currently empty. Incident history: `docs/PROJECT-HISTORY.md`.

## Design System

See `DESIGN.md` in the repo root for the canonical design reference. The picked aesthetic is **Vercel** (from the awesome-design-md collection). Read `DESIGN.md` before any UI work and align styling decisions with the documented patterns: color palette, typography, spacing, shadows, radii, component shapes.

Per Nish's "delightmaxxing >>>>>" preference (2026-04-06): do not ship generic AI-default styling. If a UI change can be more delightful, more polished, or more consistent with Vercel's aesthetic, take the extra time to do it.

Source: https://github.com/VoltAgent/awesome-design-md

## Backlog

Current backlog: `docs/BACKLOG.md`.
