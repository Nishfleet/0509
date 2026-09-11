# Lane evidence: claim/issue-2416

Delete the per-competitor Delivery settings card down to zero fields.

## Changes
- `app/components/watchlists/delivery-settings-card.tsx` renders zero form
  fields — sensitivity select, free-text timezone, quiet-hours number inputs,
  and five channel checkboxes all removed. Copy points at Targets and pauses
  for per-competitor control.
- `app/lib/delivery-policy.server.ts` — `resolveDeliveryConfig` returns fixed
  policy: sensitivity auto→balanced, quiet hours always 22:00-08:00, timezone
  from the workspace row only (null → UTC via safeTimeZone). Stored
  per-watchlist sensitivity/quiet-hours/timezone are no longer read. No data
  migration.
- `app/components/delivery-timezone-capture.tsx` (new) + `app/dashboard` action
  `capture-delivery-timezone`: posts `Intl.DateTimeFormat().resolvedOptions()
  .timeZone` once on first dashboard load when `workspaceDeliveryTimezone IS
  NULL`; the action validates IANA names and never overwrites a stored value.
- `app/components/watchlists/competitor-detail.tsx` — drops the removed card
  props. `delivery-targets-section.tsx` (per-target pause/resume) untouched.
- `tests/delivery-settings-card.render.test.tsx` rewritten to assert zero form
  fields and that no deleted control reappears from a stale stored row.
- `tests/delivery-policy.test.ts` — the watchlist-override case inverted:
  stored sensitivity/quiet-hours/timezone are ignored.
- `tests/delivery.server.test.ts`, `tests/instant-delivery-claim-integration
  .test.ts`, `tests/plan-limits.route.test.ts`, `tests/watchlists.route.test
  .ts` — pin the wall clock (quiet hours always on made wall-clock-dependent
  instant-send assertions flaky by hour) and the dashboard fetcher mock.

`app/lib/watchlist-route-actions.server.ts` `save-delivery-config` kept
verbatim — the action tests pin its posted-field contract.

## Verification
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 320 files / 4131 tests passed (prior full run on this commit: node 691
  files / 8324 tests, workers 56 files / 293 tests).
- No `migrations/**` or `tests/integration/**` touched; workers project not
  required.
