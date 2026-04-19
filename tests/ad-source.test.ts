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
});
