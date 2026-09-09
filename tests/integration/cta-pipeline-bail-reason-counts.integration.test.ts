import { describe, expect, it, vi } from "vitest";

import {
  ctaPipelineBailReasonFromCounters,
  recordCtaPipelineStageCounts,
} from "~/lib/cta-pipeline-stage-counts.server";
import {
  createLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
  recordRenderStage,
  recordValidityStage,
  type LandingPagePipelineCounters,
} from "~/lib/landing-page-pipeline-instrumentation.server";
import { appEnv, db } from "./fixtures";

/**
 * Issue #2157: cta_pipeline_stage_counts records per-stage funnel COUNTS but
 * carries no bail reason, so "top 5 bail-out reasons by frequency" (#1538 Gate
 * 1) is not queryable from D1. This test pins the new
 * `cta_pipeline_bail_reason_counts` table against a REAL local D1 with the
 * repo's real migrations applied — it asserts the WRITE path (the recorder
 * persists the bail reason) AND the READ path (the acceptance query
 * `SELECT reason, SUM(count) ... GROUP BY reason ORDER BY 2 DESC LIMIT 5`
 * returns the real top-5).
 */

function makeCounters(
  overrides: Partial<Pick<LandingPagePipelineCounters, "context">> = {},
): LandingPagePipelineCounters {
  return createLandingPagePipelineCounters({
    scanId: `scan-${Math.random().toString(36).slice(2)}`,
    watchlistId: "watch-test",
    adId: null,
    extractorVersion: "lp-signals-v5",
    ...overrides.context,
  });
}

async function bailReasonsForDay(day: string) {
  const rows = await db()
    .prepare(
      `SELECT reason, SUM(count) AS total
       FROM cta_pipeline_bail_reason_counts
       WHERE day = ? GROUP BY reason ORDER BY total DESC LIMIT 5`,
    )
    .bind(day)
    .all<{ reason: string; total: number }>();
  return rows.results.map((r) => ({ reason: r.reason, total: Number(r.total) }));
}

async function bailRowsForDay(day: string) {
  const rows = await db()
    .prepare(
      `SELECT stage, reason, count
       FROM cta_pipeline_bail_reason_counts
       WHERE day = ? ORDER BY stage, reason`,
    )
    .bind(day)
    .all<{ stage: string; reason: string; count: number }>();
  return rows.results.map((r) => ({
    stage: r.stage,
    reason: r.reason,
    count: Number(r.count),
  }));
}

