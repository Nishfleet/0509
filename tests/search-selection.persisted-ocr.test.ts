import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search selection persisted OCR reuse", () => {
  it("rebuilds analysis fields when stored creative text is reused", async () => {
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

    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([hydratedAd]),
      upsertAd: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("~/lib/creative-text.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/creative-text.server")>();

      return {
        ...actual,
        captureCreativeText,
      };
    });
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      {
        DB: {},
        META_AD_LIBRARY_TOKEN: "token",
      } as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(result.selectedAd?.creativeText).toBe("60 Hours Playback\nOnly ₹999");
    expect(result.selectedAd?.analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "ocr_text",
          fieldValue: "60 Hours Playback\nOnly ₹999",
          provenanceSource: "ad_snapshot_fetch",
        }),
      ]),
    );
  });
});
