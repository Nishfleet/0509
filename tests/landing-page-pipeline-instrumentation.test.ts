import { describe, expect, it, vi } from "vitest";

import {
  CTA_PIPELINE_STAGES,
  createLandingPagePipelineCounters,
  ctaPipelineBailReasonFromCounters,
  ctaPipelineStageCountsFromCounters,
  flushLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
  recordRenderStage,
  recordValidityStage,
} from "~/lib/landing-page-pipeline-instrumentation.server";

describe("landing-page pipeline instrumentation (issue #949)", () => {
  it("creates counters with all stages initialised to their empty state", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-1:run-1",
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      extractorVersion: "lp-signals-v5",
    });

    expect(counters.fetch.outcome).toBeNull();
    expect(counters.fetch.reasonCode).toBeNull();
    expect(counters.render.outcome).toBe("not_attempted");
    expect(counters.validity.outcome).toBeNull();
    expect(counters.validity.reasonCode).toBeNull();
    expect(counters.extract.ctaFound).toBe(false);
    expect(counters.extract.priceFound).toBe(false);
    expect(counters.extract.formPresent).toBe(false);
    expect(counters.extract.headlineFound).toBe(false);
    expect(counters.diff.status).toBeNull();
    expect(counters.diff.confirmedEventTypes).toEqual([]);
  });

  it("records the fetch stage outcome and reason code", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordFetchStage(counters, "failed", "landing_blocked");
    expect(counters.fetch.outcome).toBe("failed");
    expect(counters.fetch.reasonCode).toBe("landing_blocked");
  });

  it("records the render stage outcome", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordRenderStage(counters, "succeeded");
    expect(counters.render.outcome).toBe("succeeded");
    expect(counters.render.reasonCode).toBeNull();
  });

  it("records the capture-validity gate outcome (issue #1565)", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    // "succeeded" and "suppressed" both mean the page was real (gate passed);
    // only "capture_failed" is a bail-out.
    recordValidityStage(counters, "succeeded", null);
    expect(counters.validity.outcome).toBe("passed");
    expect(counters.validity.reasonCode).toBeNull();

    recordValidityStage(counters, "suppressed", "maintenance_window");
    expect(counters.validity.outcome).toBe("passed");
    expect(counters.validity.reasonCode).toBe("maintenance_window");

    recordValidityStage(counters, "capture_failed", "cookie_wall");
    expect(counters.validity.outcome).toBe("failed");
    expect(counters.validity.reasonCode).toBe("cookie_wall");
  });

  it("records the extract stage field presence", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordExtractStage(counters, {
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: true,
      headline: "Glow Serum Sale",
      warnings: [],
    });

    expect(counters.extract.ctaFound).toBe(true);
    expect(counters.extract.priceFound).toBe(true);
    expect(counters.extract.formPresent).toBe(true);
    expect(counters.extract.headlineFound).toBe(true);
  });

  it("does not count the generic 'Landing page' headline placeholder as found", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordExtractStage(counters, {
      ctaText: null,
      priceText: null,
      formPresent: false,
      headline: "Landing page",
      warnings: ["headline_not_detected"],
    });

    // The extractor fell back to the generic placeholder — that's a
    // headline-stage bail-out, not a real detection.
    expect(counters.extract.headlineFound).toBe(false);
    expect(counters.extract.ctaFound).toBe(false);
    expect(counters.extract.warnings).toContain("headline_not_detected");
  });

  it("records the diff stage status and confirmed event types", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordDiffStage(counters, {
      status: "confirmed",
      confirmedEventTypes: ["landing_page_cta_changed"],
    });

    expect(counters.diff.status).toBe("confirmed");
    expect(counters.diff.confirmedEventTypes).toEqual([
      "landing_page_cta_changed",
    ]);
  });

  it("records per-field bail reasons in the diff stage", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v5",
    });

    recordDiffStage(counters, {
      status: "skipped_no_snapshot",
      fieldBails: {
        headline: "fetch_bailed_no_snapshot",
        cta: "fetch_bailed_no_snapshot",
      },
    });

    expect(counters.diff.fieldBails).toEqual({
      headline: "fetch_bailed_no_snapshot",
      cta: "fetch_bailed_no_snapshot",
    });
  });

  it("flush emits one structured JSON log line with all stages", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      extractorVersion: "lp-signals-v5",
    });

    recordFetchStage(counters, "succeeded");
    recordRenderStage(counters, "not_attempted");
    recordExtractStage(counters, {
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: true,
      headline: "Glow Serum Sale",
    });
    recordDiffStage(counters, {
      status: "confirmed",
      confirmedEventTypes: ["landing_page_cta_changed"],
    });

    flushLandingPagePipelineCounters(counters);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("landing_page_pipeline_check");
    expect(logged.scanId).toBe("scan-1");
    expect(logged.fetch.outcome).toBe("succeeded");
    expect(logged.extract.ctaFound).toBe(true);
    expect(logged.diff.status).toBe("confirmed");
    expect(logged.diff.confirmedEventTypes).toEqual([
      "landing_page_cta_changed",
    ]);

    logSpy.mockRestore();
  });

  it("flush never throws even if the counter is in an unexpected state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("serialisation failed");
    });

    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: null,
    });

    // Must not throw — instrumentation is best-effort.
    expect(() => flushLandingPagePipelineCounters(counters)).not.toThrow();

    logSpy.mockRestore();
  });

  // Issue #1401: CTA field-extraction funnel (stage + bail reason + unchanged).
  it("records the CTA funnel reached stage from the extractor", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordExtractStage(counters, {
      ctaText: "Learn more",
      priceText: null,
      formPresent: false,
      headline: "Glow Serum Sale",
      ctaFunnelStage: "reached",
      ctaFunnelReasonCode: null,
    });

    expect(counters.extract.ctaFunnelStage).toBe("reached");
    expect(counters.extract.ctaFunnelReasonCode).toBeNull();
  });

  it("records the CTA funnel bail reason from the extractor", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordExtractStage(counters, {
      ctaText: null,
      priceText: null,
      formPresent: false,
      headline: "Acme Pricing",
      ctaFunnelStage: "bailed",
      ctaFunnelReasonCode: "only_chrome_anchors",
    });

    expect(counters.extract.ctaFunnelStage).toBe("bailed");
    expect(counters.extract.ctaFunnelReasonCode).toBe("only_chrome_anchors");
  });

  it("infers the funnel stage from ctaText when the extractor omits it", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordExtractStage(counters, {
      ctaText: null,
      priceText: null,
      formPresent: false,
      headline: "Acme Pricing",
    });

    // Legacy call site: stage inferred as bailed, reason defaulted.
    expect(counters.extract.ctaFunnelStage).toBe("bailed");
    expect(counters.extract.ctaFunnelReasonCode).toBe("no_cta_candidates");
  });

  it("records the ctaUnchanged diff stage", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordDiffStage(counters, {
      status: "invalidated",
      confirmedEventTypes: [],
      ctaUnchanged: true,
    });

    expect(counters.diff.ctaUnchanged).toBe(true);
  });

  it("flush emits the CTA funnel stage, reason, and unchanged flag", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordExtractStage(counters, {
      ctaText: null,
      priceText: null,
      formPresent: false,
      headline: "Acme Pricing",
      ctaFunnelStage: "bailed",
      ctaFunnelReasonCode: "only_chrome_anchors",
    });
    recordDiffStage(counters, {
      status: "invalidated",
      confirmedEventTypes: [],
      ctaUnchanged: false,
    });

    flushLandingPagePipelineCounters(counters);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.extract.ctaFunnelStage).toBe("bailed");
    expect(logged.extract.ctaFunnelReasonCode).toBe("only_chrome_anchors");
    expect(logged.diff.ctaUnchanged).toBe(false);
    // Accept-criteria aliases (issue #1401 verify step 1).
    expect(logged.extract.cta_field_reached).toBe(false);
    expect(logged.extract.cta_field_bailed).toBe(true);
    expect(logged.diff.cta_field_unchanged).toBe(false);
    expect(logged.cta_field_extraction_funnel).toBe("cta_field_bailed");

    logSpy.mockRestore();
  });

  it("flush prefers cta_field_unchanged when the diff stage matched", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const counters = createLandingPagePipelineCounters({
      scanId: "scan-1",
      watchlistId: "watch-1",
      adId: null,
      extractorVersion: "lp-signals-v8",
    });

    recordExtractStage(counters, {
      ctaText: "Sign up",
      priceText: null,
      formPresent: false,
      headline: "Five to Nine",
      ctaFunnelStage: "reached",
      ctaFunnelReasonCode: null,
    });
    recordDiffStage(counters, {
      status: "invalidated",
      confirmedEventTypes: [],
      ctaUnchanged: true,
    });

    flushLandingPagePipelineCounters(counters);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.extract.cta_field_reached).toBe(true);
    expect(logged.diff.cta_field_unchanged).toBe(true);
    expect(logged.cta_field_extraction_funnel).toBe("cta_field_unchanged");

    logSpy.mockRestore();
  });
});

