import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResponse } from "~/lib/types";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unmock("cloudflare:workers");
  delete (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__;
  vi.resetModules();
});

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
      payload: {
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      },
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
  });

  it("labels a successful refresh after stale cache as a live fetch", async () => {
    const browserSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    });
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

  it("serves stale cached results without a fresh browser fetch during public-search cooldown", async () => {
    const browserSearch = vi.fn();
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
      payload: {
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      },
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
