# Branch And Stash Cleanup Report

Last updated: 2026-06-27

No branches or stashes were deleted.

Reviewed against current hardening branch `codex/final-self-serve-ga-hardening-20260625` at `c2bd462` and `main` at `ed109a9`.

## Branches Reviewed

| Branch | Evidence | Recommendation |
| --- | --- | --- |
| `cursor/agency-monitoring-fanout-20260623` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `cursor/dashboard-v2-20260624` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after dashboard provenance stash is reconciled |
| `cursor/launch-hardening-20260623-1825` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `cursor/plan-entitlements-topups-no-prices-20260623` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `docs/plan-entitlements-release-20260624` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `cursor/ga-final-integration-20260624` | Merged into `main`; has active linked worktree at `../0509-worktrees/ga-final-integration-20260624`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate only after worktree lifecycle is handled |
| `cursor/ga-billing-sales-20260624` | Active linked worktree; one patch-equivalent commit (`git cherry -v HEAD` shows `- 83fbd45`) | Safe cleanup candidate only after worktree lifecycle is handled |
| `cursor/ga-customer-delight-20260624` | Active linked worktree; one patch-equivalent commit (`git cherry -v HEAD` shows `- 2908f9b`) | Safe cleanup candidate only after worktree lifecycle is handled |
| `cursor/ga-agency-monitoring-20260624` | Active linked worktree; one unique commit (`+ 0865b7d`) for fan-out proof ladder/canary tooling | Preserve until Agency fan-out work is explicitly reconciled |
| `cursor/ga-ops-reliability-20260624` | Active linked worktree; one unique commit (`+ cd67e14`) for launch-readiness/email gating | Preserve until this final hardening PR lands, then recompare |
| `cursor/ga-launch-customer-delight-20260624` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `cursor/presence-pilot-rollout-20260624` | Merged into `main`; remote branch still exists; `git cherry -v HEAD` reports no unique patch | Preserve until Presence owner-action cleanup is finished |
| `cursor/presence-tracking-v1-20260624` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `docs/presence-v1-deploy-provenance-20260624` | Merged into `main`; `git cherry -v HEAD` reports no unique patch | Safe cleanup candidate after owner confirms no external PR dependency |
| `codex/0509-saas-account-controls-20260622` | Active linked worktree; seven unique commits; stale broad diff; migration-number conflicts | Do not delete. Do not merge. Review result captured in `docs/codex-account-controls-branch-review.md`. |

## Linked Worktrees

The following cleanup candidates are still checked out as linked worktrees and cannot be treated as branch-only cleanup:

- `../0509-worktrees/ga-final-integration-20260624`
- `../0509-worktrees/ga-billing-sales-20260624`
- `../0509-worktrees/ga-customer-delight-20260624`
- `../0509-worktrees/ga-agency-monitoring-20260624`
- `../0509-worktrees/ga-ops-reliability-20260624`
- `.worktrees/codex-0509-saas-account-controls-20260622`

## Stashes

| Stash | Summary | Recommendation |
| --- | --- | --- |
| `stash@{0}` / `2f0dd562f03777a3196d54a377cc3f5c9a7faa1e` | One-line edit in `docs/dashboard-v2-master-progress.md`; dashboard V2 PR/Worker provenance | Preserve until the dashboard V2 docs are checked or owner approves dropping |
| `stash@{1}` / `2e58f5befd768e2863b86e242c19c1b9e71c4e1f` | Documentation edits in `docs/ga-final-master-progress.md`; GA final PR/tests/canaries/Worker provenance | Preserve until launch provenance docs are reconciled |

## Cleanup Rule

Do not drop stashes, remove worktrees, or delete branches in this pass. After the final launch PR lands, re-run `git worktree list`, `git branch --merged main`, `git cherry -v main <branch>`, `git stash list --format='%gd %H %s'`, and `git stash show --stat` before deleting anything.
