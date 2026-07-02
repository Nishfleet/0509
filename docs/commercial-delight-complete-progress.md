# Commercial Delight Complete Progress

Date: 2026-07-01

## Purpose

Track the customer-facing commercial-delight release from staged implementation through PR, protected merge, deployment, canary proof, and rollback notes. This file is durable release provenance; it must not include secrets, provider payloads, customer data, internal product IDs, webhook URLs, or payment identifiers.

## Branch

- Branch: `codex/commercial-delight-complete-20260701`
- Baseline: local `main`, `origin/main`, and branch HEAD matched at `ac5ffd88e04ef8adeee62a12a5b90dd963c9040f` before the staged patch.
- Pre-work patch: `../pre-commercial-delight-complete.patch` exists and is empty because the starting worktree matched HEAD.

## Audit

- Audit artifact: `docs/commercial-delight-complete-audit.md`
- Implementation plan: `docs/plans/2026-07-01-001-feat-commercial-delight-complete-plan.md`
- Root cause: commercial surfaces were split across public pricing, checkout routes, onboarding, and billing usage. Signed-in customers could hit public pricing paths, plan checkout needed fresh Dodo validation proof for both monthly and annual billing, and billing did not yet feel like the canonical in-app plan picker.

## Decisions

- Dodo checkout preview remains the pricing source of truth for monthly, annual, and top-up checkout.
- Monthly, annual, and top-up checkout each fail closed unless the selected safe internal SKU validates through fresh Dodo preview.
- Annual checkout has one additional Five to Nine business validation: the public `4 months free` amount must equal eight monthly periods in the same Dodo pricing context.
- Monthly checkout parity is required anywhere annual checkout is mentioned: route tests, return handling, and the pricing canary must prove both cycles.
- Agency checkout remains held unless the existing commercial launch gate opens it.
- Workspace members can view owner billing usage, but only the workspace owner can start checkout, buy top-ups, or open billing settings.
- Dodo checkout returns land in `/app/billing`.

## Implementation Summary

- Added localized Dodo preview helpers and annual validation display helpers.
- Converted public and in-app pricing to monthly/annual plan selection with annual validation copy.
- Made `/app/billing` the authenticated plan picker, billing-cycle chooser, top-up buying surface, checkout return surface, and member read-only billing view.
- Added checkout cancel handling that returns users to `/app/billing` without trusting unsigned browser returns to clear billing locks.
- Routed authenticated plan, limit, onboarding, dashboard, account, search, and top-up CTAs into `/app/billing` instead of the public homepage.
- Preserved signed-out public pricing intent through safe app billing redirects.
- Hardened plan checkout locks with an internal checkout id so stale terminal checkout events cannot clear newer pending checkouts.
- Hardened subscription/payment ordering so subscription-first activation does not preserve temporary checkout ids and payment-first annual activation can recover the trusted SKU metadata.
- Kept retryable Dodo payment failures out of checkout-lock cleanup.
- Narrowed checkout-failure extraction so typed `payment.failed` retry signals never clear pending checkout locks.
- Kept matching pending-lock cleanup on signed terminal Dodo webhook events and server-side checkout-session creation failure.
- Matched top-up return confirmation by provider payment id when present, instead of accepting older same-SKU grants.
- Moved the checkout return notice into a small component for route size and reuse.
- Added structured billing and proof-usage state to workspace readiness so API and MCP consumers can read the same billing state the UI uses.
- Kept workspace readiness available to active Agency customer API keys as a read-only diagnostic endpoint, while export/action endpoints still require their paid feature gates.
- Added redacted top-up grant rows and member/owner billing context to workspace readiness without provider payment ids or customer ids.
- Matched checkout-session creation to the same Dodo adaptive-currency fees-inclusive setting used by preview validation.
- Disabled plan checkout CTAs from billing state while a pending Dodo checkout lock exists, not only after an `already-started` redirect.
- Passed member/owner billing context into dashboard workspace readiness as well as API/MCP readiness.
- Required `subscription.failed` checkout-failure events to carry a checkout id and clear an actual pending checkout before they can consume the terminal-checkout path; otherwise active paid subscriptions keep the payment-issue warning.
- Suppressed the generic pending-checkout warning on `checkout=dodo` return pages so webhook-confirmation copy is not contradicted.
- Strengthened onboarding copy around `Paste your competitors` and kept plan-required flows inside the app.
- Moved the Market Desk Brief above lower-priority readiness panels on Overview.
- Added logged-in polish for plan cards, dashboard, empty states, progress, top-ups, and motion-safe interactions.
- Upgraded the Dodo pricing canary so it must see sale-open Scout/Starter monthly and annual prices with matching currency/country context, all public top-up pack prices, plus annual validation equal to eight monthly periods in the same pricing context.
- Fixed final Bugbot regressions so signed no-id terminal failures can clear the current UUID-backed pending checkout by provider timestamp without clearing newer locks, and filtered Dodo country-mismatch previews cannot seed a partial pricing cache for monthly, annual, or top-up surfaces.

