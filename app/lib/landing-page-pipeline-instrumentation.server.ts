/**
 * Landing-page detector pipeline instrumentation.
 *
 * The landing-page field-extraction pipeline (headline / CTA / price /
 * form-present) runs four stages per check: fetch → render → extract → diff.
 * Each stage can bail out silently, and a bail-out at an early stage
 * suppresses every `landing_page_*` event that would have fired downstream.
 * Issue #949: the CTA detector was near-silent (4 events in 4 months) because
 * bail-outs were invisible — there was no per-stage counter to show which
 * gate was dropping the signal.
 *
 * This module is a self-contained, side-effect-free accumulator. The pipeline
 * stages call the recording functions as they run; `flush` emits one
 * structured JSON log line per check with the stage-by-stage outcome counts
 * and bail-out reasons. It never writes to D1, never throws, and never alters
 * pipeline behaviour — it is read-only telemetry, so it cannot break the live
 * cron.
 *
 * Counters are intentionally per-check (one accumulator per observation), not
 * module-global: Cloudflare Workers run checks concurrently, and a shared
 * singleton would mix unrelated scans together.
 */

export type LandingPageFetchOutcome =
  | "succeeded"
  | "replayed"
  | "failed"
  | "empty_shell";

export type LandingPageRenderOutcome = "succeeded" | "failed" | "not_attempted";

export type LandingPageDiffStatus =
  | "baseline_established"
  | "confirmed"
  | "suppressed"
  | "invalidated"
  | "skipped_no_snapshot";

export interface LandingPagePipelineScanContext {
  /** Stable scan identity (e.g. proofRequestKey) — never the raw URL. */
  scanId: string;
  /** Watchlist id, or "direct_website" for the direct-website proof path. */
  watchlistId: string;
  /** Ad id when the check backs an ad observation, else null. */
  adId: string | null;
  /** Extractor version the extract stage ran with. */
  extractorVersion: string | null;
}

export interface LandingPagePipelineCounters {
  context: LandingPagePipelineScanContext;
  fetch: {
    outcome: LandingPageFetchOutcome | null;
    reasonCode: string | null;
  };
  render: {
    outcome: LandingPageRenderOutcome;
    reasonCode: string | null;
  };
  extract: {
    ctaFound: boolean;
    priceFound: boolean;
    formPresent: boolean;
    headlineFound: boolean;
    warnings: string[];
    // Issue #1401: CTA field-extraction funnel. `ctaFunnelStage` is "reached"
    // when the extractor produced a CTA value, "bailed" when it did not.
    // `ctaFunnelReasonCode` names the bail gate (no_cta_candidates,
    // only_chrome_buttons, only_chrome_anchors, empty_capture) so a log/backfill
    // GROUP BY can surface the dominant bail-out. Null when stage is "reached".
    // Accept-criteria aliases (`cta_field_reached` / `cta_field_bailed`) are
    // emitted on flush so `rg -n "cta_field_reached|cta_field_bailed|..."`
    // and operator log queries match the issue wording exactly.
    ctaFunnelStage: "reached" | "bailed" | null;
    ctaFunnelReasonCode: string | null;
  };
  diff: {
    status: LandingPageDiffStatus | null;
    /** Per-field bail reason when the diff produced no event for that field. */
    fieldBails: Record<string, string>;
    confirmedEventTypes: string[];
    // Issue #1401: the third funnel stage. "unchanged" is a diff-time concept
    // (both captures reached the CTA stage and the churn-stable values
    // matched), not an extraction concept. True only when the diff ran with a
    // prior capture, both sides had a non-null CTA, and no CTA event fired.
    // Accept-criteria alias: `cta_field_unchanged` on flush.
    ctaUnchanged: boolean | null;
  };
}

/** Accept-criteria stage names (issue #1401 verify step 1). */
export type CtaFieldFunnelBucket =
  | "cta_field_reached"
  | "cta_field_bailed"
  | "cta_field_unchanged";

export function ctaFieldFunnelBucketFromStage(
  stage: "reached" | "bailed" | null,
): Exclude<CtaFieldFunnelBucket, "cta_field_unchanged"> | null {
  if (stage === "reached") return "cta_field_reached";
  if (stage === "bailed") return "cta_field_bailed";
  return null;
}

export function createLandingPagePipelineCounters(
  context: LandingPagePipelineScanContext,
): LandingPagePipelineCounters {
  return {
    context,
    fetch: { outcome: null, reasonCode: null },
    render: { outcome: "not_attempted", reasonCode: null },
    extract: {
      ctaFound: false,
      priceFound: false,
      formPresent: false,
      headlineFound: false,
      warnings: [],
      ctaFunnelStage: null,
      ctaFunnelReasonCode: null,
    },
    diff: {
      status: null,
      fieldBails: {},
      confirmedEventTypes: [],
      ctaUnchanged: null,
    },
  };
}

export function recordFetchStage(
  counters: LandingPagePipelineCounters,
  outcome: LandingPageFetchOutcome,
  reasonCode: string | null = null,
) {
  counters.fetch.outcome = outcome;
  counters.fetch.reasonCode = reasonCode;
}

