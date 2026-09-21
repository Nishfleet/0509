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

## Review round 1 (devin-issue@0509-2417, 2026-09-21 ~08:5xZ)

Independent reviewer verdict: BLOCKING. Adjudication:

- ACT ON — saved-search state (first_competitor ready via saved query,
  competitors=0) left first_watchlist pending with no system path to complete
  it, but the card claimed "Your first brief is on its way". Fixed: an
  automatic item only counts as self-ticking while its pipeline is armed
  (activeWatchlists > 0); a pending first_watchlist (implies zero watchlists)
  is always the user's Next, carrying its server action "Add a competitor".
- ACT ON — same hole for all-paused accounts: proof/digest pending with
  activeWatchlists=0 never tick. Same fix surfaces first_proof as Next with
  its "Capture evidence" action.
- ACT ON — e2e specs still asserted the retired heading
  (e2e/local-authenticated.spec.ts, e2e/journey-2-release.spec.ts ×2);
  updated to "Add a competitor — the rest is automatic" per the repo's
  same-landing-sequence gate-spec rule.
- ACT ON (noted) — needs_proof rows now keep the server's truthful detail
  ("Evidence attempts have run…") instead of the generic automatic override.
- NOTED — "Setup · N of 4 done" still counts system items (intended: they do
  tick to done); dead `nextItem?.action` branch left (harmless, may future
  items carry actions); AUTOMATIC_PENDING_DETAIL fallback noted.
- Heading for a non-competitor Next derives from the item's server-provided
  action label ("Capture evidence — the rest is automatic") — no invented
  copy. Specs reworked: saved-search spec now asserts the Next state, new
  spec pins the real ticking state (competitor + active watchlist), paused
  spec fixture completed with production-emitted proof/digest rows.
- Re-verified: vitest changed-mode 23 files / 324 tests pass; semgrep
  diff-scoped clean.
