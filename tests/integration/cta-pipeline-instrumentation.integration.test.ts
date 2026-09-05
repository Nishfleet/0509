import { describe, expect, it } from "vitest";

import { classifyCaptureValidity } from "~/lib/capture-validity.server";
import {
  createLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
} from "~/lib/landing-page-pipeline-instrumentation.server";
import {
  CTA_PIPELINE_STAGES,
  ctaPipelineStageCountsFromCounters,
  recordCtaPipelineStageCounts,
} from "~/lib/cta-pipeline-stage-counts.server";
import type { LandingPageSnapshotData, ProofCaptureRecord } from "~/lib/types";
import { appEnv, db } from "./fixtures";

/**
 * Integration regression guard for issue #1565 — the landing-page CTA-change
 * detector was near-silent (4 events in 4 months) and there was no queryable
 * per-stage counter to show which gate was dropping the signal. The pipeline
 * already emits a per-check JSON log line, but that log is not queryable in
 * D1. This file asserts the new `cta_pipeline_stage_counts` table (migration
 * 0083) is written correctly against a REAL local D1 with the repo's real
 * migrations applied:
 *
 *   - a full successful check increments all six stages by 1;
 *   - a bailed check increments only the stages it actually reached;
 *   - a real CTA change (synthetic fixture) produces exactly one
 *     `landing_page_cta_changed` event and records `event_emitted = 1`.
 *
 * The `ctaPipelineStageCountsFromCounters` mapping is pure and unit-testable;
 * the D1 write path is what this file exists to pin.
 */

const ISO_T0 = "2026-09-01T12:00:00.000Z";
const PROOF_TARGET_IDENTITY = "watch-1:meta-boat-1:example.com/glow";

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
    metadata: { captureValidated: true, screenshotCorroborates: true },
    ...overrides,
  };
}

function baselineProof(
  overrides: Partial<Record<string, unknown>> = {},
): ProofCaptureRecord {
  return {
    id: "proof-baseline",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "landing-pages/shot.jpeg",
    htmlArtifactKey: "landing-pages/page.html",
    extractedFields: {
      rawHeadline: "Glow Serum Sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Buy now",
      priceText: "Starting at ₹499",
      formPresent: true,
      extractorRawTextHash: "baseline-raw",
      extractorAdSlotStrippedTextHash: "baseline-adslot",
      extractorChurnStableTextHash: "baseline-churn",
      ...overrides,
    },
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:baseline",
    attemptedAt: ISO_T0,
    succeededAt: ISO_T0,
    createdAt: ISO_T0,
    updatedAt: ISO_T0,
  };
}

function currentProofFromSnapshot(
  snapshot: LandingPageSnapshotData,
): {
  rawHeadline: string;
  normalizedHeadline: string;
  normalizedHeadlineHash: string;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
  extractorVersion: string;
} {
  return {
    rawHeadline: snapshot.rawHeadline,
    normalizedHeadline: snapshot.normalizedHeadline,
    normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
    ctaText: snapshot.ctaText ?? null,
    priceText: snapshot.priceText ?? null,
    formPresent: snapshot.formPresent ?? null,
    extractorVersion: "lp-signals-v1",
  };
}

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

function fullSuccessfulCounters() {
  const counters = createLandingPagePipelineCounters({
    scanId: "proof-request:watch-1:run-1",
    watchlistId: "watch-1",
    adId: "ad-1",
    extractorVersion: "lp-signals-v1",
  });
  recordFetchStage(counters, "succeeded");
  recordExtractStage(counters, {
    ctaText: "Get offer",
    priceText: "Starting at ₹499",
    formPresent: true,
    headline: "Glow Serum Sale",
    warnings: [],
    ctaFunnelStage: "reached",
    ctaFunnelReasonCode: null,
  });
  recordDiffStage(counters, {
    status: "confirmed",
    confirmedEventTypes: ["landing_page_cta_changed"],
  });
  return counters;
}

