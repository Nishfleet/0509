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
- Root cause: commercial surfaces were split across public pricing, checkout routes, onboarding, and billing usage. Signed-in customers could hit public pricing paths, annual billing had no fresh Dodo validation proof, and billing did not yet feel like the canonical in-app plan picker.

## Decisions

- Dodo checkout preview remains the pricing source of truth.
- Monthly, annual, and top-up checkout all fail closed unless the selected safe internal SKU validates through fresh Dodo preview.
- The public `4 months free` claim is a Five to Nine business validation: annual amount must equal eight monthly periods in the same Dodo pricing context.
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
- Kept workspace readiness available to any active customer API key as a read-only diagnostic endpoint, while export/action endpoints still require their paid feature gates.
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
- Dodo pricing canary: upgraded and intentionally strict. It currently fails against production because production has not deployed this branch and does not return `annualValidation`; it also cannot pass branch-local live preview on this machine because this worktree does not have Dodo API/product bindings. This is a post-branch-deploy gate, not proof to waive.
- Dodo billing canary: passed for plan webhook, proof-credit webhook, and cleanup.
- Proof canary: passed.
- Production readiness canary: passed.
- Provider bakeoff launch check: passed for the current 0509 provider path; alternate providers skipped due missing provider tokens.
- Presence pilot canary: passed.
- Presence website canary: failed because `PRESENCE_INTERNAL_WORKSPACE_ID` is not present in the available environment.
- D1 backup validation: passed.
- Local and remote D1 migration lists: passed with no pending migrations.
- Autoreview: found and fixed retryable `payment.failed` checkout-lock classification, cancelled-checkout retry copy mismatch, checkout-session fees-inclusive parity, pending-checkout CTA state, dashboard member readiness context, checkout-id gating for `subscription.failed`, Dodo-return pending-banner conflict, active-subscription `subscription.failed` payment-issue preservation, stale free-plan billing intervals, Dodo preview billing-country mismatch handling, Dodo-return false plan-success confirmation, no-checkout-id terminal failure cleanup, guarded checkout-id-or-missing-id terminal cleanup, missing-stored-id-only no-id terminal cleanup, short-window legacy monthly plan-return compatibility, UUID-backed no-id terminal checkout cleanup, and filtered-preview cache completeness. Final staged rerun clean with no accepted/actionable findings.
- CE code review: final targeted correctness and agent-native findings accepted and fixed.
- Bugbot/Cursor review: accepted fixes are included for billing preview country parity, signed no-id terminal checkout cleanup, `subscription.failed` pending-lock cleanup, false plan-return success, pending checkout-id cleanup, stale legacy return success, stale no-id cleanup, UUID-backed no-id terminal cleanup, and filtered-preview cache completeness.
- Staged diff check: passed.

## Remaining Required Gates

- CE code review synthesis and accepted fixes: completed.
- Autoreview rerun on the final diff: completed clean.
- Strict Dodo pricing canary against a branch deployment with real Dodo bindings: pending.
- Presence website smoke with `PRESENCE_INTERNAL_WORKSPACE_ID`: pending.
- Search V2 dogfood or equivalent production-safe smoke: pending if required as a separate launch sign-off beyond the completed provider bakeoff and proof canaries.
- Bugbot/Cursor review: accepted findings fixed; final PR head remains subject to protected branch checks after push.
- Protected PR, CI, merge, merged-main validation, deploy, production smokes, Worker rollback version, and docs-only provenance PR: pending.

## Payments Tested

- Provider fixture and signed webhook coverage: plan grant, subscription lifecycle, top-up grant, refund, duplicate/terminal checkout failure, retryable failure, and lock cleanup covered by tests/canaries.
- Live/customer payment completion: not performed; no real customer card or subscription was used.
- Owner/manual payment action: none recorded yet.
- Monthly checkout: covered by route tests, checkout-return tests, and the upgraded pricing canary contract, but branch-deployed live Dodo preview proof remains pending with real Dodo bindings.
- Annual checkout: covered by route tests and the upgraded pricing canary contract, including `4 months free` validation, but branch-deployed live Dodo preview proof remains pending with real Dodo bindings.

## Deployment

- Deployment status: not deployed yet.
- Runtime commit: pending protected PR merge.
- Worker version: pending deployment.
- Rollback Worker version: pending pre-deploy capture.

## Owner Actions

- None currently known for monthly checkout.
- Annual checkout owner action is required only if the branch-deployed strict pricing canary shows a live Dodo annual SKU that fails the `4 months free` validation.