## Verification

- Focused Bugbot regression tests: passed, 3 files / 109 tests.
- Focused commercial billing/API/checkout/webhook/data tests after final Bugbot fixes: passed, 14 files / 262 tests.
- Full unit/integration tests: passed, 161 files / 1583 tests.
- Typecheck: passed.
- Production build: passed.
- Local authenticated browser E2E: passed, 9 tests, including mobile billing cycle selection and overflow checks.
- Public preview browser E2E: passed, 5 tests, including signed-out monthly and annual pricing intent with mocked preview data.
- Production public E2E: passed, 3 tests with 2 preview-only tests skipped until branch deployment.
- Deployed production Dodo pricing canary: reached live Dodo and passed monthly/top-up availability for IN, US, and GB. The initial post-deploy annual canary failed because the Dodo annual product prices did not equal monthly x 8 in the checked pricing contexts; the follow-up Dodo provider repair now has annual Scout/Starter passing in IN, US, and GB.
- Dodo billing canary after deploy: passed for plan webhook, proof-credit webhook, and cleanup.
- Proof canary after deploy: passed.
- Production readiness canary after deploy: passed for `0509.io`, `www.0509.io`, `api.0509.io`, fresh-live bypass, ops readiness, and Meta Ads beta.
- Provider bakeoff launch check after deploy: passed for the current 0509 provider path across `nykaa`, `boat`, `mamaearth`, `swiggy`, `zomato`, and `meesho`; alternate providers skipped due missing optional provider tokens.
- Presence pilot canary after deploy: passed, 4 files / 38 tests.
- Presence website canary after deploy: initially blocked by stale internal-rollout harness requirements; follow-up GA-aware canary passed, 4 files / 33 tests including GA rollout coverage.
- Production public E2E after deploy: passed, 3 tests with 2 preview-only tests skipped.
- Production authenticated E2E after deploy: passed with fresh local internal-account auth state, including Overview, Account, Billing, Watchlists, Presence, Notifications, and Support.
- D1 backup validation: passed.
- Local and remote D1 migration lists: passed with no pending migrations.
- Autoreview: found and fixed retryable `payment.failed` checkout-lock classification, cancelled-checkout retry copy mismatch, checkout-session fees-inclusive parity, pending-checkout CTA state, dashboard member readiness context, checkout-id gating for `subscription.failed`, Dodo-return pending-banner conflict, active-subscription `subscription.failed` payment-issue preservation, stale free-plan billing intervals, Dodo preview billing-country mismatch handling, Dodo-return false plan-success confirmation, no-checkout-id terminal failure cleanup, guarded checkout-id-or-missing-id terminal cleanup, missing-stored-id-only no-id terminal cleanup, short-window legacy monthly plan-return compatibility, UUID-backed no-id terminal checkout cleanup, and filtered-preview cache completeness. Final staged rerun clean with no accepted/actionable findings.
- CE code review: final targeted correctness and agent-native findings accepted and fixed.
- Bugbot/Cursor review: accepted fixes are included for billing preview country parity, signed no-id terminal checkout cleanup, `subscription.failed` pending-lock cleanup, false plan-return success, pending checkout-id cleanup, stale legacy return success, stale no-id cleanup, UUID-backed no-id terminal cleanup, and filtered-preview cache completeness.
- Staged diff check: passed.

