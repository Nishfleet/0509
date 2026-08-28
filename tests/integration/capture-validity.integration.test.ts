import { describe, expect, it } from "vitest";

import { classifyCaptureValidity } from "~/lib/capture-validity.server";
import {
  createEventCandidate,
  createWatchEvent,
  listEventCandidates,
  listWatchEvents,
} from "~/lib/data/watch-events.server";
import {
  createProofCapture,
  listProofCapturesForTarget,
} from "~/lib/data/watchlist-proof.server";
import {
  resolveProofCaptureRefusal,
  resolveSuppressedCandidateRefusal,
} from "~/lib/run-history-capture-visibility";
import type { LandingPageSnapshotData, ProofCaptureRecord } from "~/lib/types";
import {
  appEnv,
  db,
  seedAd,
  seedProofTarget,
  seedRun,
  seedUser,
  seedWatchlist,
} from "./fixtures";

/**
 * Integration test for the capture-validity classifier (issue #1399).
 *
 * The classifier runs in the proof-capture pipeline and returns one of:
 * `succeeded`, `capture_failed`, or `suppressed`. This file asserts that real
 * D1 rows carry the `captureValidityStatus` and `captureFailureReason` metadata,
 * that run-history visibility surfaces every refused capture, and that no
 * `landing_page_*` watch event is written for failed or suppressed captures.
 */

const ISO_T0 = "2026-08-25T10:00:00.000Z";
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
    capturedAt: "2026-08-25T13:00:00.000Z",
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
  extractorRawTextHash?: string | null;
  extractorAdSlotStrippedTextHash?: string | null;
  extractorChurnStableTextHash?: string | null;
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

async function seed() {
  const userId = await seedUser();
  const watchlistId = await seedWatchlist(userId);
  const runId = await seedRun(watchlistId);
  const adId = await seedAd();
  const proofTargetId = await seedProofTarget(watchlistId);
  return { userId, watchlistId, runId, adId, proofTargetId };
}

function landingPageEvents(events: { eventType: string }[]) {
  return events.filter((event) => event.eventType.startsWith("landing_page_"));
}

async function landingPageEventCountForRun(
  watchlistId: string,
  runId: string,
) {
  const rows = await db()
    .prepare(
      `SELECT count(*) AS n FROM watch_event
       WHERE watchlist_id = ? AND run_id = ? AND event_type LIKE 'landing_page_%'`,
    )
    .bind(watchlistId, runId)
    .first<{ n: number }>();
  return rows?.n ?? 0;
}

