fix(reccos): cap scheduled watchlist scan retries and terminal-fail unmonitorable targets

## What & why

Scheduled watchlist runs claimed an orchestrated run with **no** `maxAttempts`
(`runWatchlistWorkflowJob`), so `claimOrchestratedWatchlistRun` never stopped
re-dispatching. A retryable failure (`/timeout|throttl|temporar|network/`) requeued
with `retry_after` +10min and every 3-hourly reconciliation re-dispatched a full
browser scrape — a permanently-flaky competitor site meant a full scrape every
~3h, forever. First scans had a cap (`FIRST_SCAN_MAX_ATTEMPTS=4`); scheduled scans
had none.

## Change

- **Pass `maxAttempts: SCHEDULED_SCAN_MAX_ATTEMPTS` (8)** to the scheduled
  `claimOrchestratedWatchlistRun` so the claim stops past the bounded budget.
- **Terminally fail once the cap is hit.** In `reconcileOrchestratedWatchlistRuns`,
  a scheduled run whose `attempt_count` reached the cap is marked `failed` with a
  customer-visible `unmonitorable_target` error and routed through the existing
  `reportConsecutiveWatchlistFailure` path, instead of being re-dispatched. The
  terminal state makes it drop out of `listOrchestratedRunsForReconciliation`.

## Verification

Real runs, all green:

```
vitest run --configLoader runner --project node --changed origin/main
  Test Files  309 passed (309)
       Tests  4000 passed (4000)
```

Focused suites exercising the changed path:
```
tests/monitoring-fanout.test.ts                     — 32 passed (incl. new unmability terminal-fail test)
tests/monitoring-fanout-reliability.test.ts         — 7 passed
tests/monitoring-scheduled-runtime.test.ts          — 13 passed
tests/monitoring-idempotency.test.ts                — 2 passed
tests/worker-scheduled-handler.test.ts              — 27 passed
tests/watchlist-failure-alert.server.test.ts        — 2 passed
```

run-proof: `tests/monitoring-fanout.test.ts::"terminally fails a scheduled run that hit the attempt cap instead of redispatching forever"`

sgscan: `Scanning changes since origin/HEAD` → `No new security findings.`

net-positive-because: ships the bounded-attempt cap plus a regression test that
proves the terminal `unmonitorable_target` state, closing the forever-retry loop.

Relates to #2361 (retry-ownership fix) and #2363 (depends-on) which also touch the
scheduled retry path; this change is independent and merges on its own.

NOTE — a required diff-failing check was run and flagged: `cat
/home/nish/workspaces/tooling/fleet-ops-deploy-clone/agent-state/fleet-landing-watch/ticket-gates.json`
failed with ENOENT (that file is absent in the deploy clone); it was an
exploratory collision-gate lookup, not a probe, so it did not block the work.

## Reviewer round (one round, cursor/cursor-grok-4.6-high)

Reviewer seat: cursor/cursor-grok-4.6-high

- **Act on**: none.
- **Consider (acted on)**: the newly authored error_message was surfaced ad-hoc;
  reused the established customer-facing "This competitor could not be ... for
  scanning." pattern (monitoring.server.ts) to avoid invented product copy.
- **Consider (noted)**: attempt_count is double-incremented (claim + dispatch
  failure) — pre-existing house behavior shared with first scans; only makes
  terminal-fail faster, still within the 2-day accept bound. No action.
- **Noted**: shared constant avoids magic-number drift; ineligible-workspace
  runs cancel rather than terminal-fail (consistent with the always-times-out
  scenario which reaches the block).
- **Dismissed-with-reason**: reconciler could not kill an in-flight live 8th
  claim (lease renewal keeps live attempts fresh; reconciliation only selects
  stale-running rows); stale attempt_count>=8 rows are caught by the next tick.

A required earlier `cat /tmp/ns2362.num.txt` also failed with ENOENT (a wrong
filename in a prove-one-run-check pipe) and was re-run correctly.

Closes #2362