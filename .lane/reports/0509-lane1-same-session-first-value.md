# SAME-SESSION FIRST VALUE — already implemented and open for merge (PR #631)

**Status: evidence record — the item is implemented in an open PR, verified against
current main. No product code touched by this lane.**

Branch: `0509-lane1-same-session-first-value`
Base: `origin/main` at `b8bfc61e` (#712)

## Item

- [ ] SAME-SESSION FIRST VALUE — paste competitors -> first live scan -> first
      mini-brief inside the signup session
      [source: consolidated-gap-v1] [tier-1] [risk: amber] [activation] [conversion]
      [unreviewed-by-opus]

## Verdict

The item is **already implemented** by PR #631
(`feat/same-session-first-value`, open, base `main`) and is verified current with
the live tree:

- `git merge-base origin/main origin/feat/same-session-first-value` ==
  `origin/main` tip (`b8bfc61e`) — the PR branch contains current main; no rebase
  or refresh is needed for it to merge.
- PR #631 `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED` only because its
  required checks are re-running after a just-pushed merge of current main
  (head `8dab529b`, pushed 2026-08-14T04:01:35Z). Prior green run on the
  previous head: codex-node-checks, required-verifier-integrity, Gitleaks all
  pass.

## What PR #631 implements (acceptance mapping)

The PR diff vs main (638 insertions across 8 files) delivers exactly the
item's acceptance criteria:

- **paste competitors inside the signup session** — existing bulk Market Desk
  import (`?setup=market-desk`), untouched by the PR; the dashboard now reads
  the `?created=N` handoff count (`readSetupCreatedCount`).
- **trigger the first live scan** — existing `queueFirstWatchlistScan` on
  watchlist creation, untouched; the free tier already gets an instant first
  scan with no card, pinned by existing onboarding/quota tests.
- **see a first mini-brief / first evidence land in-session** — new:
  - `listFirstScanRunStates` (`app/lib/data/watchlist-runs.server.ts`): latest
    first-scan run status per active never-scanned watchlist of the workspace,
    filtered to the `watchlist-run:first-scan:%` idempotency key so a later
    scheduled run never mislabels a first scan.
  - Market Desk Brief (`app/lib/market-desk-brief.ts`): live per-competitor
    states — "First scan running now — results land here", "starts shortly",
    and honest failed/skipped detail; the queued summary promises an in-session
    landing only while a scan is pending or running.
  - Overview (`app/routes/app.dashboard.tsx`): loader reads first-scan states
    (only when a never-scanned active competitor exists) and the `?created=N`
    handoff; `useFirstCapturePolling` auto-refreshes the page (bounded, ~10
    minutes of 30s polls, stops when nothing waits); a "First scan live" strip
    narrates "created N watchlists — the first live scan is running now… your
    first mini-brief lands here the moment it completes".
- **instant first scan on the free tier (no card)** — existing entitlement,
    test-pinned; no change needed.
- **morning brief with the overnight delta** — existing digest cadence,
    untouched.

## Verification run (this lane)

- **On current main** (this worktree, report branch only): the two test files
  that exist on main and are affected by the PR pass —
  `tests/market-desk-brief.test.ts` (14 tests) and `tests/dashboard.route.test.ts`
  (21 tests): **2 files / 35 tests passed**.
- **On the PR branch itself** (temporary detached worktree at `8dab529b`, since
  removed): the PR-added `tests/first-scan-run-states.server.test.ts`
  (data-layer SQL helper) passes: **1 file / 3 tests passed**.
- The PR author reported full Vitest (427 files / 4901 tests), typecheck, and
  build green on the previous head; CI on the refreshed head
  (codex-node-checks, required-verifier-integrity, Gitleaks) was re-running at
  verification time after the main merge.

## Why no new PR was opened

The packet requires landing the item or reporting plainly why it cannot be done.
Opening a second PR that re-implements an already-open, mergeable PR would fork
the work and conflict with the existing one — the item is done, and the blocking
state is only CI re-running after a routine main merge. The productive action is
to land PR #631, which is exactly this item.

## Files

- `.lane/reports/0509-lane1-same-session-first-value.md` — this evidence record
  (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
