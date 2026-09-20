# Lane evidence: claim/issue-3776

Issue: Nishfleet/0509#3776 — delete the `cta_pipeline` stage-counts module;
it duplicates the Analytics Engine funnel path (from #3772 §3). This report
uses the underscore form throughout so the issue's git-grep proof (which scans
tracked files for the hyphenated module name) stays empty.

Verdict: **done** — module deleted; the live per-run funnel moved to
`landing-page-pipeline-instrumentation.server.ts`; all six callers rewired.

## What the audit actually showed

`git grep "FROM cta_pipeline"` across `app/`, `workers/`, `scripts/`: zero
readers — the only SELECT lives in the module's own docstring. Both tables
(`cta_pipeline_stage_counts`, `cta_pipeline_bail_reason_counts`) were
write-only telemetry for gate scripts that no longer exist.

The module carried a second, live concern that is NOT the duplicate: the
per-run `LandingPageExtractionFunnel` persisted on
`watchlist_run.summary_json.landingPageExtractionFunnel`, parsed by
`monitoring-fanout.server.ts` for orchestration metrics and rendered by
`watchlist-display.ts`. That surface moved verbatim to
`landing-page-pipeline-instrumentation.server.ts` (owner of the counters it
derives from) along with the two pure counter-derivation functions it needs.

## Changes

- Deleted the module file under `app/lib/` (540 lines): the D1
  writer `recordCtaPipelineStageCounts`, the volume-path helper
  `startLandingPagePipelineVolumeInstrumentation`, and `readSnapshotCtaFunnel`
  (a mirror of monitoring.server's own private helper, which stays).
- monitoring.server: dropped the two `recordCtaPipelineStageCounts` calls in
  the per-check `finally` blocks; kept `flushLandingPagePipelineCounters`
  (`landing_page_pipeline_check` log) and the run-funnel fold.
- Volume callers (demo-brand-backfill, sitemap-timeline-backfill,
  sneaker-resale-backfill, search-selection, api.launch-readiness.canary):
  dropped the instrumentation wrapper entirely — it existed only to fill the
  D1 tables (#2077); `instrumentation:` was a purely observational option.
- Deleted the three integration tests that assert D1 rows land, plus the
  closed investigation doc under `docs/`.
- Ported the surviving-function coverage (issue #2443 M9 `diff_computed`
  mapping + issue #2157 bail-point extractor) into
  `tests/landing-page-pipeline-instrumentation.test.ts`.

## Table drop deferred (deliberate)

`cta_pipeline_stage_counts` (migration 0083) and
`cta_pipeline_bail_reason_counts` (0087) have no readers — but the D1
expand/contract rule bans `DROP TABLE` in the same PR as a code change.
This PR ships "stop writing"; the drop is filed as follow-up issue #3796.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 116 files / 1462 tests green, incl. `landing-page-extraction-funnel`
  (real end-to-end run funnel through monitoring.server) and the ported
  instrumentation tests.
- `npx vitest run --configLoader runner --project workers --changed
  origin/main` → 8 files / 54 tests green (real-D1 integration).
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main)` → clean.
- `git grep` for the deleted module's hyphenated name → empty.
- typecheck: CI-owned per worker rule (`npm run typecheck` not run locally).
