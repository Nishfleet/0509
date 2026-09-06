## Summary

Main CI has been red since 2026-09-06T18:30Z because the **Deploy production** workflow's
"Deploy Worker" check fails on main. `fleet_main_ci_green["Nishfleet/0509"]` = 0.

### Root cause

The deploy's `launch:readiness:predeploy` gate runs the full canonical release proof
(`e2e:local:release`, journeys 1–6). The tablet (768px) variant of **Gate-B Journey 1**
failed `expect(...heading 'No verified ads found for fresh-empty.example').toBeVisible()`
— the heading was present in the DOM but resolved **hidden** (14×), then timed out.

The heading is genuinely invisible at tablet width, a real layout bug. In the
641–900px single-column range the split collapses to one column, but `.f9-wk-sec-head`
only wraps `.f9-wk-sec-acts` below the title from `<=640px`. In the empty/delayed state
the action links (`flex: none`, ~522px across three next actions) overflow the narrower
column and squash `.f9-wk-sec-headings` (`min-width: 0`) to width:0 — the title is in the
DOM and the accessibility tree but has an empty bounding box, so Playwright reports it
hidden. This is real product breakage (the empty-state headline is unreadable to tablet
users), not a test-only flake.

Mobile passed only because `<=640px` wraps; desktop passed only because its column is
wide enough. Tablet (768px) alone hit the collapse. This ran red on two consecutive
merges (#1832, #1841) plus a rerun attempt, so the `auto-revert` workflow correctly
classified it as "failing across consecutive commits" (halt issue #1846) rather than
reverting product code.

### Fix

Add the same `flex-wrap` / `flex: 1 1 100%` treatment the `<=640px` block already uses
into the `@media (max-width: 900px)` block so the section head wraps its actions onto
their own full-width row across the whole single-column range.

### The auto-redispatch defect (named, as required by the issue)

Auto-redispatch reporting `rc=0` while main stays red IS itself a defect. The canary
repair path re-triggers the same failing deploy run, but `ci-verify-production-candidate.sh`
hard-requires `GITHUB_RUN_ATTEMPT == "1"` and fails closed with
`production_candidate_invalid: run_attempt` on any re-run (`GITHUB_RUN_ATTEMPT >= 2`).
So a re-dispatched deploy can never pass the gate: the redeploy fails before doing any
work, `rc=0` only proves the dispatcher spawned the unit, and main stays red forever for
this class. The lasting fix is removing the root cause (this PR) so the *next* main push
runs a fresh attempt-1 deploy that can actually go green.

## Verification

- **Reproduced**: the empty-state title at 768px was invisible (0-width, flex-squashed).
- **After fix**: rebuilt and served the app; at 768px the `No verified ads found…`
  heading now renders with a non-zero bounding box (width 422px, height 22px,
  `flex-wrap: wrap` on `.f9-wk-sec-head`). The exact assertion that fails in CI now
  observes a visible heading.
- `npm run typecheck` → pass.
- `npm run build` → pass (bundle size check passed).

## run-proof

- Failing main checks: `Deploy Worker` (run 34049887001, attempt 2, `run_attempt` failure);
  `Deploy Worker` (run 34048631385, attempt 1, tablet E2E flake).
- Halt issue: #1846.
- Fresh main deploy run after merge of this PR's parent commit will exercise the fixed
  tablet test. (Deploy happens on the auto-deploy-on-green push trigger; a re-dispatch
  alone cannot clear the existing red run — see the defect note above.)

## Reviewer round

Reviewer seat: `cursor/cursor-grok-4.6-high`.

- Act on: none.
- Consider: (1) the fix comment duplicates the commit-message rationale — kept for
  future readability; (2) the 900px and 640px blocks repeat the same property trio —
  acceptable, they target different breakpoints and merging them would over-complicate.

Closes #1847
