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

## Second cause: one shared feature map

The same day, `feature-map.md` was the top source of merge conflicts. It held every route as one very long line in one 490 KB file, and every pull request that changed a route edited it. It knocked #7393 out of the queue three times and held #7497 (migration 0059, with four pull requests behind it) in the queue for three hours.

Fix: one file per row under `.agents/skills/verify/feature-map/<section>/`, so two pull requests conflict only if they change the same route. `tests/unit/feature-map-proof.test.ts` reads the directory and keeps every old check, plus one that a file holds exactly one row. The reviewer bot refuses a diff over 250 KB, so the move lands in six parts.

The lesson: a file that every pull request edits is a queue lock. Put a per-change fact in its own file.

## Third cause: an accessibility scan taken mid-fade

From 21:45Z, when `e2e/a11y-onboarding.spec.ts` started running on every pull request (#7576), "screen 2 is operable by keyboard" failed now and then and passed on retry. Playwright counts a pass-on-retry as a failed run, so it knocked #7500 and #7496 out of the queue and failed #7573's checks twice.

Cause: opening the name editor fades its popover in over 160 ms, and the scan ran inside that fade. axe read the placeholder's blended colour (colour-contrast, about 2.8:1) or counted the hidden base-ui focus guards as visible (aria-hidden-focus, six spans). Scanned right after opening, 7 of 8 local runs failed. Scanned once the popup was fully opaque, 30 of 30 were clean, so the colours and the guards were never wrong.

Fix (#7580): the spec waits for `opacity: 1` and no `data-starting-style` before it scans. No skip, retry wrapper or loosened rule.

The lesson: a scan of a transient surface waits for the surface to settle, and a new check that joins every pull request gets a repeat run under load before it merges.