/**
 * Issue #2443 (finding M9): `diff_computed` counted `baseline_established`.
 *
 * `ctaPipelineStageCountsFromCounters` documents `diff_computed` as "the
 * change-diff stage ran against a prior capture". `baseline_established` is by
 * definition the no-prior-capture case (`recordDiffStage`'s `ctaUnchanged`
 * doc: "Null when there was no prior capture to diff against
 * (baseline_established)"), so a first-ever capture of a page was counted as a
 * computed diff — overstating `diff_computed` and understating the real
 * bail-out point for new pages.
 */
function countersWithDiff(status: Parameters<typeof recordDiffStage>[1]["status"]) {
  const counters = createLandingPagePipelineCounters({
    scanId: "proof-request:watch-2443:run-1",
    watchlistId: "watch-2443",
    adId: "ad-2443",
    extractorVersion: "lp-signals-v1",
  });
  recordFetchStage(counters, "succeeded");
  recordValidityStage(counters, "succeeded", null);
  recordExtractStage(counters, {
    ctaText: "Buy now",
    priceText: "Starting at ₹499",
    formPresent: true,
    headline: "Glow Serum Sale",
    warnings: [],
    ctaFunnelStage: "reached",
    ctaFunnelReasonCode: null,
  });
  recordDiffStage(counters, { status });
  return counters;
}

