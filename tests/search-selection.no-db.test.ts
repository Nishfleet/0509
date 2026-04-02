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

describe("search selection without D1", () => {
  it("returns public search results without touching D1-backed persistence", async () => {
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      { META_AD_LIBRARY_TOKEN: "token" } as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).toHaveBeenCalledWith(
      { META_AD_LIBRARY_TOKEN: "token" },
      "https://cdn.example.com/meta-boat-1.png",
      baseAd,
    );
    expect(result.result.ads).toEqual([baseAd]);
    expect(result.selectedAd).toEqual(
      expect.objectContaining({
        metaAdId: "meta-boat-1",
        creativeText: "Fresh OCR",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: {
          source: "fresh",
        },
      }),
    );
  });
});
