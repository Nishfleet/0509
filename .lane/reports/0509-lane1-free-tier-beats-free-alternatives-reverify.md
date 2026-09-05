# Free tier beats the free alternatives — already resolved on main by PR #642 / PR #763

**Status: already resolved; this lane records the evidence only. No product
code touched.**

Branch: `0509-lane1-free-tier-beats-free-alternatives-reverify`
Base: `origin/main` at `59243e7f` (#799)
Pull requests: https://github.com/Nishfleet/0509/pull/642, https://github.com/Nishfleet/0509/pull/763

## Item

- [ ] Free tier must beat the free alternatives — instant first scan + 1 real
      proof-backed brief, no card; honest 1-coll

## Verdict

The item is **already implemented and merged on `origin/main`**. No new PR is
warranted. The accepting PRs are present in `git log` and verified against the
live tree:

- **PR #642** — `52830fe0` "Merge pull request #642 from
  Nishfleet/feat/free-tier-beats-free-alternatives", merged 2026-08-20 by
  Nish. The merge commit is a follow-up reconciliation that resolves the
  landing-page release conflict on `app/routes/app.dashboard.tsx`; the full
  feature diff was introduced by PR #763.
- **PR #763** — `2c4d3e0b` "Merge pull request #763 from
  Nishfleet/feat/lane1-free-tier-beats-free-alternatives", merged earlier
  2026-08-17. Carries the four implementation commits (`29b058f2`,
  `c879262e`, `aae36712`, `2db4214e`) that add the free-tier upgrade.
- All four commits are ancestors of the current `origin/main` HEAD
  `59243e7f` (verified with `git merge-base --is-ancestor` in this worktree).

## Acceptance mapping (the item is satisfied on main)

The item's four commitments are live on origin/main:

| Commitment | Where it lives on main | Tests |
|---|---|---|
| **Instant first scan** | `app/lib/plan-entitlements.ts` free plan: `watchlists: 1`, `scheduledScanCadence: "weekly"` driven by the activation scan on watchlist creation (existing `queueFirstWatchlistScan` / `dispatchFirstWatchlistScanWorkflow` path). The free activation result email (`app/lib/delivery-account-emails.server.ts`) only claims a proof-backed brief when a confirmed event carries a `proofCaptureId`. Daily proof cap for free is `1` so the activation capture is not starved (`app/lib/monitoring.server.ts`). | `tests/free-activation-observability.test.ts` and `tests/free-weekly-watch.test.ts`. |
| **1 real proof-backed brief** | `app/lib/plan-entitlements.ts` free plan: `includedEvidenceChecksPerMonth: 1`, `digestCadence: "weekly"`. `app/lib/evidence-usage-period.server.ts` persists a real calendar-month period for the free branch (allowance 1) instead of a zero-allowance placeholder, so `reserveEvidenceCheck` can grant the free check. | `tests/plan-entitlements.test.ts`, `tests/free-activation-observability.test.ts`. |
| **No card** | Signup is magic-link only via Better Auth (`auth.signup.tsx` → `sendBetterAuthMagicLink`). No card form exists on the Free flow anywhere in the repo; the Free plan is not in `PLAN_FAMILIES.filter((plan) => plan !== "free")` in `app/lib/pricing.ts`, so Dodo checkout never runs for free. | `tests/auth-form-signup-guidance.test.ts`, `tests/auth-signup-structured-data.test.ts`. |
| **Honest 1-coll** | `app/lib/plan-entitlements.ts` free plan: `collections: 1`. Surface copy is honest: `app/components/result-quick-save.tsx` carries the explicit comment "Free includes 1 Collection (honest 1-coll)"; a free user with their 1 Collection saves like paid users; a free user without one gets a "create your free Collection first" note that opens the Library instead of an upgrade wall. The marketing pricing-note and the signup story column both state "1 Collection" and "No card required." | `tests/plan-entitlements.test.ts`, `tests/billing-page.route.test.ts`, `tests/collections-atomicity.test.ts`, `tests/collections-ia.test.tsx`, `tests/digest-plan-controls.test.ts`. |

The plan-entitlements file's own doc comment is now literally the item name:

> // Free tier (PLG wedge): beats the free alternatives (Meta Ad Library,
> // MagicBrief free) with an instant first scan, a weekly brief that is
> // genuinely proof-backed once a month, and one real Collection — no card.

## Verification run (this lane, on this branch off origin/main)

```
$ env -u NODE_ENV npx vitest run tests/plan-entitlements.test.ts tests/free-weekly-watch.test.ts tests/free-activation-observability.test.ts
 Test Files  3 passed (3)
      Tests  19 passed (19)

$ env -u NODE_ENV npx vitest run tests/auth-form-signup-guidance.test.ts tests/auth-signup-structured-data.test.ts tests/marketing-nav.test.ts tests/collections-atomicity.test.ts tests/collections-ia.test.tsx tests/digest-plan-controls.test.ts
 Test Files  6 passed (6)
      Tests  66 passed (66)

$ env -u NODE_ENV npx vitest run tests/plan-limits.route.test.ts tests/plan-feature-enforcement-matrix.test.ts tests/plan-monitoring.test.ts tests/plan.server.test.ts
 Test Files  4 passed (4)
      Tests  55 passed (55)

$ env -u NODE_ENV npx vitest run tests/billing-page.route.test.ts
 Test Files  1 passed (1)
      Tests  56 passed (56)

$ env -u NODE_ENV npx tsc --noEmit -p tsconfig.json
(no output — typecheck silent pass)
```

Total: **14 test files / 196 tests passing** on the free-tier-relevant and
plan-enforcement surface, plus a clean typecheck. The relevant feature surfaces
(marketing copy, signup story, plan entitlements, result-quick-save, evidence
usage period, collections, free activation email, free weekly watch) are all
covered by pinned tests on origin/main.

## Why no new PR was opened

The packet requires landing the item or reporting plainly why it cannot be
done. The item is already landed on `origin/main` via PR #642 / PR #763. The
follow-up pattern in this lane set (see the reports in `.lane/reports/`) is
"open a re-verification report when the item is already resolved" rather than
fork the work with a duplicate PR. Opening a second PR that re-implements an
already-shipped feature would conflict with the existing merged PRs and
re-introduce the four commits it just shipped. The productive action is to
record the evidence, which is exactly what this report does.

## Files

- `.lane/reports/0509-lane1-free-tier-beats-free-alternatives-reverify.md` —
  this evidence record (the only file touched by this lane).
- `/home/nish/workspaces/agent-state/lanes/0509/lane-1.json` — lane claim
  list updated to the single relative path of this report.

No product code, data, billing, or test files were modified by this lane.

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
