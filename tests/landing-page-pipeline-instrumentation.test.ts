import { describe, expect, it, vi } from "vitest";

import {
  createLandingPagePipelineCounters,
  flushLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
  recordRenderStage,
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
});
