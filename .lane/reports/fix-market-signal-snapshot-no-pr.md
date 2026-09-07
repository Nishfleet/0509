# Lane evidence — fix/market-signal-snapshot-no-pr

Branch: `fix/market-signal-snapshot-no-pr`
Date: 2026-08-24
Scope: remove the GitHub-Actions-creates-PR dependency from the daily
market-signal D1 snapshot workflow.

## Problem

`.github/workflows/market-signal-snapshot.yml` ("Daily market-signal D1
snapshot") failed every run since 2026-08-21 because the landing step called
`gh pr create`, and the Nishfleet org policy "Allow GitHub Actions to create
and approve pull requests" is disabled. The failure was:

```
pull request create failed: GraphQL: GitHub Actions is not permitted to
create or approve pull requests (createPullRequest)
```

Flipping the org setting needs `admin:org` scope and loosens an org-wide
security control for one daily data file.

## Root-cause finding (what the PR was for)

The PR was **transport, not a deliverable a human reviews**. The old flow:
create a PR from a per-day automation branch, arm GitHub auto-merge, watch the
required CI checks (codex-node-checks, Gitleaks, required-verifier-integrity),
squash-merge to main. No human was in the loop; the "review" was the required
CI checks gating the auto-merge. The snapshot itself is an aggregate,
customer-safe JSON data file consumed by the Hermes morning report
(`automation/HERMES_MARKET_SIGNAL.md`), which read it from a `main` checkout.

## Change

The snapshot now publishes to a dedicated, automation-owned data branch
`automation/market-signal-snapshot` instead of merging to `main`. No PR is
opened, so no org or repo policy is weakened.

- `.github/workflows/market-signal-snapshot.yml`: replaced the "Commit
  snapshot to main" step (gh pr create / gh pr merge / gh pr checks) with a
  "Publish snapshot to data branch" step that commits, force-pushes to
  `automation/market-signal-snapshot` with `--force-if-includes` (+ `--force`
  fallback for first run), and writes a `$GITHUB_STEP_SUMMARY` pointing a
  human at the branch + commit for review. Dropped `pull-requests: write`
  permission. Updated header + permission comments. Cron, concurrency group,
  D1 queries, freshness check, and secret-refuse check are unchanged.
- `automation/HERMES_MARKET_SIGNAL.md`: Hermes now fetches
  `automation/market-signal-snapshot` and reads the snapshot with
  `git show origin/automation/market-signal-snapshot:ops/market-signal/0509-market-signal.json`
  into a temp file. No `main` checkout switch needed; the host working tree
  stays on `main`. Freshness/26h rules unchanged.
- `tests/market-signal-workflow.test.ts`: replaced the PR-merge assertions
  with data-branch-publish assertions (no `gh pr create`/`gh pr merge`, stable
  branch, fail-loud under `set -euo pipefail`, `--force-if-includes`,
  `$GITHUB_STEP_SUMMARY` surfacing, permissions `{contents: write, issues:
  read}`). Added a contract assertion that Hermes points at the data branch.

## How review is preserved without Actions opening a PR

There was no human review to drop — the old gate was CI checks via auto-merge.
The new flow surfaces the snapshot to a human via the job summary (branch URL
+ commit URL) so the diff is reviewable in the GitHub UI before it feeds the
morning report. Hermes reads the snapshot directly from the data branch, so
no human merge is required for the daily signal to flow; a human merge to
`main` is not part of the path.

## Fail-loud

The publish step runs under `set -euo pipefail`. A push failure (after the
`--force-if-includes` / `--force` fallback) exits non-zero. The only exit 0
path is a genuinely unchanged snapshot (`market_signal_snapshot_unchanged`).
The existing freshness check still rejects a stale/missing snapshot before
publish.

## Verification

- `npx vitest run tests/market-signal-workflow.test.ts tests/market-signal-snapshot.test.ts`
  → 28 passed.
- `npm test` (full suite) → 5460 passed (455 files).
- `npm run typecheck` → exit 0.

## Interaction with PR #907

PR #907 adds a fail-loud preflight that names the org "Actions can create PRs"
setting. This PR removes the `gh pr create` step that #907's preflight guards,
so after this lands #907's preflight is dead code. **This PR should merge
first**; #907 should be closed as superseded (or, if merged first as a
stopgap diagnostic, it will conflict on `tests/market-signal-workflow.test.ts`
and `.github/workflows/market-signal-snapshot.yml` and must be superseded
immediately after).
