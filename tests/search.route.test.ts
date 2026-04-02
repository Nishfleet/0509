import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

const baseAd: AdRecord = {
  metaAdId: "meta-boat-1",
  advertiser: "boAt",
  body: "Bass bhi, battery bhi.",
  previewHeadline: "Bass bhi. Battery bhi.",
  previewSubhead: "Launch pricing",
  hook: "Bass bhi. Battery bhi.",
  offer: "Launch pricing",
  cta: "Buy now",
  format: "image",
  languageLabel: "Hinglish",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: "https://cdn.example.com/meta-boat-1.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search loader OCR reuse", () => {
  it("reuses persisted creative text before re-running capture", async () => {
    const env = { META_AD_LIBRARY_TOKEN: "token", DB: {} };
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText: "60 Hours Playback\nOnly ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives,
      upsertAd: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      env as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(hydrateAdsWithPersistedCreatives).toHaveBeenCalledWith(env, [baseAd]);
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(result.selectedAd?.creativeText).toBe("60 Hours Playback\nOnly ₹999");
    expect(result.selectedAd?.creativeTextMetadata).toEqual({
      source: "stored",
    });
  });

  it("translates stored non-English creative text into a translated analysis field", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      translated_text: "60 Hours Playback\nOnly Rs 999",
    });
    const env = {
      META_AD_LIBRARY_TOKEN: "token",
      DB: {},
      AI: {
        run: aiRun,
      },
    };
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText: "60 Hours Playback\nSirf ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);
    const upsertAd = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives,
      upsertAd,
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      env as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(result.selectedAd?.analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "translated_text",
          fieldValue: "60 Hours Playback\nOnly Rs 999",
          provenanceSource: "ai_summary",
        }),
      ]),
    );
    expect(upsertAd).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        metaAdId: "meta-boat-1",
        analysisFields: expect.arrayContaining([
          expect.objectContaining({
            fieldKey: "translated_text",
            fieldValue: "60 Hours Playback\nOnly Rs 999",
          }),
        ]),
      }),
    );
  });
});
