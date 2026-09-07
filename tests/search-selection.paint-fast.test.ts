import { afterEach, describe, expect, it, vi } from "vitest";

import { creativeCaptureSourceFingerprint } from "~/lib/creative-capture-policy";
import type { AdRecord } from "~/lib/types";

const baseAd: AdRecord = {
  metaAdId: "meta-fast-1",
  advertiser: "Glossier",
  body: "Soft skin kit",
  previewHeadline: "Soft skin kit",
  previewSubhead: "",
  hook: "Soft skin kit",
  offer: "",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://www.glossier.com/products/kit",
  adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1",
  countries: ["US"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_library_browser",
  analysisFields: [],
  creativeText: null,
  landingPage: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("WP-11 paint-fast selection enrichment", () => {
  it("returns the base ad immediately and defers OCR/landing via waitUntil", async () => {
    let resolveCreative: (value: unknown) => void = () => undefined;
    const captureCreativeText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreative = resolve;
        }),
    );
    const captureLandingPageSnapshot = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                rawHeadline: "Glossier kit",
                ctaText: "Shop",
                priceText: null,
                formPresent: false,
                captureMethod: "fetch",
                capturedAt: "2026-07-18T00:00:00.000Z",
              }),
            5,
          );
        }),
    );

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: vi.fn((fields: unknown) => fields),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd: vi.fn(),
    }));

    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });

    const { prepareSearchResultSelection, selectionNeedsEnrichment } = await import(
      "~/lib/search-selection.server"
    );

    expect(selectionNeedsEnrichment(baseAd)).toBe(true);

    const result = await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "hit",
      },
      "meta-fast-1",
      {
        enrichSelected: true,
        hydratePersisted: true,
        waitUntil,
      },
    );

    // Paint-fast: selected ad is the base (no creative/landing yet).
    expect(result.selectionEnrichmentPending).toBe(true);
    expect(result.selectedAd?.creativeText).toBeNull();
    expect(result.selectedAd?.landingPage).toBeNull();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // Enrichment was scheduled, not awaited before return.
    expect(captureCreativeText).toHaveBeenCalled();

    resolveCreative({
      text: "Soft skin kit OCR",
      captureMethod: "ad_snapshot_fetch",
      imageUrl: null,
      metadata: { source: "test" },
    });
    await waitUntil.mock.calls[0]?.[0];
    expect(captureLandingPageSnapshot).toHaveBeenCalled();
  });

  it("skips enrichment work when persisted creatives already fill the slots", async () => {
    const captureCreativeText = vi.fn();
    const captureLandingPageSnapshot = vi.fn();
    const richAd: AdRecord = {
      ...baseAd,
      creativeText: "Already captured",
      landingPage: {
        rawUrl: "https://www.glossier.com/products/kit",
        canonicalUrl: "https://www.glossier.com/products/kit",
        rawHeadline: "Done",
        normalizedHeadline: "done",
        normalizedHeadlineHash: "done",
        ctaText: null,
        priceText: null,
        formPresent: false,
        captureMethod: "landing_page_fetch",
        capturedAt: "2026-07-18T00:00:00.000Z",
      },
    };

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: vi.fn((fields: unknown) => fields),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd: vi.fn(),
    }));

    const waitUntil = vi.fn();
    const { prepareSearchResultSelection, selectionNeedsEnrichment } = await import(
      "~/lib/search-selection.server"
    );

    expect(selectionNeedsEnrichment(richAd)).toBe(false);

    const result = await prepareSearchResultSelection(
      {} as never,
      {
        ads: [richAd],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "hit",
      },
      "meta-fast-1",
      { enrichSelected: true, waitUntil },
    );

    expect(result.selectionEnrichmentPending).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
    expect(result.selectedAd?.creativeText).toBe("Already captured");
  });

  it("OCRs whitespace-only creative text from the image when the snapshot URL is blank", async () => {
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Image-only OCR",
      captureMethod: "ad_snapshot_fetch",
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: { capturedAt: "2026-07-18T00:00:00.000Z" },
    });
    const imageOnlyAd: AdRecord = {
      ...baseAd,
      landingPageUrl: null,
      adSnapshotUrl: "   ",
      creativeImageUrl: "https://cdn.example.com/creative.jpg",
      creativeText: "   ",
    };

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn(),
    }));
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: vi.fn((fields: unknown) => fields),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd: vi.fn(),
    }));

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    await prepareSearchResultSelection(
      {} as never,
      {
        ads: [imageOnlyAd],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "hit",
      },
      imageOnlyAd.metaAdId,
      { enrichSelected: true, hydratePersisted: true },
    );

    expect(captureCreativeText).toHaveBeenCalledWith(
      expect.anything(),
      imageOnlyAd.creativeImageUrl,
      imageOnlyAd,
    );
  });

  it("does not invent a capture timestamp when the capture result omits one", async () => {
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: null,
      captureMethod: "ad_snapshot_fetch",
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        extractionStatus: "unreadable",
        unreadableReasonCode: "no_creative_capture_stored",
      },
    });
    const upsertAd = vi.fn();

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
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
      withTranslatedAnalysisField: vi.fn((fields: unknown) => fields),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd,
    }));

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "hit",
      },
      baseAd.metaAdId,
      { enrichSelected: true, hydratePersisted: true },
    );

    expect(upsertAd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        creativeTextMetadata: expect.not.objectContaining({
          capturedAt: expect.anything(),
        }),
      }),
    );
  });

  it("honors a recent unreadable creative result while enriching the landing page", async () => {
    const captureCreativeText = vi.fn();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    const recentUnreadableAd: AdRecord = {
      ...baseAd,
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint(baseAd),
      },
    };

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/translation.server", () => ({
      translateAdText: vi.fn().mockResolvedValue(null),
      buildTranslatedAnalysisField: vi.fn(),
      withTranslatedAnalysisField: vi.fn((fields: unknown) => fields),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: AdRecord[]) => ads),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      upsertAd: vi.fn(),
    }));

    const { prepareSearchResultSelection, selectionNeedsEnrichment } = await import(
      "~/lib/search-selection.server"
    );

    expect(selectionNeedsEnrichment({
      ...recentUnreadableAd,
      landingPage: {
        rawUrl: recentUnreadableAd.landingPageUrl ?? "",
        canonicalUrl: recentUnreadableAd.landingPageUrl ?? "",
        rawHeadline: "",
        normalizedHeadline: "",
        normalizedHeadlineHash: "",
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "landing_page_fetch",
        capturedAt: new Date().toISOString(),
      },
    })).toBe(false);

    await prepareSearchResultSelection(
      {} as never,
      {
        ads: [recentUnreadableAd],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "hit",
      },
      recentUnreadableAd.metaAdId,
      { enrichSelected: true, hydratePersisted: true },
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(captureCreativeText).not.toHaveBeenCalled();
  });

  it("retries unreadable creative capture after the selection cooldown", async () => {
    const staleUnreadableAd: AdRecord = {
      ...baseAd,
      landingPage: {
        rawUrl: baseAd.landingPageUrl ?? "",
        canonicalUrl: baseAd.landingPageUrl ?? "",
        rawHeadline: "",
        normalizedHeadline: "",
        normalizedHeadlineHash: "",
        ctaText: null,
        priceText: null,
        formPresent: null,
        captureMethod: "landing_page_fetch",
        capturedAt: new Date().toISOString(),
      },
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint(baseAd),
      },
    };

    const { selectionNeedsEnrichment } = await import(
      "~/lib/search-selection.server"
    );

    expect(selectionNeedsEnrichment(staleUnreadableAd)).toBe(true);
  });
});
