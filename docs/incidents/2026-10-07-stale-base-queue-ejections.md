# 2026-10-07: green pull requests ejected from the merge queue on a stale base

## What customers saw

Nothing. No change reached `main` broken. The cost was internal: four pull requests had a green `ci-ok` on the pull request, were armed, and then failed in the merge queue. Each ejection forced a new head, and a new head needs a fresh owner approval, so the owner had to approve the same work again.

## Start and end (UTC)

- 2026-10-07, morning: #7214 and #7172 failed `Typecheck` in the queue after `main` started typechecking tests (`tsconfig.test.json`). They were replaced by #7240 and #7248.
- 2026-10-07, morning: #7243 failed in the queue after #7256 turned on type-aware lint for `tests/**`. It now has a new head (814325d9).
- 2026-10-07, ~08:00: #7248 was ejected again on four `dot-notation` lint errors in `tests/integration/discovery/d2-judge.integration.test.ts:192-194`.
- Ends when the fix PR for this postmortem merges.

Exact queue-run timestamps were not read for this write-up.

## Root cause

`ci.yml` ran on `pull_request` only for `opened`, `synchronize` and `reopened`. A pull request's run tests the merge of its head with `main` as `main` was at that moment. Nothing reran it when `main` moved. So a head that was green on Tuesday's `main` stayed green on the pull request after `main` tightened its gates, and the first run against the new gates was the merge queue's, after the head was armed and approved.

The gate changes were real and correct (tests typechecked, tests linted type-aware). The hole was the delay between "the pull request last ran against the old gates" and "the first run against the new gates". "Flake" does not apply: every ejection reproduces locally by merging the head onto current `main` and running `npm run typecheck` and `npm run lint`.

Evidence: the four failures name rules and files that exist only on the newer `main` (`tsconfig.test.json`, the typed-lint block for `tests/**`); each head passes on the base it was last run against.

## How it was detected

The merge queue itself failed each entry. Nothing before the queue could have reported it.

## The fix

`ci.yml` now also runs on `ready_for_review` and `auto_merge_enabled`. Marking a pull request ready, or arming auto-merge, reruns the full gate on the merge with today's `main`, on the pull request. A head that the new gates reject is red there, and auto-merge does not queue a red pull request, so it never reaches the queue. No new job, no script, no required-check change: `ci-ok` is untouched.

## What stops a repeat

1. Code: the `types:` list in `.github/workflows/ci.yml`, pinned by `tests/required-checks-never-skip.test.ts`.
2. Rule: none added. The reviewer's local "merge head onto main, run eslint and `tsc -b`" step stays as a second check, not the first.

Limit, stated plainly: a head armed before a gate change lands, and not touched after, is still first tested against the new gate in the queue. The queue stays the final check. This fix shortens the window to "between arm and queue", where it was "between last push and queue".
