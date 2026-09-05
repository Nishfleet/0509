## What changed

**Root-cause** (`accept 1`): `skipped_due_to_budget` is set in `app/lib/proof-policy.server.ts` (`evaluateProofPolicy`) from three expected budget guards — the per-period evidence remaining (`workspaceEvidenceRemaining <= 0`), the monthly cap (`hasExhaustedMonthlyCap`), and the per-run / per-watchlist / daily budget guards. These are cases **(a) monthly plan limit exceeded** and **(b) per-run budget guard**, not an artifact-storage quota or a bug/race (cases c/d). Expected behavior.

**Why no quota/bug fix** (`accept 2`/`accept 3`): because the skip is expected behavior, the correct action is to surface it, not to change capture limits. The `budget_skip` reason code and its human label "Skipped — plan allowance reached" already exist (`accept 4`, `app/lib/capture-attempt-reason-code.ts`), and the 72h live canary (`scripts/canary-proof-budget-skip-surface.mjs`) already verifies every budget-skip row carries a non-null `skip_reason`.

**What was missing and is shipped here**: a buyer-facing "why this happened" explanation and one click to it.
- `app/lib/capture-validity-public-rules.ts` — `CAPTURE_BUDGET_SKIP_PUBLIC_RULE` (id `budget-skip`) plus the stable `/capture-rules#budget-skip` href.
- `app/routes/capture-rules.tsx` — renders the budget-skip block at the `#budget-skip` anchor on `/capture-rules` (the locale route re-exports this component, so it appears on `/de/capture-rules` too).
- `app/components/watchlists/recent-evidence-checks-card.tsx` — the budget-skip message in the evidence panel now ends with a `Why this happened` link to `/capture-rules#budget-skip`.

**Prevention mechanism** (mechanical-fix, fleet-ops#366): regression test `tests/monitoring/budget-skip-visibility.test.ts` seeds a watchlist at its capture limit, runs `evaluateProofPolicy`, drives the resulting skip through the run-history visibility layer, and asserts the human reason, the label, and the `Why this happened` link all render — proving the surface cannot silently disappear.

**Acceptance 5** is exactly that regression test.

## Verification
- `npx vitest run tests/monitoring/budget-skip-visibility.test.ts` → 6 passed
- `npx vitest run tests/run-history-capture-visibility.test.ts tests/watchlist-proof-skip-reason.test.tsx tests/capture-validity-public-rules.test.ts tests/capture-rules-page.test.ts tests/marketing-proof-brief.test.tsx` → 27 passed
- full `npx vitest run --configLoader runner` → **567 files / 6678 tests passed**
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc -b` → exit 0

Run cue: the regression-test run above is the run that proves the surface. No unit/timer/workflow added, so no `systemd`/workflow `run-proof` transcript applies.

net-positive-because: closes the silent-degradation gap (issue #1485) with a read-mostly change — one new public block, one link, one regression-test file — and zero changes to capture limits or the `proof_capture` schema (rollback is a revert of the reason-code surface alone).

Closes #1485
