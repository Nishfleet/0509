# Weekly brief at workspace-local Monday morning (issue #2406)

Branch: `claim/issue-2406`
Base: `origin/main`

## What changed

- `workers/schedule.ts`: the Monday `0 5 * * MON` cron no longer assembles
  weekly digests (a single 05:00 UTC shot lands Sunday evening in the
  Americas). The three-hourly monitoring tick now hosts the weekly cycle —
  `includeDigests: true`, `digestCadence: "weekly"`, `digestLookbackDays: 7`.
  The Monday cron still fires weekly business numbers and first-of-month
  customer recaps; `workers/app.ts` keys those on the cron string.
- `app/lib/digest-orchestration.server.ts`: new
  `isWithinWeeklyDigestLocalWindow(instant, timezone)` — true only when the
  instant lands inside local Monday 05:00–08:00 in the given IANA zone
  (`safeTimeZone` fallback to UTC). `listWeeklyDigestWindowUserIds` resolves
  every candidate workspace's timezone and keeps the ones inside the window;
  the weekly enqueue passes them as `onlyUserIds`. The window width equals
  the tick spacing, so every timezone enters it exactly once per local
  Monday.
- `app/lib/data/digests.server.ts` + `app/lib/data.server.ts`: new
  `listDigestScheduleJobTimezones` — workspace delivery timezone first (the
  brief is a workspace-level send; `deliverWeeklyDigest` resolves its
  effective config with `watchlistConfig: null`), earliest watchlist-row
  timezone as fallback, null otherwise. `enqueueDigestScheduleJobs` accepts
  an optional `onlyUserIds` filter via `json_each`; `undefined` keeps the
  all-active insert, `[]` enqueues nothing.

## Precedence note

`resolveDeliveryConfig` is watchlist-first because it resolves per-watchlist
delivery. The weekly brief is per-workspace — the send path itself passes
`watchlistConfig: null` — so the window gate mirrors that: workspace row
wins, watchlist row is fallback signal only.

## Verification

- `npx vitest run --configLoader runner --project node tests/weekly-digest-window.test.ts tests/worker-schedule.test.ts` — 9/9 pass
- `npx vitest run --configLoader runner --project node tests/digest-schedule-jobs.test.ts tests/digest-schedule-exhaustion.test.ts tests/digest-strategy-retry.test.ts tests/digest-retention-retry.test.ts tests/digest-strategy-budget.test.ts` — 17/17 pass
- `npx vitest run --configLoader runner --project node tests/digest-strategy-flow.test.ts tests/digest-strategy-overlap.test.ts tests/digest-triage-orchestration.test.ts tests/digest-heartbeat-degrade.test.ts` — 27/27 pass
- `npx vitest run --configLoader runner --project node tests/monitoring-reliability.test.ts tests/plan-monitoring.test.ts tests/visual-diff-alert-payloads.test.ts tests/proof-first-pipeline.test.ts` — 57/57 pass
