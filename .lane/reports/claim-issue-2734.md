# claim/issue-2734 — weekly brief catch-up for a lost in-window tick

## Diagnosis (from issue + landed code)

#2406/#2733 moved the weekly brief onto the 3-hourly monitoring tick: a
workspace's digest job is enqueued only while its local time sits inside
Monday 05:00-08:00. Window width equals tick spacing, so exactly one tick
per local Monday opens the gate — that is the exactly-once guarantee, and
also the fragility: if Cloudflare delays or drops that one tick (or the
candidates read fails closed at it), the workspace misses the whole week.
A job that is never enqueued is invisible to the pending-job recovery
sweep.

## Fix (the issue's catch-up shape, keyed on the workspace's local week)

`resolveWeeklyDigestCatchUpWindow(instant, timezone)` — null unless the
workspace's local time is Monday >= 08:00; then returns the one 3-hourly
tick that sat inside its closed window plus its local ISO-week UTC bounds.

`planWeeklyDigestCatchUpEnqueues` runs that resolver over the same
candidates read the window gate already pays for, then drops every
workspace that already has a weekly job filed inside its ISO week (new
`listDigestScheduleJobPeriodEnds` read, fail-closed like the candidates
read). Survivors enqueue under the MISSED tick's own period tuple, so the
UNIQUE (user_id, cadence, period_start, period_end) key also dedupes any
workspace a late-delivered on-time event did reach. Catch-up stays inside
local Monday only — widening past Monday is the accept-the-miss edge the
issue leaves intact.

No migration, no new cron — the catch-up rides the existing 3-hourly tick
the week of the miss.

## Files

- `app/lib/digest-orchestration.server.ts` — resolver + planner + call-site
  wiring in `runDigestDeliveryCycleDetailed`
- `app/lib/data/digests.server.ts` — `listDigestScheduleJobPeriodEnds`
- `app/lib/data.server.ts` — barrel re-export
- `workers/schedule.ts` — comment update
- `tests/weekly-digest-window.test.ts` — harness tables + 5 catch-up tests

## Verification

- `npx vitest run --project node tests/weekly-digest-window.test.ts` —
  11/11 pass (window math, ISO-week bounds, dedupe read, end-to-end cycle
  at a post-window tick, exactly-once re-run)
- `npx vitest run --configLoader runner --project node --changed
  origin/main` — 387 files / 4711 tests pass
- `semgrep --config p/default --baseline-commit <merge-base>` — clean

## Review round 1 (2026-09-20, post-diff)

Engines: the pi reviewer subagent (read-only, full-diff review).
Acceptance verdicts — all three met: local-week catch-up keyed on
`resolveWeeklyDigestCatchUpWindow` (local Monday ≥ 08:00 + week-span
dedupe), the #2406 window gate untouched (null before/inside the window,
boundary hour < 8 exclusive on both sides, no gap), and no double-send
under a different periodEnd (catch-up files the on-time tuple so the
UNIQUE key collides; week-span read blocks off-lattice filings;
re-runs file nothing — pinned by the e2e tests).

Buckets:
- Act on (fixed this round): (a) fail-closed catch-up reads were untested
  → new `tests/weekly-digest-catchup-failclosed.test.ts` pins both
  (candidates throw, dedupe throw), sensitivity proven by mutation;
  (b) docstring said "refinement against the offset at the result"
  but code measures at the guess — corrected; (c) catch-up enqueue now
  pins `cadence: "weekly"` so a hypothetical non-weekly caller can never
  file weekly-shaped periods as daily rows.
- Consider (open question for Nish): mid-Monday timezone-change re-key
  edge — a tz edit between Monday 00:00 and the catch-up tick moves the
  ISO-week span siloing out the already-filed brief, so a second weekly
  job can file under the new zone's missed tick (~6–9h apart, overlapping
  data windows). The on-time gate carries the same shape on its own, so
  this is a pre-standing class, not a regression; needs a product
  decision (accepted edge vs widening the covered span by 24h).
- Noted: `Math.min/max` spread + O(users×rows) coverage check (fine at
  current scale); fresh `Intl.DateTimeFormat` per call (~5/candidate vs
  1 for the on-time gate); dedupe read has no cadence-prefix index and
  completed rows are never pruned (follow-up issue filed); DST-
  transition-Monday and quarter-hour catch-up sweeps; `WEEKLY_DIGEST_TICK_MS`
  ↔ cron spacing pin. Harness nit: `emailVerified DEFAULT 1` vs prod
  `DEFAULT 0` in the fixture DDL.
- Dismissed: "no serving index / unbounded scan " — overstated; the
  `UNIQUE (user_id, cadence, period_start, period_end)` index can serve
  the `user_id IN (json_each)` read per-user, and the read runs only
  when a missed set exists.

CI gate repair: PR #3746's shard-4 red came from MAIN drift, not from
this diff — 987ba3b3d (landed on main pre-merge-base, PR-merges skip CI)
added two unannotated ISO literals to `tests/sources/hiring-snapshot.test.ts`
breaking the #3215 no-time-bomb gate. Fixed here as a separate chore
commit (marker annotation, matching the file's own convention).

Round-1 verification (all in-round):
- `npx vitest run --configLoader runner --project node
  tests/weekly-digest-catchup-failclosed.test.ts tests/weekly-digest-window.test.ts
  tests/no-time-bomb-fixtures.test.ts tests/sources/hiring-snapshot.test.ts`
  — 28/28 pass
- `npx vitest run --configLoader runner --project node --changed
  origin/main` — 388 files / 4713 tests pass
- `semgrep --config p/default --baseline-commit <merge-base>` — clean
