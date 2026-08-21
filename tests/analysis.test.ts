import { describe, expect, it } from "vitest";

import {
  buildAnalysisFields,
  composeResearchSummary,
  deriveHook,
  deriveOffer,
  resolveHookAndOffer,
  withStructuredAnalysis,
} from "~/lib/analysis.server";
import {
  formatOfferDisplay,
  NO_EXPLICIT_OFFER_LABEL,
} from "~/lib/analysis-display";
import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import type { AdRecord } from "~/lib/types";

const baseAd: AdRecord = {
  metaAdId: "meta-1",
  advertiser: "boAt",
  body: "Bass bhi, battery bhi.",
  previewHeadline: "Bass bhi. Battery bhi.",
  previewSubhead: "Launch pricing",
  hook: "Bass bhi. Battery bhi.",
  offer: "Launch pricing",
  cta: "Buy now",
  format: "video",
  languageLabel: "Hinglish",
  destinationType: "website",
  landingPageUrl: "https://boat.example.com/rockerz-neckband",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_api",
  analysisFields: [],
  landingPage: {
    rawUrl: "https://boat.example.com/rockerz-neckband",
    canonicalUrl: "https://boat.example.com/rockerz-neckband",
    rawHeadline: "Browser rendering required",
    normalizedHeadline: "browser rendering required",
    normalizedHeadlineHash: "fnv1a-headline",
    captureMethod: "browser_render",
    capturedAt: "2026-03-30T00:00:00.000Z",
    artifactKey: null,
    metadata: {
      reason: "fallback_not_configured",
    },
  },
};

describe("buildAnalysisFields", () => {
  it("uses the landing page capture method as provenance for headline summary", () => {
    const fields = buildAnalysisFields(baseAd, "user");
    const headlineField = fields.find(
      (field) => field.fieldKey === "landing_page_headline_summary",
    );

    expect(headlineField?.provenanceSource).toBe("browser_render");
  });

  it("stores confidence and metadata on the language_label field", () => {
    const fields = buildAnalysisFields(baseAd, "user");
    const languageField = fields.find(
      (field) => field.fieldKey === "language_label",
    );

    expect(languageField?.fieldValue).toBe("Hinglish");
    expect(languageField?.confidence).toBeGreaterThan(0.65);
    expect(languageField?.metadata).toMatchObject({
      decisionReason: "latin_with_hinglish_cues",
      cueMatches: expect.arrayContaining(["bhi"]),
    });
  });

  it("adds creative OCR text as ad analysis with explicit snapshot provenance", () => {
    const fields = buildAnalysisFields(
      {
        ...baseAd,
        creativeText: "60 Hours Playback\nOnly ₹999",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: {
          fetchStatus: 200,
        },
      },
      "user",
    );
    const ocrField = fields.find((field) => field.fieldKey === "ocr_text");

    expect(ocrField).toMatchObject({
      fieldValue: "60 Hours Playback\nOnly ₹999",
      provenanceSource: "ad_snapshot_fetch",
      extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
      metadata: {
        fetchStatus: 200,
      },
    });
  });

  it("omits empty hook and offer fields instead of assigning them confidence", () => {
    const fields = buildAnalysisFields(
      { ...baseAd, hook: "", offer: "" },
      "user",
    );

    expect(fields.find((field) => field.fieldKey === "hook")).toBeUndefined();
    expect(fields.find((field) => field.fieldKey === "offer")).toBeUndefined();
  });
});

describe("deriveHook / deriveOffer", () => {
  it("extracts USD EUR and GBP promo offers without falling back to the body", () => {
    expect(deriveOffer("Get $20 off sitewide this weekend only")).toMatch(
      /\$20\s*off/i,
    );
    expect(deriveOffer("Save €15 on your first order")).toMatch(/€15/);
    expect(deriveOffer("From £9.99 with free delivery")).toMatch(
      /£9\.99|free delivery/i,
    );
    expect(deriveOffer("Flat 30% off serums + free shipping")).toMatch(
      /30\s*%\s*off/i,
    );
  });

  it("returns null when no explicit offer phrase exists", () => {
    expect(
      deriveOffer("Meet our new daily moisturizer for busy mornings."),
    ).toBeNull();
    expect(formatOfferDisplay(null)).toBe(NO_EXPLICIT_OFFER_LABEL);
    expect(formatOfferDisplay("")).toBe(NO_EXPLICIT_OFFER_LABEL);
  });

  it("does not invent offers from ordinary r/z words (FIX-3)", () => {
    expect(deriveOffer("Over 200 styles")).toBeNull();
    expect(deriveOffer("Discover 12 colorways")).toBeNull();
    expect(deriveOffer("Shop the Bogotá collection")).toBeNull();
    expect(deriveOffer("Use code SUMMER at checkout")).toBeNull();
    // Still match real multi-char currency tokens.
    expect(deriveOffer("From R$ 49,90 this week")).toMatch(/R\$\s*49/i);
  });

  it("never returns identical hook and offer strings", () => {
    const body = "Shop now at nike.com for the latest drops.";
    const resolved = resolveHookAndOffer({
      body,
      previewHeadline: body,
      cta: "Shop now",
    });
    expect(resolved.hook).toBeTruthy();
    // No promo phrase → empty offer, not a body/CTA copy.
    expect(resolved.offer).toBe("");
    expect(resolved.hook).not.toBe(resolved.offer);

    const promo = resolveHookAndOffer({
      body: "30% off everything. Limited time.",
      previewHeadline: "30% off everything",
      cta: "Shop",
    });
    expect(promo.hook.toLowerCase()).not.toBe(promo.offer.toLowerCase());
  });

  it("caps hooks and strips heavy emoji runs", () => {
    const long = `${"Amazing deal today ".repeat(20)}ends soon!`;
    const hook = deriveHook(long, "fallback");
    expect(hook.length).toBeLessThanOrEqual(120);
  });

  it("never leaves a lone surrogate when the 120-char cap cuts an emoji", () => {
    // Units 0..118 are "x", unit 119 is the high half of 🌟 (U+1F31F): a plain
    // slice(0, 119) would orphan it and the hook would render "�" on /search.
    const body = `${"x".repeat(118)}🌟 more text follows here to push past the cap`;
    const hook = deriveHook(body, "fallback");
    expect(hook.endsWith("…")).toBe(true);
    expect(/[\uD800-\uDFFF]/.test(hook)).toBe(false);
    expect(hook.includes("\uFFFD")).toBe(false);
  });

  it("collapses a heavy emoji run without orphaning a surrogate half", () => {
    // "✨🌟❤" is a run of 3 pictographs; collapsing it to 2 code units must
    // not slice 🌟's pair in half (old match.slice(0, 2) produced a lone high
    // surrogate that renders as "�").
    const body = "✨🌟❤ Get 40% off luxury serums today only while stocks last";
    const hook = deriveHook(body, "fallback");
    expect(/[\uD800-\uDFFF]/.test(hook)).toBe(false);
    expect(hook.includes("\uFFFD")).toBe(false);
    // The run collapses to well-formed text: the first pictograph survives
    // whole, and the rest of the sentence is untouched.
    expect(hook.startsWith("✨ Get 40% off luxury serums")).toBe(true);
  });
});

