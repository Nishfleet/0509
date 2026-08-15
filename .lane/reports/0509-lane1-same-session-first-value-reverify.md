# SAME-SESSION FIRST VALUE — re-verified: implemented by open PR #631 (still not merged)

**Status: evidence record — the item is implemented in Nish's open PR #631,
re-verified current against today's main. No product code touched by this lane.**

Branch: `0509-lane1-same-session-first-value-reverify`
Base: `origin/main` at `42db40fd` (#747)

## Item

- [ ] SAME-SESSION FIRST VALUE — paste competitors -> first live scan -> first
      mini-brief inside the signup session
      [source: consolidated-gap-v1] [tier-1] [risk: amber] [activation] [conversion]

## Verdict

The item is **already implemented** by PR #631 (`feat/same-session-first-value`,
author nish3451, open since 2026-08-11, base `main`) and remains **unmerged**.
Re-verified against the current live tree on 2026-08-15:

- `git merge-base origin/main origin/feat/same-session-first-value` ==
  `origin/main` tip (`42db40fd`) — the PR branch contains current main; it
  merges cleanly with no refresh needed.
- PR #631 `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED` only because its
  required checks are re-running after the latest main merge (head
  `e2ebe369`, pushed 2026-08-15T03:32Z). Prior green run on the previous head:
  codex-node-checks, required-verifier-integrity, Gitleaks all passed.
- The PR head moved since the 2026-08-14 evidence record (`b6315245`, which
  documented head `8dab529b`); this record supersedes it.

## What PR #631 implements (acceptance mapping)

The PR diff vs main (638 insertions / 8 files) delivers exactly the item's
acceptance criteria:

- **paste competitors inside the signup session** — existing bulk Market Desk
  import (`app/lib/setup-checklist-action.server.ts` commits selected rows and
  redirects to `/app?setup=market-desk&created=N`); the dashboard reads the
  `?created=N` handoff count (`readSetupCreatedCount`).
- **trigger the first live scan** — existing `queueFirstWatchlistScan` on
  watchlist creation dispatches the durable first-scan Workflow immediately
  (`app/lib/monitoring-fanout.server.ts` `dispatchFirstWatchlistScanWorkflow`),
  not on cron.
- **see a first mini-brief / first evidence land in-session** — new:
  - `listFirstScanRunStates` (`app/lib/data/watchlist-runs.server.ts`): latest
    first-scan run status per active never-scanned watchlist, filtered to the
    `watchlist-run:first-scan:%` idempotency key.
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

On the PR head `e2ebe369` (temporary worktree, since removed):

| Check | Result |
| --- | --- |
| `tests/first-scan-run-states.server.test.ts` | 3 tests passed |
| `tests/market-desk-brief.test.ts` | 18 tests passed |
| `tests/dashboard.route.test.ts` | 27 tests passed |
| Total | 3 files / 48 tests passed |

The PR author previously reported full Vitest, typecheck, and build green on an
earlier head; CI on the refreshed head (codex-node-checks,
required-verifier-integrity, Gitleaks) was queued at verification time.

## Open review note (non-blocking)

Codex review raised one P2 on 2026-08-12: when every first-scan run is
terminal (`failed`/`skipped`) and the watchlist is still unscanned, the brief
fallback still titles "First sweep is queued" even though no queued run exists.
Item-level detail is honest; only the headline overstates. Not a blocker for
the item's acceptance (the in-session running/pending/landing path is what the
item measures), but worth addressing in PR #631 before merge.

## Why no new PR was opened

Opening a second PR that re-implements an already-open, mergeable PR owned by
Nish would fork the work and conflict with it. The item is done in PR #631;
the remaining step is landing that PR (author: Nish), which is outside this
lane's authority (packet forbids pushing to main; merging a PR is a
shared-state action). The productive action is to land PR #631.

## Files

- `.lane/reports/0509-lane1-same-session-first-value-reverify.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
