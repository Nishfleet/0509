# cta_pipeline_stage_counts empty despite recordCtaPipelineStageCounts wired — investigation (issue #1960)

**Status:** root cause identified; observability gap closed; prod table-fill pending a
deploy + a full telemetry day.

## Symptom

- `cta_pipeline_stage_counts` is empty: `SELECT day, stage, SUM(count) ...` returns
  `0 rows`, and `SELECT COUNT(*)` returns `row_count: 0` against production D1.
- The table itself exists (migration `0083_cta_pipeline_stage_counts.sql` is applied).
- `browser_job_telemetry` shows ~2,882 `landing_snapshot` rows in the last 7 days, so
  landing pages ARE being captured at volume.
- `wrangler tail 0509 --search 'landing_page_pipeline_check'` over 30s returned
  **0 matches** — the per-check flush log line is not appearing either.

Issue #1538 (the spec needs the real top bail-out reasons by frequency from one week of
telemetry), #1500 (silent-failure narrowing), and #1565 (the funnel counters) are all
blocked on this table being queryable.

## Method

- Read the recorder: `app/lib/cta-pipeline-stage-counts.server.ts`.
- Traced every caller of `recordCtaPipelineStageCounts` and
  `flushLandingPagePipelineCounters` in the repo.
- Traced every caller of the shared capture util `captureLandingPageSnapshot`, whose
  `landing_snapshot` telemetry rows dominate the "pipeline is exercised" signal.
