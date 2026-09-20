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

// Issue #1565: the capture-validity gate sits between fetch and extract. Its
// outcome is the `classifyCaptureValidity` status, collapsed to a pass/fail
// for the per-stage funnel: a "succeeded" or "suppressed" capture is a real
// page (the gate passed); only "capture_failed" is an error/challenge/cookie
// wall bail-out. Null when the gate never ran (e.g. fetch bailed first).
export type LandingPageValidityOutcome = "passed" | "failed";

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
  // Issue #1565: the capture-validity gate (classifyCaptureValidity). Outcome
  // is null until the gate runs; "failed" records an error/challenge/cookie
  // wall bail-out, "passed" records a real page (succeeded or suppressed).
  validity: {
    outcome: LandingPageValidityOutcome | null;
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
    validity: { outcome: null, reasonCode: null },
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

// Issue #1565: record the capture-validity gate outcome. `status` is the raw
// `CaptureValidityStatus` from classifyCaptureValidity; "succeeded" and
// "suppressed" both mean the gate passed (the page was real), only
// "capture_failed" is a bail-out. The reasonCode is the classifier's internal
// reason (e.g. the CAPTURE_VALIDITY_REASON_CODES vocabulary).
export function recordValidityStage(
  counters: LandingPagePipelineCounters,
  status: "succeeded" | "capture_failed" | "suppressed",
  reasonCode: string | null = null,
) {
  counters.validity.outcome = status === "capture_failed" ? "failed" : "passed";
  counters.validity.reasonCode = reasonCode;
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
      // Issue #1565: capture-validity gate outcome + bail reason.
      validity: counters.validity,
      validity_passed: counters.validity.outcome === "passed",
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

/**
 * The per-check funnel stage vocabulary (issue #1565), in funnel order:
 *
 *   checks_started        — every landing-page check that began
 *   page_fetch_succeeded  — the page fetch (or replay) produced a snapshot
 *   validity_passed       — the capture-validity gate classified the capture
 *                           as a real page (not an error/challenge/cookie wall)
 *   dom_extracted         — the DOM extraction stage ran and produced fields
 *   diff_computed         — the change-diff stage ran against a prior capture
 *   event_emitted         — the check confirmed at least one landing_page_* event
 */
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
 * past it; a bail-out at an earlier stage leaves the later stages at 0. The
 * validity stage is reached when the capture-validity gate ran and passed — a
 * "suppressed" capture (valid page, no confirmed change) counts as passed,
 * because the page was real; only "capture_failed" is a bail-out.
 */
export function ctaPipelineStageCountsFromCounters(
  counters: LandingPagePipelineCounters,
): Record<CtaPipelineStage, number> {
  const fetchSucceeded =
    counters.fetch.outcome === "succeeded" ||
    counters.fetch.outcome === "replayed";
  // Issue #2893: a plain-http bail rescued by the browser-render fallback DID
  // produce a page — the bail recorder already treats it as reaching the next
  // stage (no fetch bail), and the stage count must agree. Without this every
  // rescued proof check reads as dying at the fetch step, which is exactly
  // the "where did the checks go?" blindness this issue instruments against.
  const renderRescued =
    counters.fetch.outcome === "failed" &&
    counters.render.outcome === "succeeded";
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
    page_fetch_succeeded: fetchSucceeded || renderRescued ? 1 : 0,
    validity_passed: validityPassed ? 1 : 0,
    dom_extracted: domExtracted ? 1 : 0,
    diff_computed: diffComputed ? 1 : 0,
    event_emitted: eventEmitted ? 1 : 0,
  };
}

/**
 * Issue #2157: the bail-out reason code for the FIRST stage a check dropped
 * out of, so the per-run funnel's `bailReasons` map can rank the dominant
 * bail-out points. Returns null when the check reached the end and emitted an
 * event (it did not bail).
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
  // (selection_enrichment, backfill, canary) never run the diff stage — a
  // successful volume capture has `diff.status` null and no events, which is
  // NOT a bail (the capture reached the end of the stages that run on that
  // path). Counting it as an `event_emitted` bail would drown the real top
  // bail reasons in `no_event_emitted` rows from every successful volume
  // capture. So only record an event_emitted bail when the diff stage
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
 * Issue #2893: per-run extraction funnel. This accumulator answers "where did
 * this run's checks stop" for ONE watchlist run so the answer can live on the
 * run row (`watchlist_run.summary_json.landingPageExtractionFunnel`) and feed
 * the scheduled orchestration metrics.
 *
 * The funnel deliberately extends ABOVE `checks_started`: a run can evaluate
 * dozens of ad observations yet dispatch zero landing-page checks (missing
 * landing identity, proof-policy skip, dedupe, budget, freshness interval).
 * Those pre-dispatch exits write no pipeline counters at all, so they are
 * counted here as `bailReasons` — that is the "bail out before it" gap the
 * issue's funnel (dispatched → rendered → content-gate passed → fields
 * extracted → diffed) needs to make visible.
 */
export interface LandingPageExtractionFunnel {
  /** Ad observations the run evaluated for proof candidacy. */
  observations: number;
  /** Observations that cleared the identity gates into a proof candidate. */
  proofCandidates: number;
  /** Checks dispatched into the capture pipeline (== checks_started total). */
  dispatched: number;
  /** Render/fetch produced a usable snapshot (issue's "rendered" stage). */
  pageFetchSucceeded: number;
  /** Capture-validity gate passed (issue's "content-gate passed" stage). */
  validityPassed: number;
  /** Field extraction produced a DOM extraction (issue's "fields extracted"). */
  domExtracted: number;
  /** A real diff ran against a prior capture (issue's "diffed" stage). */
  diffComputed: number;
  /** At least one landing_page_* event was confirmed. */
  eventEmitted: number;
  /**
   * Bail-out reasons across the whole run, keyed "<gate>:<reason>" — both
   * pre-dispatch drops (e.g. "proof_policy:skipped_due_to_budget",
   * "evidence_reservation:<reason>", "proof_freshness_interval") and in-funnel
   * bails (e.g. "page_fetch_succeeded:landing_rate_limited",
   * "event_emitted:no_baseline_first_scan").
   */
  bailReasons: Record<string, number>;
}

export function createLandingPageExtractionFunnel(
  observations = 0,
): LandingPageExtractionFunnel {
  return {
    observations,
    proofCandidates: 0,
    dispatched: 0,
    pageFetchSucceeded: 0,
    validityPassed: 0,
    domExtracted: 0,
    diffComputed: 0,
    eventEmitted: 0,
    bailReasons: {},
  };
}

/** Count a check that exited BEFORE the capture pipeline was dispatched. */
export function recordLandingPageFunnelCandidateDrop(
  funnel: LandingPageExtractionFunnel,
  reason: string,
) {
  funnel.bailReasons[reason] = (funnel.bailReasons[reason] ?? 0) + 1;
}

/**
 * Fold one completed check's pipeline counters into the run funnel. Call once
 * per dispatched check — from the same `finally` that flushes the per-check
 * counters — so a thrown error still lands the check's funnel contribution.
 */
export function recordLandingPageFunnelCheck(
  funnel: LandingPageExtractionFunnel,
  counters: LandingPagePipelineCounters,
) {
  const stages = ctaPipelineStageCountsFromCounters(counters);
  funnel.dispatched += 1;
  funnel.pageFetchSucceeded += stages.page_fetch_succeeded ?? 0;
  funnel.validityPassed += stages.validity_passed ?? 0;
  funnel.domExtracted += stages.dom_extracted ?? 0;
  funnel.diffComputed += stages.diff_computed ?? 0;
  funnel.eventEmitted += stages.event_emitted ?? 0;
  const bail = ctaPipelineBailReasonFromCounters(counters);
  if (bail) {
    const key = `${bail.stage}:${bail.reason}`;
    funnel.bailReasons[key] = (funnel.bailReasons[key] ?? 0) + 1;
  }
}

export function mergeLandingPageExtractionFunnels(
  funnels: Array<LandingPageExtractionFunnel | null | undefined>,
): LandingPageExtractionFunnel | null {
  let merged: LandingPageExtractionFunnel | null = null;
  for (const funnel of funnels) {
    if (!funnel) continue;
    merged ??= createLandingPageExtractionFunnel();
    merged.observations += funnel.observations;
    merged.proofCandidates += funnel.proofCandidates;
    merged.dispatched += funnel.dispatched;
    merged.pageFetchSucceeded += funnel.pageFetchSucceeded;
    merged.validityPassed += funnel.validityPassed;
    merged.domExtracted += funnel.domExtracted;
    merged.diffComputed += funnel.diffComputed;
    merged.eventEmitted += funnel.eventEmitted;
    for (const [reason, count] of Object.entries(funnel.bailReasons)) {
      merged.bailReasons[reason] = (merged.bailReasons[reason] ?? 0) + count;
    }
  }
  return merged;
}

/**
 * The JSON-safe shape persisted into `watchlist_run.summary_json`. Keys use the
 * issue's funnel vocabulary (dispatched → rendered → contentGatePassed →
 * fieldsExtracted → diffed → eventEmitted) so the run row reads like the
 * funnel the issue names. Returns null when the run never touched the
 * landing-page pipeline (no observations, no candidates, nothing dispatched)
 * so quiet runs keep clean summaries.
 */
export function landingPageExtractionFunnelSummaryJson(
  funnel: LandingPageExtractionFunnel | null | undefined,
): Record<string, unknown> | null {
  if (
    !funnel ||
    (funnel.observations === 0 &&
      funnel.proofCandidates === 0 &&
      funnel.dispatched === 0 &&
      Object.keys(funnel.bailReasons).length === 0)
  ) {
    return null;
  }
  return {
    observations: funnel.observations,
    proofCandidates: funnel.proofCandidates,
    dispatched: funnel.dispatched,
    rendered: funnel.pageFetchSucceeded,
    contentGatePassed: funnel.validityPassed,
    fieldsExtracted: funnel.domExtracted,
    diffed: funnel.diffComputed,
    eventEmitted: funnel.eventEmitted,
    ...(Object.keys(funnel.bailReasons).length > 0
      ? { bailReasons: funnel.bailReasons }
      : {}),
  };
}
