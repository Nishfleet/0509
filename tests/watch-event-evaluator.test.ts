import { describe, expect, it } from "vitest";

import {
  evaluateProofBackedEvents,
  selectLastSuccessfulProofCapture,
} from "~/lib/watch-event-evaluator.server";
import type { ProofCaptureRecord, WatchEventRecord } from "~/lib/types";

function proofCapture(overrides: Partial<ProofCaptureRecord> = {}): ProofCaptureRecord {
  return {
    id: "proof-1",
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
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
      canonicalUrl: "https://example.com/glow",
    },
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-04-10T00:00:00.000Z",
    succeededAt: "2026-04-10T00:00:01.000Z",
    createdAt: "2026-04-10T00:00:01.000Z",
    updatedAt: "2026-04-10T00:00:01.000Z",
    ...overrides,
  };
}

function watchEvent(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-0",
    eventType: "landing_page_headline_changed",
    status: "confirmed",
    importanceScore: 75,
    adId: "meta-boat-1",
    baselineFromRunId: "run-prev",
    candidateId: "candidate-1",
    proofCaptureId: "proof-prev",
    title: "Landing page headline changed",
    summary: "The landing-page headline changed.",
    metadata: {
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      diffHash: "headline:hash-b",
    },
    confirmedAt: "2026-04-17T01:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-17T01:00:00.000Z",
    createdAt: "2026-04-17T01:00:00.000Z",
    ...overrides,
  };
}

describe("watch event evaluator", () => {
  it("selects the last successful proof instead of a newer failed attempt", () => {
    const selected = selectLastSuccessfulProofCapture([
      proofCapture({
        id: "proof-failed",
        status: "failed",
        attemptedAt: "2026-04-18T00:00:00.000Z",
        succeededAt: null,
      }),
      proofCapture({
        id: "proof-succeeded",
        status: "succeeded",
        attemptedAt: "2026-04-17T00:00:00.000Z",
        succeededAt: "2026-04-17T00:00:01.000Z",
      }),
    ]);

    expect(selected?.id).toBe("proof-succeeded");
  });

  it("confirms proof-backed field changes against the last successful proof", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Weekend Sale",
        normalizedHeadline: "glow serum weekend sale",
        normalizedHeadlineHash: "hash-b",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
      },
      lastSuccessfulProof: proofCapture(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.status).toBe("confirmed");
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "landing_page_headline_changed",
        status: "confirmed",
        metadata: expect.objectContaining({
          proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
          from: "Glow Serum Sale",
          to: "Glow Serum Weekend Sale",
        }),
      }),
    ]);
  });

  it("invalidates when the current proof matches the last successful proof", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
      },
      lastSuccessfulProof: proofCapture(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.status).toBe("invalidated");
    expect(result.events).toEqual([]);
  });

  it("suppresses duplicate proof-backed alerts within the suppression window", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Weekend Sale",
        normalizedHeadline: "glow serum weekend sale",
        normalizedHeadlineHash: "hash-b",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
      },
      lastSuccessfulProof: proofCapture(),
      recentWatchEvents: [
        watchEvent({
          metadata: {
            proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
            diffHash: "landing_page_headline_changed:hash-a:hash-b",
          },
          createdAt: "2026-04-17T22:00:00.000Z",
        }),
      ],
      sensitivityMode: "balanced",
      burstCount: 1,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.status).toBe("suppressed");
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "landing_page_headline_changed",
        status: "suppressed",
        dedupeReason: "proof_duplicate",
      }),
    ]);
  });

  it("adds India-aware urgency to offer changes", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹799 with COD",
        formPresent: true,
      },
      lastSuccessfulProof: proofCapture(),
      recentWatchEvents: [],
      sensitivityMode: "aggressive",
      burstCount: 4,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        importanceScore: expect.any(Number),
      }),
    ]);
    expect(result.events[0]?.importanceScore).toBeGreaterThan(74);
  });
});
