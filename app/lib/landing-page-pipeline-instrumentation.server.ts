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
  };
  diff: {
    status: LandingPageDiffStatus | null;
    /** Per-field bail reason when the diff produced no event for that field. */
    fieldBails: Record<string, string>;
    confirmedEventTypes: string[];
  };
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
    },
    diff: {
      status: null,
      fieldBails: {},
      confirmedEventTypes: [],
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
}

export function recordDiffStage(
  counters: LandingPagePipelineCounters,
  input: {
    status: LandingPageDiffStatus;
    fieldBails?: Record<string, string>;
    confirmedEventTypes?: string[];
  },
) {
  counters.diff.status = input.status;
  counters.diff.fieldBails = input.fieldBails ?? {};
  counters.diff.confirmedEventTypes = input.confirmedEventTypes ?? [];
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
      },
      diff: counters.diff,
    };
    console.log(JSON.stringify(payload));
  } catch {
    // Instrumentation is best-effort. A serialisation failure must never
    // propagate into the scan path.
  }
}
