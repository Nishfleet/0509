import { describe, expect, it, vi } from "vitest";

import {
  createLandingPagePipelineCounters,
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
      extractorVersion: "lp-signals-v6",
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
      extractorVersion: "lp-signals-v6",
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
      extractorVersion: "lp-signals-v6",
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
      extractorVersion: "lp-signals-v6",
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
      extractorVersion: "lp-signals-v6",
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
      extractorVersion: "lp-signals-v6",
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
