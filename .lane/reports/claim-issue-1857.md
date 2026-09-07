# Lane evidence — claim/issue-1857

Issue: Nishfleet/0509#1857 — Investigate and resolve 70 proof_capture skipped_due_to_budget

## What shipped

`tests/proof-capture-budget.test.ts` — a `node`-project test (verify command:
`npx vitest run --configLoader runner --project node tests/proof-capture-budget.test.ts`)
that proves a paid-tier watchlist whose capture budget is exhausted never
loses a check silently. It ties together the four user-visible surfaces the
issue names:

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
5. **Dashboard quota** — the `proofUsage` shape (`getProofUsageSummary`)
   reports `warningLevel: "exhausted"`, `remaining: 0`, and the
   "X of Y proof captures used" / "0 left this month" copy the dashboard
   renders.
6. **Live canary** — `buildBudgetSkipSurfaceQuery` joins proof_capture →
   proof_target → watchlist → user_plan to classify the 70 rows by plan tier
   and timestamp; `mapBudgetSkipRows` / `validateBudgetSkipSurface` pass on
   the 70-row paid-tier scenario with no silent skips and fail on any silent
   paid-tier skip.

## No new machinery

- No D1 schema change (reuses existing `proof_capture.status` /
  `skip_reason` columns).
- No workflow edit, no gate-owned path edit.
- No new `bin/` file, no new organ. The test reuses existing modules:
  `proof-policy.server`, `run-history-capture-visibility`,
  `watch-period-triage`, `watchlist-display`, `recent-evidence-checks-card`,
  and the existing `canary-proof-budget-skip-surface.mjs` script.

## Verification

```
npx vitest run --configLoader runner --project node tests/proof-capture-budget.test.ts
→ Test Files 1 passed (1), Tests 16 passed (16)
```

Related suites still green:
`tests/monitoring/budget-skip-visibility.test.ts`,
`tests/run-history-capture-visibility.test.ts`,
`tests/canary-proof-budget-skip-surface.test.ts`,
`tests/watch-period-triage.test.ts` → 58 passed.

`npm run typecheck` — no errors in the new file (pre-existing e2e/Playwright
type mismatches are unrelated and untouched).