describe("cta pipeline stage counters on real D1 (issue #1565)", () => {
  it("maps a full successful check to all six stages", () => {
    const counts = ctaPipelineStageCountsFromCounters(fullSuccessfulCounters());
    for (const stage of CTA_PIPELINE_STAGES) {
      expect(counts[stage]).toBe(1);
    }
  });

  it("records all six stages for a full successful check", async () => {
    const day = "2026-09-01";
    await recordCtaPipelineStageCounts(
      appEnv,
      fullSuccessfulCounters(),
      new Date(`${day}T12:00:00.000Z`),
    );

    const counts = await stageCountsForDay(day);
    for (const stage of CTA_PIPELINE_STAGES) {
      expect(counts[stage]).toBe(1);
    }
  });

  it("records only the stages a bailed check actually reached", async () => {
    const day = "2026-09-02";
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-2:run-2",
      watchlistId: "watch-2",
      adId: "ad-2",
      extractorVersion: "lp-signals-v1",
    });
    // Fetch bailed out — no snapshot, no extract, no diff, no event.
    recordFetchStage(counters, "failed", "landing_error_page");
    recordDiffStage(counters, {
      status: "skipped_no_snapshot",
      fieldBails: {
        headline: "fetch_bailed_no_snapshot",
        offer: "fetch_bailed_no_snapshot",
        cta: "fetch_bailed_no_snapshot",
        form: "fetch_bailed_no_snapshot",
      },
    });

    await recordCtaPipelineStageCounts(
      appEnv,
      counters,
      new Date(`${day}T12:00:00.000Z`),
    );

    const counts = await stageCountsForDay(day);
    expect(counts.checks_started).toBe(1);
    // The fetch failed, so none of the downstream stages were reached.
    expect(counts.page_fetch_succeeded).toBeUndefined();
    expect(counts.validity_passed).toBeUndefined();
    expect(counts.dom_extracted).toBeUndefined();
    expect(counts.diff_computed).toBeUndefined();
    expect(counts.event_emitted).toBeUndefined();
  });

  it("accumulates counts across checks on the same day", async () => {
    const day = "2026-09-03";
    await recordCtaPipelineStageCounts(
      appEnv,
      fullSuccessfulCounters(),
      new Date(`${day}T12:00:00.000Z`),
    );
    await recordCtaPipelineStageCounts(
      appEnv,
      fullSuccessfulCounters(),
      new Date(`${day}T13:00:00.000Z`),
    );

    const counts = await stageCountsForDay(day);
    for (const stage of CTA_PIPELINE_STAGES) {
      expect(counts[stage]).toBe(2);
    }
  });

  it("a real CTA change emits exactly one landing_page_cta_changed event and records event_emitted=1", async () => {
    const baseline = baselineProof();
    const snapshot = realSnapshot({ ctaText: "Get offer" });
    const currentProof = currentProofFromSnapshot(snapshot);

    const classification = classifyCaptureValidity({
      snapshot,
      failureDetail: null,
      currentProof,
      lastSuccessfulProof: baseline,
      recentWatchEvents: [],
      proofTargetIdentity: PROOF_TARGET_IDENTITY,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: snapshot.capturedAt,
      screenshotCorroborates: true,
    });

    // The real CTA change must produce exactly one confirmed CTA event.
    expect(classification.status).toBe("succeeded");
    expect(classification.events).toHaveLength(1);
    const event = classification.events[0]!;
    expect(event.eventType).toBe("landing_page_cta_changed");
    expect(event.status).toBe("confirmed");

    // The pipeline counters for this exact check reflect that single event.
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-3:run-3",
      watchlistId: "watch-3",
      adId: "ad-3",
      extractorVersion: "lp-signals-v1",
    });
    recordFetchStage(counters, "succeeded");
    recordExtractStage(counters, {
      ctaText: "Get offer",
      priceText: "Starting at ₹499",
      formPresent: true,
      headline: "Glow Serum Sale",
      warnings: [],
      ctaFunnelStage: "reached",
      ctaFunnelReasonCode: null,
    });
    recordDiffStage(counters, {
      status: "confirmed",
      confirmedEventTypes: ["landing_page_cta_changed"],
    });

    const day = "2026-09-04";
    await recordCtaPipelineStageCounts(
      appEnv,
      counters,
      new Date(`${day}T12:00:00.000Z`),
    );

    const counts = await stageCountsForDay(day);
    expect(counts.event_emitted).toBe(1);
    expect(counts.checks_started).toBe(1);
    expect(counts.page_fetch_succeeded).toBe(1);
    expect(counts.validity_passed).toBe(1);
    expect(counts.dom_extracted).toBe(1);
    expect(counts.diff_computed).toBe(1);
  });
});
