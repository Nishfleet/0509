# SAME-SESSION FIRST VALUE — third re-verify: still implemented by open PR #631, still not merged

**Status: evidence record — the item is implemented in Nish's open PR #631,
re-verified current against today's main. No product code touched by this lane.**

Branch: `0509-lane1-same-session-first-value-third-reverify`
Base: `origin/main` at `57a73d5f` (#764)

## Item

- [ ] SAME-SESSION FIRST VALUE — paste competitors -> first live scan -> first
      mini-brief inside the signup session
      [source: consolidated-gap-v1] [tier-1] [risk: amber] [activation] [conversion]

## Verdict

The item is **already implemented** by PR #631 (`feat/same-session-first-value`,
author nish3451, base `main`) and remains **unmerged**. Re-verified against the
current live tree on 2026-08-17:

- `git merge-base origin/main origin/feat/same-session-first-value` ==
  `origin/main` tip (`57a73d5f`) — the PR branch contains current main and the
  diff vs main is unchanged from the prior re-verify (8 files / 638 insertions,
  no rebase or refresh needed for it to merge).
- PR #631 head today: `d6fbf0c3` ("Merge branch 'main' into
  feat/same-session-first-value", 2026-08-17T07:01:55+05:30) — a routine main
  merge; the prior re-verify head was `e2ebe369` (2026-08-15). Two non-merge
  PR-exclusive commits remain: `47c5e820` (feat) and `e16d8195` (fix).
- This is the **third dispatch** for the same item; the previous two lanes
  (`.lane/reports/0509-lane1-same-session-first-value.md` on base
  `b8bfc61e` / #712, and `0509-lane1-same-session-first-value-reverify.md` on
  base `42db40fd` / #747) reached the same verdict. The state is unchanged.

## What PR #631 implements (acceptance mapping)

The PR diff vs main (8 files / 638 insertions) still delivers exactly the
item's acceptance criteria:

- **paste competitors inside the signup session** — existing bulk Market Desk
  import (`app/lib/setup-checklist-action.server.ts` commits selected rows and
  redirects to `/app?setup=market-desk&created=N`); the dashboard reads the
  `?created=N` handoff count via `readSetupCreatedCount`.
- **trigger the first live scan** — existing `queueFirstWatchlistScan` on
  watchlist creation dispatches the durable first-scan Workflow immediately
  (`app/lib/monitoring-fanout.server.ts` `dispatchFirstWatchlistScanWorkflow`),
  not on cron. The free tier gets an instant first scan with no card, pinned by
  `tests/first-scan.test.ts`.
- **see a first mini-brief / first evidence land in-session** — new:
  - `listFirstScanRunStates` (`app/lib/data/watchlist-runs.server.ts`): latest
    first-scan run status per active never-scanned watchlist, filtered to the
    `watchlist-run:first-scan:%` idempotency key (verified still used
    consistently across `monitoring.server.ts`, `monitoring-fanout.server.ts`,
    and the e2e replay helper).
  - Market Desk Brief (`app/lib/market-desk-brief.ts`): live per-competitor
    states — "First scan running now — results land here", "starts shortly",
    and honest failed/skipped item detail; the queued summary promises an
    in-session landing only while a scan is pending or running.
  - Overview (`app/routes/app.dashboard.tsx`): loader reads first-scan states
    only when a never-scanned active competitor exists; `useFirstCapturePolling`
    auto-refreshes (bounded, ~10 minutes of 30s polls, stops when nothing
    waits); a single "First scan live" FeedbackStrip narrates "Created N
    watchlists — the first live scan is running now… your first mini-brief
    lands here the moment it completes".
- **instant first scan on the free tier (no card)** — existing entitlement,
  pinned by `tests/first-scan.test.ts` (free first scan runs with no recent
  runs; capped at 3/day).
- **morning brief with the overnight delta** — existing digest cadence,
  untouched.

## Verification run (this lane)

On `origin/main` (this worktree, head `57a73d5f`, branch
`0509-lane1-same-session-first-value-third-reverify`):

| Check | Result |
| --- | --- |
| `tests/first-scan.test.ts` | 11 tests passed |
| `tests/market-desk-brief.test.ts` | 8 tests passed |
| `tests/dashboard.route.test.ts` | 27 tests passed |
| Total | 3 files / 46 tests passed (`node_modules/.bin/vitest run`) |

Spot-check on `origin/feat/same-session-first-value`:

- `git show origin/feat/same-session-first-value:tests/first-scan-run-states.server.test.ts`
  exists (161 lines, the PR-added data-layer SQL helper test, 3 cases on the
  previous head).
- The `listFirstScanRunStates` SQL on the PR still scopes to the
  `watchlist-run:first-scan:%` idempotency key, matching the rest of the
  codebase (`monitoring.server.ts`, `monitoring-fanout.server.ts`, e2e replay).
- The `awaitingFirstScan` gate in `app/routes/app.dashboard.tsx` still triggers
  `useFirstCapturePolling` only when a never-scanned active competitor exists,
  keeping the polling honest and bounded.

## Open review note (still non-blocking)

Codex review raised one P2 on 2026-08-12: when every first-scan run is
terminal (`failed`/`skipped`) and the watchlist is still unscanned, the brief
fallback still titles "First sweep is queued" even though no queued run exists.
Item-level detail is honest; only the headline overstates. Not a blocker for
the item's acceptance (the in-session running/pending/landing path is what the
item measures), but worth addressing in PR #631 before merge.

## Why no new PR with new product code was opened

Opening a second PR that re-implements an already-open, mergeable PR owned by
Nish would fork the work and conflict with it. The item is done in PR #631;
the remaining step is landing that PR (author: Nish), which is outside this
lane's authority (packet forbids pushing to main; merging a PR is a
shared-state action). The productive action is still to land PR #631.

## Files

- `.lane/reports/0509-lane1-same-session-first-value-third-reverify.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
