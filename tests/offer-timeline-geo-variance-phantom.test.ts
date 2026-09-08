// Offer timeline regression gate for issue #1996.
//
// Captures an ad-discovery target through two different regional storefronts
// (Nike SG vs Nike FR) or at the same storefront hit by a cookie-banner /
// consent CTA. Before the capture-validity gate, these pairs diffed to a
// phantom "Headline/CTA/Price changed" offer transition (and a fake
// `$149 -> —` price disappearance) that never reflected a real offer change.
//
// The gate reclassifies those pairs as an explicit suppressed state — no
// transition, a recorded reason, real proof hrefs kept — instead of emitting
// a phantom transition. This file is the regression test that holds the gate
// shut: it fails on pre-gate code and passes only while the gate is landed.
//
// Method: @2026-09-08

import { describe, expect, it } from "vitest";

import {
  buildOfferLedger,
  formatOfferDate,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";

const SG_A = "landing-pages/2026-09-07/da39a3ee5e6b4b0d3255bfef95601890afd80709.jpeg";
const SG_B = "landing-pages/2026-09-08/356a192b7913b04c54574d18c445648acc0d3a0e.jpeg";
const FR_B = "landing-pages/2026-09-08/86f7e43f0d0d10d2b10e6c7f5d1a0f3d4b7e5f2a.jpeg";
const SG_A_HTML = "landing-pages/2026-09-07/da39a3ee5e6b4b0d3255bfef95601890afd80709.html";
const SG_B_HTML = "landing-pages/2026-09-08/356a192b7913b04c54574d18c445648acc0d3a0e.html";
const FR_B_HTML = "landing-pages/2026-09-08/86f7e43f0d0d10d2b10e6c7f5d1a0f3d4b7e5f2a.html";

function snapshot(overrides: Partial<OfferSnapshotInput> & Pick<OfferSnapshotInput, "id" | "capturedAt">): OfferSnapshotInput {
  return {
    canonicalUrl: "https://www.nike.com/sg/",
    headline: "Nike. Just Do It. Nike.com",
    ctaText: "Shop Now",
    priceText: "$149",
    formPresent: true,
    screenshotKey: SG_A,
    pageTextKey: SG_A_HTML,
    evidenceNote: null,
    ...overrides,
  };
}

describe("capture-validity gate (issue #1996)", () => {
  it("suppresses a real sg+fr Nike capture pair — no phantom offer transition", () => {
    // Snapshot A: Singapore storefront, 7 Sept 2026.
    // Snapshot B: France storefront, 8 Sept 2026. Headline/CTA/price all
    // differ from A only because the regional site localises its copy — a
    // cookie/consent CTA and a "—" where a price would be on the SG page.
    const ledger = buildOfferLedger([
      snapshot({
        id: "sg-07",
        capturedAt: "2026-09-07T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/sg/",
        headline: "Nike. Just Do It. Nike.com",
        ctaText: "Shop Now",
        priceText: "$149",
        formPresent: true,
        screenshotKey: SG_A,
        pageTextKey: SG_A_HTML,
      }),
      snapshot({
        id: "fr-08",
        capturedAt: "2026-09-08T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/fr/",
        headline: "Nike. Just Do It",
        ctaText: "En savoir plus sur les publicités personnalisées",
        priceText: "—",
        formPresent: true,
        screenshotKey: FR_B,
        pageTextKey: FR_B_HTML,
      }),
    ]);

    // Two distinct dated states — one per localised capture.
    expect(ledger).toHaveLength(2);

    // First state: no prior offer, so no transition and no suppression.
    expect(ledger[0]?.id).toBe("sg-07");
    expect(ledger[0]?.dateLabel).toBe(formatOfferDate("2026-09-07T00:00:00.000Z"));
    expect(ledger[0]?.transition).toBeNull();
    expect(ledger[0]?.suppressedReason).toBeNull();

    // Second state: the geo locale changed, so the pair is suppressed — NO
    // "Headline/CTA/Price changed" transition and NO `$149 -> —` price
    // disappearance.
    expect(ledger[1]?.id).toBe("fr-08");
    expect(ledger[1]?.dateLabel).toBe(formatOfferDate("2026-09-08T00:00:00.000Z"));
    expect(ledger[1]?.transition).toBeNull();
    expect(ledger[1]?.suppressedReason).toBe("geo locale change");

    // Proof is still preserved while the transition is suppressed.
    expect(ledger[1]?.screenshotHref).toBe(
      `/artifacts/proof/${encodeURIComponent(FR_B)}`,
    );
    expect(ledger[1]?.pageTextHref).toBe(
      `/artifacts/page-text/${encodeURIComponent(FR_B_HTML)}`,
    );
  });

  it("still emits exactly ONE transition for a genuine same-geo price edit", () => {
    // Both captures on the Singapore storefront; the only real change is the
    // price dropping from $149 to $129. This must diff normally — it is not a
    // geo or consent artefact.
    const ledger = buildOfferLedger([
      snapshot({
        id: "sg-07",
        capturedAt: "2026-09-07T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/sg/",
        headline: "Nike. Just Do It. Nike.com",
        ctaText: "Shop Now",
        priceText: "$149",
        formPresent: true,
        screenshotKey: SG_A,
        pageTextKey: SG_A_HTML,
      }),
      snapshot({
        id: "sg-08",
        capturedAt: "2026-09-08T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/sg/",
        headline: "Nike. Just Do It. Nike.com",
        ctaText: "Shop Now",
        priceText: "$129",
        formPresent: true,
        screenshotKey: SG_B,
        pageTextKey: SG_B_HTML,
      }),
    ]);

    expect(ledger).toHaveLength(2);

    // A genuine change is NOT suppressed.
    expect(ledger[1]?.suppressedReason).toBeNull();

    // Exactly one transition, and it is the real price edit.
    expect(ledger[1]?.transition).not.toBeNull();
    expect(ledger[1]?.transition?.priceText).toEqual({ before: "$149", after: "$129" });
    expect(ledger[1]?.transition?.headline).toBeNull();
    expect(ledger[1]?.transition?.ctaText).toBeNull();
  });

  it("suppresses a cookie-banner CTA swap on the SAME geo with the consent reason", () => {
    // Both captures on the Singapore storefront; headline and price are
    // identical. Only the CTA changed to a consent/ads-personalization string
    // — the issue's second cause, and it must be suppressed even though the
    // geo did not change.
    const ledger = buildOfferLedger([
      snapshot({
        id: "sg-07",
        capturedAt: "2026-09-07T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/sg/",
        headline: "Nike. Just Do It. Nike.com",
        ctaText: "Shop Now",
        priceText: "$149",
        formPresent: true,
        screenshotKey: SG_A,
        pageTextKey: SG_A_HTML,
      }),
      snapshot({
        id: "sg-08",
        capturedAt: "2026-09-08T00:00:00.000Z",
        canonicalUrl: "https://www.nike.com/sg/",
        headline: "Nike. Just Do It. Nike.com",
        ctaText: "En savoir plus sur les publicités personnalisées",
        priceText: "$149",
        formPresent: true,
        screenshotKey: SG_B,
        pageTextKey: SG_B_HTML,
      }),
    ]);

    expect(ledger).toHaveLength(2);

    // Consent string on a same-geo pair is suppressed with its own reason.
    expect(ledger[1]?.transition).toBeNull();
    expect(ledger[1]?.suppressedReason).toBe("cookie banner / consent string");

    // Proof is kept for the second, suppressed capture.
    expect(ledger[1]?.screenshotHref).toBe(
      `/artifacts/proof/${encodeURIComponent(SG_B)}`,
    );
    expect(ledger[1]?.pageTextHref).toBe(
      `/artifacts/page-text/${encodeURIComponent(SG_B_HTML)}`,
    );
  });
});