# Five to Nine Launch Readiness

Last checked: 2026-05-15

## Current Verdict

Five to Nine is ready for a narrow paid pilot, not a broad public launch.

The app has real product surface: public search, authenticated workspace, watchlists, collections, daily briefs, weekly digests, reports, share/export flows, operator health, region-aware pricing display, Razorpay subscription scaffolding, and proof-first monitoring infrastructure.

The broad-launch blockers are Resend domain verification, Razorpay production setup, and enough production evidence that fresh discovery, proof capture, and digest delivery stay reliable.

## Live Blockers Found On 2026-05-15

- `npm run canary:prod` passes health and fresh-live bypass, but fails ops readiness with `no_recent_proof_capture` and `no_recent_digest_sent`.
- The private digest canary is pinned to `LAUNCH_CANARY_EMAIL=me@inish.in`, but Resend rejects delivery because `0509.in` is not verified in Resend.
- The live Resend API key is send-only; it cannot create or verify the domain through `/api/ops/resend-domain`.
- Remote D1 migrations are fully applied; `user_plan`, `razorpay_webhook_event`, and `rate_limit_events` tables/columns exist.
- Remote Worker secrets are missing all Razorpay keys and plan IDs, so checkout is still not live.
- The platform `META_AD_LIBRARY_TOKEN` is expired. Remote provider state shows it expired on 2026-04-19 and the browser path is currently `cache_only` / `empty_result` with repeated login-wall or empty extraction failures.
- `npm run provider:bakeoff:launch -- --provider current_0509 --query nykaa` now returns fresh live Ad Library results after the text-card extractor fix, but Meta ads tracking remains beta until the production success window clears the historical failures.

## Hard Launch Gates

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- `CANARY_BYPASS_TOKEN` is set locally and as a Worker secret.
- `npm run canary:prod` reports Meta ads tracking as `meta ads beta: ok` or `meta ads beta: needs proof`; beta uncertainty is not hidden.
- Meta ads beta graduation requires enough live samples, at least 95% seven-day success, a fresh live success in the last 24 hours, no recent failures, and a healthy visual capture path.
- `npm run canary:prod` also passes the private launch-readiness endpoint: recent successful monitoring, recent proof capture, and at least one recently sent digest.
- `npm run provider:bakeoff:launch` is green for `current_0509`, proving the public app path returns fresh live Ad Library results before Meta ads can leave beta.
- `npm audit --omit=dev --audit-level=moderate` passes.
- Privacy and terms pages are present in the active React Router app.
- Public copy does not claim live checkout, verified WhatsApp delivery, SOC 2, HIPAA, GDPR, zero retention, no training, or unverified model/provider behavior.
- Pricing is framed as pilot pricing until Razorpay test-mode checkout, signed subscription webhooks, and live secrets are verified.
- Auth runtime stays on Better Auth + D1 unless a future B2B auth requirement justifies Stytch.
- Meta ads tracking is labeled beta in customer-facing setup/status surfaces until discovery resilience is proven.
- Customer-facing Meta API fallback uses customer-owned Meta access. Customer tokens are test-before-save and stored encrypted. The platform `META_AD_LIBRARY_TOKEN` stays diagnostic-only unless `ALLOW_PLATFORM_META_API_FALLBACK=true` is deliberately configured as an exception.

## What Customers Expect

- Daily reminders with proof-backed changes.
- Competitor website changes with snapshots.
- New and current competitor ads.
- New competitors where a watchlist/search surface proves them.
- New product additions where the monitored page exposes that signal.
- Price changes and discount changes.

## 11/10 Additions Now In The Product Contract

- Priority score for each change.
- What to do next recommendation for each change.
- Weekly competitor movement summary in digest/share views.
- Client-ready share snapshot and PDF print path.
- Human-readable proof trail: source, timestamp, confidence, and captured diff where available.

## Pilot-Safe Offer

Use this framing until the fresh discovery canary passes:

> Five to Nine helps growth teams turn competitor ad checks into proof-backed monitoring. Search stays public. Pilot workspaces save queries, track changes, label source status honestly, and prepare email-first proof reports.

## Not Ready To Claim

- Broad self-serve launch.
- Live checkout or automatic subscription management until Razorpay plan ids, secrets, D1 migration, and signed webhooks are verified in test mode.
- Non-beta Meta ads tracking before the beta graduation gate says it is ready to review.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- Untested customer Meta tokens. Customer token paste is allowed only through the guarded setup flow: test first, store encrypted, and keep Meta ads tracking labeled beta.
- Compliance, retention, or vendor-data guarantees beyond what has been reviewed and verified.

## Recommended Next Slice

Fix fresh discovery reliability or choose a commercial data provider. The launch gate should stay red until `npm run canary:prod` passes against `https://0509.in` without stale monitoring/proof/digest signals, and Meta ads should stay beta until `npm run provider:bakeoff:launch` proves fresh live discovery without cached/degraded/demo source status.
