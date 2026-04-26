import { describe, expect, it } from "vitest";

import { buildAnalysisFields, withStructuredAnalysis } from "~/lib/analysis.server";
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
  source: "demo",
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
    const headlineField = fields.find((field) => field.fieldKey === "landing_page_headline_summary");

    expect(headlineField?.provenanceSource).toBe("browser_render");
  });

  it("stores confidence and metadata on the language_label field", () => {
    const fields = buildAnalysisFields(baseAd, "user");
    const languageField = fields.find((field) => field.fieldKey === "language_label");

    expect(languageField?.fieldValue).toBe("Hinglish");
    expect(languageField?.confidence).toBeGreaterThan(0.65);
    expect(languageField?.metadata).toMatchObject({
      decisionReason: "latin_with_hinglish_cues",
      cueMatches: expect.arrayContaining(["bhi"]),
    });
  });

  it("adds creative OCR text as ad analysis with explicit snapshot provenance", () => {
    const fields = buildAnalysisFields({
      ...baseAd,
      creativeText: "60 Hours Playback\nOnly ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        fetchStatus: 200,
      },
    }, "user");
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
    const hookField = nextAd.analysisFields.find((field) => field.fieldKey === "hook");

    expect(hookField?.provenanceSource).toBe("meta_library_browser");
  });
});