describe("cta_pipeline_bail_reason_counts (issue #2157)", () => {
  it("writes the fetch bail reason and the acceptance read query returns it as top-1", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      recordFetchStage(counters, "failed", "landing_rate_limited");

      await recordCtaPipelineStageCounts(appEnv, counters);

      const rows = await bailRowsForDay("2026-09-10");
      expect(rows).toEqual([
        { stage: "page_fetch_succeeded", reason: "landing_rate_limited", count: 1 },
      ]);

      const top = await bailReasonsForDay("2026-09-10");
      expect(top[0]).toEqual({ reason: "landing_rate_limited", total: 1 });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("aggregates bail reasons across checks so the top-5 query ranks by frequency", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 3 checks bailed at fetch with landing_rate_limited, 2 with landing_blocked,
      // 1 bailed at extract with no_cta_candidates.
      for (let i = 0; i < 3; i++) {
        const c = makeCounters();
        recordFetchStage(c, "failed", "landing_rate_limited");
        await recordCtaPipelineStageCounts(appEnv, c);
      }
      for (let i = 0; i < 2; i++) {
        const c = makeCounters();
        recordFetchStage(c, "failed", "landing_blocked");
        await recordCtaPipelineStageCounts(appEnv, c);
      }
      {
        const c = makeCounters();
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
        await recordCtaPipelineStageCounts(appEnv, c);
      }

      const top = await bailReasonsForDay("2026-09-11");
      expect(top).toEqual([
        { reason: "landing_rate_limited", total: 3 },
        { reason: "landing_blocked", total: 2 },
        { reason: "no_cta_candidates", total: 1 },
      ]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("writes the validity bail reason at the validity_passed stage", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      recordFetchStage(counters, "succeeded");
      recordValidityStage(counters, "capture_failed", "cookie_wall");

      await recordCtaPipelineStageCounts(appEnv, counters);

      const rows = await bailRowsForDay("2026-09-12");
      expect(rows).toEqual([
        { stage: "validity_passed", reason: "cookie_wall", count: 1 },
      ]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("writes the diff no-event bail reason at the event_emitted stage", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-13T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      recordFetchStage(counters, "succeeded");
      recordValidityStage(counters, "succeeded");
      recordExtractStage(counters, {
        ctaText: "Buy now",
        priceText: "$9",
        formPresent: true,
        headline: "Sale",
        ctaFunnelStage: "reached",
      });
      recordDiffStage(counters, {
        status: "invalidated",
        fieldBails: {
          headline: "no_field_change_detected",
          offer: "no_field_change_detected",
          cta: "no_field_change_detected",
          form: "no_field_change_detected",
        },
        confirmedEventTypes: [],
      });

      await recordCtaPipelineStageCounts(appEnv, counters);

      const rows = await bailRowsForDay("2026-09-13");
      expect(rows).toEqual([
        { stage: "event_emitted", reason: "no_field_change_detected", count: 1 },
      ]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does NOT write a bail reason when the check emitted an event (reached the funnel end)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-14T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      recordFetchStage(counters, "succeeded");
      recordValidityStage(counters, "succeeded");
      recordExtractStage(counters, {
        ctaText: "Buy now",
        priceText: "$9",
        formPresent: true,
        headline: "Sale",
        ctaFunnelStage: "reached",
      });
      recordDiffStage(counters, {
        status: "confirmed",
        confirmedEventTypes: ["landing_page_cta_changed"],
      });

      await recordCtaPipelineStageCounts(appEnv, counters);

      const rows = await bailRowsForDay("2026-09-14");
      expect(rows).toEqual([]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does NOT bail at fetch when the render fallback rescued the check", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-15T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      // Proof-capture funnel: fetch "failed" (plain-http bailed) but render
      // succeeded — the check was rescued and continued.
      recordFetchStage(counters, "failed", "landing_plain_http_bailed_to_render");
      recordRenderStage(counters, "succeeded");
      recordValidityStage(counters, "succeeded");
      recordExtractStage(counters, {
        ctaText: "Buy now",
        priceText: null,
        formPresent: false,
        headline: "Sale",
        ctaFunnelStage: "reached",
      });
      // The check bailed at diff (no event) — the bail is at event_emitted,
      // NOT at page_fetch_succeeded.
      recordDiffStage(counters, {
        status: "baseline_established",
        fieldBails: {
          headline: "no_baseline_first_scan",
          offer: "no_baseline_first_scan",
          cta: "no_baseline_first_scan",
          form: "no_baseline_first_scan",
        },
        confirmedEventTypes: [],
      });

      await recordCtaPipelineStageCounts(appEnv, counters);

      const rows = await bailRowsForDay("2026-09-15");
      expect(rows).toEqual([
        { stage: "event_emitted", reason: "no_baseline_first_scan", count: 1 },
      ]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("the pure extractor returns the expected bail point for each bail shape", () => {
    // fetch bail
    {
      const c = makeCounters();
      recordFetchStage(c, "failed", "landing_blocked");
      expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
        stage: "page_fetch_succeeded",
        reason: "landing_blocked",
      });
    }
    // validity bail
    {
      const c = makeCounters();
      recordFetchStage(c, "succeeded");
      recordValidityStage(c, "capture_failed", "challenge_page");
      expect(ctaPipelineBailReasonFromCounters(c)).toEqual({
        stage: "validity_passed",
        reason: "challenge_page",
      });
    }
    // extract bail
    {
      const c = makeCounters();
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
      const c = makeCounters();
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

  it("never throws when the D1 binding is missing (telemetry must not break the scan)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-16T00:00:00.000Z") });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const counters = makeCounters();
      recordFetchStage(counters, "failed", "landing_rate_limited");
      // Must not throw even with no D1 binding.
      await recordCtaPipelineStageCounts(
        { DB: undefined } as typeof appEnv,
        counters,
      );
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
