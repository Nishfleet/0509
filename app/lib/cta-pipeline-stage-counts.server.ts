/**
 * Landing-page CTA-change detector pipeline stage counters (issue #1565).
 *
 * The pipeline already emits a per-check JSON log line
 * (`landing_page_pipeline_check`) via
 * `app/lib/landing-page-pipeline-instrumentation.server.ts`, but that log is
 * not queryable in D1. This module turns the per-check counters into a
 * per-day, per-stage count that is written to the `cta_pipeline_stage_counts`
 * table so an operator (or the fleet) can run:
 *
 *   SELECT stage, SUM(count) FROM cta_pipeline_stage_counts
 *   WHERE day >= date('now','-3 days') GROUP BY stage;
 *
 * and see where checks bail out. The six stages are the issue's accept-criteria
 * funnel:
 *
 *   checks_started        — every landing-page check that began
 *   page_fetch_succeeded  — the page fetch (or replay) produced a snapshot
 *   validity_passed       — the capture-validity gate classified the capture
 *                           as a real page (not an error/challenge/cookie wall)
 *   dom_extracted         — the DOM extraction stage ran and produced fields
 *   diff_computed         — the change-diff stage ran against a prior capture
 *   event_emitted         — the check confirmed at least one landing_page_* event
 *
 * The mapping is derived from the pipeline counters that
 * `app/lib/landing-page-pipeline-instrumentation.server.ts` already records, so
 * this module adds no new instrumentation surface — it only persists what the
 * pipeline already knows. Writes are best-effort: a D1 failure must never break
 * a scan, so `recordCtaPipelineStageCounts` never throws.
 */
import type { AppEnv } from "~/lib/env.server";
import type { LandingPagePipelineCounters } from "~/lib/landing-page-pipeline-instrumentation.server";

export const CTA_PIPELINE_STAGES = [
  "checks_started",
  "page_fetch_succeeded",
  "validity_passed",
  "dom_extracted",
  "diff_computed",
  "event_emitted",
] as const;

export type CtaPipelineStage = (typeof CTA_PIPELINE_STAGES)[number];

/**
 * Derive the six per-stage counts from a completed pipeline counters object.
 * Pure and side-effect-free so it is trivially unit-testable.
 *
 * A stage counts as reached (1) only when the pipeline actually progressed
 * past it; a bail-out at an earlier stage leaves the later stages at 0 (and
 * they are not written, so a missing row reads as zero). The validity stage
 * is reached when the capture-validity gate ran and passed — a "suppressed"
 * capture (valid page, no confirmed change) counts as passed, because the
 * page was real; only "capture_failed" is a bail-out.
 */
export function ctaPipelineStageCountsFromCounters(
  counters: LandingPagePipelineCounters,
): Record<CtaPipelineStage, number> {
  const fetchSucceeded =
    counters.fetch.outcome === "succeeded" ||
    counters.fetch.outcome === "replayed";
  const validityPassed = counters.validity.outcome === "passed";
  // The extract stage ran (and ctaFunnelStage becomes non-null) only when the
  // DOM extraction actually ran against a snapshot.
  const domExtracted = counters.extract.ctaFunnelStage !== null;
  const diffComputed =
    counters.diff.status !== null &&
    counters.diff.status !== "skipped_no_snapshot";
  const eventEmitted = counters.diff.confirmedEventTypes.length > 0;

  return {
    checks_started: 1,
    page_fetch_succeeded: fetchSucceeded ? 1 : 0,
    validity_passed: validityPassed ? 1 : 0,
    dom_extracted: domExtracted ? 1 : 0,
    diff_computed: diffComputed ? 1 : 0,
    event_emitted: eventEmitted ? 1 : 0,
  };
}

/**
 * Persist one check's stage counts into `cta_pipeline_stage_counts`, keyed by
 * UTC day. Each stage that was reached increments its (day, stage) row by 1.
 * Stages not reached are not written (a missing row reads as zero). Never
 * throws — a telemetry write failure must not break a scan.
 */
export async function recordCtaPipelineStageCounts(
  env: AppEnv,
  counters: LandingPagePipelineCounters,
  now: Date = new Date(),
): Promise<void> {
  if (!env.DB) return;
  const day = now.toISOString().slice(0, 10);
  const counts = ctaPipelineStageCountsFromCounters(counters);
  try {
    for (const stage of CTA_PIPELINE_STAGES) {
      const count = counts[stage];
      if (count <= 0) continue;
      await env.DB.prepare(
        `INSERT INTO cta_pipeline_stage_counts (day, stage, count)
         VALUES (?, ?, ?)
         ON CONFLICT(day, stage) DO UPDATE SET count = count + excluded.count`,
      )
        .bind(day, stage, count)
        .run();
    }
  } catch {
    // Best-effort telemetry. A D1 failure here must never fail the scan.
  }
}
