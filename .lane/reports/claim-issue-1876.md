# Issue #1876 — paid-tier screenshot-rate metric + diagnostics

Branch: `claim/issue-1876`
Worktree: `/home/nish/workspaces/agent-worktrees/issue-0509-1876`
Base: `496ff9c1` (Merge PR #1873)

## What changed

### 1. Migration `0084_proof_capture_plan_diagnostics.sql`
Two additive nullable columns on `proof_capture` (expand/contract phase 1;
no DROP, no rename, no NOT NULL, no backfill):

- `plan_at_capture TEXT` — watchlist owner's plan family at capture time
  (`free`|`scout`|`starter`|`agency`), NULL on legacy/unattributed rows.
- `capture_diagnostics TEXT` — structured JSON recording WHY a screenshot is
  missing on a non-succeeded capture (timeout, OOM, selector miss, budget,
  rate_limit, dedupe, …). NULL on succeeded rows (the succeeded path is
  fail-closed on `screenshot_artifact_key`).

### 2. Data layer (`app/lib/data/watchlist-proof.server.ts`, `watchlist-rows.server.ts`, `app/lib/types.ts`)
- `CreateProofCaptureInput` accepts `planAtCapture` + `captureDiagnostics`.
- `createProofCapture` INSERT writes both columns (22 cols / 22 values).
- `PROOF_CAPTURE_LIST_COLUMNS` selects both columns.
- `ProofCaptureRow` + `toProofCaptureRecord` map them.
- `ProofCaptureRecord` type gains them (optional, so legacy test fixtures
  omitting them stay valid).
- Idempotency equivalence check includes `planAtCapture`.

### 3. Capture pipeline (`app/lib/monitoring.server.ts`)
All 10 `createProofCapture` call sites in the two website proof paths
(`evaluateSelectiveProofCandidates`, `evaluateDirectWebsiteProofCandidate`)
now pass:
- `planAtCapture: userPlan` — the plan already resolved by
  `resolveWorkspaceEvidenceCapacity` at both call sites, so no new plan
  lookup is introduced.
- `captureDiagnostics: { screenshotMissingReason, ... }` — on every
  non-succeeded capture (skip/budget/rate-limit/dedupe/failed), recording
  the structured missing-screenshot reason. Succeeded captures omit it
  (the succeeded path is fail-closed on the screenshot key).

The launch-readiness canary capture (`api.launch-readiness.canary.ts`) is
an internal launch-gate capture, not a customer watchlist capture — it
intentionally leaves `planAtCapture` NULL so it's excluded from the
paid-tier cohort.

### 4. Canary (`scripts/canary-proof-screenshot-rate.mjs`)
- New `--cohort <watcher|paid-tier>` flag (default `watcher`, preserving
  #1747 behaviour).
- `buildScreenshotRateQuery(window, { cohort: 'paid-tier' })` adds
  `AND plan_at_capture IN ('scout','starter','agency')` to the WHERE clause.
- `summarize`, `renderHumanReport`, and `buildIssueBody` surface the cohort.
- New npm script `canary:screenshot-rate` runs the paid-tier cohort at the
  90% target threshold (the issue's acceptance command).

### 5. Tests
- `tests/canary-proof-screenshot-rate.test.ts` — extended for `--cohort`
  parseArgs, paid-tier query filter, paid-tier issue body. 19 tests pass.
- `tests/integration/proof-capture-plan-diagnostics.integration.test.ts` —
  NEW real-D1 integration test (workerd): WRITE path persists both columns
  and reads them back; READ path proves the paid-tier cohort filter
  excludes free + unattributed captures; verdict passes for a healthy
  paid-tier cohort and fails when paid-tier captures lack screenshots.
  3 tests pass.
- `tests/integration/screenshot-rate-target.integration.test.ts` — existing
  #1747 integration test still passes (watcher cohort unchanged).
- `tests/data.server.test.ts` — inline `proof_capture` CREATE TABLE
  updated with the two new columns so the idempotency test sees the
  post-migration schema.

## Verification

| Check | Command | Result |
|---|---|---|
| Typecheck (touched files) | `npx tsc -b` | No errors in touched files (pre-existing Playwright/e2e errors only) |
| Canary unit tests | `npx vitest run tests/canary-proof-screenshot-rate.test.ts` | 19/19 pass |
| New integration test | `npx vitest run --project workers tests/integration/proof-capture-plan-diagnostics.integration.test.ts` | 3/3 pass |
| Existing integration test | `npx vitest run --project workers tests/integration/screenshot-rate-target.integration.test.ts` | 3/3 pass |
| Full workers suite | `npx vitest run --project workers` | 153/153 pass |
| Full node suite | `npx vitest run --project node` | 7112/7113 pass (1 pre-existing EISDIR in `legacy-billing-provider-removal.test.ts`, unrelated) |

## What this does NOT do

- No homepage copy change (the issue forbids it until the metric is green).
- No production migration application (CI handles deploys; this PR adds the
  migration file only).
- No change to the launch-readiness canary capture path (internal, excluded
  from the paid-tier cohort by design).
- No change to the existing `canary:proof-screenshot-rate` command (the
  watcher-cohort default is preserved); the new `canary:screenshot-rate`
  command is the paid-tier cohort variant.
