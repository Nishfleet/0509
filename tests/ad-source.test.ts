import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedSavedQuery, SearchResponse } from "~/lib/types";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("cloudflare:workers");
  delete (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__;
  delete (globalThis as { __0509InFlightDiscovery__?: unknown }).__0509InFlightDiscovery__;
  vi.resetModules();
});

function buildLiveBrowserResult(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    ads: [
      {
        metaAdId: "meta-nykaa-1",
        advertiser: "Nykaa",
        body: "Flat 30% off on serums.",
        previewHeadline: "Glow sale",
        previewSubhead: "Weekend only",
        hook: "Glow sale",
        offer: "Flat 30% off",
        cta: "Shop now",
        format: "image",
        languageLabel: "English",
        destinationType: "website",
        landingPageUrl: "https://www.nykaa.com/glow-sale",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=meta-nykaa-1",
        countries: ["India"],
        platforms: ["Instagram"],
        firstSeenAt: null,
        lastSeenAt: null,
        active: true,
        researchSummary: "Live Browser Run fixture",
        source: "meta",
        analysisFields: [],
        tags: [],
      },
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    ...overrides,
  };
}

describe("resolveCommercialAdSourceStatus", () => {
  it("treats the official Meta API as diagnostic-only even when a token exists", async () => {
    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({
      META_AD_LIBRARY_TOKEN: "live-token",
    } as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_api",
      mode: "diagnostic",
    });
    expect(status.summary).toContain("limited diagnostic use");
    expect(status.summary).not.toContain("ready for live searches");
  });

  it("reports explicit demo mode when no live commercial source is configured", async () => {
    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({} as never);

    expect(status).toMatchObject({
      status: "demo",
      provider: "demo",
      mode: "demo",
    });
    expect(status.summary).toContain("explicit demo mode");
  });

  it("surfaces provider-state error messages for operator status", async () => {
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryProviderState: vi.fn().mockResolvedValue({
        provider: "meta_api",
        status: "degraded",
        failureClass: "login_wall",
        summary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
        lastSuccessAt: null,
        lastFailureAt: new Date().toISOString(),
        metadata: {
          errorMessage: "Error validating access token: Session has expired.",
        },
        updatedAt: new Date().toISOString(),
      }),
    }));

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({
      META_AD_LIBRARY_TOKEN: "expired-token",
      DB: {} as D1Database,
    } as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_api",
      lastErrorCode: "login_wall",
      lastErrorMessage: "Error validating access token: Session has expired.",
    });
  });

  it("falls back to the runtime worker env when Browser Run is missing from route context", async () => {
    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {
          BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        },
      }),
    );

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({} as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
    });
    expect(status.summary).toContain("Browser Run");
  });

  it("prefers the per-request worker env when the route context drops Browser Run", async () => {
    (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__ = {
      BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
    };

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({} as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
    });
  });

  it("does not rehydrate provider bindings for deterministic local release proof", async () => {
    (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__ = {
      BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
      BROWSER_RUN_API_TOKEN: "live-token-that-must-not-be-used",
    };

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
    const status = await resolveCommercialAdSourceStatus({
      E2E_PROVIDER_NETWORK_DENY: "1",
    } as never);

    expect(status).toMatchObject({
      status: "demo",
      provider: "demo",
      mode: "demo",
    });
  });

  it("treats Quick Actions config as a live Browser Run provider even without the browser binding", async () => {
    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({
      BROWSER_RUN_ACCOUNT_ID: "acct-123",
      BROWSER_RUN_API_TOKEN: "token-123",
    } as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
    });
    expect(status.summary).toContain("Browser Run");
  });

  it("treats Browserless BQL config as a live browser-backed provider", async () => {
    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    const status = await resolveCommercialAdSourceStatus({
      BROWSERLESS_TOKEN: "browserless-token",
    } as never);

    expect(status).toMatchObject({
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
    });
    expect(status.summary).toContain("Browser Run");
  });
});

