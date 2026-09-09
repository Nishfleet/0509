import { describe, expect, it, vi } from "vitest";

import {
  startLandingPagePipelineVolumeInstrumentation,
  CTA_PIPELINE_STAGES,
} from "~/lib/cta-pipeline-stage-counts.server";
import { runDemoBrandBackfill } from "~/lib/demo-brand-backfill.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import type { LandingPageSnapshotData } from "~/lib/types";
import { appEnv, db } from "./fixtures";

/**
 * Issue #2077: the volume landing-page capture paths (selection_enrichment,
 * backfill, canary) did not build pipeline counters or call the recorder, so
 * `cta_pipeline_stage_counts` stayed empty even though `landing_snapshot`
 * volume was high (see docs/cta-pipeline-stage-counts-investigation.md).
 *
 * This file pins the new wiring against a REAL local D1 with the repo's real
 * migrations applied:
 *
 *   - the volume-path instrumentation helper writes exactly the stages that
 *     run on a successful capture (checks_started, page_fetch_succeeded,
 *     dom_extracted) and NOT the stages that do not run there
 *     (validity_passed, diff_computed, event_emitted);
 *   - a fetch bail-out writes only checks_started;
 *   - the demo-brand backfill (a real volume-path caller) actually invokes the
 *     helper and lands rows in `cta_pipeline_stage_counts`.
 *
 * The capture step is stubbed (the real pipeline needs the Browser Rendering
 * binding), but every D1 write/read is real.
 *
 * Note: the `workers` project isolates D1 per test FILE, not per test, and the
 * helper writes to `new Date()`'s UTC day. Each test uses fake timers with a
 * distinct day so its assertions see only its own writes.
 */

async function stageCountsForDay(day: string): Promise<Record<string, number>> {
  const rows = await db()
    .prepare(
      `SELECT stage, SUM(count) AS total FROM cta_pipeline_stage_counts
       WHERE day = ? GROUP BY stage`,
    )
    .bind(day)
    .all<{ stage: string; total: number }>();
  const out: Record<string, number> = {};
  for (const row of rows.results) {
    out[row.stage] = Number(row.total);
  }
  return out;
}

function realSnapshot(
  overrides: Partial<LandingPageSnapshotData> = {},
): LandingPageSnapshotData {
  return {
    rawUrl: "https://example.com/offer",
    canonicalUrl: "https://example.com/offer",
    rawHeadline: "Glow Serum Sale",
    normalizedHeadline: "glow serum sale",
    normalizedHeadlineHash: "hash-a",
    ctaText: "Buy now",
    priceText: "Starting at ₹499",
    formPresent: true,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-09-01T13:00:00.000Z",
    metadata: { ctaFunnelStage: "reached" },
    ...overrides,
  };
}

describe("volume-path pipeline instrumentation wiring (issue #2077)", () => {
  it("records checks_started + page_fetch_succeeded + dom_extracted for a successful capture, and NOT the proof-only stages", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const instr = startLandingPagePipelineVolumeInstrumentation({
        watchlistId: "selection_enrichment",
        scanId: "vol-test-success",
        adId: "ad-success",
      });
      const snapshot = realSnapshot();
      instr.recordCaptureOutcome(snapshot, null);
      await instr.finish(appEnv);

      const counts = await stageCountsForDay("2026-09-10");
      // The three stages that actually run on the volume path.
      expect(counts.checks_started).toBe(1);
      expect(counts.page_fetch_succeeded).toBe(1);
      expect(counts.dom_extracted).toBe(1);
      // The proof-capture-only stages must NOT be fabricated on this path.
      expect(counts.validity_passed).toBeUndefined();
      expect(counts.diff_computed).toBeUndefined();
      expect(counts.event_emitted).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("records only checks_started when the capture bailed (no snapshot)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const instr = startLandingPagePipelineVolumeInstrumentation({
        watchlistId: "selection_enrichment",
        scanId: "vol-test-bail",
        adId: "ad-bail",
      });
      instr.recordCaptureOutcome(null, "landing_fetch_failed");
      await instr.finish(appEnv);

      const counts = await stageCountsForDay("2026-09-11");
      expect(counts.checks_started).toBe(1);
      // No snapshot → fetch failed → no downstream stages.
      expect(counts.page_fetch_succeeded).toBeUndefined();
      expect(counts.dom_extracted).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("the demo-brand backfill (a volume-path caller) lands rows in cta_pipeline_stage_counts", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T00:00:00.000Z") });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const day = "2026-09-05";
      const snapshotFor = (domain: string): LandingPageSnapshotData => ({
        rawUrl: `https://www.${domain}/`,
        canonicalUrl: `https://www.${domain}/`,
        rawHeadline: `Demo offer for ${domain}`,
        normalizedHeadline: `demo offer for ${domain}`,
        normalizedHeadlineHash: `hash-${domain}`,
        ctaText: "Shop now",
        priceText: null,
        formPresent: false,
        captureMethod: "browser_render",
        capturedAt: `${day}T01:30:00.000Z`,
        artifactKey: `landing-pages/${day}/${domain}.html`,
        metadata: {
          captureMethod: "browser_render",
          screenshotArtifactKey: `landing-pages/${day}/${domain}.jpeg`,
          htmlArtifactKey: `landing-pages/${day}/${domain}.html`,
          extractorVersion: "test-stub",
          ctaFunnelStage: "reached",
        },
      });

      const captureStub = async (
        _env: unknown,
        url: string,
      ): Promise<LandingPageSnapshotData | null> => {
        const domain = DEMO_BRAND_PAGE_DOMAINS.find((d) => url.includes(d));
        if (!domain) return null;
        return snapshotFor(domain);
      };

      const result = await runDemoBrandBackfill(appEnv, {
        now: new Date(`${day}T01:00:00.000Z`),
        capture: captureStub as never,
      });

      expect(result.capturedCount).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
      expect(result.failedCount).toBe(0);

      // The backfill ran one capture per demo brand, each through the helper.
      // 2026-09-12 (the fake-timer "today") must carry the volume-path stages.
      const counts = await stageCountsForDay("2026-09-12");
      expect(counts.checks_started).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
      expect(counts.page_fetch_succeeded).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
      expect(counts.dom_extracted).toBe(DEMO_BRAND_PAGE_DOMAINS.length);
      // The proof-only stages are not fabricated on the backfill path.
      expect(counts.validity_passed).toBeUndefined();
      expect(counts.diff_computed).toBeUndefined();
      expect(counts.event_emitted).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("the helper never throws when the D1 binding is missing (telemetry must not break the scan)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-13T00:00:00.000Z") });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const instr = startLandingPagePipelineVolumeInstrumentation({
        watchlistId: "selection_enrichment",
        scanId: "vol-test-no-db",
        adId: null,
      });
      instr.recordCaptureOutcome(realSnapshot(), null);
      // Must not throw even with no D1 binding.
      await instr.finish({ DB: undefined } as typeof appEnv);
      expect(errorSpy).toHaveBeenCalled();
      const emitted = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(emitted.event).toBe("cta_pipeline_stage_counts_writer");
      expect(emitted.ok).toBe(false);
      expect(emitted.reason).toBe("no_d1_binding");
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("all six CTA_PIPELINE_STAGES are still the expected set (regression guard)", () => {
    expect(CTA_PIPELINE_STAGES).toEqual([
      "checks_started",
      "page_fetch_succeeded",
      "validity_passed",
      "dom_extracted",
      "diff_computed",
      "event_emitted",
    ]);
  });
});
