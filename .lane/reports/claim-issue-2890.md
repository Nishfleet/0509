# #2890 proof-capture integrity — 7-day re-measurement + budget-skip reason fidelity

Branch: `claim/issue-2890`
Base: `origin/main` at `e203d87cc9`

## Measurement (issue acceptance 1 — run first, recorded here and in the PR body)

Query run against production D1 (`0509`, database_id `746c6e3d-…`) via
`wrangler d1 execute 0509 --remote` at 2026-09-11T09:44Z, using the repo's own
canary (`scripts/canary-proof-screenshot-rate.mjs --window-hours 168`) plus
direct status counts:

- succeeded `proof_capture` rows in trailing 168h: **0** (with screenshot key: 0)
- `proof_capture` rows total (all time): **0**
- `watchlist`, `watchlist_run`, `watch_event`, `event_candidate`,
  `proof_target`: **0 rows each**
- `user`: 16 rows (2026-04-19 → 2026-09-11), `dodo_webhook_event`: 1130,
  `discovery_cache_entry`: 357, `rate_limit_events`: 1301,
  `landing_page_snapshot`: 65, `user_plan`: 1

Interpretation: the 2026-08-25 roadmap reading (115/598 = 19%) is stale —
the entire monitoring subtree is currently empty in prod (`watchlist` deletes
cascade to `proof_target` → `proof_capture` per migrations/0001/0007 FKs).
The ≥90% attach-rate half is **unjudgeable, not failing**: n=0, the same SKIP
verdict the screenshot-rate guard emits for small samples. No new capture can
be silently missing a screenshot because no captures ran. Filed a separate
finding issue on the emptied monitoring tables.

## What was already shipped (verified on main, not re-built)

- `skipped_due_to_budget` rows are written by every skip path
  (`app/lib/monitoring.server.ts`) and read back by
  `app/lib/data/watchlist-run-capture-attempts.server.ts` into run history,
  `/api/v1/watchlists/:id/runs/latest`, and the MCP surface (#1289).
- Evidence card renders "Budget exhausted — plan allowance reached …" plus a
  `/capture-rules#budget-skip` "why this happened" link (#1879, #1485), and the
  run-history route renders status + reason + learn-more per attempt.

## Delta this PR adds

One residual gap against "visible **with its reason**": the stored
`capture_diagnostics.budgetReason = 'top_up_inactive_plan'` (purchased credit
packs held by an inactive plan, `app/lib/evidence-usage.server.ts`) was
flattened to `budget_skip` → "Skipped — plan allowance reached … resets on
your next plan cycle" — factually wrong for that row (the credits exist; the
plan lapsed). Changes:

- `app/lib/capture-attempt-reason-code.ts`: new public reason code
  `budget_topup_inactive` (+ `budgetReason` option on `toPublicReasonCode`,
  + label "Skipped — purchased credits need an active plan").
- `app/lib/data/watchlist-run-capture-attempts.server.ts`: select
  `capture_diagnostics`, pass `budgetReason` through — run-history UI, REST
  API, and MCP all inherit it.
- `app/lib/run-history-capture-visibility.ts`: `resolveProofCaptureRefusal`
  renders the row as "Credits blocked — … need an active paid plan …
  reactivate your plan" instead of "Budget exhausted".
- `app/lib/capture-validity-public-rules.ts`: one added sentence on
  `/capture-rules#budget-skip` covering credits-needing-active-plan.
- `docs/PROJECT-HISTORY.md`: vocabulary list updated.

No migrations, no capture-budget or billing changes; read-path only.

## Verification

- `npx vitest run --configLoader runner --project node -t 'budget'` →
  51 files, 166 tests passed (issue's verify command).
- `npx vitest run --configLoader runner --project workers
  tests/integration/watchlist-run-capture-attempts.integration.test.ts` →
  6/6, incl. new real-D1 case asserting `budget_topup_inactive`.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 356 files, 4616 tests passed.
