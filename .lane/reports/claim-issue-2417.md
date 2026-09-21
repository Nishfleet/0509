# Lane evidence: claim/issue-2417

Issue: Nishfleet/0509#2417 — "reccos: Collapse the setup checklist to one
human task — the other three are the system's" (Kimi K3 Simplicity/automation
pass, ref R4). Binding judge edit: depends on R1 (#2414, merged PR #3754) and
R2 (#2415, merged PR #3108); both landed before claim, gate released
2026-09-20T23:42Z.

## What shipped

`app/lib/setup-checklist.ts` — `BLOCKING_SETUP_ITEM_IDS` is now composed of
`USER_SETUP_ITEM_IDS` (`first_competitor`) and `AUTOMATIC_SETUP_ITEM_IDS`
(`first_watchlist`, `first_proof`, `first_digest`), plus
`isAutomaticSetupItem()`. Existing exports and `isBlockingSetupItemComplete`
semantics (including the paused-watchlist override) unchanged.

`app/components/setup-checklist-card.tsx` — `nextItem` is the first pending
NON-automatic item, so automatic items never hold "Next", `aria-current`, or
the PrimaryAction link. Card stays mounted while only automatic items pend
(dashboard already revalidates on the first-scan poll) and still retires when
the blocking list is empty. Pending automatic rows stamp "Automatic" (a state
word, per the v4 stamp DNA) and show system-side detail instead of the
server's user-instruction detail. Heading retires "Finish the workspace that
sends your first brief": "Add a competitor — the rest is automatic" while the
user step is open, "Your first brief is on its way" once only the pipeline is
running.

`tests/dashboard-activation.route.test.ts` — heading assertion updated; new
spec pins the saved-search state (first_competitor ready via saved query,
three pending automatics): no Next/Pending stamp, no aria-current, no action
links, no quick-create form. The paused-watchlist spec's fixture gained
`counts.competitors: 1` — a paused watchlist implies a saved competitor, so
the step completes via the existing override and the card correctly does not
re-present; assertion updated to match production-reachable state.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 23 files / 323 tests pass (worktree, 2026-09-21 ~07:56Z).
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main)` → clean, exit 0.
- First failing run caught two real interactions: the first_watchlist
  competitor-count override (fixture made production-consistent) and the
  paused-watchlist card suppression (assertion updated to the override's
  contract).

Files outside `files:`/`do:` touched: `tests/dashboard-activation.route.test.ts`
only — required because it asserted the retired heading verbatim; same
test-update scope as merged R1/R2 (PRs #3754, #3108). No weakened assertions;
the new spec adds coverage.