export function recordRenderStage(
  counters: LandingPagePipelineCounters,
  outcome: LandingPageRenderOutcome,
  reasonCode: string | null = null,
) {
  counters.render.outcome = outcome;
  counters.render.reasonCode = reasonCode;
}

export function recordExtractStage(
  counters: LandingPagePipelineCounters,
  input: {
    ctaText: string | null;
    priceText: string | null;
    formPresent: boolean | null;
    headline: string | null;
    warnings?: string[];
    // Issue #1401: the CTA funnel stage + bail reason from the extractor.
    ctaFunnelStage?: "reached" | "bailed";
    ctaFunnelReasonCode?: string | null;
  },
) {
  counters.extract.ctaFound = Boolean(input.ctaText);
  counters.extract.priceFound = Boolean(input.priceText);
  counters.extract.formPresent = input.formPresent === true;
  // A headline that fell back to the generic "Landing page" placeholder is
  // not a real detection — the extractor could not find og:title, <title>,
  // or <h1>. Counting it as found would hide a headline-stage bail-out.
  counters.extract.headlineFound =
    Boolean(input.headline) && input.headline !== "Landing page";
  counters.extract.warnings = input.warnings ?? [];
  // The funnel stage is authoritative (it is computed inside the extractor
  // from which fallback tier fired). Fall back to the legacy found/not-found
  // inference only when the extractor did not report a stage — keeps older
  // call sites working while the wiring rolls out.
  counters.extract.ctaFunnelStage =
    input.ctaFunnelStage ?? (input.ctaText ? "reached" : "bailed");
  counters.extract.ctaFunnelReasonCode =
    input.ctaFunnelReasonCode ?? (input.ctaText ? null : "no_cta_candidates");
}

export function recordDiffStage(
  counters: LandingPagePipelineCounters,
  input: {
    status: LandingPageDiffStatus;
    fieldBails?: Record<string, string>;
    confirmedEventTypes?: string[];
    // Issue #1401: the "unchanged" funnel stage — true when the diff ran
    // against a prior capture, both sides reached the CTA stage, and no CTA
    // change event fired. Null when there was no prior capture to diff
    // against (baseline_established) so a backfill does not count a first
    // capture as "unchanged".
    ctaUnchanged?: boolean | null;
  },
) {
  counters.diff.status = input.status;
  counters.diff.fieldBails = input.fieldBails ?? {};
  counters.diff.confirmedEventTypes = input.confirmedEventTypes ?? [];
  counters.diff.ctaUnchanged = input.ctaUnchanged ?? null;
}

/**
 * Emit one structured log line summarising the check's journey through the
 * four stages. Called once per check after the pipeline completes (or after a
 * bail-out). Never throws — a logging failure must never break a scan.
 */
export function flushLandingPagePipelineCounters(
  counters: LandingPagePipelineCounters,
) {
  try {
    const payload = {
      event: "landing_page_pipeline_check",
      scanId: counters.context.scanId,
      watchlistId: counters.context.watchlistId,
      adId: counters.context.adId,
      extractorVersion: counters.context.extractorVersion,
      fetch: counters.fetch,
      render: counters.render,
      extract: {
        ctaFound: counters.extract.ctaFound,
        priceFound: counters.extract.priceFound,
        formPresent: counters.extract.formPresent,
        headlineFound: counters.extract.headlineFound,
        warnings: counters.extract.warnings,
        // Issue #1401: CTA funnel stage + bail reason.
        ctaFunnelStage: counters.extract.ctaFunnelStage,
        ctaFunnelReasonCode: counters.extract.ctaFunnelReasonCode,
        // Accept-criteria aliases for operator queries / verify step 1.
        cta_field_reached: counters.extract.ctaFunnelStage === "reached",
        cta_field_bailed: counters.extract.ctaFunnelStage === "bailed",
        ctaFieldFunnelBucket: ctaFieldFunnelBucketFromStage(
          counters.extract.ctaFunnelStage,
        ),
      },
      diff: {
        status: counters.diff.status,
        fieldBails: counters.diff.fieldBails,
        confirmedEventTypes: counters.diff.confirmedEventTypes,
        // Issue #1401: the "unchanged" stage.
        ctaUnchanged: counters.diff.ctaUnchanged,
        cta_field_unchanged: counters.diff.ctaUnchanged === true,
      },
      // Flat funnel counter for a per-watchlist/per-day GROUP BY without
      // nested JSON paths. One of: cta_field_reached | cta_field_bailed |
      // cta_field_unchanged | null. Unchanged wins when both reached and
      // the values matched — that is the third accept-criteria stage.
      cta_field_extraction_funnel:
        counters.diff.ctaUnchanged === true
          ? "cta_field_unchanged"
          : ctaFieldFunnelBucketFromStage(counters.extract.ctaFunnelStage),
    };
    console.log(JSON.stringify(payload));
  } catch {
    // Instrumentation is best-effort. A serialisation failure must never
    // propagate into the scan path.
  }
}
