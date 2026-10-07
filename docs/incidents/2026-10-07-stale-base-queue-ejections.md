# 2026-10-07: green pull requests ejected from the merge queue on a stale base

## What customers saw

Nothing. No change reached `main` broken. The cost was internal: four pull requests had a green `ci-ok` on the pull request, were armed, and then failed in the merge queue. Each ejection forced a new head, and a new head needs a fresh owner approval, so the owner had to approve the same work again.

## Start and end (UTC)

- 2026-10-07 (Wednesday), morning: #7214 and #7172 failed `Typecheck` in the queue after `main` started typechecking tests (`tsconfig.test.json`). They were replaced by #7240 and #7248.
- Morning: #7243 failed in the queue after #7256 turned on type-aware lint for `tests/**`. It now has a new head (814325d9).
- 08:13:50: #7248 was ejected again on four `dot-notation` lint errors in `tests/integration/discovery/d2-judge.integration.test.ts:192-194`.
- Ends when the fix PR for this postmortem merges.

Exact times of the first three queue failures were not read for this write-up.

## Root cause

A pull request's CI run tests the merge of its head with `main` as `main` was when that run started. Nothing re-decides it when `main` moves. The repository requires one check, `ci-ok`, and zero approvals, so a pull request with a green `ci-ok` that is armed goes straight into the merge queue. The timelines of all four show `added_to_merge_queue` with no earlier `auto_merge_enabled` event: they were green at the moment they were armed. The merge queue's own run was the first to apply the gates `main` had tightened since (tests typechecked in `tsc -b`, type-aware lint on `tests/**`) and it failed them.

The gate changes were correct. The hole is that a green `ci-ok` carried no information about whether its base predated a gate change. "Flake" does not apply: each failure names a rule or file that exists only on the newer `main`, and reproduces by merging the head onto current `main` and running `npm run typecheck` and `npm run lint`.

An earlier attempt, retesting on `ready_for_review` and `auto_merge_enabled` (#7265, efb23028), did not close the gap for the reason above: a green-at-arm pull request fires neither.

## How it was detected

The merge queue failed each entry. An update-branch or a rerun against current `main` before arming would have caught each of them; nothing in the repo did either automatically.

## The fix

- `ci.yml` gets a `base-fresh` job, needed by `ci-ok`. On a pull request it fails when the head does not contain the newest commit on `main` that touched a gate file (lint and TypeScript config, suppressions, `knip.jsonc`, `package*.json`, vitest configs, `ci.yml`). It reads `main` at run time, so rerunning it re-decides it. In the merge queue it passes: the queue tests the real merge.
- `stale-base-retest.yml` runs when a gate file lands on `main` and reruns `base-fresh`, and through it `ci-ok`, on every open pull request's latest CI run. A stale pull request goes red at that moment, so a later arm cannot queue it.

The job is a gate in `ci-ok`'s `needs`, so `tests/required-checks-never-skip.test.ts` already pins that it reports. That test also pins the two path lists equal.

## What stops a repeat

1. Code (this fix). Covered: any open pull request whose head lacks the latest gate change, whether it is armed, queued later, or just ready. It is red from the moment the gate lands, and goes green only after `main` is merged into its branch and CI runs there.
2. Not covered: a pull request already inside the merge queue when the gate lands, and the CI-only effects of a gate change not in the path list (for example a rule added in a file the list does not name). The queue stays the final check for those.
3. Cost, stated plainly: every open pull request that predates a gate change needs `main` merged in, which is a new head. That is the point, but it also means a fresh approval for a risky-path pull request. Doing it right after the gate lands, not at arm time, is the saving.
