import { beforeEach, describe, expect, it, vi } from "vitest";

const hasFreshDiscoveryCacheEntry = vi.fn();
const searchAdsViaSourceResolver = vi.fn();
const hydrateAdsWithPersistedCreatives = vi.fn();

beforeEach(() => {
  vi.resetModules();
  hasFreshDiscoveryCacheEntry.mockReset().mockResolvedValue(true);
  searchAdsViaSourceResolver.mockReset();
  hydrateAdsWithPersistedCreatives.mockReset().mockImplementation(async (_env, ads) => ads);
  vi.doMock("~/lib/ad-source.server", () => ({
    hasFreshDiscoveryCacheEntry,
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    searchAdsViaSourceResolver,
  }));
  vi.doMock("~/lib/website-identity.server", () => ({
    resolveWebsiteIdentity: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/ad-persistence.server", () => ({
    hydrateAdsWithPersistedCreatives,
  }));
});

describe("search execution cache probing", () => {
  it("uses only the customer-visible legacy cache during shadow rollout", async () => {
    const { hasWarmSearchCacheEntry } = await import("~/lib/search-execution.server");

    await expect(
      hasWarmSearchCacheEntry({
        env: { SEARCH_ROLLOUT_MODE: "shadow" } as never,
        competitorWebsite: {
          raw: "https://www.nykaa.com",
          normalizedUrl: "https://nykaa.com",
          host: "nykaa.com",
          displayName: "Nykaa",
          searchTerm: "nykaa.com",
          error: null,
        },
        parsed: {
          mode: "advertiser",
          filters: {
            query: "nykaa.com",
            country: "all",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
          fingerprint: "legacy-fingerprint",
        },
        scope: "exact",
        cursor: null,
        customerMetaAdLibraryToken: null,
      }),
    ).resolves.toBe(true);

    expect(hasFreshDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(hasFreshDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: expect.objectContaining({ query: "nykaa.com" }),
      }),
      null,
      expect.objectContaining({ cacheKeyOverride: null }),
    );
  });

  it("returns the untouched legacy result while shadowing a separate v2 query", async () => {
    const legacyResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "hit" as const,
      discoveryStatus: "healthy" as const,
    };
    const v2Result = {
      ...legacyResult,
      ads: [
        {
          metaAdId: "verified-v2",
          advertiser: "Nykaa",
          body: "Sale",
          previewHeadline: "Sale",
          previewSubhead: "",
          hook: "Sale",
          offer: "Sale",
          cta: "Shop now",
          format: "image" as const,
          languageLabel: "English",
          destinationType: "website" as const,
          landingPageUrl: "https://nykaa.com/sale",
          adSnapshotUrl: null,
          countries: ["India"],
          platforms: ["Instagram"],
          firstSeenAt: null,
          lastSeenAt: null,
          active: true,
          researchSummary: "Summary",
          source: "meta_library_browser" as const,
          analysisFields: [],
        },
      ],
    };
    searchAdsViaSourceResolver
      .mockResolvedValueOnce(legacyResult)
      .mockResolvedValueOnce(v2Result);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const waitUntil = vi.fn();
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    const execution = await executeSearchWithRelevance({
      env: { SEARCH_ROLLOUT_MODE: "shadow" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
      cursor: null,
      executionContext: { waitUntil },
    });

    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    expect(searchAdsViaSourceResolver.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ filters: expect.objectContaining({ query: "nykaa.com" }) }),
    );
    expect(searchAdsViaSourceResolver.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ filters: expect.objectContaining({ query: "nykaa" }) }),
    );
    expect(execution.result).toBe(legacyResult);
    expect(execution.query.filters.query).toBe("nykaa.com");
    expect(execution.relevanceApplied).toBe(false);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"kind":"search_v2_shadow"'));
  });

  it("returns a valid legacy result when the shadow comparison fails", async () => {
    const legacyResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "hit" as const,
      discoveryStatus: "healthy" as const,
    };
    searchAdsViaSourceResolver
      .mockResolvedValueOnce(legacyResult)
      .mockRejectedValueOnce(new Error("comparison unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const waitUntil = vi.fn();
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    const execution = await executeSearchWithRelevance({
      env: { SEARCH_ROLLOUT_MODE: "shadow" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
      cursor: null,
      executionContext: { waitUntil },
    });

    expect(execution.result).toBe(legacyResult);
    expect(execution.relevanceApplied).toBe(false);
    await waitUntil.mock.calls[0]?.[0];
    expect(warn).toHaveBeenCalledWith(
      "Search V2 shadow comparison failed; returning the legacy result.",
      { errorName: "Error" },
    );
  });

  it("returns the legacy result before a deferred shadow comparison finishes", async () => {
    const legacyResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser" as const,
      cacheStatus: "hit" as const,
      discoveryStatus: "healthy" as const,
    };
    let resolveComparison!: (value: typeof legacyResult) => void;
    const comparison = new Promise<typeof legacyResult>((resolve) => {
      resolveComparison = resolve;
    });
    searchAdsViaSourceResolver
      .mockResolvedValueOnce(legacyResult)
      .mockImplementationOnce(() => comparison);
    const waitUntil = vi.fn();
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    const execution = await executeSearchWithRelevance({
      env: { SEARCH_ROLLOUT_MODE: "shadow" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
      executionContext: { waitUntil },
    });

    expect(execution.result).toBe(legacyResult);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    resolveComparison(legacyResult);
    await waitUntil.mock.calls[0]?.[0];
  });

  it("hydrates retained landing evidence before exact V2 classification", async () => {
    const sparseAd = {
      metaAdId: "meta-nykaa-1",
      advertiser: "Nykaa",
      body: "Sale",
      previewHeadline: "Sale",
      previewSubhead: "",
      hook: "Sale",
      offer: "Sale",
      cta: "Shop now",
      format: "image" as const,
      languageLabel: "English",
      destinationType: "website" as const,
      landingPageUrl: null,
      adSnapshotUrl: null,
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta_library_browser" as const,
      analysisFields: [],
    };
    searchAdsViaSourceResolver.mockResolvedValue({
      ads: [sparseAd],
      nextCursor: null,
      source: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    hydrateAdsWithPersistedCreatives.mockResolvedValue([{
      ...sparseAd,
      landingPageUrl: "https://nykaa.com/sale",
    }]);
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    const execution = await executeSearchWithRelevance({
      env: { DB: {}, SEARCH_ROLLOUT_MODE: "v2" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
    });

    expect(hydrateAdsWithPersistedCreatives).toHaveBeenCalledWith(
      expect.anything(),
      [sparseAd],
    );
    expect(execution.result.ads).toHaveLength(1);
    expect(execution.result.ads[0]?.domainMatch?.matchedDomain).toBe("nykaa.com");
  });

  it("does not merge persisted account evidence into anonymous V2 results", async () => {
    const publicAd = {
      metaAdId: "meta-nykaa-public",
      advertiser: "Nykaa",
      body: "Sale",
      previewHeadline: "Sale",
      previewSubhead: "",
      hook: "Sale",
      offer: "Sale",
      cta: "Shop now",
      format: "image" as const,
      languageLabel: "English",
      destinationType: "website" as const,
      landingPageUrl: "https://nykaa.com/sale",
      adSnapshotUrl: null,
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "meta_library_browser" as const,
      analysisFields: [],
    };
    searchAdsViaSourceResolver.mockResolvedValue({
      ads: [publicAd],
      nextCursor: null,
      source: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    hydrateAdsWithPersistedCreatives.mockResolvedValue([{
      ...publicAd,
      translatedText: "Private account translation",
      landingPage: {
        rawUrl: "https://nykaa.com/private",
        canonicalUrl: "https://nykaa.com/private",
        rawHeadline: "Private saved headline",
        normalizedHeadline: "private saved headline",
        normalizedHeadlineHash: "private",
        captureMethod: "browser_render",
        capturedAt: "2026-07-19T00:00:00.000Z",
      },
    }]);
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    const execution = await executeSearchWithRelevance({
      env: { DB: {}, SEARCH_ROLLOUT_MODE: "v2" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
      hydratePersisted: false,
    });

    expect(hydrateAdsWithPersistedCreatives).not.toHaveBeenCalled();
    expect(execution.result.ads).toHaveLength(1);
    expect(execution.result.ads[0]).not.toHaveProperty("translatedText");
    expect(execution.result.ads[0]).not.toHaveProperty("landingPage");
  });
});

describe("search observability privacy", () => {
  it("logs only a hash for the searched domain", async () => {
    const { buildSearchObservabilityEvent } = await import("~/lib/search-observability.server");
    const event = buildSearchObservabilityEvent({
      result: {
        ads: [],
        matchedAds: [],
        nextCursor: null,
        source: "meta_library_browser",
        searchIntent: "domain",
        searchScope: "exact",
        displayDomain: "private-competitor.example",
        verifiedCount: 0,
        rawCandidateCount: 0,
        broaderCandidateCount: 0,
        missingVerificationCount: 0,
        rejectedKeywordOnlyCount: 0,
      },
    });

    expect(event.domainHash).toBeTruthy();
    expect(JSON.stringify(event)).not.toContain("private-competitor.example");
  });
});

describe("plan-tier propagation into discovery telemetry", () => {
  it("carries the resolved plan family into every resolver call", async () => {
    const legacyResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "hit" as const,
      discoveryStatus: "healthy" as const,
    };
    searchAdsViaSourceResolver
      .mockResolvedValueOnce(legacyResult)
      .mockResolvedValueOnce({ ...legacyResult, cacheStatus: "miss" as const });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const waitUntil = vi.fn();
    const { executeSearchWithRelevance } = await import("~/lib/search-execution.server");

    await executeSearchWithRelevance({
      env: { SEARCH_ROLLOUT_MODE: "shadow" } as never,
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
        error: null,
      },
      parsed: {
        mode: "advertiser",
        filters: {
          query: "nykaa.com",
          country: "all",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "legacy-fingerprint",
      },
      scope: "exact",
      cursor: null,
      planTier: "agency",
      executionContext: { waitUntil } as never,
    });

    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    for (const call of searchAdsViaSourceResolver.mock.calls) {
      expect(call[3]).toMatchObject({ planTier: "agency" });
    }
    info.mockRestore();
  });
});
