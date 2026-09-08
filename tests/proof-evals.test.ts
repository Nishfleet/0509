import { describe, expect, it } from "vitest";

import { evaluateProofPolicy } from "~/lib/proof-policy.server";
import { evaluateProofBackedEvents } from "~/lib/watch-event-evaluator.server";
import type { ProofCaptureRecord, WatchEventType } from "~/lib/types";

function baselineProof(overrides: Partial<ProofCaptureRecord> = {}): ProofCaptureRecord {
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
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.95,
      ctaText: 0.9,
      priceText: 0.85,
      formPresent: 0.9,
    },
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

describe("proof eval harness", () => {
  it("keeps the standing proof change set free of false positives", () => {
    const cases: Array<{
      name: string;
      currentProof: {
        rawHeadline: string | null;
        normalizedHeadline: string | null;
        normalizedHeadlineHash: string | null;
        ctaText: string | null;
        priceText: string | null;
        formPresent: boolean | null;
      };
      expectedEventTypes: WatchEventType[];
    }> = [
      {
        name: "headline change",
        currentProof: {
          rawHeadline: "Glow Serum Weekend Sale",
          normalizedHeadline: "glow serum weekend sale",
          normalizedHeadlineHash: "hash-b",
          ctaText: "Shop now",
          priceText: "Starting at ₹499",
          formPresent: true,
        },
        expectedEventTypes: ["landing_page_headline_changed"],
      },
      {
        name: "cta change",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Get offer",
          priceText: "Starting at ₹499",
          formPresent: true,
        },
        expectedEventTypes: ["landing_page_cta_changed"],
      },
      {
        name: "offer change",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Shop now",
          priceText: "Starting at ₹799 with COD",
          formPresent: true,
        },
        expectedEventTypes: ["landing_page_offer_changed"],
      },
      {
        name: "form state change",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Shop now",
          priceText: "Starting at ₹499",
          formPresent: false,
        },
        expectedEventTypes: ["landing_page_form_changed"],
      },
      {
        name: "no change",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Shop now",
          priceText: "Starting at ₹499",
          formPresent: true,
        },
        expectedEventTypes: [],
      },
      {
        name: "template noise only",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Shop now",
          priceText: "Starting at ₹499",
          formPresent: true,
        },
        expectedEventTypes: [],
      },
      {
        name: "cookie banner noise only",
        currentProof: {
          rawHeadline: "Glow Serum Sale",
          normalizedHeadline: "glow serum sale",
          normalizedHeadlineHash: "hash-a",
          ctaText: "Shop now",
          priceText: "Starting at ₹499",
          formPresent: true,
        },
        expectedEventTypes: [],
      },
    ];

    const results = cases.map((entry) => ({
      name: entry.name,
      expected: entry.expectedEventTypes,
      actual: evaluateProofBackedEvents({
        proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
        currentProof: entry.currentProof,
        lastSuccessfulProof: baselineProof(),
        recentWatchEvents: [],
        sensitivityMode: "balanced",
        burstCount: 1,
        now: "2026-04-18T00:00:00.000Z",
      }),
    }));

    const misses = results.filter((entry) => {
      const actualTypes = entry.actual.events.map((event) => event.eventType);
      return entry.expected.some((expectedType) => !actualTypes.includes(expectedType));
    });
    const falsePositives = results.filter((entry) => {
      if (entry.expected.length > 0) {
        return false;
      }

      return entry.actual.events.some((event) => event.status === "confirmed");
    });

    expect(misses, JSON.stringify(results, null, 2)).toEqual([]);
    expect(falsePositives, JSON.stringify(results, null, 2)).toEqual([]);
  });

  it("keeps fresh low-signal pages below the proof threshold", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: [],
      lastSuccessfulProofAt: "2026-04-17T12:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 1,
      workspaceDailyAttemptCount: 5,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.bucket).toBeNull();
  });

  it("still opens proof for stale or first-proof cases that protect the moat", () => {
    const firstProofDecision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["ad_new"],
      lastSuccessfulProofAt: null,
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });
    const staleProofDecision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: [],
      lastSuccessfulProofAt: "2026-04-01T00:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(firstProofDecision.shouldCapture).toBe(true);
    expect(staleProofDecision.shouldCapture).toBe(true);
    expect(staleProofDecision.bucket).toBe("freshness-triggered");
  });
});
