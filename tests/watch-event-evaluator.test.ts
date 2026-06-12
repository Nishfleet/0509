import { describe, expect, it } from "vitest";

import {
  evaluateProofBackedEvents,
  selectLastSuccessfulProofCapture,
  scoreWatchEventImportance,
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

function launchGate(input: {
  proofSuccessRate: number;
  falsePositiveRate: number;
  provisionalCustomerSendShare: number;
  duplicateSendRate: number;
  webhookLagP95Minutes: number;
  reconciliationSuccessRate: number;
}) {
  return (
    input.proofSuccessRate >= 0.8 &&
    input.falsePositiveRate <= 0.05 &&
    input.provisionalCustomerSendShare <= 0.02 &&
    input.duplicateSendRate <= 0.001 &&
    input.webhookLagP95Minutes <= 5 &&
    input.reconciliationSuccessRate >= 0.98
  );
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

  it("invalidates low-confidence headline noise when the normalized proof is unchanged", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow   Serum Sale",
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

  it("keeps the customer rollout gate numeric and explicit", () => {
    expect(
      launchGate({
        proofSuccessRate: 0.82,
        falsePositiveRate: 0.04,
        provisionalCustomerSendShare: 0.01,
        duplicateSendRate: 0.0005,
        webhookLagP95Minutes: 3,
        reconciliationSuccessRate: 0.99,
      }),
    ).toBe(true);

    expect(
      launchGate({
        proofSuccessRate: 0.79,
        falsePositiveRate: 0.04,
        provisionalCustomerSendShare: 0.01,
        duplicateSendRate: 0.0005,
        webhookLagP95Minutes: 3,
        reconciliationSuccessRate: 0.99,
      }),
    ).toBe(false);
  });
});

describe("signal-quality hardening (2026-06-12)", () => {
  it("suppresses A/B flip-flops: same field, different from→to, within the window", () => {
    // Prior alert was hash-b → hash-a; today's change is hash-a → hash-b.
    // Per-field suppression must catch this even though the diff differs.
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
            diffHash: "landing_page_headline_changed:hash-b:hash-a",
          },
          createdAt: "2026-04-17T00:00:00.000Z",
        }),
      ],
      sensitivityMode: "balanced",
      burstCount: 1,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.status).toBe("suppressed");
  });

  it("keeps suppressing daily repeats: a 30-hour-old alert is still inside the window", () => {
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
          createdAt: "2026-04-16T18:00:00.000Z", // 30h before now
        }),
      ],
      sensitivityMode: "balanced",
      burstCount: 1,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(result.status).toBe("suppressed");
  });

  it("scores without a proof-presence bump so only headline changes clear the balanced instant bar", () => {
    expect(
      scoreWatchEventImportance({
        eventType: "landing_page_headline_changed",
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        indiaSignals: false,
      }),
    ).toBe(75);
    expect(
      scoreWatchEventImportance({
        eventType: "landing_page_offer_changed",
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        indiaSignals: false,
      }),
    ).toBe(74);
    expect(
      scoreWatchEventImportance({
        eventType: "landing_page_cta_changed",
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        indiaSignals: false,
      }),
    ).toBe(72);
  });
});
