import { describe, expect, it } from "vitest";

import { isCustomerDigestEligibleEvent } from "~/lib/delivery-policy.server";
import {
  classifyExtractorSuppression,
  extractLandingPageSignals,
} from "~/lib/landing-page-signals.server";
import {
  resolveSuppressedCandidateRefusal,
} from "~/lib/run-history-capture-visibility";
import type { EventCandidateRecord, ProofCaptureRecord } from "~/lib/types";
import { evaluateProofBackedEvents } from "~/lib/watch-event-evaluator.server";

/**
 * Issue #1159: timestamp-only edits and rotating banners succeed as
 * captures, and the extractor drops the churn. Run history had nothing to
 * show until those suppressions were stored as candidates.
 */

const GLOW_BODY = `<body><header><nav>Shop About Reviews Contact</nav></header>
<main><h1>Glow Serum — Save 20% Today</h1>
<p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
<p>Starting at ₹499. Free shipping on orders over ₹999.</p>
<a href="/buy" class="cta">Buy now</a>
<form action="/checkout" method="post">
<input name="email" type="email" placeholder="Email"/>
<button type="submit">Get offer</button>
</form></main>
<footer>© 2026 Glow Co. All rights reserved. Terms · Privacy · Support</footer></body>`;

function glowPage(input: {
  generatedAt?: string;
  adCreative?: string;
  priceText?: string;
}) {
  const meta = input.generatedAt
    ? `<meta name="generated-at" content="${input.generatedAt}"/>`
    : "";
  const ad = input.adCreative
    ? `<div class="ad-slot" data-slot-id="home-top-728x90">
  <a href="/click/${input.adCreative}"><img src="https://ad-network.example/${input.adCreative}.jpg" alt=""/></a>
</div>`
    : "";
  const price = input.priceText ?? "Starting at ₹499. Free shipping on orders over ₹999.";
  return `<html><head><title>Glow Serum — Save 20% Today</title>${meta}</head>
${GLOW_BODY.replace("Starting at ₹499. Free shipping on orders over ₹999.", price).replace(
    '<a href="/buy" class="cta">Buy now</a>',
    `${ad}<a href="/buy" class="cta">Buy now</a>`,
  )}</html>`;
}

const FIELD_BASE = {
  rawHeadline: "Glow Serum — Save 20% Today",
  normalizedHeadline: "glow serum — save 20% today",
  normalizedHeadlineHash: "hash-glow",
  ctaText: "Buy now",
  priceText: "Starting at ₹499",
  formPresent: true,
  extractorVersion: "lp-signals-v5",
};

function fingerprintsOn(html: string) {
  const { suppressionFingerprints } = extractLandingPageSignals(html);
  return {
    extractorRawTextHash: suppressionFingerprints.rawTextHash,
    extractorAdSlotStrippedTextHash: suppressionFingerprints.adSlotStrippedTextHash,
    extractorChurnStableTextHash: suppressionFingerprints.churnStableTextHash,
  };
}

function proof(html: string, overrides: Partial<ProofCaptureRecord> = {}): ProofCaptureRecord {
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
      ...FIELD_BASE,
      ...fingerprintsOn(html),
    },
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v5",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-08-25T10:00:00.000Z",
    succeededAt: "2026-08-25T10:00:01.000Z",
    createdAt: "2026-08-25T10:00:01.000Z",
    updatedAt: "2026-08-25T10:00:01.000Z",
    ...overrides,
  };
}

function evaluatePair(baselineHtml: string, currentHtml: string) {
  return evaluateProofBackedEvents({
    proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
    currentProof: {
      ...FIELD_BASE,
      ...fingerprintsOn(currentHtml),
    },
    lastSuccessfulProof: proof(baselineHtml),
    recentWatchEvents: [],
    sensitivityMode: "balanced",
    burstCount: 1,
    currentCapturedAt: "2026-08-25T13:50:00.000Z",
    screenshotCorroborates: true,
  });
}

function asCandidate(
  event: ReturnType<typeof evaluateProofBackedEvents>["events"][number],
): Pick<
  EventCandidateRecord,
  "id" | "status" | "skipReason" | "dedupeReason" | "metadata" | "detectedAt"
> {
  return {
    id: "candidate-suppressed",
    status: event.status,
    skipReason: null,
    dedupeReason: event.dedupeReason,
    metadata: event.metadata,
    detectedAt: "2026-08-25T13:50:00.000Z",
  };
}