## Remaining Required Gates

- CE code review synthesis and accepted fixes: completed.
- Autoreview rerun on the final diff: completed clean.
- Strict Dodo pricing canary against production with real Dodo bindings: completed after the Dodo provider repair; monthly, annual, and top-up prices validate in IN, US, and GB.
- Presence website smoke under current GA rollout: completed.
- Production authenticated E2E with internal account state: completed.
- Search V2 dogfood or equivalent production-safe smoke: completed via provider bakeoff launch check.
- Bugbot/Cursor review: accepted findings fixed; final PR head had no new final-push comments and Bugbot completed neutral/skipped.
- Protected PR, CI, merge, merged-main validation, deploy, production smokes, and Worker rollback version: completed.
- Follow-up proof-gate PR #271 and production deploy: completed.

## Payments Tested

- Provider fixture and signed webhook coverage: plan grant, subscription lifecycle, top-up grant, refund, duplicate/terminal checkout failure, retryable failure, and lock cleanup covered by tests/canaries.
- Live/customer payment completion: not performed; no real customer card or subscription was used.
- Owner/manual payment action: Dodo Scout/Starter monthly and annual pricing was corrected through Dodo's documented by-currency localized pricing flow before annual checkout was called live.
- Monthly checkout: covered by route tests, checkout-return tests, and deployed live Dodo pricing canary proof in IN, US, and GB.
- Annual checkout: covered by route tests and deployed live Dodo pricing canary proof. Dodo now serves Scout/Starter annual prices that validate as `4 months free` in IN, US, and GB.
- Dodo plan changes: redacted Dodo API verification confirms the Five to Nine Product Collection groups Scout/Starter monthly and annual products, and the app now uses Dodo's documented subscription plan-change preview/change endpoints for owner-only in-app switching. Remaining provider proof is an internal subscription smoke plus cancellation availability from the hosted portal.

## Deployment

- Deployment status: deployed to production on 2026-07-01 after PR #271.
- Runtime merge commit: `9bef0c3f0a6778abda4739c7abc4ab029f7fc764`.
- Commercial feature head commit merged by PR #269: `c858855254ccc2bdd2e3f5dd64da21ef4aefded6`.
- Proof-gate follow-up head commit merged by PR #271: `e11a50b703ad99643aa06da6222d01169056c0ec`.
- Worker deployment: `ad02524f-866a-4ef8-b2b6-d58040e94679`, serving version `cab91367-2fe1-46df-845e-33ec104186c2` at 100%.
- Rollback Worker deployment: `f2b89e7a-cdf1-4f17-9cd3-dc5ec1d7731f`, serving version `bbd9c75c-84ff-4c2b-a1ca-5a36a93931c9` at 100% before the PR #271 deploy.
- Deploy script checks: public-home source/current, D1 sync, production build, Wrangler deploy, live public-home, and Google OAuth branding guard all completed. Google OAuth branding check skipped because the provider is hidden/disabled.
- Post-PR #271 production checks: Presence website canary passed, authenticated production smoke passed with fresh local internal-account auth state, billing canary passed, proof canary passed, production surface canary passed, and Dodo pricing canary reached live Dodo. After the Dodo provider repair, monthly, annual, and top-up pricing validate in IN, US, and GB.

## Owner Actions

- None currently known for monthly checkout.
- None currently known for annual Scout/Starter checkout after the Dodo localized pricing repair.