describe("searchAdsViaSourceResolver", () => {
  it("serves an explicitly marked local fixture cache without touching browser, API, or demo providers", async () => {
    const browserSearch = vi.fn();
    const metaApiSearch = vi.fn();
    const demoSearch = vi.fn();
    const payload = {
      ads: [{ metaAdId: "e2e-nykaa-live-1" }],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: "Live ad checks are ready.",
      discoveryFailureClass: null,
    };
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({
            provider: "meta_library_browser",
            payload_json: JSON.stringify(payload),
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        })),
      })),
    } as never;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch,
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      {
        DB: db,
        E2E_PROVIDER_NETWORK_DENY: "1",
        E2E_FIXTURE_PROVIDER: "meta_library_browser",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search", cacheKeyOverride: "e2e-cache-key" },
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    });
    expect(browserSearch).not.toHaveBeenCalled();
    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(demoSearch).not.toHaveBeenCalled();
  });

  it("does not treat a mislabeled fixture cache row as a warm selection cache", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({
            provider: "meta_library_browser",
            payload_json: JSON.stringify({
              ads: [{ metaAdId: "wrong-source" }],
              source: "demo",
              provider: "demo",
              cacheStatus: "hit",
            }),
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        })),
      })),
    } as never;

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");
    await expect(hasFreshDiscoveryCacheEntry(
      {
        DB: db,
        E2E_PROVIDER_NETWORK_DENY: "1",
        E2E_FIXTURE_PROVIDER: "meta_library_browser",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { cacheKeyOverride: "e2e-cache-key" },
    )).resolves.toBe(false);
  });

  it("fails closed on a missing marked fixture cache row without falling through to a provider", async () => {
    const browserSearch = vi.fn();
    const metaApiSearch = vi.fn();
    const demoSearch = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
      })),
    } as never;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch,
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      {
        DB: db,
        E2E_PROVIDER_NETWORK_DENY: "1",
        E2E_FIXTURE_PROVIDER: "meta_library_browser",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "missing",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search", cacheKeyOverride: "missing-cache-key" },
    );

    expect(result).toMatchObject({
      ads: [],
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "browser_unavailable",
    });
    expect(browserSearch).not.toHaveBeenCalled();
    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(demoSearch).not.toHaveBeenCalled();
  });

  it("does not use the platform Meta token for customer-facing discovery by default", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });
    const demoSearch = vi.fn().mockReturnValue({
      ads: [],
      nextCursor: null,
      source: "demo",
      provider: "demo",
      cacheStatus: "none",
    });

    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      { META_AD_LIBRARY_TOKEN: "live-token" } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(demoSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("demo");
    expect(result.source).toBe("demo");
  });

  it("uses a customer-owned Meta token when the caller provides one", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });

    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {} as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(metaApiSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        META_AD_LIBRARY_TOKEN: "customer-token",
      }),
      expect.anything(),
      null,
      expect.objectContaining({
        allowDemoFallback: false,
      }),
    );
    expect(result.provider).toBe("meta_api");
    expect(result.source).toBe("meta_api");
  });

  it("bypasses a warm Meta API cache when forceLive is requested", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [
        {
          metaAdId: "meta-api-live-1",
          advertiser: "Nykaa",
          body: "Live API offer",
          previewHeadline: "Live API offer",
          previewSubhead: "",
          hook: "Live API offer",
          offer: "Fresh",
          cta: "Shop now",
          format: "image",
          languageLabel: "English",
          destinationType: "website",
          landingPageUrl: "https://www.nykaa.com/live",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=meta-api-live-1",
          countries: ["India"],
          platforms: ["Facebook"],
          firstSeenAt: null,
          lastSeenAt: null,
          active: true,
          researchSummary: "Live Meta API fixture",
          source: "meta_api",
          analysisFields: [],
          tags: [],
        },
      ],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });
    const cachedAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt: cachedAt,
      expiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: cachedAt,
      updatedAt: cachedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      { DB: {} as D1Database } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        customerMetaAdLibraryToken: "customer-token",
        forceLive: true,
      },
    );

    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(metaApiSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      provider: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
  });

  it("prefers the browser-backed provider when Browser Run is configured", async () => {
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
  });

  it("keeps successful forceLive customer browser writes on the normal cache key", async () => {
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    const upsertDiscoveryCacheEntry = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-token",
        cacheKeyOverride: "meta_library_browser:fp-nykaa:india:page-1",
      },
    );

    expect(result).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(upsertDiscoveryCacheEntry.mock.calls[0]?.[1]).toMatchObject({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
    });
    expect(upsertDiscoveryCacheEntry.mock.calls[0]?.[1].cacheKey).not.toContain(":customer_meta:");
  });

  it("scopes customer-owned Meta API provider cache keys by token", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ...buildLiveBrowserResult({
        source: "meta_api",
        provider: "meta_api",
      }),
      ads: [
        {
          ...buildLiveBrowserResult().ads[0],
          metaAdId: "customer-meta-api-1",
        },
      ],
    });
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(null);
    const upsertDiscoveryCacheEntry = vi.fn();

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-token",
        cacheKeyOverride: "meta_api:fp-nykaa:india:page-1",
      },
    );

    expect(metaApiSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        META_AD_LIBRARY_TOKEN: "customer-token",
      }),
      expect.anything(),
      null,
      expect.objectContaining({
        allowDemoFallback: false,
      }),
    );
    expect(result).toMatchObject({
      provider: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    const readCacheKey = getDiscoveryCacheEntry.mock.calls[0]?.[1] as string;
    const published = upsertDiscoveryCacheEntry.mock.calls[0]?.[1] as { cacheKey: string };
    expect(readCacheKey).toContain("meta_api:fp-nykaa:india:page-1:customer_meta:");
    expect(readCacheKey).not.toContain("customer-token");
    expect(published.cacheKey).toBe(readCacheKey);
  });

  it("routes through the browser-backed provider when Quick Actions are configured", async () => {
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
  });

  it("uses Meta API fallback when browser capture hits a login wall and no cache exists", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    const browserSearch = vi
      .fn()
      .mockRejectedValue(
        new MockCommercialDiscoveryError("Meta Ad Library returned a login wall.", "login_wall"),
      );
    const apiSearch = vi.fn().mockResolvedValue(
      buildLiveBrowserResult({
        source: "meta",
        provider: undefined,
      }),
    );
    const createDiscoveryFetchLog = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "live-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(apiSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "meta_api",
      provider: "meta_api",
      discoveryStatus: "healthy",
      discoveryFailureClass: null,
    });
    expect(result.discoverySummary).toContain("API fallback");
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        status: "failed",
        failureClass: "login_wall",
      }),
    );
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_api",
        status: "succeeded",
        failureClass: null,
      }),
    );
  });

  it("puts failed Meta API fallback auth errors into provider cooldown", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }
    class MockMetaApiError extends Error {
      isAuthError = true;
      isRateLimit = false;
    }

    const browserSearch = vi
      .fn()
      .mockRejectedValue(
        new MockCommercialDiscoveryError("Meta Ad Library returned a login wall.", "login_wall"),
      );
    const apiSearch = vi
      .fn()
      .mockRejectedValue(new MockMetaApiError("Error validating access token: Session has expired."));
    const upsertDiscoveryProviderState = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: MockMetaApiError,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "expired-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(apiSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      discoveryStatus: "degraded",
      discoveryFailureClass: "login_wall",
    });
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_api",
        status: "degraded",
        failureClass: "login_wall",
        metadata: expect.objectContaining({
          cooldownUntil: expect.any(String),
          errorMessage: "Error validating access token: Session has expired.",
          fallbackFor: "meta_library_browser",
        }),
      }),
    );
  });

  it("uses Meta API fallback during browser cooldown when no cache exists", async () => {
    const browserSearch = vi.fn();
    const apiSearch = vi.fn().mockResolvedValue(
      buildLiveBrowserResult({
        source: "meta",
        provider: undefined,
      }),
    );
    const getDiscoveryProviderState = vi.fn(async (_env, provider) =>
      provider === "meta_library_browser"
        ? {
            provider: "meta_library_browser",
            status: "degraded",
            failureClass: "login_wall",
            summary: "Commercial discovery degraded and no cached results are available.",
            lastSuccessAt: null,
            lastFailureAt: new Date().toISOString(),
            metadata: {
              cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            },
            updatedAt: new Date().toISOString(),
          }
        : null,
    );

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "live-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(apiSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "meta_api",
      provider: "meta_api",
      discoveryStatus: "healthy",
    });
  });

  it("skips Meta API fallback while the diagnostic token is in cooldown", async () => {
    const browserSearch = vi.fn();
    const apiSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn(async (_env, provider) => {
      if (provider === "meta_library_browser") {
        return {
          provider: "meta_library_browser",
          status: "degraded",
          failureClass: "login_wall",
          summary: "Commercial discovery degraded and no cached results are available.",
          lastSuccessAt: null,
          lastFailureAt: new Date().toISOString(),
          metadata: {
            cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        provider: "meta_api",
        status: "degraded",
        failureClass: "login_wall",
        summary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
        lastSuccessAt: null,
        lastFailureAt: new Date().toISOString(),
        metadata: {
          cooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          errorMessage: "Error validating access token: Session has expired.",
        },
        updatedAt: new Date().toISOString(),
      };
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "expired-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(apiSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      discoveryStatus: "degraded",
      discoveryFailureClass: "login_wall",
    });
  });

  it("uses Meta API fallback before retrying recently failed browser capture for public search", async () => {
    const browserSearch = vi.fn();
    const apiSearch = vi.fn().mockResolvedValue(
      buildLiveBrowserResult({
        source: "meta",
        provider: undefined,
      }),
    );
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "login_wall",
      summary: "Commercial discovery degraded and no cached results are available.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: {
        cooldownUntil: new Date(Date.now() - 60 * 1000).toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "live-token",
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(apiSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "meta_api",
      provider: "meta_api",
      discoveryStatus: "healthy",
    });
  });

  it("returns degraded public search quickly when recent browser failure has no working API fallback", async () => {
    const browserSearch = vi.fn();
    const apiSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn(async (_env, provider) => {
      if (provider === "meta_library_browser") {
        return {
          provider: "meta_library_browser",
          status: "degraded",
          failureClass: "login_wall",
          summary: "Commercial discovery degraded and no cached results are available.",
          lastSuccessAt: null,
          lastFailureAt: new Date().toISOString(),
          metadata: {
            cooldownUntil: new Date(Date.now() - 60 * 1000).toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        provider: "meta_api",
        status: "degraded",
        failureClass: "login_wall",
        summary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
        lastSuccessAt: null,
        lastFailureAt: new Date().toISOString(),
        metadata: {
          cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          errorMessage: "Error validating access token: Session has expired.",
        },
        updatedAt: new Date().toISOString(),
      };
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "expired-token",
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(apiSearch).not.toHaveBeenCalled();
    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "login_wall",
    });
  });

  it("uses Browser Run from the runtime worker env when route context omits it", async () => {
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });

    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {
          BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        },
      }),
    );
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {} as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
  });

  it("uses Browser Run from the per-request worker env when route context omits it", async () => {
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });

    (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__ = {
      BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
    };
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {} as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
  });

  it("serves stale cached results when live discovery fails and cache exists", async () => {
    const browserSearch = vi.fn().mockRejectedValue(new Error("selector drift"));
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: "2026-04-19T00:00:00.000Z",
      expiresAt: "2026-04-19T00:15:00.000Z",
      browserMsUsed: 2500,
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "selector_drift";
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
    expect(result.cacheStatus).toBe("stale");
    expect(result.discoveryStatus).toBe("cache_only");
  });

  it("labels a successful refresh after stale cache as a live fetch", async () => {
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: "2026-04-21T18:00:00.000Z",
      expiresAt: "2026-04-21T18:01:00.000Z",
      browserMsUsed: 2500,
      createdAt: "2026-04-21T18:00:00.000Z",
      updatedAt: "2026-04-21T18:00:00.000Z",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.cacheStatus).toBe("miss");
    expect(result.discoveryStatus).toBe("healthy");
  });

  it("does not serve fresh zero-ad Browser Run cache as healthy", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "empty_result";
    }
    const browserSearch = vi
      .fn()
      .mockRejectedValue(new MockCommercialDiscoveryError("empty result"));
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      },
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      browserMsUsed: 2500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ads: [],
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "empty_result",
    });
  });

  it("accepts explicit Browser Run no-results as a healthy empty discovery result", async () => {
    const upsertDiscoveryCacheEntry = vi.fn();
    const createDiscoveryFetchLog = vi.fn();
    const upsertDiscoveryProviderState = vi.fn();
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        constructor(
          message: string,
          public readonly failureClass: string,
        ) {
          super(message);
          this.name = "CommercialDiscoveryError";
        }
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adflex",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        payload: expect.objectContaining({
          ads: [],
          discoveryEmptyReason: "no_results",
        }),
      }),
    );
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        status: "succeeded",
        failureClass: null,
      }),
    );
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        status: "healthy",
        failureClass: null,
      }),
    );
    expect(result).toMatchObject({
      ads: [],
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
      discoveryStatus: "healthy",
      discoveryFailureClass: null,
    });
  });

  it("downgrades live Browser Run zero-ad results instead of caching them as success", async () => {
    const upsertDiscoveryCacheEntry = vi.fn();
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        constructor(
          message: string,
          public readonly failureClass: string,
        ) {
          super(message);
          this.name = "CommercialDiscoveryError";
        }
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "boat",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(upsertDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ads: [],
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "empty_result",
    });
  });

  it("returns an honest degraded empty state for public search when live discovery fails without cache", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "selector_drift";
    }
    const browserSearch = vi
      .fn()
      .mockRejectedValue(new MockCommercialDiscoveryError("selector drift"));

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "selector_drift",
    });
    expect(result.discoverySummary).toContain("no cached results are available");
  });

  it("still throws for watchlist scans when live discovery fails without cache", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "selector_drift";
    }
    const browserSearch = vi
      .fn()
      .mockRejectedValue(new MockCommercialDiscoveryError("selector drift"));

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    await expect(
      searchAdsViaSourceResolver(
        {
          BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
          DB: {} as D1Database,
        } as never,
        {
          mode: "keyword",
          filters: {
            query: "nykaa",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
        null,
        {
          purpose: "watchlist_scan",
        },
      ),
    ).rejects.toThrow("selector drift");

    expect(browserSearch).toHaveBeenCalledTimes(1);
  });

  it("classifies Browser Run 429 launch errors as rate limited", async () => {
    const browserSearch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(result.discoveryFailureClass).toBe("rate_limited");
  });

  it("stores upstream retry-after cooldown windows after rate limits", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
        public readonly retryAfterSeconds: number | null,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    const browserSearch = vi
      .fn()
      .mockRejectedValue(
        new MockCommercialDiscoveryError(
          "Browser Run Quick Actions rate limited this request. Retry after about 41216s.",
          "rate_limited",
          41_216,
        ),
      );
    const createDiscoveryFetchLog = vi.fn();
    const upsertDiscoveryProviderState = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const before = Date.now();

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "bigspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(result.discoveryStatus).toBe("degraded");
    expect(result.discoveryFailureClass).toBe("rate_limited");
    expect(result.discoverySummary).toContain("Retrying after about 11h 27m.");
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          retryAfterSeconds: 41_216,
          cooldownUntil: expect.any(String),
        }),
      }),
    );
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureClass: "rate_limited",
        metadata: expect.objectContaining({
          retryAfterSeconds: 41_216,
          cooldownUntil: expect.any(String),
        }),
        summary: expect.stringContaining("Retrying after about 11h 27m."),
      }),
    );

    const providerStateInput = upsertDiscoveryProviderState.mock.calls[0]?.[1];
    const cooldownUntilMs = Date.parse(providerStateInput.metadata.cooldownUntil);
    expect(cooldownUntilMs).toBeGreaterThan(before + 41_215_000);
  });

  it("coalesces concurrent cold misses for the same query into one live fetch", async () => {
    let resolveSearch!: (value: SearchResponse) => void;
    const browserSearch = vi.fn().mockImplementation(
      () =>
        new Promise<SearchResponse>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const upsertDiscoveryCacheEntry = vi.fn();
    const createDiscoveryFetchLog = vi.fn();
    const upsertDiscoveryProviderState = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const query: NormalizedSavedQuery = {
      mode: "keyword" as const,
      filters: {
        query: "burst-test",
        country: "India",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    };

    const first = searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      query,
      null,
      {
        purpose: "public_search",
      },
    );
    const second = searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      query,
      null,
      {
        purpose: "public_search",
      },
    );

    await vi.waitFor(() => {
      expect(browserSearch).toHaveBeenCalledTimes(1);
    });

    resolveSearch(buildLiveBrowserResult());

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(secondResult).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(createDiscoveryFetchLog).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryProviderState).toHaveBeenCalledTimes(1);
  });

  it("keeps the cross-isolate lease alive beyond the two-call browser fallback path", async () => {
    const browserSearch = vi.fn().mockResolvedValue(buildLiveBrowserResult());
    let insertedLeaseValues: unknown[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...values: unknown[]) => {
          if (sql.includes("INSERT OR IGNORE INTO discovery_query_lease")) {
            insertedLeaseValues = values;
          }

          return {
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockImplementation(async () =>
              sql.includes("SELECT holder_id, lease_expires_at")
                ? {
                    holder_id: insertedLeaseValues[3],
                    lease_expires_at: insertedLeaseValues[4],
                  }
                : null,
            ),
          };
        }),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const startedAt = Date.now();
    await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "lease-duration",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search" },
    );

    const leaseExpiresAt = Date.parse(String(insertedLeaseValues[4]));
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(leaseExpiresAt - startedAt).toBeGreaterThanOrEqual(179_000);
  });

  it("returns a typed warming state while another isolate owns the live search", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T04:00:00.000Z"));

    try {
      const browserSearch = vi.fn();
      const future = new Date(Date.now() + 180_000).toISOString();
      const db = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue({
              holder_id: "other-isolate",
              lease_expires_at: future,
            }),
          })),
        })),
      } as unknown as D1Database;

      vi.doMock("~/lib/meta-library-browser.server", () => ({
        searchMetaLibraryByBrowser: browserSearch,
        CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
      }));
      vi.doMock("~/lib/data.server", () => ({
        getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
        getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
        upsertDiscoveryCacheEntry: vi.fn(),
        createDiscoveryFetchLog: vi.fn(),
        upsertDiscoveryProviderState: vi.fn(),
      }));

      const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
      const resultPromise = searchAdsViaSourceResolver(
        {
          BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
          DB: db,
        } as never,
        {
          mode: "keyword",
          filters: {
            query: "warming-state",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
        null,
        { purpose: "public_search" },
      );

      await vi.advanceTimersByTimeAsync(12_500);
      await expect(resultPromise).resolves.toMatchObject({
        ads: [],
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
        discoveryFailureClass: null,
      });
      expect(browserSearch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs live discovery when the distributed lease table is missing", async () => {
    const browserSearch = vi.fn().mockResolvedValue(buildLiveBrowserResult());
    const upsertDiscoveryCacheEntry = vi.fn();
    const createDiscoveryFetchLog = vi.fn();
    const upsertDiscoveryProviderState = vi.fn();
    const missingLeaseTable = new Error("D1_ERROR: no such table: discovery_query_lease");
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockRejectedValue(missingLeaseTable),
          run: vi.fn().mockRejectedValue(missingLeaseTable),
        })),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "missing-lease-table",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(result.discoverySummary).toBeNull();
    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(createDiscoveryFetchLog).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryProviderState).toHaveBeenCalledTimes(1);
  });

  it("honors stored provider cooldown metadata beyond the default cooldown window", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "rate_limited",
      summary: "Commercial discovery rate limited and no cached results are available. Retrying after about 30m.",
      lastSuccessAt: null,
      lastFailureAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      metadata: {
        cooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        retryAfterSeconds: 1800,
      },
      updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adflex",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ads: [],
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "rate_limited",
    });
    expect(result.discoverySummary).toContain("Retrying after about 30m.");
  });

  it("allows tokened canary probes to bypass cache and provider cooldown for a fresh live check", async () => {
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: "2026-04-21T18:00:00.000Z",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      browserMsUsed: 2500,
      createdAt: "2026-04-21T18:00:00.000Z",
      updatedAt: "2026-04-21T18:00:00.000Z",
    });
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "cache_only",
      failureClass: "rate_limited",
      summary: "Commercial discovery degraded; serving cached results.",
      lastSuccessAt: "2026-04-21T18:00:00.000Z",
      lastFailureAt: new Date().toISOString(),
      metadata: {
        cooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        retryAfterSeconds: 1800,
      },
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
        forceLive: true,
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoveryFailureClass: null,
    });
  });

  it("keeps customer-owned Meta API fallback available during forceLive browser failures", async () => {
    class CommercialDiscoveryError extends Error {
      failureClass: string;

      constructor(message: string, failureClass: string) {
        super(message);
        this.failureClass = failureClass;
      }
    }
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockRejectedValue(new CommercialDiscoveryError("Browser capture timed out.", "timeout"));
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ...buildLiveBrowserResult({
        source: "meta_api",
        provider: "meta_api",
      }),
      ads: [
        {
          ...buildLiveBrowserResult().ads[0],
          metaAdId: "meta-api-fallback-1",
        },
      ],
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    const upsertDiscoveryCacheEntry = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(metaApiSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        META_AD_LIBRARY_TOKEN: "customer-token",
      }),
      expect.anything(),
      null,
      expect.objectContaining({
        allowDemoFallback: false,
      }),
    );
    expect(result).toMatchObject({
      provider: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    const published = upsertDiscoveryCacheEntry.mock.calls[0]?.[1] as {
      cacheKey: string;
      provider: string;
      payload: SearchResponse;
    };
    expect(published).toMatchObject({
      provider: "meta_library_browser",
      payload: expect.objectContaining({
        provider: "meta_api",
      }),
    });
    expect(published.cacheKey).toContain("meta_library_browser:");
    expect(published.cacheKey).toContain(":customer_meta:");
    expect(published.cacheKey).not.toContain("customer-token");
  });

  it("marks empty customer Meta API fallbacks as no_results for forceLive lease waiters", async () => {
    class CommercialDiscoveryError extends Error {
      failureClass = "timeout";
    }
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockRejectedValue(new CommercialDiscoveryError("Browser capture timed out."));
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });
    const upsertDiscoveryCacheEntry = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(result).toMatchObject({
      provider: "meta_api",
      ads: [],
      discoveryStatus: "healthy",
    });
    expect(upsertDiscoveryCacheEntry.mock.calls[0]?.[1]).toMatchObject({
      payload: expect.objectContaining({
        provider: "meta_api",
        discoveryEmptyReason: "no_results",
      }),
    });
  });

  it("does not retry a forceLive customer Meta API failure as its own fallback", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockRejectedValue(new Error("Meta API unavailable."));

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    await expect(
      searchAdsViaSourceResolver(
        {
          DB: {} as D1Database,
        } as never,
        {
          mode: "keyword",
          filters: {
            query: "nykaa",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
        null,
        {
          purpose: "watchlist_scan",
          forceLive: true,
          customerMetaAdLibraryToken: "customer-token",
        },
      ),
    ).rejects.toThrow("Meta API unavailable.");

    expect(metaApiSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps the distributed discovery lease when forceLive bypasses a warm cache", async () => {
    const browserSearch = vi.fn();
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const fetchedAt = new Date().toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt,
      expiresAt: future,
      browserMsUsed: 2500,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue({
            holder_id: "other-holder",
            lease_expires_at: future,
          }),
        })),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
      },
    );

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("discovery_query_lease"));
    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "hit",
      discoveryStatus: "healthy",
    });
  });

  it("lets forceLive lease waiters use the lease holder's customer Meta API fallback", async () => {
    const browserSearch = vi.fn();
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    const fetchedAt = new Date().toISOString();
    const fallbackCacheEntry = {
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1:customer_meta:scoped-token",
      provider: "meta_library_browser",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult({
          source: "meta_api",
          provider: "meta_api",
        }),
        discoverySummary: "Browser capture is unavailable right now; showing API fallback results.",
      },
      fetchedAt,
      expiresAt: future,
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    };
    const getDiscoveryCacheEntry = vi.fn(async (_env, cacheKey: string) =>
      cacheKey.includes(":customer_meta:") ? fallbackCacheEntry : null,
    );
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue({
            holder_id: "other-holder",
            lease_expires_at: future,
          }),
        })),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-token",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.stringContaining(":customer_meta:"),
    );
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(":customer_meta:"),
    );
    expect(result).toMatchObject({
      provider: "meta_api",
      source: "meta_api",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
    });
  });

  it("runs the waiting customer's Meta API fallback when the shared browser lease does not resolve", async () => {
    const browserSearch = vi.fn();
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ...buildLiveBrowserResult({
        source: "meta_api",
        provider: "meta_api",
      }),
      ads: [
        {
          ...buildLiveBrowserResult().ads[0],
          metaAdId: "customer-b-fallback-1",
        },
      ],
    });
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(null);
    const upsertDiscoveryCacheEntry = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue({
            holder_id: "other-holder",
            lease_expires_at: future,
          }),
        })),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockImplementation(() => {
        const timestamp = new Date().toISOString();
        return Promise.resolve({
          provider: "meta_library_browser",
          status: "degraded",
          failureClass: "timeout",
          summary: "Commercial discovery timed out while another scan held the lease.",
          lastSuccessAt: null,
          lastFailureAt: timestamp,
          metadata: {},
          updatedAt: timestamp,
        });
      }),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
        customerMetaAdLibraryToken: "customer-b-token",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(metaApiSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        META_AD_LIBRARY_TOKEN: "customer-b-token",
      }),
      expect.anything(),
      null,
      expect.objectContaining({
        allowDemoFallback: false,
      }),
    );
    expect(upsertDiscoveryCacheEntry.mock.calls.at(-1)?.[1]).toMatchObject({
      cacheKey: expect.stringContaining(":customer_meta:"),
      payload: expect.objectContaining({
        provider: "meta_api",
      }),
    });
    expect(result).toMatchObject({
      provider: "meta_api",
      source: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
  });

  it("waits through stale provider cooldown for a fresh forceLive lease result", async () => {
    const browserSearch = vi.fn();
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const oldFetchedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const freshFetchedAt = new Date().toISOString();
    const staleCache = {
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: oldFetchedAt,
      expiresAt: future,
      browserMsUsed: 2500,
      createdAt: oldFetchedAt,
      updatedAt: oldFetchedAt,
    };
    const freshCache = {
      ...staleCache,
      fetchedAt: freshFetchedAt,
      createdAt: freshFetchedAt,
      updatedAt: freshFetchedAt,
    };
    const getDiscoveryCacheEntry = vi.fn()
      .mockResolvedValueOnce(staleCache)
      .mockResolvedValue(freshCache);
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue({
            holder_id: "other-holder",
            lease_expires_at: future,
          }),
        })),
      })),
    } as unknown as D1Database;

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass: string;

        constructor(message: string, failureClass: string) {
          super(message);
          this.failureClass = failureClass;
        }
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue({
        provider: "meta_library_browser",
        status: "cache_only",
        failureClass: "rate_limited",
        summary: "Commercial discovery degraded; serving cached results.",
        lastSuccessAt: oldFetchedAt,
        lastFailureAt: new Date().toISOString(),
        metadata: {
          cooldownUntil: future,
          retryAfterSeconds: 1800,
        },
        updatedAt: new Date().toISOString(),
      }),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
        forceLive: true,
      },
    );

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("discovery_query_lease"));
    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(2);
    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "hit",
      discoveryStatus: "healthy",
    });
  });

  it("serves stale cached results without a fresh browser fetch during public-search cooldown", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: "2026-04-21T18:00:00.000Z",
      expiresAt: "2026-04-21T18:01:00.000Z",
      browserMsUsed: 2500,
      createdAt: "2026-04-21T18:00:00.000Z",
      updatedAt: "2026-04-21T18:00:00.000Z",
    });
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "cache_only",
      failureClass: "rate_limited",
      summary: "Commercial discovery degraded; serving cached results.",
      lastSuccessAt: "2026-04-21T18:00:00.000Z",
      lastFailureAt: new Date().toISOString(),
      metadata: null,
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryFailureClass: "rate_limited",
    });
  });

  it("returns a degraded empty state without a fresh browser fetch during public-search cooldown when no cache exists", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "rate_limited",
      summary: "Commercial discovery degraded and no cached results are available.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: null,
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "adspy",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ads: [],
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryFailureClass: "rate_limited",
    });
  });

  it("serves stale cached results without a fresh browser fetch during watchlist-scan cooldown", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: "2026-04-21T18:00:00.000Z",
      expiresAt: "2026-04-21T18:01:00.000Z",
      browserMsUsed: 2500,
      createdAt: "2026-04-21T18:00:00.000Z",
      updatedAt: "2026-04-21T18:00:00.000Z",
    });
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "cache_only",
      failureClass: "rate_limited",
      summary: "Commercial discovery degraded; serving cached results.",
      lastSuccessAt: "2026-04-21T18:00:00.000Z",
      lastFailureAt: new Date().toISOString(),
      metadata: null,
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        constructor(
          message: string,
          public readonly failureClass: string,
        ) {
          super(message);
          this.name = "CommercialDiscoveryError";
        }
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "watchlist_scan",
      },
    );

    expect(browserSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryFailureClass: "rate_limited",
    });
  });

  it("fails fast during watchlist-scan cooldown when no cache exists", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "rate_limited",
      summary: "Commercial discovery degraded and no cached results are available.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: null,
      updatedAt: new Date().toISOString(),
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        constructor(
          message: string,
          public readonly failureClass: string,
        ) {
          super(message);
          this.name = "CommercialDiscoveryError";
        }
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver, CommercialDiscoveryError } = await import(
      "~/lib/ad-source.server"
    );

    await expect(
      searchAdsViaSourceResolver(
        {
          BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
          DB: {} as D1Database,
        } as never,
        {
          mode: "keyword",
          filters: {
            query: "adspy",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
        null,
        {
          purpose: "watchlist_scan",
        },
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
      message: "Commercial discovery degraded and no cached results are available.",
    });
    expect(browserSearch).not.toHaveBeenCalled();
  });

  it("returns an honest empty result when client-side filters narrow a usable scrape to zero ads", async () => {
    // The scrape itself worked (>=1 extractable ad card); only the exposed UI
    // filters removed everything. That must NOT throw empty_result, degrade
    // shared provider health, or burn the gated Meta API fallback.
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    const filterAdsBySearchFilters = vi.fn().mockReturnValue([]);
    const apiSearch = vi.fn();
    const upsertDiscoveryProviderState = vi.fn();
    const createDiscoveryFetchLog = vi.fn();

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters,
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: {} as D1Database,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "instagram",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      {
        purpose: "public_search",
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(filterAdsBySearchFilters).toHaveBeenCalledTimes(1);
    // no throw, honest empty result with the explicit reason
    expect(result.ads).toEqual([]);
    expect(result.discoveryEmptyReason).toBe("no_results");
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      discoveryStatus: "healthy",
      discoveryFailureClass: null,
    });
    // the gated Meta API fallback must not fire for a scrape that worked
    expect(apiSearch).not.toHaveBeenCalled();
    // provider health stays healthy — never marked degraded
    expect(upsertDiscoveryProviderState).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        status: "healthy",
        failureClass: null,
      }),
    );
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_library_browser",
        status: "succeeded",
        failureClass: null,
      }),
    );
  });
});