- Read the design intent from the introducing commit `5ba577c5` (issue #1565):
  "Wire recordCtaPipelineStageCounts into both proof-capture paths' finally blocks."
- Ran the real-D1 integration suite (`tests/integration/cta-pipeline-instrumentation.integration.test.ts`,
  7 pre-existing + 2 added cases) to confirm the write path itself is correct against a
  real local D1 built from the repo's real migrations.

## Root cause

**The writer is only wired into the proof-capture funnel — not the code path that is
actually producing the `landing_snapshot` volume. The recorder is not broken; it is
never reached at scale.**

Concrete evidence (all code, no guesses):

1. `recordCtaPipelineStageCounts` has exactly **two** call sites in the entire app,
   both in `app/lib/monitoring.server.ts`, both in a `finally` block:
   - a `evaluateSelectiveProofCandidates` (scan path) — line 4119;
   - a `evaluateDirectWebsiteProofCandidate` (direct-website path) — line 4760.
2. `flushLandingPagePipelineCounters` (the `landing_page_pipeline_check` flush that the
   reporter tail'd to 0) is colocated with it — same two `finally` blocks. So a
   `landing_page_pipeline_check` log and a stage-count write fire or don't fire together.
3. Those two functions are only invoked when a **selective proof candidate** clears the
   proof funnel: observation has both `landing_page_url` and `ad_id`, a proof target
   resolves, a proof request key is issued, evidence budget/reservation gates pass, and
   the capture loop actually begins. Every earlier `continue`/`continue` (no target,
   budget exhausted, reservation skipped, …) exits **before** a `LandingPagePipelineCounters`
   is even created — recording nothing, not even `checks_started`.
4. The capture that actually runs at volume is the **discovery/selection enrichment** path:
   `enrichAndPersistSelectedAd` in `app/lib/search-selection.server.ts` calls
   `captureLandingPageSnapshot` with `routeContext: "selection_enrichment"` (line ~216),
   and backfill/canary callers (`demo-brand-backfill.server.ts`, `sneaker-resale-backfill.server.ts`,
   `sitemap-timeline-backfill.server.ts`, `app/routes/api.launch-readiness.canary.ts`)
   do the same. **None of these build pipeline counters, flush
   `landing_page_pipeline_check`, or call `recordCtaPipelineStageCounts`.** They call the
   same shared capture util, so they emit `landing_snapshot` telemetry — which is exactly
   the 2,000+ rows that looked like "the pipeline is running at volume" — but they are a
   different, un-instrumented code path.

So the two production observations are **consistent**, not contradictory:

- `landing_snapshot` rows high: the selection/enrichment + warmup capture path runs a lot.
- `cta_pipeline_stage_counts` empty AND `landing_page_pipeline_check` silent: the only
   instrumented path (the narrow proof funnel) either ran no qualifying candidates in the
   window or ran too few to reach a write. Whenever the proof funnel DOES run a capture,
   if it were exercised at volume we would see rows — so the funnel is running far below
   the level the issue assumed.

## Secondary, compounding gap (the one this change closes)

Two silent failure modes made the empty table **indistinguishable from a broken writer**:

- `if (!env.DB) return;` silently no-ops when the D1 binding is absent — indistinguishable
  from "writer is never reached."
- The entire write loop was wrapped in `try { } catch { }` with an empty catch — a D1
  write error was swallowed with **no log at all**.

Because both failures were silent, an operator could not tell "the recorder never runs on
this code path" (the real situation, per above) from "the recorder runs but throws every
write." That is the silent-failure genre at #1500.

### Durable (observability) fix in this PR

`recordCtaPipelineStageCounts` now emits a structured diagnostic
`cta_pipeline_stage_counts_writer` line:

- `ok: false, reason: "no_d1_binding"` when `env.DB` is absent;
- `ok: true, wrote: <n>` once per check that wrote > 0 rows (same cadence as the
  `landing_page_pipeline_check` flush in the same `finally`);
- `ok: false, reason: "d1_write_failed", error: <msg>` when a D1 write throws.

It still never throws (telemetry must not break a scan). A future operator reading an empty
table can now distinguish, from logs alone, "writer never reached"
(no writer lines, empty table) from "writer runs but breaks" (`d1_write_failed` lines).
Two integration tests pin both branches.

Note on the `wrote > 0` success guard: `ctaPipelineStageCountsFromCounters` always yields
`checks_started: 1`, so every real invocation of the recorder writes at least one row and the
`ok: true` line fires. "Reached but wrote nothing" cannot be masked by the guard today; if a
future change ever makes `checks_started` conditional, that invariant must be re-checked or the
ambiguity this PR closes would silently return.

## Why this table will still be empty for now

Even after this PR ships, the table stays empty until the six-stage funnel is wired into a
volume-producing path — and even then, the acceptance bullets require a deploy + at least
one full day of normal traffic to observe. The six stages (`dom_extracted`, `diff_computed`,
`event_emitted`, full `validity_passed` semantics) only have meaning where a landing page is
fully fetched **and** a target, diffed, and evented. The enrichment capture path does not
run the full funnel, so naively wiring a whole counters object there would fabricate funnels
for pages that never went through extraction/diff.

The honest, correct work to actually fill the table is:

1. Decide whether the instrumented funnel (proof/selective path) is the intended volume path
   (issue says "every landing-page change") — it currently only covers proof candidates.
2. If yes: widen the recorder + flush so they cover the scan entries that run at volume
   (the selective/refresh capture), with `checks_started` + `page_fetch_succeeded` recorded
   by the shared capture util and the extraction/diff stages recorded where those stages
   actually run.
3. Then a prod deploy + one telemetry day satisfies issue #1960's acceptance bullets 1–3.

That widening is deliberately **not** done in this PR: it changes behaviour on the hot path
and needs its own review + a real D1 integration test for the new wiring. It is tracked as a
follow-up (see issue #2077 / PR body).

## What this PR verifiably closes

- **Acceptance bullet 4** ("a short note on the root cause lands in
  `docs/cta-pipeline-stage-counts-investigation.md`") — this doc. **Closed.**
- The recruiter-reported "silent failure" of the writer (#1500 framing) — the observer
  gap in one hand-write path. **Closed** by the `ctta_pipeline_stage_counts_writer`
  diagnostics + 2 integration tests, which pass against real local D1.
- **Acceptance bullets 1–3** (COUNT>0, six stages present for a day, steady
  `landing_pipeline_check` stream) — **not closed here**: they require the volume-path
  wiring (follow-up) + a production deploy + a full telemetry day. A worker cannot populate
  production D1 or force a day of traffic; pretending otherwise would be a false close.