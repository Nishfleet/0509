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
  it("does not substitute the first result when an explicit selection is missing", async () => {
    const captureCreativeText = vi.fn();
    const captureLandingPageSnapshot = vi.fn();
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({ captureCreativeText }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      {} as never,
      {
        ads: [{ ...baseAd, metaAdId: "page-2-ad" }],
        nextCursor: null,
        source: "meta",
      },
      "page-1-ad",
      { hydratePersisted: false },
    );

    expect(result.selectedAd).toBeNull();
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
  });

  it("never asks a public search selection to create ownerless R2 artifacts", async () => {
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      { LANDING_PAGE_ARTIFACTS: {} as R2Bucket } as never,
      {
        ads: [{ ...baseAd, landingPageUrl: "https://example.com/offer" }],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/offer",
      {
        persistArtifacts: false,
        routeContext: "selection_enrichment",
        planTier: null,
      },
    );
  });

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

  it("captures creative text for Browser Run Ad Library results", async () => {
    const browserAd = {
      ...baseAd,
      source: "meta_library_browser" as const,
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh Browser Run OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });

    vi.doMock("~/lib/analysis.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/analysis.server")>();

      return {
        ...actual,
        withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
      };
    });
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      {} as never,
      {
        ads: [browserAd],
        nextCursor: null,
        source: "meta_library_browser",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).toHaveBeenCalledWith(
      {},
      "https://cdn.example.com/meta-boat-1.png",
      browserAd,
    );
    expect(result.selectedAd).toEqual(
      expect.objectContaining({
        source: "meta_library_browser",
        creativeText: "Fresh Browser Run OCR",
      }),
    );
  });
});

describe("selection-enrichment plan-tier propagation", () => {
  it("passes the signed-in plan family into the landing capture", async () => {
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      { LANDING_PAGE_ARTIFACTS: {} as R2Bucket } as never,
      {
        ads: [{ ...baseAd, landingPageUrl: "https://example.com/offer" }],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
      { planTier: "starter" },
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/offer",
      {
        persistArtifacts: false,
        routeContext: "selection_enrichment",
        planTier: "starter",
      },
    );
  });
});

describe("anonymous selection landing capture", () => {
  const liveAd: AdRecord = {
    ...baseAd,
    landingPageUrl: "https://example.com/offer",
    landingPage: null,
    source: "meta",
  };
  const capturedSnapshot = {
    rawHeadline: "Offer headline",
    ctaText: "Buy now",
    priceText: "$9",
    formPresent: false,
    captureMethod: "landing_page_fetch" as const,
    capturedAt: "2026-08-22T00:00:00.000Z",
  };

  it("runs fetch-only landing capture without upserting or OCR", async () => {
    const captureCreativeText = vi.fn();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(capturedSnapshot);
    const upsertAd = vi.fn();
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({ captureCreativeText }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd,
    }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [liveAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/offer",
      {
        persistArtifacts: false,
        routeContext: "selection_enrichment",
        planTier: null,
        allowRenderedFallback: false,
      },
    );
    expect(upsertAd).not.toHaveBeenCalled();
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(result.selectedAd?.landingPage).toEqual(capturedSnapshot);
  });

  it("does not fetch demo landing URLs", async () => {
    const captureLandingPageSnapshot = vi.fn();
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [{ ...liveAd, source: "demo" }],
        nextCursor: null,
        source: "demo",
      },
      "meta-boat-1",
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );

    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
  });

  it("does not capture when the live ad has no landing-page URL", async () => {
    const captureLandingPageSnapshot = vi.fn();
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [{ ...liveAd, landingPageUrl: null }],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );

    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
  });

  it("still runs creative OCR and omits rendered-fallback:false when hydratePersisted is omitted", async () => {
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: { source: "fresh" },
    });
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/analysis.server", () => ({
      buildLandingPageAnalysisFields: vi.fn(() => []),
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({ captureCreativeText }));
    vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      {} as never,
      {
        ads: [liveAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).toHaveBeenCalled();
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/offer",
      {
        persistArtifacts: false,
        routeContext: "selection_enrichment",
        planTier: null,
      },
    );
    expect(captureLandingPageSnapshot.mock.calls[0]?.[2]).not.toHaveProperty(
      "allowRenderedFallback",
    );
  });
});
