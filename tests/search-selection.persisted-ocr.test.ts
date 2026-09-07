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

describe("search selection enrichment lease (FIX-13)", () => {
  it("does not schedule a second waitUntil enrichment while one is in flight", async () => {
    const captureCreativeText = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                text: "OCR text",
                captureMethod: "ad_snapshot_fetch",
                metadata: { source: "fresh" },
              }),
            50,
          );
        }),
    );
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: (fields: unknown) => fields,
    }));

    const {
      prepareSearchResultSelection,
      resetSelectionEnrichmentInFlightForTests,
    } = await import("~/lib/search-selection.server");
    resetSelectionEnrichmentInFlightForTests();

    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    const result = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta" as const,
      cacheStatus: "miss" as const,
    };

    const first = await prepareSearchResultSelection({ DB: {} } as never, result, "meta-boat-1", {
      waitUntil,
    });
    const second = await prepareSearchResultSelection({ DB: {} } as never, result, "meta-boat-1", {
      waitUntil,
    });

    expect(first.selectionEnrichmentPending).toBe(true);
    expect(second.selectionEnrichmentPending).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(captureCreativeText).toHaveBeenCalledTimes(1);
  });
});

describe("search selection persisted OCR reuse", () => {
  it("can skip persisted hydration and enrichment for logged-out public search", async () => {
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText: "Stored account proof",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
    };
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });

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
      {
        DB: {},
      } as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
      {
        enrichSelected: false,
        hydratePersisted: false,
      },
    );

    expect(hydrateAdsWithPersistedCreatives).not.toHaveBeenCalled();
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(result.result.ads).toEqual([baseAd]);
    expect(result.selectedAd).toEqual(baseAd);
  });

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
      listAdsByIds: vi.fn().mockResolvedValue([hydratedAd]),
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
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: vi.fn((fields: AdRecord[]) => fields),
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