describe("diff_computed excludes baseline_established (issue #2443)", () => {
  it("baseline_established is not diff_computed", () => {
    // repro from the issue, verbatim: a first capture has no prior capture to
    // diff against, so it did NOT run a computed diff.
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-2443:run-baseline",
      watchlistId: "watch-2443",
      adId: "ad-2443",
      extractorVersion: "lp-signals-v1",
    });
    recordDiffStage(counters, { status: "baseline_established" });

    expect(ctaPipelineStageCountsFromCounters(counters).diff_computed).toBe(0);
  });

  it("confirmed is diff_computed", () => {
    expect(
      ctaPipelineStageCountsFromCounters(countersWithDiff("confirmed"))
        .diff_computed,
    ).toBe(1);
  });

  it("suppressed is diff_computed (a real prior capture was diffed)", () => {
    expect(
      ctaPipelineStageCountsFromCounters(countersWithDiff("suppressed"))
        .diff_computed,
    ).toBe(1);
  });

  it("invalidated is diff_computed (a real prior capture was diffed)", () => {
    expect(
      ctaPipelineStageCountsFromCounters(countersWithDiff("invalidated"))
        .diff_computed,
    ).toBe(1);
  });

  it("skipped_no_snapshot is not diff_computed", () => {
    expect(
      ctaPipelineStageCountsFromCounters(countersWithDiff("skipped_no_snapshot"))
        .diff_computed,
    ).toBe(0);
  });

  it("a null diff status (volume paths that never run the diff) is not diff_computed", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "selection:watch-2443:run-2",
      watchlistId: "watch-2443",
      adId: null,
      extractorVersion: "lp-signals-v1",
    });
    recordFetchStage(counters, "succeeded");
    expect(
      ctaPipelineStageCountsFromCounters(counters).diff_computed,
    ).toBe(0);
  });
});

describe("CTA funnel stage vocabulary and rescue mapping", () => {
  it("CTA_PIPELINE_STAGES keeps the six-stage funnel contract (issue #1565)", () => {
    expect(CTA_PIPELINE_STAGES).toEqual([
      "checks_started",
      "page_fetch_succeeded",
      "validity_passed",
      "dom_extracted",
      "diff_computed",
      "event_emitted",
    ]);
  });

  it("a fetch rescued by the render fallback counts as page_fetch_succeeded (issue #2893)", () => {
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-2893:run-1",
      watchlistId: "watch-2893",
      adId: "ad-2893",
      extractorVersion: "lp-signals-v1",
    });
    recordFetchStage(counters, "failed", "http_error");
    recordRenderStage(counters, "succeeded");

    expect(ctaPipelineStageCountsFromCounters(counters).page_fetch_succeeded).toBe(
      1,
    );
  });
});

