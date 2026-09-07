import { describe, expect, it } from "vitest";

import { classifyCaptureValidity } from "~/lib/capture-validity.server";
import {
  createLandingPagePipelineCounters,
  recordDiffStage,
  recordExtractStage,
  recordFetchStage,
  recordValidityStage,
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
 *   - a fetch bail-out increments only checks_started (validity never ran);
 *   - a capture-validity bail-out (error/challenge/cookie wall) increments
 *     checks_started + page_fetch_succeeded but NOT validity_passed — the
 *     funnel attributes the drop to the validity gate, not the diff;
 *   - a valid page with NO change (suppressed) still records validity_passed
 *     — the page was real, only the event was suppressed. This is the case
 *     the prior near-silent detector would have miscounted as a validity
 *     bail-out;
 *   - counts accumulate per day;
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
  recordValidityStage(counters, "succeeded", null);
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

  it("records only checks_started when the fetch bailed (validity never ran)", async () => {
    const day = "2026-09-02";
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-2:run-2",
      watchlistId: "watch-2",
      adId: "ad-2",
      extractorVersion: "lp-signals-v1",
    });
    // Fetch bailed out — no snapshot, so the validity gate never ran, no
    // extract, no diff, no event. validity.outcome stays null.
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

  it("attributes a capture-validity bail-out to the validity gate, not the diff", async () => {
    const day = "2026-09-03";
    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-3:run-3",
      watchlistId: "watch-3",
      adId: "ad-3",
      extractorVersion: "lp-signals-v1",
    });
    // The fetch produced a snapshot, but the capture-validity gate rejected
    // it (error/challenge/cookie wall). The funnel must show the drop at the
    // validity gate: page_fetch_succeeded reached, validity_passed NOT.
    recordFetchStage(counters, "succeeded");
    recordValidityStage(counters, "capture_failed", "cookie_wall");
    recordDiffStage(counters, {
      status: "skipped_no_snapshot",
      fieldBails: {
        headline: "validity_bailed",
        offer: "validity_bailed",
        cta: "validity_bailed",
        form: "validity_bailed",
      },
    });

    const counts = ctaPipelineStageCountsFromCounters(counters);
    expect(counts.checks_started).toBe(1);
    expect(counts.page_fetch_succeeded).toBe(1);
    expect(counts.validity_passed).toBe(0);
    expect(counts.dom_extracted).toBe(0);
    expect(counts.diff_computed).toBe(0);
    expect(counts.event_emitted).toBe(0);

    await recordCtaPipelineStageCounts(
      appEnv,
      counters,
      new Date(`${day}T12:00:00.000Z`),
    );

    const persisted = await stageCountsForDay(day);
    expect(persisted.checks_started).toBe(1);
    expect(persisted.page_fetch_succeeded).toBe(1);
    // validity_passed is not written (it was 0), so the row is absent.
    expect(persisted.validity_passed).toBeUndefined();
    expect(persisted.dom_extracted).toBeUndefined();
    expect(persisted.event_emitted).toBeUndefined();
  });

  it("records validity_passed for a valid page with NO change (suppressed)", async () => {
    const day = "2026-09-04";
    // A real page that did not change: the capture-validity gate passed
    // (the page was real), the extractor ran, the diff ran but suppressed
    // (no confirmed event). The prior mapping (validity = diff.confirmed)
    // would have wrongly recorded validity_passed = 0 here — this test pins
    // that the validity gate and the diff are separate funnel stages.
    const baseline = baselineProof();
    const snapshot = realSnapshot(); // same CTA as baseline → no change
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

    // No CTA change → no confirmed event. The classifier still classifies
    // the capture as a real page (succeeded or suppressed), NOT capture_failed.
    expect(classification.status).not.toBe("capture_failed");

    const counters = createLandingPagePipelineCounters({
      scanId: "proof-request:watch-4:run-4",
      watchlistId: "watch-4",
      adId: "ad-4",
      extractorVersion: "lp-signals-v1",
    });
    recordFetchStage(counters, "succeeded");
    recordValidityStage(counters, classification.status, classification.reason);
    recordExtractStage(counters, {
      ctaText: snapshot.ctaText ?? null,
      priceText: snapshot.priceText ?? null,
      formPresent: snapshot.formPresent ?? null,
      headline: snapshot.rawHeadline,
      warnings: [],
      ctaFunnelStage: "reached",
      ctaFunnelReasonCode: null,
    });
    recordDiffStage(counters, {
      status:
        classification.evaluation?.status === "suppressed"
          ? "suppressed"
          : "baseline_established",
      confirmedEventTypes: classification.events.map((e) => e.eventType),
    });

    const counts = ctaPipelineStageCountsFromCounters(counters);
    expect(counts.checks_started).toBe(1);
    expect(counts.page_fetch_succeeded).toBe(1);
    // The page was real — validity passed even though no event fired.
    expect(counts.validity_passed).toBe(1);
    expect(counts.dom_extracted).toBe(1);
    expect(counts.diff_computed).toBe(1);
    // No confirmed change → no event emitted.
    expect(counts.event_emitted).toBe(0);

    await recordCtaPipelineStageCounts(
      appEnv,
      counters,
      new Date(`${day}T12:00:00.000Z`),
    );

    const persisted = await stageCountsForDay(day);
    expect(persisted.validity_passed).toBe(1);
    expect(persisted.event_emitted).toBeUndefined();
  });

  it("accumulates counts across checks on the same day", async () => {
    const day = "2026-09-05";
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
      scanId: "proof-request:watch-5:run-5",
      watchlistId: "watch-5",
      adId: "ad-5",
      extractorVersion: "lp-signals-v1",
    });
    recordFetchStage(counters, "succeeded");
    recordValidityStage(counters, classification.status, classification.reason);
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

    const day = "2026-09-06";
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
