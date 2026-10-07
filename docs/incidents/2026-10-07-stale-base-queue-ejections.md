# 2026-10-07: green pull requests ejected from the merge queue on a stale base

## What customers saw

Nothing. No change reached `main` broken. The cost was internal: four pull requests had a green `ci-ok` on the pull request, were armed, and then failed in the merge queue. Each ejection forced a new head. On a risky path a new head needs a fresh owner approval, so the owner had to approve the same work again.

## Start and end (UTC)

- 2026-10-07 (Wednesday) 05:28:25: #7214 failed `Typecheck` in the queue after `main` started typechecking tests (`tsconfig.test.json`). Replaced by #7240.
- 06:00:27: #7172 failed the same way. Replaced by #7248.
- 08:07:57: #7243 failed in the queue after #7256 turned on type-aware lint for `tests/**`. It now has a new head (814325d9).
- 08:13:50: #7248 was ejected again on four `dot-notation` lint errors in `tests/integration/discovery/d2-judge.integration.test.ts:192-194`.
- Ends when the fix PR for this postmortem merges.

## Root cause

A pull request's CI run tests the merge of its head with `main` as `main` was when that run started, and its tests are selected with `vitest --changed HEAD^1`; only typecheck and lint run in full. Nothing re-decides it when `main` moves. The repository requires one check, `ci-ok`, and zero approvals, so a pull request with a green `ci-ok` that is armed goes straight into the merge queue. The timelines of all four show `added_to_merge_queue` with no earlier `auto_merge_enabled` event: they were green at the moment they were armed. The merge queue's own run was the first to apply the gates `main` had tightened since (tests typechecked in `tsc -b`, type-aware lint on `tests/**`) and it failed them.

The gate changes were correct. The hole is that a green `ci-ok` carried no information about whether its base predated a gate change. "Flake" does not apply: each failure names a rule or file that exists only on the newer `main`, and reproduces by merging the head onto current `main` and running `npm run typecheck` and `npm run lint`.

An earlier attempt, retesting on `ready_for_review` and `auto_merge_enabled` (#7265, efb23028), did not close the gap for the reason above: a green-at-arm pull request fires neither.

## How it was detected

The merge queue failed each entry. An update-branch or a rerun against current `main` before arming would have caught each of them; nothing in the repo did either automatically.

## The fix

- `ci.yml` gets a `base-fresh` job, needed by `ci-ok`. On a pull request it fails when the head does not contain the newest commit on `main` that touched a gate file (lint and TypeScript config, suppressions, `knip.jsonc`, `package*.json`, vitest configs, `ci.yml`). It reads `main` at run time, so rerunning it re-decides it. In the merge queue it passes: the queue tests the real merge.
- `stale-base-retest.yml` runs when a gate file lands on `main` and reruns `base-fresh`, and through it `ci-ok`, on the latest CI run of every open pull request against `main`. A stale pull request goes red at that moment, so a later arm cannot queue it. Failures are warnings so one pull request cannot stop the rest.

The job is a gate in `ci-ok`'s `needs`, so `tests/required-checks-never-skip.test.ts` already pins that it reports. That test also pins the two path lists equal.

## What stops a repeat

1. Code (this fix). Covered: any open pull request whose head lacks the latest gate change, whether it is armed, queued later, or just ready. It is red from the moment the gate lands, and goes green only after `main` is merged into its branch and CI runs there.
2. Not covered:
   - Pull requests whose latest run predates `base-fresh` (every open one when this merges). A rerun reuses the old workflow file and cannot add the job, so the workflow lists them as warnings. Planned post-merge step: add `base-fresh` as a required check in ruleset 21391031 next to `ci-ok` (it already reports in `merge_group`). Such a pull request then cannot merge until its next push, and that push is tested against current `main`. Confirm with the ruleset JSON afterwards.
   - The arm race: a pull request armed between a gate landing and the retest finishing can still queue.
   - Pull requests already inside the queue when a gate lands.
   - A run still in progress when the gate lands is skipped. It is not stale, because `base-fresh` reads `main` when it runs, unless it had already passed.
   - A gate change outside the path list; the list is pinned equal in `ci.yml` and the workflow, not to the repository's real gates.
     The queue stays the final check for all of these.
3. Cost, stated plainly: every open pull request that predates a gate change needs `main` merged in, which is a new head. That is the point. On a risky path it also means a fresh approval, so doing it right after the gate lands is the saving.
