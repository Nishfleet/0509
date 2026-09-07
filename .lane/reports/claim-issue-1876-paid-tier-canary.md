# Issue #1876 — paid-tier screenshot-rate canary scheduling (acceptance 4)

Branch: `claim/issue-1876`
Worktree: `/home/nish/workspaces/agent-worktrees/issue-0509-1876`
Base: `f5a3d540` (Merge PR #1892)

## Context

Issue #1876 has four acceptances. The prior PR (#1888, commit `2d051866`,
merged 2026-09-07) shipped acceptances 1–3:

- **Acceptance 1 (diagnose + fix the capture pipeline):** the pipeline is
  already fail-closed. `createProofCapture` throws
  `proof_capture_succeeded_without_screenshot` for any `succeeded` row
  without a `screenshot_artifact_key` (`app/lib/data/watchlist-proof.server.ts`
  L651–L655). Both website proof paths set `requireScreenshot: true`
  (`app/lib/monitoring.server.ts` L3783, L4388). Live D1 confirms it: every
  real watcher succeeded capture since the 2026-08-27 fix (`0b22b877`)
  carries a screenshot key. The 2 pre-fix rows (2026-08-25) are the only
  `succeeded` + `screenshot_artifact_key IS NULL` rows in the last 30 days.
- **Acceptance 2 (`capture_diagnostics` column):** migration `0084` added
  `plan_at_capture` + `capture_diagnostics`; all 10 `createProofCapture`
  call sites thread `captureDiagnostics` on non-succeeded captures.
- **Acceptance 3 (do not change homepage copy):** no copy change in either
  PR.

The remaining gap is **acceptance 4: a canary that asserts the 48h
screenshot rate ≥ 90% on a paid-tier watchlist cohort.** The canary script
(`scripts/canary-proof-screenshot-rate.mjs`) and the `canary:screenshot-rate`
npm script already exist from #1888, but the scheduled systemd guard
(`ops/screenshot-rate-guard/`) only ran the **watcher** cohort (alert < 80%).
The paid-tier cohort (alert < 90%) was not scheduled — the regression the
issue is about could recur on paid-tier watchlists with no detector firing.

## What changed

### `ops/screenshot-rate-guard/0509-screenshot-rate-guard-run.sh`
The guard now runs **both** cohorts every tick and exits with the worst
verdict (2 = could-not-run beats 1 = regression beats 0 = pass/skip):

1. `watcher` — all real watcher captures (`kind IS NULL`), alert < 80%
   (issues #1327/#1747, unchanged behaviour).
2. `paid-tier` — paid-plan watcher captures (`plan_at_capture IN
   scout/starter/agency`), alert < 90% (issue #1876 acceptance 4).

Each cohort runs under `set +e` so a failure in one cannot abort the
other; a labelled banner per cohort makes journald show which cohort
produced which verdict. The paid-tier cohort SKIPs (exit 0, reported every
run) until `plan_at_capture` is populated by a deploy and paid-tier
captures flow — the SKIP is reported so the empty window cannot silently
mask a regression.

### `ops/screenshot-rate-guard/0509-screenshot-rate-guard.service`
Description updated to name both cohorts.

### `ops/screenshot-rate-guard/provision-screenshot-rate-guard.sh`
Header comment updated to describe both cohorts and the worst-of-two
verdict.

## Verification

| Check | Command | Result |
|---|---|---|
| Live guard run (both cohorts, prod D1) | `SCREENSHOT_GUARD_CHECKOUT="$(pwd)" bash ops/screenshot-rate-guard/0509-screenshot-rate-guard-run.sh` | exit 0; watcher SKIP (n=0 in 48h), paid-tier SKIP (n=0 in 48h, plan_at_capture not yet populated) |
| Canary unit tests | `npx vitest run tests/canary-proof-screenshot-rate.test.ts` | 19/19 pass |
| Migration integration test | `npx vitest run --project workers tests/integration/proof-capture-plan-diagnostics.integration.test.ts` | 3/3 pass |
| Screenshot-rate-target integration test | `npx vitest run --project workers tests/integration/screenshot-rate-target.integration.test.ts` | 3/3 pass (part of the 156 below) |
| Browser-run fail-closed contract | `npx vitest run tests/browser-run.server.test.ts` | 7/7 pass |
| Full workers suite | `npx vitest run --project workers` | 156/156 pass |
| Shellcheck (run.sh) | `shellcheck ops/screenshot-rate-guard/0509-screenshot-rate-guard-run.sh` | only pre-existing SC1090 (non-constant source) |
| Shellcheck (provision.sh) | `shellcheck ops/screenshot-rate-guard/provision-screenshot-rate-guard.sh` | only pre-existing SC2155 (readonly assign) |
| Bash syntax | `bash -n` on both scripts | OK |

## What this does NOT do

- No homepage copy change (acceptance 3 forbids it until the metric is
  green).
- No production migration application (CI handles deploys; migration `0084`
  is already merged and applied to prod D1 — verified live: both columns
  exist in `pragma_table_info('proof_capture')`).
- No re-provisioning of the live systemd unit (the deploy clone + CI own
  the live install; this PR updates the source the provision script
  installs from).
- No new `bin/` file (reuses the existing canary script + guard rail).
