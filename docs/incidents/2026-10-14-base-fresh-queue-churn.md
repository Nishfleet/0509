# 2026-10-14: base-fresh blamed for queue churn

## What was reported

`base-fresh` fails on `merge_group` runs and ejects pull requests from the merge queue, causing re-merges, lost approvals and locked branches.

## What the records show

- `base-fresh` never fails on `merge_group`. Both of its steps carry `if: github.event_name == 'pull_request'`, so on a merge group the job passes with no work.
- Every failed `merge_group` run of `ci.yml` on 2026-10-14 (pr-7501, pr-7506, pr-7485, 10:29 to 10:46Z) failed in `codex-node-checks`, step Lint. `ci-ok` failed only because it needs that job.
- The red `base-fresh` checks are `pull_request` runs. `stale-base-retest.yml` reruns that job on every open pull request each time a gate file lands on `main`, so every open head goes red at once.
- #7516 and #7531 merged with a red `base-fresh` on their head, so a red head check alone does not eject a queued pull request.

## The real cost

A red head cannot be armed or queued until `main` is merged into it. That makes a new head, which drops the bot approval, and a branch already in the queue cannot take the merge ("Branches that are queued for merging cannot be updated").

## Fix

`stale-base-retest.yml` skips pull requests with auto-merge armed (`autoMergeRequest == null`). The queue tests the real merge on the new gate, so a freshness verdict on the head adds nothing there. Net workflow lines are 0, so the ratchet is unaffected, and no ruleset change is needed. Migration number and gap checks run in tests, which `merge_group` runs in full. Nish approved the change on 2026-10-14.

## What this does not cover

A head armed before a gate tightened can reach the queue as the first run on the new gate, the 2026-10-07 case. The queue then ejects that one pull request, once.
