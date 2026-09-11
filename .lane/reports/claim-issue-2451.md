# Lane evidence — claim/issue-2451 (Nishfleet/0509#2451)

Unit: pi-issue-0509-2451. Date: 2026-09-11.

## What changed

`INSERT OR IGNORE` in the landing-page backfill write paths discarded its D1
result. When a concurrent pass (nightly rail vs. hourly proof-hole catch-up)
won the deterministic row id between the existence check and the insert, the
loser still ran `replaceAnalysisFields` — wiping the winner's analysis fields
and installing its own — and reported `status: "captured"` for a row it did
not write.

Fixed in all three modules carrying the pattern:

- `app/lib/demo-brand-backfill.server.ts` (the finding's file)
- `app/lib/sitemap-timeline-backfill.server.ts` (same pattern, step 3)
- `app/lib/sneaker-resale-backfill.server.ts` (same pattern, step 3)

Each now captures the insert result and, when `meta.changes === 0`, skips
`replaceAnalysisFields` and reports `skipped_already_captured` with the
deterministic row id. `skipped_already_captured` was already a member of all
three status unions — no type change needed. The demo-brand path still records
the attempt as a day success (the proof hole is filled by the winner's row).

## Tests

- RED first: one new workerd integration test per module (capture override
  inserts the deterministic row + a sentinel `analysis_field` row mid-capture,
  simulating the concurrent winner). All three failed pre-fix with
  `expected 'captured' to be 'skipped_already_captured'`.
- GREEN: `npx vitest run --project workers` on the three integration files —
  29/29 passed.
- Node mocked suites: `execute.mockResolvedValue({})` mocks updated to return
  the real `.run()` shape `{ meta: { changes: 1 } }` (2 test files);
  `npx vitest run --configLoader runner --project node --changed origin/main`
  — 104/104 passed.
- sgscan: no new findings.
- crgate: exit 3 — CodeRabbit CLI not signed in on this machine; local review
  gate could not run (auth is Nish-reserved). CI autoreview covers the PR.
- `npm run typecheck` not run locally per the worker memory-budget rule
  (fleet-ops#4891, AGENTS.md): CI owns typecheck.
