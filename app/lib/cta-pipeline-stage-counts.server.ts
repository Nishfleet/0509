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
import { LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import {
  createLandingPagePipelineCounters,
  flushLandingPagePipelineCounters,
  recordExtractStage,
  recordFetchStage,
  type LandingPagePipelineCounters,
} from "~/lib/landing-page-pipeline-instrumentation.server";
import type { LandingPageSnapshotData } from "~/lib/types";

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
  // Issue #2443 (finding M9): `baseline_established` is the no-prior-capture
  // outcome — `recordDiffStage`'s `ctaUnchanged` doc defines it as "no prior
  // capture to diff against". The stage doc above says `diff_computed` is the
  // diff stage that "ran against a prior capture", so a first-ever capture of
  // a page did NOT compute a diff and must not be counted here (counting it
  // overstated `diff_computed` and hid the real new-page bail-out point).
  const diffComputed =
    counters.diff.status !== null &&
    counters.diff.status !== "skipped_no_snapshot" &&
    counters.diff.status !== "baseline_established";
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
 * Issue #2157: the bail-out reason code for the FIRST stage a check dropped
 * out of, so the top-5 bail-out reasons by frequency are queryable from D1
 * (unblocks #1538 Gate 1 without a Logpush sink). Returns null when the check
 * reached the end and emitted an event (it did not bail).
 *
 * The reason vocabulary is the one the pipeline counters already carry — the
 * same codes the `lp_run_audit` lines emit as `outcome: "bailed:<reason>"`.
 * One bail reason per check (at the first bail point); a check that was
 * rescued by the render fallback did NOT bail at fetch, so it falls through to
 * the next stage that actually dropped it.
 *
 * Pure and side-effect-free so it is trivially unit-testable alongside
 * `ctaPipelineStageCountsFromCounters`.
 */
export function ctaPipelineBailReasonFromCounters(
  counters: LandingPagePipelineCounters,
): { stage: CtaPipelineStage; reason: string } | null {
  // A check that emitted an event reached the end of the funnel — no bail.
  if (counters.diff.confirmedEventTypes.length > 0) return null;

  const fetchSucceeded =
    counters.fetch.outcome === "succeeded" ||
    counters.fetch.outcome === "replayed";
  // The proof-capture funnel records a "failed" fetch with a "succeeded" render
  // when the plain-http leg bailed and the browser-render fallback rescued it.
  // That check did NOT bail at fetch — it continued through the funnel — so
  // only count a fetch bail when render did not rescue.
  const renderRescued =
    counters.fetch.outcome === "failed" &&
    counters.render.outcome === "succeeded";
  if (!fetchSucceeded && !renderRescued) {
    return {
      stage: "page_fetch_succeeded",
      reason: counters.fetch.reasonCode ?? "fetch_failed",
    };
  }

  if (counters.validity.outcome === "failed") {
    return {
      stage: "validity_passed",
      reason: counters.validity.reasonCode ?? "validity_failed",
    };
  }

  if (counters.extract.ctaFunnelStage === "bailed") {
    return {
      stage: "dom_extracted",
      reason: counters.extract.ctaFunnelReasonCode ?? "extract_bailed",
    };
  }

  // The diff stage is the proof-capture funnel's last gate. The volume paths
  // (selection_enrichment, backfill, canary) share this recorder but NEVER run
  // the diff stage (#2077) — a successful volume capture has `diff.status`
  // null and no events, which is NOT a bail (the capture reached the end of
  // the stages that run on that path). Counting it as an `event_emitted` bail
  // would drown the real top-5 in `no_event_emitted` rows from every successful
  // volume capture. So only record an event_emitted bail when the diff stage
  // actually ran (status set and not skipped_no_snapshot).
  //
  // NOT the same condition as `diffComputed` above (issue #2443, finding M9):
  // this asks "did the check reach the diff stage?" so a no-event outcome is
  // attributed to the right gate, and `baseline_established` DID reach it (its
  // field bails carry `no_baseline_first_scan`). `diffComputed` asks the
  // narrower "was there a prior capture to diff against?", where
  // `baseline_established` is a no. Keep the two separate.
  const diffRan =
    counters.diff.status !== null &&
    counters.diff.status !== "skipped_no_snapshot";
  if (!diffRan) return null;

  // The check reached the diff stage but no event was emitted. The per-field
  // bail reasons (diff.fieldBails) explain why; they are usually uniform (all
  // four fields share one reason), so the first reason is the bail reason.
  const fieldBailReasons = Object.values(counters.diff.fieldBails);
  const reason = fieldBailReasons[0] ?? "no_event_emitted";
  return { stage: "event_emitted", reason };
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
  const day = now.toISOString().slice(0, 10);
  const counts = ctaPipelineStageCountsFromCounters(counters);
  if (!env.DB) {
    // Issue #1960: a missing D1 binding used to be a silent no-op, so an
    // empty `cta_pipeline_stage_counts` table was indistinguishable from a
    // writer that was never reached. Surface it as a structured diagnostic so
    // an operator (or the fleet) can tell "no rows because nothing ran" apart
    // from "no rows because the writer is broken on this Worker."
    console.error(
      JSON.stringify({
        event: "cta_pipeline_stage_counts_writer",
        day,
        ok: false,
        reason: "no_d1_binding",
      }),
    );
    return;
  }
  try {
    let wrote = 0;
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
      wrote += 1;
    }
    // Issue #2157: persist the bail-out reason code for the first stage this
    // check dropped out of, so the top-5 bail-out reasons by frequency are
    // queryable from D1 (unblocks #1538 Gate 1 without a Logpush sink). A
    // check that emitted an event returns null here and writes nothing.
    const bail = ctaPipelineBailReasonFromCounters(counters);
    if (bail) {
      await env.DB.prepare(
        `INSERT INTO cta_pipeline_bail_reason_counts (day, stage, reason, count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(day, stage, reason) DO UPDATE SET count = count + excluded.count`,
      )
        .bind(day, bail.stage, bail.reason, 1)
        .run();
      wrote += 1;
    }
    if (wrote > 0) {
      // Issue #1960: one structured line per written check (same cadence as
      // the `landing_page_pipeline_check` flush in the same finally block), so
      // the funnel write is itself observable and not a silent success.
      console.log(
        JSON.stringify({
          event: "cta_pipeline_stage_counts_writer",
          day,
          ok: true,
          wrote,
        }),
      );
    }
  } catch (error) {
    // Issue #1960: a D1 write failure was previously swallowed, so an empty
    // table was indistinguishable from a writer that was never reached. Log the
    // underlying error, but never throw — a telemetry failure must not break a
    // scan. The drop-through is intentional: an empty table plus these error
    // lines points at a broken writer, while an empty table with no lines points
    // at a writer that is never invoked on the running code path.
    console.error(
      JSON.stringify({
        event: "cta_pipeline_stage_counts_writer",
        day,
        ok: false,
        reason: "d1_write_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Read the CTA extraction funnel stage + bail reason the capture path stored
 * on the snapshot metadata. Returns nulls for snapshots that predate the
 * funnel wiring so older captures do not break the counter. Mirrors the
 * private helper in monitoring.server.ts without importing it (avoids pulling
 * the whole monitoring module into the volume paths).
 */
function readSnapshotCtaFunnel(snapshot: {
  metadata?: Record<string, unknown>;
}): {
  stage: "reached" | "bailed" | null;
  reasonCode: string | null;
} {
  const metadata = snapshot.metadata;
  const rawStage = metadata?.ctaFunnelStage;
  const stage: "reached" | "bailed" | null =
    rawStage === "reached" || rawStage === "bailed" ? rawStage : null;
  const rawReason = metadata?.ctaFunnelReasonCode;
  const reasonCode =
    typeof rawReason === "string" && rawReason.length > 0 ? rawReason : null;
  return { stage, reasonCode };
}

/**
 * Issue #2077: the volume landing-page capture paths (selection_enrichment,
 * backfill, canary) did not build pipeline counters or call the recorder, so
 * `cta_pipeline_stage_counts` stayed empty even though `landing_snapshot`
 * volume was high (see docs/cta-pipeline-stage-counts-investigation.md).
 *
 * This helper wires the six-stage funnel into those paths WITHOUT fabricating
 * the stages that do not run there. These paths run fetch + render + extract
 * (the capture util extracts CTA / price / form signals into the snapshot).
 * They do NOT run the capture-validity gate, the change-diff, or
 * `landing_page_*` event emission — those are the proof-capture funnel
 * (monitoring.server.ts), which is already wired and is NOT changed here. So
 * this helper records only the stages that actually run:
 *   checks_started        — always (every capture that began)
 *   page_fetch_succeeded  — the capture produced a snapshot
 *   dom_extracted         — the snapshot carries extracted signals
 * validity_passed, diff_computed, and event_emitted stay at 0 on these paths;
 * fabricating them would hide where the real funnel drops.
 *
 * Usage at a capture call site:
 *   const instr = startLandingPagePipelineVolumeInstrumentation({ ... });
 *   const snapshot = await captureLandingPageSnapshot(env, url, {
 *     ...,
 *     instrumentation: instr.instrumentation, // records render stage
 *     onFailure: (detail) => { failureReasonCode = detail.reasonCode; },
 *   });
 *   instr.recordCaptureOutcome(snapshot, failureReasonCode);
 *   // in a finally block:
 *   await instr.finish(env);
 */
export interface LandingPagePipelineVolumeInstrumentation {
  /** Pass as the `instrumentation` option to captureLandingPageSnapshot. */
  instrumentation: LandingPagePipelineCounters;
  /** Record the fetch + extract outcome once the capture has returned. */
  recordCaptureOutcome: (
    snapshot: LandingPageSnapshotData | null,
    failureReasonCode: string | null,
  ) => void;
  /** Flush the per-check log line and persist stage counts to D1. Never throws. */
  finish: (env: AppEnv) => Promise<void>;
}

export function startLandingPagePipelineVolumeInstrumentation(context: {
  /**
   * Distinct per caller so the `landing_page_pipeline_check` log line is
   * attributable (e.g. "selection_enrichment", "demo_brand_backfill").
   */
  watchlistId: string;
  /** Stable per-check identity (e.g. the ad id or a deterministic capture key). */
  scanId: string;
  /** Ad id when the check backs an ad observation, else null. */
  adId: string | null;
}): LandingPagePipelineVolumeInstrumentation {
  const counters = createLandingPagePipelineCounters({
    scanId: context.scanId,
    watchlistId: context.watchlistId,
    adId: context.adId,
    extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
  });
  return {
    instrumentation: counters,
    recordCaptureOutcome: (snapshot, failureReasonCode) => {
      if (!snapshot) {
        recordFetchStage(counters, "failed", failureReasonCode ?? "capture_failed");
        return;
      }
      // The volume funnel's page_fetch_succeeded means "a usable snapshot
      // was produced" — whether via plain-http or the rendered fallback.
      // The proof-capture funnel records browser_render as a fetch failure
      // (its plain-http leg bailed), but on the volume path the render
      // rescue IS the success: the page was fetched. The render stage (which
      // the capture util records via instrumentation) carries the
      // plain-http-vs-render distinction in the structured log, so the
      // stage count stays a clean "did we get a snapshot" signal.
      if (snapshot.captureMethod === "browser_render") {
        recordFetchStage(counters, "succeeded", "browser_render_rescued");
      } else {
        recordFetchStage(counters, "succeeded");
      }
      // The capture util ran extractLandingPageSignals and stored the CTA
      // funnel stage on the snapshot metadata. Record it so dom_extracted
      // reflects extraction that actually ran on this path.
      const ctaFunnel = readSnapshotCtaFunnel(snapshot);
      recordExtractStage(counters, {
        ctaText: snapshot.ctaText ?? null,
        priceText: snapshot.priceText ?? null,
        formPresent: snapshot.formPresent ?? null,
        headline: snapshot.rawHeadline ?? null,
        ctaFunnelStage: ctaFunnel.stage ?? undefined,
        ctaFunnelReasonCode: ctaFunnel.reasonCode ?? undefined,
      });
    },
    finish: async (env) => {
      flushLandingPagePipelineCounters(counters);
      await recordCtaPipelineStageCounts(env, counters);
    },
  };
}
