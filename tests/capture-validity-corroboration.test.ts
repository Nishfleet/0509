import { describe, expect, it } from "vitest";

import { evaluateProofBackedEvents } from "~/lib/watch-event-evaluator.server";
import type { ProofCaptureRecord } from "~/lib/types";

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

describe("screenshot corroboration cross-check (BET 4)", () => {
  it("confirms a price change when the screenshot corroborates", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹599",
        formPresent: true,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: true,
    });

    expect(result.status).toBe("confirmed");
    const offer = result.events.find((e) => e.eventType === "landing_page_offer_changed");
    expect(offer).toBeDefined();
    expect(offer?.status).toBe("confirmed");
    expect(offer?.metadata).not.toHaveProperty("corroboration");
  });

  it("suppresses a price change when no screenshot corroborates (never an alert)", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹599",
        formPresent: true,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: false,
    });

    const offer = result.events.find((e) => e.eventType === "landing_page_offer_changed");
    expect(offer).toBeDefined();
    expect(offer?.status).toBe("suppressed");
    expect(offer?.metadata.corroboration).toBe("unconfirmed_by_screenshot");
    // dedupeReason stays null — this is a corroboration suppression, not a
    // duplicate. The DB-constrained dedupe_reason column is untouched.
    expect(offer?.dedupeReason).toBeNull();
  });

  it("suppresses a CTA change when no screenshot corroborates", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Buy now",
        priceText: "Starting at ₹499",
        formPresent: true,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: false,
    });

    const cta = result.events.find((e) => e.eventType === "landing_page_cta_changed");
    expect(cta?.status).toBe("suppressed");
    expect(cta?.metadata.corroboration).toBe("unconfirmed_by_screenshot");
  });

  it("does NOT require screenshot corroboration for a headline change", () => {
    // The headline is read from the document title; a missing screenshot
    // cannot fake it. A headline change without corroboration still confirms.
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
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: false,
    });

    const headline = result.events.find((e) => e.eventType === "landing_page_headline_changed");
    expect(headline?.status).toBe("confirmed");
    expect(headline?.metadata).not.toHaveProperty("corroboration");
  });

  it("does NOT require screenshot corroboration for a form change", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: false,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: false,
    });

    const form = result.events.find((e) => e.eventType === "landing_page_form_changed");
    expect(form?.status).toBe("confirmed");
  });

  it("defaults to corroborated when the caller does not opt in (back-compat)", () => {
    // Callers that have not wired screenshotCorroborates keep the standing
    // behavior: a price change confirms. The capture pipeline opts in; bare
    // evaluator callers do not regress.
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹599",
        formPresent: true,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
    });

    const offer = result.events.find((e) => e.eventType === "landing_page_offer_changed");
    expect(offer?.status).toBe("confirmed");
  });

  it("a genuine price edit with corroboration still produces one confirmed event", () => {
    // Termination criterion: a genuine price edit in the same suite still
    // produces one event. The corroboration cross-check must not over-suppress.
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Shop now",
        priceText: "Starting at ₹699",
        formPresent: true,
      },
      lastSuccessfulProof: baselineProof(),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: "2026-04-18T00:00:00.000Z",
      now: "2026-04-18T00:00:00.000Z",
      screenshotCorroborates: true,
    });

    const confirmed = result.events.filter((e) => e.status === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].eventType).toBe("landing_page_offer_changed");
  });
});
