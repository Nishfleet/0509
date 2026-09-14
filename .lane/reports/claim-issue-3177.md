# Lane evidence — claim/issue-3177

Issue: Nishfleet/0509#3177 — onboarding epic slice 4 (epic #3172).

## What shipped

- `app/lib/join-pipeline-metrics.ts` (new, pure) — probe name, latency
  types, `formatJoinLatencyMs`. Client-safe: the /status component renders
  with it.
- `app/lib/join-pipeline-metrics.server.ts` (new) —
  `recordJoinConfirmSample` writes the confirm latency into
  `status_probe_samples` as probe `join_first_confirm` (gated by
  FUNNEL_MEASUREMENT_ENABLED + Sec-GPC, never throws, no new table);
  `getJoinPipelineMetrics` reads p50/p95 over 24 h and 7 d for both
  time-to-first-confirm (probe samples) and time-to-first-brief
  (`user.createdAt` → `digest_run.created_at` where
  `summary_json.kind = "first_brief"` — the rows slices 1/3 write).
- `app/routes/join.tsx` — confirm leg writes the D1 sample before the
  signup redirect; the redirect now carries `source=join`.
- `app/components/auth-form.tsx` — `source=join` signups render the folded
  name/competitor as hidden inputs (or omit them), leaving the email
  credential as the only visible field. Direct signups unchanged.
- `app/routes/status.tsx` + `app/lib/public-status-counters.server.ts` —
  a "Join path" block with both metrics, honest empty/degraded lines.
- `e2e/join-path-questions.spec.ts` (new, join-flow project) — counts the
  path: 1 question input on /join, 1 confirm on the card, 0 question
  inputs on the signup fold (email credential only), settings route
  reachable, /status block renders the honest empty window.
- `playwright.config.ts` — join-flow testMatch widened to the new spec.

## Salvage note

A prior unit banked most of the lib/route work as
`wip/pi-issue-0509-3177-20260914T101213Z` @ d125130fa; this lane rebased it
onto current main, split the pure display helpers out of the `.server`
module (status.tsx used `formatJoinLatencyMs` in render — React Router
flagged "server-only module referenced by client"), and added the missing
e2e acceptance spec.

## Verification

- `npx vitest run --configLoader runner --project node tests/join-pipeline-metrics.test.ts tests/status.route.test.ts` — 34/34 pass.
- `npx vitest run --configLoader runner --project workers tests/integration/join-pipeline-metrics.integration.test.ts` — 1/1 pass (real D1: write + read path).
- `npx vitest run --configLoader runner --project node --changed origin/main` — 42 files / 453 tests pass.
- `E2E_START_LOCAL_SERVER=1 npx playwright test --project=join-flow` — 8/8 pass (5 slice-1 + 3 new); no server-module client leak in the log.