describe("capture-validity classifier on real D1 (issue #1399)", () => {
  it("records capture_failed for a 500 error page and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_error_page" },
    });
    expect(classification.status).toBe("capture_failed");

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "Landing-page proof capture failed.",
      captureMetadata: {
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
        unreadableReasonCode: "landing_error_page",
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:500`,
      attemptedAt: ISO_T0,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    expect(capture).toBeDefined();
    expect(capture?.captureMetadata?.captureValidityStatus).toBe("capture_failed");
    expect(capture?.captureMetadata?.captureFailureReason).toBe("landing_error_page");

    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal).not.toBeNull();
    expect(refusal?.kind).toBe("capture_failed");
    expect(refusal?.generatesAlert).toBe(false);

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records capture_failed for a Cloudflare challenge and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_challenge_page" },
    });

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "failed",
      failureCode: "landing_challenge_page",
      failureReason: "Landing-page proof capture failed.",
      captureMetadata: {
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
        unreadableReasonCode: "landing_challenge_page",
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:cf`,
      attemptedAt: ISO_T0,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("capture_failed");
    expect(refusal?.reasonCode).toBe("landing_challenge_page");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records capture_failed for a cookie / consent wall and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_cookie_wall" },
    });

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "failed",
      failureCode: "landing_cookie_wall",
      failureReason: "Landing-page proof capture failed.",
      captureMetadata: {
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
        unreadableReasonCode: "landing_cookie_wall",
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:cookie`,
      attemptedAt: ISO_T0,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("capture_failed");
    expect(refusal?.reasonCode).toBe("landing_cookie_wall");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records capture_failed for a partially-loaded SPA and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_partial_spa" },
    });

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "failed",
      failureCode: "landing_partial_spa",
      failureReason: "Landing-page proof capture failed.",
      captureMetadata: {
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
        unreadableReasonCode: "landing_partial_spa",
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:spa`,
      attemptedAt: ISO_T0,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("capture_failed");
    expect(refusal?.reasonCode).toBe("landing_partial_spa");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records capture_failed for site-down-then-restored and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_error_page" },
    });

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "failed",
      failureCode: "landing_error_page",
      failureReason: "Landing-page proof capture failed.",
      captureMetadata: {
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
        takedownRestore: { restoredAt: "2026-08-25T14:00:00.000Z" },
        unreadableReasonCode: "landing_error_page",
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:down`,
      attemptedAt: ISO_T0,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("capture_failed");
    expect(refusal?.reasonCode).toBe("landing_error_page");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records suppressed for a timestamp-only edit and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, adId, proofTargetId } = await seed();

    const baseline = baselineProof();
    const currentProof = {
      ...currentProofFromSnapshot(realSnapshot()),
      extractorRawTextHash: "current-raw",
      extractorAdSlotStrippedTextHash: "current-adslot",
      extractorChurnStableTextHash: "baseline-churn",
    };

    const classification = classifyCaptureValidity({
      snapshot: realSnapshot(),
      failureDetail: null,
      currentProof,
      lastSuccessfulProof: baseline,
      recentWatchEvents: [],
      proofTargetIdentity: PROOF_TARGET_IDENTITY,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: realSnapshot().capturedAt,
      screenshotCorroborates: true,
    });

    expect(classification.status).toBe("suppressed");
    expect(classification.reason).toBe("churn_stable");

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "succeeded",
      screenshotArtifactKey: "landing-pages/shot.jpeg",
      extractedFields: {
        rawHeadline: realSnapshot().rawHeadline,
        normalizedHeadline: realSnapshot().normalizedHeadline,
        normalizedHeadlineHash: realSnapshot().normalizedHeadlineHash,
        ctaText: realSnapshot().ctaText,
        priceText: realSnapshot().priceText,
        formPresent: realSnapshot().formPresent,
        extractorRawTextHash: currentProof.extractorRawTextHash,
        extractorAdSlotStrippedTextHash: currentProof.extractorAdSlotStrippedTextHash,
        extractorChurnStableTextHash: currentProof.extractorChurnStableTextHash,
      },
      captureMetadata: {
        captureValidated: true,
        screenshotCorroborates: true,
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:churn`,
      attemptedAt: realSnapshot().capturedAt,
      succeededAt: realSnapshot().capturedAt,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    expect(capture?.captureMetadata?.captureValidityStatus).toBe("suppressed");
    expect(capture?.captureMetadata?.captureFailureReason).toBe("churn_stable");

    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("suppressed_churn_stable");
    expect(refusal?.generatesAlert).toBe(false);

    // Pipeline also writes a suppressed event candidate for run history.
    for (const event of classification.events) {
      await createEventCandidate(appEnv, {
        watchlistId,
        runId,
        eventType: event.eventType,
        status: event.status,
        importanceScore: event.importanceScore,
        adId,
        proofTargetId,
        title: event.title,
        summary: event.summary,
        metadata: event.metadata,
        proofRequired: true,
        dedupeReason: event.dedupeReason,
        lastEvaluatedAt: realSnapshot().capturedAt,
      });
    }

    const candidates = await listEventCandidates(appEnv, watchlistId, 10);
    const suppressed = candidates.find((c) => c.proofTargetId === proofTargetId);
    expect(suppressed?.status).toBe("suppressed");
    const candidateRefusal = resolveSuppressedCandidateRefusal(suppressed!);
    expect(candidateRefusal?.kind).toBe("suppressed_churn_stable");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records suppressed for a rotating banner and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, adId, proofTargetId } = await seed();

    const baseline = baselineProof();
    const currentProof = {
      ...currentProofFromSnapshot(realSnapshot()),
      extractorRawTextHash: "current-raw",
      extractorAdSlotStrippedTextHash: "baseline-adslot",
      extractorChurnStableTextHash: "baseline-churn",
    };

    const classification = classifyCaptureValidity({
      snapshot: realSnapshot(),
      failureDetail: null,
      currentProof,
      lastSuccessfulProof: baseline,
      recentWatchEvents: [],
      proofTargetIdentity: PROOF_TARGET_IDENTITY,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: realSnapshot().capturedAt,
      screenshotCorroborates: true,
    });

    expect(classification.status).toBe("suppressed");
    expect(classification.reason).toBe("ad_slot_strip");

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "succeeded",
      screenshotArtifactKey: "landing-pages/shot.jpeg",
      extractedFields: {
        rawHeadline: realSnapshot().rawHeadline,
        normalizedHeadline: realSnapshot().normalizedHeadline,
        normalizedHeadlineHash: realSnapshot().normalizedHeadlineHash,
        ctaText: realSnapshot().ctaText,
        priceText: realSnapshot().priceText,
        formPresent: realSnapshot().formPresent,
        extractorRawTextHash: currentProof.extractorRawTextHash,
        extractorAdSlotStrippedTextHash: currentProof.extractorAdSlotStrippedTextHash,
        extractorChurnStableTextHash: currentProof.extractorChurnStableTextHash,
      },
      captureMetadata: {
        captureValidated: true,
        screenshotCorroborates: true,
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:adslot`,
      attemptedAt: realSnapshot().capturedAt,
      succeededAt: realSnapshot().capturedAt,
    });

    for (const event of classification.events) {
      await createEventCandidate(appEnv, {
        watchlistId,
        runId,
        eventType: event.eventType,
        status: event.status,
        importanceScore: event.importanceScore,
        adId,
        proofTargetId,
        title: event.title,
        summary: event.summary,
        metadata: event.metadata,
        proofRequired: true,
        dedupeReason: event.dedupeReason,
        lastEvaluatedAt: realSnapshot().capturedAt,
      });
    }

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("suppressed_ad_slot_strip");

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records suppressed for a scheduled maintenance window and emits zero landing_page_* events", async () => {
    const { watchlistId, runId, proofTargetId } = await seed();

    const classification = classifyCaptureValidity({
      snapshot: realSnapshot(),
      failureDetail: null,
      maintenanceWindow: true,
    });

    expect(classification.status).toBe("suppressed");
    expect(classification.reason).toBe("maintenance_window");

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "succeeded",
      screenshotArtifactKey: "landing-pages/shot.jpeg",
      extractedFields: {
        rawHeadline: realSnapshot().rawHeadline,
        normalizedHeadline: realSnapshot().normalizedHeadline,
        normalizedHeadlineHash: realSnapshot().normalizedHeadlineHash,
        ctaText: realSnapshot().ctaText,
        priceText: realSnapshot().priceText,
        formPresent: realSnapshot().formPresent,
      },
      captureMetadata: {
        captureValidated: true,
        screenshotCorroborates: true,
        captureValidityStatus: classification.status,
        captureFailureReason: classification.reason,
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:maintenance`,
      attemptedAt: realSnapshot().capturedAt,
      succeededAt: realSnapshot().capturedAt,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal?.kind).toBe("suppressed_maintenance_window");
    expect(refusal?.generatesAlert).toBe(false);

    expect(await landingPageEventCountForRun(watchlistId, runId)).toBe(0);
  });

  it("records succeeded for a genuine price edit and emits exactly one landing_page_offer_changed event", async () => {
    const { watchlistId, runId, adId, proofTargetId } = await seed();

    const baseline = baselineProof();
    const snapshot = realSnapshot({ priceText: "Starting at ₹399" });
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

    expect(classification.status).toBe("succeeded");
    expect(classification.events).toHaveLength(1);
    const event = classification.events[0]!;
    expect(event.eventType).toBe("landing_page_offer_changed");
    expect(event.status).toBe("confirmed");

    const proofCaptureId = await createProofCapture(appEnv, {
      proofTargetId,
      status: "succeeded",
      screenshotArtifactKey: "landing-pages/shot.jpeg",
      extractedFields: {
        rawHeadline: snapshot.rawHeadline,
        normalizedHeadline: snapshot.normalizedHeadline,
        normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
        ctaText: snapshot.ctaText,
        priceText: snapshot.priceText,
        formPresent: snapshot.formPresent,
      },
      captureMetadata: {
        captureValidated: true,
        screenshotCorroborates: true,
        captureValidityStatus: classification.status,
      },
      extractorVersion: "lp-signals-v1",
      idempotencyKey: `proof-request:${watchlistId}:${runId}:genuine`,
      attemptedAt: snapshot.capturedAt,
      succeededAt: snapshot.capturedAt,
    });

    const candidateId = await createEventCandidate(appEnv, {
      watchlistId,
      runId,
      eventType: event.eventType,
      status: event.status,
      importanceScore: event.importanceScore,
      adId,
      proofTargetId,
      title: event.title,
      summary: event.summary,
      metadata: event.metadata,
      proofRequired: true,
      dedupeReason: event.dedupeReason,
      lastEvaluatedAt: snapshot.capturedAt,
    });

    await createWatchEvent(appEnv, {
      watchlistId,
      runId,
      eventType: event.eventType,
      status: "confirmed",
      importanceScore: event.importanceScore,
      adId,
      baselineFromRunId: null,
      candidateId,
      proofCaptureId,
      title: event.title,
      summary: event.summary,
      metadata: event.metadata,
      confirmedAt: snapshot.capturedAt,
      lastEvaluatedAt: snapshot.capturedAt,
    });

    const captures = await listProofCapturesForTarget(appEnv, proofTargetId, 10);
    const capture = captures.find((c) => c.id === proofCaptureId);
    expect(capture?.captureMetadata?.captureValidityStatus).toBe("succeeded");
    expect(capture?.captureMetadata?.captureFailureReason).toBeUndefined();

    const refusal = resolveProofCaptureRefusal(capture!);
    expect(refusal).toBeNull();

    const landingPageEvents = await listWatchEvents(appEnv, watchlistId, 10)
      .then((events) => events.filter((e) => e.eventType.startsWith("landing_page_")));
    expect(landingPageEvents).toHaveLength(1);
    expect(landingPageEvents[0]!.eventType).toBe("landing_page_offer_changed");
    expect(landingPageEvents[0]!.status).toBe("confirmed");
    expect(landingPageEvents[0]!.proofCaptureId).toBe(proofCaptureId);
  });
});