describe("extractor suppression candidates (#1159)", () => {
  const baseline = glowPage({ generatedAt: "2026-08-25T12:00:00Z" });
  const timestampOnly = glowPage({ generatedAt: "2026-08-25T13:50:00Z" });
  const bannerA = glowPage({
    generatedAt: "2026-08-25T12:00:00Z",
    adCreative: "creative-11111",
  });
  const bannerB = glowPage({
    generatedAt: "2026-08-25T12:00:00Z",
    adCreative: "creative-98765",
  });
  const genuinePrice = glowPage({
    generatedAt: "2026-08-25T12:00:00Z",
    priceText: "Starting at ₹399. Free shipping on orders over ₹999.",
  });

  it("classifies a timestamp-only meta edit as churn_stable", () => {
    expect(
      classifyExtractorSuppression(
        extractLandingPageSignals(baseline).suppressionFingerprints,
        extractLandingPageSignals(timestampOnly).suppressionFingerprints,
      ),
    ).toBe("churn_stable");
  });

  it("classifies a rotating ad-slot creative as ad_slot_strip", () => {
    expect(
      classifyExtractorSuppression(
        extractLandingPageSignals(bannerA).suppressionFingerprints,
        extractLandingPageSignals(bannerB).suppressionFingerprints,
      ),
    ).toBe("ad_slot_strip");
  });

  it("does not classify an identical recapture", () => {
    expect(
      classifyExtractorSuppression(
        extractLandingPageSignals(baseline).suppressionFingerprints,
        extractLandingPageSignals(baseline).suppressionFingerprints,
      ),
    ).toBeNull();
  });

  it("does not classify a genuine price edit as extractor suppression", () => {
    expect(
      classifyExtractorSuppression(
        extractLandingPageSignals(baseline).suppressionFingerprints,
        extractLandingPageSignals(genuinePrice).suppressionFingerprints,
      ),
    ).toBeNull();
  });

  it("records suppressed_churn_stable for a timestamp-only edit and never alerts", () => {
    const result = evaluatePair(baseline, timestampOnly);

    expect(result.status).toBe("suppressed");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      status: "suppressed",
      importanceScore: 0,
      metadata: {
        kind: "extractor_suppression",
        suppression: "churn_stable",
      },
    });
    expect(isCustomerDigestEligibleEvent(result.events[0])).toBe(false);

    const row = resolveSuppressedCandidateRefusal(asCandidate(result.events[0]));
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("suppressed_churn_stable");
    expect(row!.reasonCode).toBe("churn_stable");
    expect(row!.explanation).toBe("Only a timestamp changed");
    expect(row!.generatesAlert).toBe(false);
  });

  it("records suppressed_ad_slot_strip for a rotating banner and never alerts", () => {
    const result = evaluatePair(bannerA, bannerB);

    expect(result.status).toBe("suppressed");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      status: "suppressed",
      importanceScore: 0,
      metadata: {
        kind: "extractor_suppression",
        suppression: "ad_slot_strip",
      },
    });
    expect(isCustomerDigestEligibleEvent(result.events[0])).toBe(false);

    const row = resolveSuppressedCandidateRefusal(asCandidate(result.events[0]));
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("suppressed_ad_slot_strip");
    expect(row!.reasonCode).toBe("ad_slot_strip");
    expect(row!.explanation).toBe("Only a rotating banner changed");
    expect(row!.generatesAlert).toBe(false);
  });

  it("still confirms a genuine price edit when fingerprints are present", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        ...FIELD_BASE,
        priceText: "Starting at ₹399",
        ...fingerprintsOn(genuinePrice),
      },
      lastSuccessfulProof: proof(baseline),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      screenshotCorroborates: true,
    });

    expect(result.status).toBe("confirmed");
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        status: "confirmed",
      }),
    ]);
  });

  it("does not invent a suppression when prior fingerprints are missing", () => {
    const result = evaluateProofBackedEvents({
      proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      currentProof: {
        ...FIELD_BASE,
        ...fingerprintsOn(timestampOnly),
      },
      lastSuccessfulProof: proof(baseline, {
        extractedFields: { ...FIELD_BASE },
      }),
      recentWatchEvents: [],
      sensitivityMode: "balanced",
      burstCount: 1,
      screenshotCorroborates: true,
    });

    expect(result.status).toBe("invalidated");
    expect(result.events).toEqual([]);
  });
});
