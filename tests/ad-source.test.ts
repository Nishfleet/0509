import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedSavedQuery, SearchResponse } from "~/lib/types";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unmock("cloudflare:workers");
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
});

describe("searchAdsViaSourceResolver", () => {
  it("routes discovery through the resolver instead of importing meta-api directly", async () => {
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
      searchAds: metaApiSearch,
      demoSearch: vi.fn(),
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

    expect(metaApiSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_api");
    expect(result.source).toBe("meta_api");
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
      },
    );

    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("meta_library_browser");
    expect(result.source).toBe("meta_library_browser");
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
        metadata: expect.objectContaining({
          cursor: null,
          queryLabel: "nykaa",
          queryMode: "advertiser",
        }),
      }),
    );
    expect(createDiscoveryFetchLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_api",
        status: "succeeded",
        failureClass: null,
        metadata: expect.objectContaining({
          fallbackFor: "meta_library_browser",
          queryLabel: "nykaa",
          queryMode: "advertiser",
        }),
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

  it("serves public-search cache before diagnostic fallback when the browser provider recently degraded", async () => {
    const browserSearch = vi.fn();
    const apiSearch = vi.fn();
    const fetchedAt = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "selector_drift",
      summary: "Browser Run selectors drifted.",
      lastSuccessAt: fetchedAt,
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
      searchAds: apiSearch,
      demoSearch: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue({
        cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
        provider: "meta_library_browser",
        routeContext: "public_search",
        queryFingerprint: "fp-nykaa",
        country: "India",
        cursor: null,
        payload: buildLiveBrowserResult(),
        fetchedAt,
        expiresAt,
        browserMsUsed: 2500,
        createdAt: fetchedAt,
        updatedAt: fetchedAt,
      }),
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
    expect(apiSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoverySummary: "Browser Run selectors drifted.",
      discoveryFailureClass: "selector_drift",
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
});