describe("composeResearchSummary", () => {
  it("builds distinct signal lines from real fields only", () => {
    const a = composeResearchSummary({
      active: true,
      firstSeenAt: new Date(
        Date.now() - 62 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      landingPageUrl: "https://www.nykaa.com/sale",
      offer: "30% off",
      format: "image",
      platforms: ["Instagram", "Facebook"],
      countries: ["US"],
      source: "meta_library_browser",
      variantCount: 3,
    });
    const b = composeResearchSummary({
      active: false,
      firstSeenAt: null,
      landingPageUrl: null,
      offer: "",
      format: "video",
      platforms: ["Facebook"],
      countries: ["US"],
      source: "meta_library_browser",
    });

    expect(a).toMatch(/Active/);
    expect(a).toMatch(/Running 62 days/);
    expect(a).toMatch(/3 variants/);
    expect(a).toMatch(/discount offer/);
    expect(a).toMatch(/links to nykaa\.com/);
    expect(b).toMatch(/Inactive/);
    expect(b).toMatch(/video creative/);
    expect(a).not.toBe(b);
  });
});

describe("withStructuredAnalysis", () => {
  it("updates the visible ad language label from the classifier result", () => {
    const nextAd = withStructuredAnalysis({
      ...baseAd,
      languageLabel: "English",
      previewHeadline: "Offer",
      body: "Sale",
      previewSubhead: "",
      landingPage: {
        ...baseAd.landingPage!,
        rawHeadline: "सिर्फ आज के लिए ऑफर",
      },
    });

    expect(nextAd.languageLabel).toBe("Hindi");
  });

  it("keeps Browser Run discovery provenance distinct from Meta API provenance", () => {
    const { analysisFields: _analysisFields, ...inputAd } = baseAd;
    const nextAd = withStructuredAnalysis({
      ...inputAd,
      source: "meta_library_browser",
    });
    const hookField = nextAd.analysisFields.find(
      (field) => field.fieldKey === "hook",
    );

    expect(hookField?.provenanceSource).toBe("meta_library_browser");
  });
});

describe("honest extracted analysis", () => {
  it("returns no offer when the body contains no explicit promotion", () => {
    expect(deriveOffer("Fresh skincare for summer.")).toBeNull();
    expect(deriveOffer("Discover Bogotá this weekend.")).toBeNull();
    expect(deriveOffer("Use code R2D2 at checkout.")).toBeNull();
    expect(deriveOffer("Over 200 styles available.")).toBeNull();
    expect(deriveOffer("The wholesale ends at the market.")).toBeNull();
    expect(deriveOffer("Choose $,. as separators.")).toBeNull();
  });

  it("recognizes explicit BOGO and currency offers without copying the whole body", () => {
    expect(deriveOffer("BOGO weekend is here.")).toBe("BOGO");
    expect(deriveOffer("Flat 30% off today.")).toBe("Flat 30% off");
    expect(deriveOffer("Starting at $ 19 today.")).toBe("Starting at $ 19");
    expect(deriveOffer("From € 20 today.")).toBe("From € 20");
    expect(deriveOffer("Starting at £ 15 today.")).toBe("Starting at £ 15");
    expect(deriveOffer("Starting at R$ 199 today.")).toBe("Starting at R$ 199");
    expect(deriveOffer("From zł 99 today.")).toBe("From zł 99");

    const body = "Meet your new serum. BOGO weekend is here.";
    const analysis = resolveHookAndOffer({
      body,
      previewHeadline: "Serum launch",
    });

    expect(analysis.hook).toBe("Meet your new serum.");
    expect(analysis.offer).toBe("BOGO");
    expect(analysis.offer).not.toBe(body);

    expect(
      resolveHookAndOffer({ body: "BOGO", previewHeadline: "BOGO" }),
    ).toEqual({ hook: "BOGO", offer: "BOGO" });
    expect(
      resolveHookAndOffer({ body: "Launch pricing", previewHeadline: "Launch pricing" }),
    ).toEqual({ hook: "Launch pricing", offer: "Launch pricing" });
  });
});
