import { describe, expect, it } from "vitest";

import {
  createLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
  recordValidityStage,
} from "~/lib/landing-page-pipeline-instrumentation.server";
import { ctaPipelineStageCountsFromCounters } from "~/lib/cta-pipeline-stage-counts.server";

/**
 * Issue #2443 (finding M9): `diff_computed` counted `baseline_established`.
 *
 * Fixed in PR #2748 (merged 2026-09-11). The fix excludes `baseline_established`
 * from `diff_computed` because a first-ever capture has no prior capture to
 * diff against. The module's own contract documents `diff_computed` as the
 * stage that "ran against a prior capture".
 *
 * The module documents `diff_computed` as "the change-diff stage ran against a
 * prior capture". `baseline_established` is by definition the no-prior-capture
 * case (`recordDiffStage`'s `ctaUnchanged` doc: "Null when there was no prior
 * capture to diff against (baseline_established)"), so a first-ever capture of
 * a page was counted as a computed diff — overstating `diff_computed` and
 * understating the real bail-out point for new pages.
 *
 * These are pure node tests: the mapping is side-effect-free and needs no D1.
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