import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";

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
  landingPageUrl: "https://example.com/offer",
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

function resultWith(ads: AdRecord[]): SearchResponse {
  return {
    ads,
    nextCursor: null,
    source: "meta",
    cacheStatus: "miss",
  };
}

/**
 * The deferCapture payload is a promise on the defer path and undefined on
 * every other return shape; these tests only exercise the defer path, so a
 * missing payload is a test-setup bug, not an expectation to soften.
 */
async function requireCapturePayload(
  returned: Awaited<ReturnType<typeof import("~/lib/search-selection.server").prepareSearchResultSelection>>,
) {
  const capture = await returned.selectedAdCapture;
  if (!capture) {
    throw new Error("deferCapture payload missing — test setup drifted from the defer path");
  }
  return capture;
}

function mockCaptureModules(overrides: {
  captureLandingPageSnapshot?: ReturnType<typeof vi.fn>;
  captureCreativeText?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.doMock("~/lib/analysis.server", () => ({
    buildLandingPageAnalysisFields: vi.fn(() => []),
    withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
  }));
  vi.doMock("~/lib/creative-text.server", () => ({
    captureCreativeText:
      overrides.captureCreativeText ?? vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot:
      overrides.captureLandingPageSnapshot ?? vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * Issue #3014: the anonymous free preview must not sit 15-25s behind an
 * opaque spinner while the featured ad's landing page is captured. With
 * `deferCapture: true` the loader gets the base ad SYNCHRONOUSLY (rows +
 * pending pane paint) and the capture comes back as a promise the route
 * streams into the same document via <Await>.
 */
describe("prepareSearchResultSelection deferCapture (issue #3014)", () => {
  it("returns the base ad immediately and hands back a promise that resolves to the enriched ad", async () => {
    let resolveCapture: (snapshot: unknown) => void = () => {};
    const captureLandingPageSnapshot = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    mockCaptureModules({ captureLandingPageSnapshot });

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    const returned = await prepareSearchResultSelection(
      {} as never,
      resultWith([{ ...baseAd }]),
      null,
      { hydratePersisted: false, deferCapture: true },
    );

    // The base ad (NO landing page yet) is on the synchronous payload — the
    // pane paints with pending copy and the first card is unblocked.
    expect(returned.selectedAd).not.toBeNull();
    expect(returned.selectedAd?.landingPage).toBeUndefined();
    expect(returned.selectionEnrichmentPending).toBe(false);
    expect(returned.landingPageCaptureFailure).toBeNull();
    expect(typeof returned.selectedAdCapture?.then).toBe("function");

    // The capture is already in flight but its result is NOT awaited here.
    expect(captureLandingPageSnapshot).toHaveBeenCalledTimes(1);

    // The streamed promise resolves to the enriched ad once the capture lands.
    resolveCapture({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Launch offer",
      normalizedHeadline: "launch offer",
      normalizedHeadlineHash: "hash",
      ctaText: "Buy now",
      priceText: "₹999",
      formPresent: false,
      captureMethod: "landing_page_fetch",
      capturedAt: new Date().toISOString(),
      artifactKey: null,
      metadata: {},
    });
    const payload = await requireCapturePayload(returned);
    expect(payload.ad.landingPage?.rawHeadline).toBe("Launch offer");
    expect(payload.landingPageCaptureFailure).toBeNull();
  });

  it("the streamed promise never rejects — a failed capture resolves to the honest failure detail", async () => {
    const captureLandingPageSnapshot = vi
      .fn()
      .mockImplementation(
        (_env: unknown, _url: string, options?: { onFailure?: (d: unknown) => void }) => {
          options?.onFailure?.({
            snapshotId: null,
            reasonCode: "snapshot_empty",
            canonicalUrl: null,
            capturedAt: null,
            error: "no signals",
          });
          return Promise.resolve(null);
        },
      );
    mockCaptureModules({ captureLandingPageSnapshot });

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    const returned = await prepareSearchResultSelection(
      {} as never,
      resultWith([{ ...baseAd }]),
      null,
      { hydratePersisted: false, deferCapture: true },
    );
    const payload = await requireCapturePayload(returned);
    expect(payload.ad.metaAdId).toBe(baseAd.metaAdId);
    expect(payload.ad.landingPage).toBeNull();
    expect(payload.landingPageCaptureFailure?.reasonCode).toBe(
      "snapshot_empty",
    );
  });

  it("an enrichment crash resolves (not rejects) with the capture_stream_failed detail", async () => {
    const captureLandingPageSnapshot = vi
      .fn()
      .mockRejectedValue(new Error("browser isolate gone"));
    mockCaptureModules({ captureLandingPageSnapshot });

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    const returned = await prepareSearchResultSelection(
      {} as never,
      resultWith([{ ...baseAd }]),
      null,
      { hydratePersisted: false, deferCapture: true },
    );
    const payload = await requireCapturePayload(returned);
    expect(payload.ad.metaAdId).toBe(baseAd.metaAdId);
    expect(payload.landingPageCaptureFailure?.reasonCode).toBe(
      "capture_stream_failed",
    );
    expect(String(payload.landingPageCaptureFailure?.metadata.message)).toContain(
      "browser isolate gone",
    );
  });

  it("needs no deferred promise when the base evidence already fills the pane", async () => {
    const captureLandingPageSnapshot = vi.fn();
    mockCaptureModules({ captureLandingPageSnapshot });

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    // Cached snapshot already present on the ad, and a demo-sourced ad with
    // no landing destination — both take the direct path.
    const withSnapshot = await prepareSearchResultSelection(
      {} as never,
      resultWith([
        {
          ...baseAd,
          landingPage: {
            rawUrl: "https://example.com/offer",
            canonicalUrl: "https://example.com/offer",
            rawHeadline: "Launch offer",
            normalizedHeadline: "launch offer",
            normalizedHeadlineHash: "hash",
            ctaText: "Buy now",
            priceText: null,
            formPresent: false,
            captureMethod: "landing_page_fetch",
            capturedAt: new Date().toISOString(),
            artifactKey: null,
            metadata: {},
          } as AdRecord["landingPage"],
        },
      ]),
      null,
      { hydratePersisted: false, deferCapture: true },
    );
    expect(withSnapshot.selectedAdCapture).toBeUndefined();
    expect(withSnapshot.selectedAd?.landingPage?.rawHeadline).toBe(
      "Launch offer",
    );

    const demo = await prepareSearchResultSelection(
      {} as never,
      resultWith([{ ...baseAd, source: "demo", landingPageUrl: null }]),
      null,
      { hydratePersisted: false, deferCapture: true },
    );
    expect(demo.selectedAdCapture).toBeUndefined();
    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
  });

  it("signed-in callers that omit deferCapture keep the synchronous contract", async () => {
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Launch offer",
      normalizedHeadline: "launch offer",
      normalizedHeadlineHash: "hash",
      ctaText: "Buy now",
      priceText: null,
      formPresent: false,
      captureMethod: "landing_page_fetch",
      capturedAt: new Date().toISOString(),
      artifactKey: null,
      metadata: {},
    });
    mockCaptureModules({ captureLandingPageSnapshot });
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn(
        async (_env: unknown, ads: AdRecord[]) => ads,
      ),
      listAdsByIds: vi.fn(async () => []),
      upsertAd: vi.fn(async () => undefined),
    }));

    const { prepareSearchResultSelection } = await import(
      "~/lib/search-selection.server"
    );
    const returned = await prepareSearchResultSelection(
      { DB: {} } as never,
      resultWith([{ ...baseAd }]),
      null,
      { hydratePersisted: true },
    );
    // Synchronous path: the awaited result already carries the capture.
    expect(returned.selectedAd?.landingPage?.rawHeadline).toBe("Launch offer");
    expect(returned.selectedAdCapture).toBeUndefined();
  });
});