describe("ctaPipelineBailReasonFromCounters (issue #2157)", () => {
  const bailCounters = () =>
    createLandingPagePipelineCounters({
      scanId: "proof-request:watch-2157:run-1",
      watchlistId: "watch-2157",
      adId: "ad-2157",
      extractorVersion: "lp-signals-v1",
    });

  it("returns the expected bail point for each bail shape", () => {
    // fetch bail
    {
      const c = bailCounters();
      recordFetchStage(c, "failed", "landing_blocked");
      expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
        stage: "page_fetch_succeeded",
        reason: "landing_blocked",
      });
    }
    // validity bail
    {
      const c = bailCounters();
      recordFetchStage(c, "succeeded");
      recordValidityStage(c, "capture_failed", "challenge_page");
      expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
        stage: "validity_passed",
        reason: "challenge_page",
      });
    }
    // extract bail
    {
      const c = bailCounters();
      recordFetchStage(c, "succeeded");
      recordValidityStage(c, "succeeded");
      recordExtractStage(c, {
        ctaText: null,
        priceText: null,
        formPresent: null,
        headline: null,
        ctaFunnelStage: "bailed",
        ctaFunnelReasonCode: "no_cta_candidates",
      });
      expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
        stage: "dom_extracted",
        reason: "no_cta_candidates",
      });
    }
    // success — no bail
    {
      const c = bailCounters();
      recordFetchStage(c, "succeeded");
      recordValidityStage(c, "succeeded");
      recordExtractStage(c, {
        ctaText: "Buy now",
        priceText: "$9",
        formPresent: true,
        headline: "Sale",
        ctaFunnelStage: "reached",
      });
      recordDiffStage(c, {
        status: "confirmed",
        confirmedEventTypes: ["landing_page_cta_changed"],
      });
      expect(ctaPipelineBailReasonFromCounters(c)).toBeNull();
    }
  });

  it("does not bail at fetch when the render fallback rescued it (issue #2893)", () => {
    const c = bailCounters();
    recordFetchStage(c, "failed", "http_error");
    recordRenderStage(c, "succeeded");
    recordValidityStage(c, "succeeded");
    recordExtractStage(c, {
      ctaText: null,
      priceText: null,
      formPresent: null,
      headline: null,
      ctaFunnelStage: "bailed",
      ctaFunnelReasonCode: "no_cta_candidates",
    });

    // The rescued check fell through fetch and bailed at the next real gate.
    expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
      stage: "dom_extracted",
      reason: "no_cta_candidates",
    });
  });

  it("returns null when the diff stage never ran (volume paths)", () => {
    const c = bailCounters();
    recordFetchStage(c, "succeeded");
    recordValidityStage(c, "succeeded");
    recordExtractStage(c, {
      ctaText: "Buy now",
      priceText: "$9",
      formPresent: true,
      headline: "Sale",
      ctaFunnelStage: "reached",
    });

    // diff.status stays null on volume paths — not an event_emitted bail.
    expect(ctaPipelineBailReasonFromCounters(c)).toBeNull();
  });

  it("returns null when the diff was skipped for lack of a snapshot", () => {
    const c = bailCounters();
    recordFetchStage(c, "succeeded");
    recordDiffStage(c, { status: "skipped_no_snapshot" });

    expect(ctaPipelineBailReasonFromCounters(c)).toBeNull();
  });

  it("attributes a no-event diff to event_emitted with the field bail reason", () => {
    const c = bailCounters();
    recordFetchStage(c, "succeeded");
    recordValidityStage(c, "succeeded");
    recordExtractStage(c, {
      ctaText: "Buy now",
      priceText: "$9",
      formPresent: true,
      headline: "Sale",
      ctaFunnelStage: "reached",
    });
    recordDiffStage(c, {
      status: "invalidated",
      confirmedEventTypes: [],
      fieldBails: { cta: "cta_selector_mismatch", headline: "no_cta_change" },
    });

    expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
      stage: "event_emitted",
      reason: "cta_selector_mismatch",
    });
  });

  it("falls back to no_event_emitted when the diff ran with no field bails", () => {
    const c = bailCounters();
    recordFetchStage(c, "succeeded");
    recordDiffStage(c, { status: "suppressed" });

    expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
      stage: "event_emitted",
      reason: "no_event_emitted",
    });
  });
});
