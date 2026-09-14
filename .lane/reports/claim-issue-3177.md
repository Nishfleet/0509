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
- `npx vitest run --configLoader runner --project node --changed origin/main` — 43 files / 456 tests pass.
- `E2E_START_LOCAL_SERVER=1 npx playwright test --project=join-flow` — 8/8 pass (5 slice-1 + 3 new); no server-module client leak in the log.

## Resume pass (pi-issue-0509-3177, 2026-09-14 ~18:30 IST)

- PR #3508 existed but CI was red: `codex-node-checks` + `preview-assert`
  both failed `tsc -b` on `tests/join-pipeline-metrics.test.ts` — Vitest 4
  types a bare `vi.fn()`'s `mock.calls` as `[]` (empty tuple). Typed the
  prepare/bind mocks with explicit signatures; vitest stayed green.
- The earlier commit + PR body carried agent attribution trailers; amended
  out (hard rule) and force-pushed with lease.
- Reviewer round on senior seat `cursor/cursor-grok-4.6-high` (one round,
  stock reviewer): no BLOCKING findings. Three Act-on items fixed:
  1. Unsigned `f9_join_touch` cookie could inject a multi-year latency into
     the public p95 — confirm leg now bounds the delta by the cookie's own
     Max-Age (1 h); forged/stale values record the event with null latency.
     Pinned by new `tests/join-confirm-latency.test.ts` (route-action test,
     3 cases: real delta, forged cookie, absent cookie).
  2. `/status` "Join path" copy rewritten in plain words (unslop accept
     line): honest degraded line, no pipeline/sample jargon.
  3. `/auth/signup` story column told join-path visitors to "paste a
     competitor" — gated on `signupSource === "join"`; the join variant
     confirms the competitor is already picked. Default copy unchanged
     (prod-public spec asserts it).
- Consider/Noted/Dismissed findings recorded in the PR body.
- `npx vitest run --configLoader runner --project node tests/join-confirm-latency.test.ts tests/join-pipeline-metrics.test.ts tests/status.route.test.ts tests/auth-signup-structured-data.test.ts` — 40/40 pass; `--changed origin/main` sweep 43 files / 456 pass.
