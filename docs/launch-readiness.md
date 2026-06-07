# Five to Nine Launch Readiness

Last checked: 2026-06-04

## Current Verdict

Five to Nine is ready to onboard the first paid customer.

The app has real product surface: public competitor website search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo local-pricing preview/checkout, Postmark email delivery, and proof-first monitoring infrastructure.

No first-customer onboarding blocker was found in the 2026-06-04 production pass. Meta ads tracking still stays labeled beta until the historical reliability gate graduates.

## Live Evidence From 2026-06-04

- `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=moderate` pass.
- Production health passes on `https://0509.in`, `https://www.0509.in`, and `https://api.0509.in`.
- `npm run canary:prod` passes health, fresh-live bypass, ops readiness, and current Meta ads beta checks.
- `npm run provider:bakeoff:launch` proves fresh live Ad Library results through the current 0509 path.
- A fresh private launch-readiness canary captured browser-rendered proof and sent a Postmark email digest.
- A fresh disposable customer flow passed: account creation, paid unlock via signed Dodo webhook canary, onboarding watchlist creation, competitor website watch setup, watchlist edit, delivery target add, refresh, and share page.
- Dodo checkout creation works for a fresh account and returns a hosted Dodo checkout URL before payment.

## Hard Launch Gates

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- `CANARY_BYPASS_TOKEN` is set locally and as a Worker secret.
- `npm run canary:prod` reports Meta ads tracking as `meta ads beta: ok` or `meta ads beta: needs proof`; beta uncertainty is not hidden.
- Meta ads beta graduation requires enough live samples, at least 95% seven-day success, a fresh live success in the last 24 hours, no unrecovered recent failures, and a healthy visual capture path.
- `npm run canary:prod` also passes the private launch-readiness endpoint: recent successful monitoring, recent proof capture, and at least one recently sent digest.
- `npm run provider:bakeoff:launch` is green for `current_0509`, proving the public app path returns fresh live Ad Library results before Meta ads can leave beta.
- `npm audit --omit=dev --audit-level=moderate` passes.
- Privacy and terms pages are present in the active React Router app.
- Public copy does not claim verified WhatsApp delivery, SOC 2, HIPAA, GDPR, zero retention, no training, or unverified model/provider behavior.
- Public pricing display comes from Dodo local-price preview. Dodo checkout creation and signed webhook grant canaries must remain green.
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

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website checks into proof-backed monitoring. Enter a competitor website, find the matching Meta ads, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Non-beta Meta ads tracking before the beta graduation gate says it is ready to review.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- Untested customer Meta tokens. Customer token paste is allowed only through the guarded setup flow: test first, store encrypted, and keep Meta ads tracking labeled beta.
- Compliance, retention, or vendor-data guarantees beyond what has been reviewed and verified.

## Recommended Next Slice

Keep onboarding narrow, watch production events during the first customer setup, and keep Meta ads labeled beta until the seven-day success window clears the historical failures or newer live success proves recovery.
