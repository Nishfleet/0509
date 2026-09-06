# Lane evidence — claim/issue-1732

## Goal
Close Nishfleet/0509#1732 by adding `vulnerability-alerts: read` permission and a required `dependabot-critical-check` job to `.github/workflows/ci.yml`.

## Work performed
- Reused the existing `claim/issue-1732` branch and PR Nishfleet/0509#1740.
- Verified the existing implementation adds the workflow-level and job-level `vulnerability-alerts: read` permission and the `dependabot-critical-check` job with an in-job authorizer, pinned checkout, and `gh api` query.
- Added the new required job to the structural guard tests:
  - `tests/required-context-no-skip.test.ts`
  - `tests/production-candidate-workflow.test.ts`
- Attempted to correct the query to use the documented GitHub API `relationship=direct` filter and a paginated line-count, but the worker GitHub App token lacks the `workflows` permission, so the push of `.github/workflows/ci.yml` was rejected. The corrected query was reverted from the branch.

## Verification commands

```bash
git -C /home/nish/workspaces/agent-worktrees/issue-0509-1732 rev-parse claim/issue-1732
# d31cd71a02abca3f65ef79da80fba3a10b1ba063

npx vitest run tests/required-context-no-skip.test.ts tests/ci-hosted-runners.test.ts tests/workflow-routing-hardening.test.ts tests/production-candidate-workflow.test.ts
# Test Files  4 passed (4)
#      Tests  18 passed (18)

git push origin claim/issue-1732
# 7ad8e31b..d31cd71a  claim/issue-1732 -> claim/issue-1732

gh pr merge 1740 --auto --squash -R Nishfleet/0509
# ! The merge strategy for main is set by the merge queue
```

## Result
- Structural tests for `dependabot-critical-check` are now in PR #1740.
- PR #1740 is armed for auto-merge but remains `BLOCKED` pending the required admin `gate-integrity-attest` / `verifier-attest` comments because it touches `.github/workflows/ci.yml`.
- A query correctness fix (`relationship=direct`, paginated count, `security_advisory.ghsa_id`) needs a token with the `workflows` permission or an admin push.
