# Lane evidence — claim/issue-1857

Issue: Nishfleet/0509#1857 — Investigate and resolve 70 proof_capture skipped_due_to_budget

## What shipped

Two test files plus a canary-script extension. No production code changed.

### `tests/proof-capture-budget.test.ts` (node project, 21 tests)

Pins the unit-level surfaces and the canary query/validator:

1. **Proof policy** — both budget paths (per-plan monthly cap via
   `workspaceMonthlyAttemptCount >= workspaceMonthlyCap`, and the credit
   ledger via `workspaceEvidenceRemaining <= 0`) skip with
   `skipped_due_to_budget`; a paid watchlist with allowance left still
   captures.
2. **Run history** — `resolveProofCaptureRefusal` / `buildRunHistoryRefusalRows`
   turn every `skipped_due_to_budget` row over a 72h window into an explained
   refusal (human reason, no raw snake_case, no alert). A null `skip_reason`
   is still surfaced (the canary separately flags it silent).
3. **Evidence card** — `RecentEvidenceChecksCard` renders the budget-skip
   count, the human reason, and a "why this happened" link; `buildProofSummary`
   counts budget skips separately from rate-limit skips.
4. **Period triage** — `classifyWatchPeriodTriage` returns
   `evidence_skipped_budget` (never `all_quiet`) when a budget skip happened,
   so the digest cannot say "all quiet" while checks were dropped.
5. **Dashboard quota** — reads the real `getIncludedEvidenceAllowance` from
   `app/lib/plan-entitlements.ts` (Starter=250, Scout=50, Agency>Starter),
   not invented literals. At `includedUsed == includedAllowance` the
   warningLevel is "exhausted" and the dashboard copy is "250 of 250" / "0 left".
6. **Live canary** — `buildBudgetSkipSurfaceQuery` joins proof_capture →
   proof_target → watchlist → user_plan to classify the 70 rows by plan tier
   and timestamp; `mapBudgetSkipRows` / `validateBudgetSkipSurface` pass on
   the 70-row paid-tier scenario with no silent skips and fail on any silent
   paid-tier skip.
7. **Domain breakdown** — `buildBudgetSkipDomainBreakdownQuery` selects
   `pt.landing_page_url AS competitor_domain` and groups by it, so the 70-row
   investigation classifies by plan tier, competitor domain, and timestamp.
   `mapBudgetSkipDomainRows` surfaces null domains (legacy rows) rather than
   hiding them.

### `tests/integration/proof-capture-budget.integration.test.ts` (workers project, 3 tests)

The issue's acceptance (e): a real integration test against real D1 that
creates a paid-tier watchlist, exhausts its capture budget, and asserts the
failure is visible (not silent).

1. Seeds a Starter workspace (`user_plan.plan = 'starter'`), watchlist, run,
   and proof_target with `landing_page_url`.
2. Drives `evaluateProofPolicy` at the Starter monthly cap (250) — it skips
   with `skipped_due_to_budget`.
3. Persists a `proof_capture` row with that status and a non-null `skip_reason`.
4. `listCaptureAttemptsForRun` (the run-history read path) surfaces it with
   `reasonCode = "budget_skip"` and the competitor domain — never silent.
5. `classifyWatchPeriodTriage` reads the period as `evidence_skipped_budget`,
   never `all_quiet`.
6. A null `skip_reason` row is still surfaced (the canary flags it silent).
7. Multiple budget skips across competitor domains each surface in run history.

### `scripts/canary-proof-budget-skip-surface.mjs` (extended)

Added `buildBudgetSkipDomainBreakdownQuery` and `mapBudgetSkipDomainRows` —
the domain classification the issue's acceptance (a) names. Read-only query,
no DDL, no DML. Reuses the existing `proof_target.landing_page_url` column.

## No new machinery

- No D1 schema change (reuses existing `proof_capture.status` /
  `skip_reason` columns and `proof_target.landing_page_url`).
- No workflow edit, no gate-owned path edit.
- No new `bin/` file, no new organ. The tests reuse existing modules:
  `proof-policy.server`, `run-history-capture-visibility`,
  `watch-period-triage`, `watchlist-display`, `recent-evidence-checks-card`,
  `plan-entitlements`, `data/watchlist-run-capture-attempts.server`, and the
  existing `canary-proof-budget-skip-surface.mjs` script.

## Verification

```
npx vitest run --configLoader runner --project node tests/proof-capture-budget.test.ts
→ Test Files 1 passed (1), Tests 21 passed (21)

npx vitest run --project workers tests/integration/proof-capture-budget.integration.test.ts
→ Test Files 1 passed (1), Tests 3 passed (3)
```

Related suites still green:
`tests/canary-proof-budget-skip-surface.test.ts` → 16 passed.

`npm run typecheck` — no errors in the new files (pre-existing e2e/Playwright
type mismatches are unrelated and untouched).

## Reviewer round

Ran on the senior seat (cursor / cursor-grok-4.6-high). First pass raised
valid Act-on findings: the dashboard-quota cases were tautologies, the canary
query did not classify by competitor domain, and the issue's acceptance (e)
asked for a write-path integration test. All three were fixed: the dashboard
cases now call `getIncludedEvidenceAllowance`, the canary script gained
`buildBudgetSkipDomainBreakdownQuery`, and the workers-project integration
test seeds a paid watchlist + writes a skipped capture through the real
read path.