describe("hasFreshDiscoveryCacheEntry", () => {
  const query: NormalizedSavedQuery = {
    mode: "advertiser",
    filters: {
      query: "nykaa",
      country: "India",
      platform: "all",
      creativeType: "all",
      status: "all",
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
  };

  function cacheEntry(overrides: Record<string, unknown> = {}) {
    const cachedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    return {
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult(),
      fetchedAt: cachedAt,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: cachedAt,
      updatedAt: cachedAt,
      ...overrides,
    };
  }

  it("reports a fresh usable cache entry without running discovery", async () => {
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(cacheEntry());
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");

    await expect(
      hasFreshDiscoveryCacheEntry(
        { BROWSER: { fetch: vi.fn() }, DB: {} as D1Database } as never,
        query,
        null,
      ),
    ).resolves.toBe(true);
    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
  });

  it("reports false for an expired cache entry", async () => {
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(
      cacheEntry({ expiresAt: new Date(Date.now() - 60 * 1000).toISOString() }),
    );
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");

    await expect(
      hasFreshDiscoveryCacheEntry(
        { BROWSER: { fetch: vi.fn() }, DB: {} as D1Database } as never,
        query,
        null,
      ),
    ).resolves.toBe(false);
  });

  it("reports false for a zero-ad browser cache entry that is not an explicit no-results", async () => {
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(
      cacheEntry({ payload: buildLiveBrowserResult({ ads: [] }) }),
    );
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");

    await expect(
      hasFreshDiscoveryCacheEntry(
        { BROWSER: { fetch: vi.fn() }, DB: {} as D1Database } as never,
        query,
        null,
      ),
    ).resolves.toBe(false);
  });

  it("reports false in explicit demo mode", async () => {
    const getDiscoveryCacheEntry = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");

    await expect(
      hasFreshDiscoveryCacheEntry({ DB: {} as D1Database } as never, query, null),
    ).resolves.toBe(false);
    expect(getDiscoveryCacheEntry).not.toHaveBeenCalled();
  });
});
