import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex, recordBrowserJobTelemetry } from "~/lib/browser-job-telemetry.server";
import type { NormalizedSavedQuery, SearchResponse } from "~/lib/types";
import { DISCOVERY_ADVERTISER_FILTER_EPOCH, buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { fingerprintSavedQuery } from "~/lib/normalize";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("interactive Meta pagination honesty", () => {
  it("labels and preserves a partial result when a bounded later page fails", async () => {
    const firstAd = buildLiveBrowserResult().ads[0];
    const searchAds = vi.fn()
      .mockResolvedValueOnce({
        ads: [firstAd],
        nextCursor: "cursor-2",
        source: "meta_api",
      })
      .mockRejectedValueOnce(new Error("page 2 unavailable"));
    vi.doMock("~/lib/meta-api.server", () => ({
      searchAds,
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(2),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));

    const { searchMetaApiAdsWithInteractiveDepth } = await import(
      "~/lib/ad-source.server"
    );
    const result = await searchMetaApiAdsWithInteractiveDepth(
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
      { interactive: true },
    );

    expect(result).toMatchObject({
      ads: [firstAd],
      nextCursor: "cursor-2",
      discoveryStatus: "healthy",
      discoveryPartial: true,
      discoverySummary: expect.stringContaining("results shown are partial"),
      discoveryFailureClass: "provider_unavailable",
    });
  });

  it("preserves prior provider success when a later Meta page degrades", async () => {
    const firstAd = buildLiveBrowserResult().ads[0];
    const previousSuccess = "2026-07-29T12:00:00.000Z";
    const searchAds = vi.fn()
      .mockResolvedValueOnce({
        ads: [firstAd],
        nextCursor: "cursor-2",
        source: "meta_api",
      })
      .mockRejectedValueOnce(new Error("page 2 unavailable"));
    const upsertDiscoveryProviderState = vi.fn();
    const upsertDiscoveryCacheEntry = vi.fn();

    vi.doMock("~/lib/meta-api.server", () => ({
      searchAds,
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(2),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue({
        provider: "meta_api",
        status: "healthy",
        failureClass: null,
        summary: "Official Meta API is available for limited diagnostic use.",
        lastSuccessAt: previousSuccess,
        lastFailureAt: null,
        metadata: null,
        updatedAt: previousSuccess,
      }),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      {
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "platform-token",
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
      { purpose: "public_search" },
    );

    expect(result).toMatchObject({
      ads: [firstAd],
      nextCursor: "cursor-2",
      discoveryStatus: "healthy",
      discoveryPartial: true,
      discoveryFailureClass: "provider_unavailable",
    });
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_api",
        status: "degraded",
        failureClass: "provider_unavailable",
        lastSuccessAt: previousSuccess,
        lastFailureAt: expect.any(String),
        metadata: expect.objectContaining({ partial: true }),
      }),
    );
    expect(upsertDiscoveryCacheEntry).not.toHaveBeenCalled();
  });

  it("maps unclassified Meta API first-page failures to provider_unavailable", async () => {
    const upsertDiscoveryProviderState = vi.fn();
    const before = Date.now();
    vi.doMock("~/lib/meta-api.server", () => ({
      searchAds: vi.fn().mockRejectedValue(new Error("upstream opaque failure")),
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
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
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "platform-token",
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
      { purpose: "public_search" },
    );

    expect(result.discoveryFailureClass).toBe("provider_unavailable");
    expect(result.discoveryFailureClass).not.toBe("browser_launch_failed");
    expect(result.discoveryFailureClass).not.toBe("browser_unavailable");
    expect(upsertDiscoveryProviderState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "meta_api",
        failureClass: "provider_unavailable",
      }),
    );
    const providerStateInput = upsertDiscoveryProviderState.mock.calls[0]?.[1];
    const cooldownUntil = Date.parse(providerStateInput.metadata.cooldownUntil);
    expect(cooldownUntil).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(cooldownUntil).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  });

  it("does not globally cool down Meta after a successful first page was partial", async () => {
    const firstAd = buildLiveBrowserResult().ads[0];
    const searchAds = vi.fn().mockResolvedValue({
      ads: [firstAd],
      nextCursor: null,
      source: "meta_api",
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      searchAds,
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      MetaApiError: class MetaApiError extends Error {},
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(2),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
      getDiscoveryProviderState: vi.fn().mockResolvedValue({
        provider: "meta_api",
        status: "degraded",
        failureClass: "browser_unavailable",
        summary: "A later page was unavailable.",
        lastSuccessAt: "2026-07-29T12:00:00.000Z",
        lastFailureAt: new Date().toISOString(),
        metadata: { partial: true, routeContext: "public_search" },
        updatedAt: new Date().toISOString(),
      }),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      {
        DB: {} as D1Database,
        META_AD_LIBRARY_TOKEN: "platform-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
      } as never,
      {
        mode: "advertiser",
        filters: {
          query: "another-brand",
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

    expect(searchAds).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ads: [firstAd],
      discoveryStatus: "healthy",
      discoveryPartial: false,
      discoveryFailureClass: null,
    });
  });
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

  it("throws when no commercial discovery provider is configured", async () => {
    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");

    await expect(resolveCommercialAdSourceStatus({} as never)).rejects.toThrow(
      "No commercial discovery provider is configured",
    );
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

  it("does not rehydrate provider bindings when E2E_PROVIDER_NETWORK_DENY is set", async () => {
    (globalThis as { __APP_REQUEST_ENV__?: unknown }).__APP_REQUEST_ENV__ = {
      BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
      BROWSER_RUN_API_TOKEN: "live-token-that-must-not-be-used",
    };

    const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
    await expect(resolveCommercialAdSourceStatus({
      E2E_PROVIDER_NETWORK_DENY: "1",
    } as never)).rejects.toThrow("No commercial discovery provider is configured");
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
  it("serves an explicitly marked local fixture cache without touching browser or API providers", async () => {
    const browserSearch = vi.fn();
    const metaApiSearch = vi.fn();
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
  });

  it("fails closed on a missing marked fixture cache row without falling through to a provider", async () => {
    const browserSearch = vi.fn();
    const metaApiSearch = vi.fn();
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
  });

  it("uses the platform Meta token when no customer token is provided", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [
        {
          metaAdId: "platform-token-result-1",
          advertiser: "Nykaa",
          body: "Sale",
          previewHeadline: "Sale",
          previewSubhead: "Sale",
          hook: "Sale",
          offer: "Sale",
          cta: "Shop",
          format: "image",
          languageLabel: "English",
          destinationType: "website",
          landingPageUrl: "https://www.nykaa.com/sale",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=platform-token-result-1",
          countries: ["India"],
          platforms: ["Instagram"],
          firstSeenAt: null,
          lastSeenAt: null,
          active: true,
          researchSummary: "Platform Meta API token fixture",
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

    vi.doMock(
      "cloudflare:workers",
      () => ({
        env: {},
      }),
    );
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      // Earlier tests mock this module without the export, and vi.doMock
      // state leaks across the file; pin it so the interactive-depth helper
      // never throws mid-search here.
      getInteractiveMetaApiExtraPages: () => 0,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
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
    expect(result.ads[0].metaAdId).toBe("platform-token-result-1");
  });

  it("returns an honest not-configured response for public search when no provider is configured", async () => {
    vi.doMock("cloudflare:workers", () => ({ env: {} }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn(),
      getDiscoveryProviderState: vi.fn(),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
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
      { purpose: "public_search" },
    );

    // Never a fabricated demo dataset: the honest end state says fresh checks
    // cannot run until a real source is configured.
    expect(result).toMatchObject({
      ads: [],
      provider: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoverySummary: expect.stringContaining(
        "No live commercial discovery provider is configured",
      ),
      discoveryFailureClass: "provider_unavailable",
    });
  });

  it("still fails loudly for non-public callers when no provider is configured", async () => {
    vi.doMock("cloudflare:workers", () => ({ env: {} }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");

    await expect(
      searchAdsViaSourceResolver(
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
        { purpose: "watchlist_scan" },
      ),
    ).rejects.toThrow("No commercial discovery provider is configured");
  });

  it("uses a customer-owned Meta token when the caller provides one", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [
        {
          metaAdId: "customer-owned-1",
          advertiser: "Nykaa",
          body: "Sale",
          previewHeadline: "Sale",
          previewSubhead: "Sale",
          hook: "Sale",
          offer: "Sale",
          cta: "Shop",
          format: "image",
          languageLabel: "English",
          destinationType: "website",
          landingPageUrl: null,
          adSnapshotUrl: null,
          countries: ["IN"],
          platforms: ["Facebook"],
          firstSeenAt: null,
          lastSeenAt: null,
          active: true,
          researchSummary: "ok",
          source: "meta_api",
          analysisFields: [],
        },
      ],
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
      MetaApiError: class MetaApiError extends Error {},
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

  it("reuses a forceLive shared cache entry younger than acceptCacheYoungerThanMs (WP-36)", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>();
    const fetchedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "shared-cache-1",
            advertiser: "Nykaa",
            body: "Shared cache offer",
            previewHeadline: "Shared cache offer",
            previewSubhead: "",
            hook: "Shared cache offer",
            offer: "Fresh enough",
            cta: "Shop now",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://www.nykaa.com/shared",
            adSnapshotUrl: "https://www.facebook.com/ads/library/?id=shared-cache-1",
            countries: ["India"],
            platforms: ["Facebook"],
            firstSeenAt: null,
            lastSeenAt: null,
            active: true,
            researchSummary: "Shared cache fixture",
            source: "meta_api",
            analysisFields: [],
            tags: [],
          },
        ],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
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
        acceptCacheYoungerThanMs: 3 * 60 * 60 * 1000,
      },
    );

    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "meta_api",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      ads: [expect.objectContaining({ metaAdId: "shared-cache-1" })],
    });
  });

  it("re-scrapes a stale zero-result shared cache entry scraped before the advertiser-fix cutoff", async () => {
    // Frozen just past the cutoff so the fixed pre-cutoff fetchedAt and the
    // acceptance window stay deterministic forever (no calendar drift).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    // A watchlist scan cached 0 ads during the broken-advertiser-filter era
    // (nonzero payload, no epoch stamp needed). The generous acceptance window
    // isolates the cutoff logic from the age check: without the fix this entry
    // would be served as a healthy forceLive shared hit (0 ads); with the fix it
    // is treated as expired and the live provider is called to re-scrape.
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [
        {
          metaAdId: "fresh-after-fix-1",
          advertiser: "Nykaa",
          body: "Now discoverable",
          previewHeadline: "Now discoverable",
          previewSubhead: "",
          hook: "Now discoverable",
          offer: "Now discoverable",
          cta: "Shop now",
          format: "image",
          languageLabel: "English",
          destinationType: "website",
          landingPageUrl: "https://www.nykaa.com/fresh",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=fresh-after-fix-1",
          countries: ["India"],
          platforms: ["Facebook"],
          firstSeenAt: null,
          lastSeenAt: null,
          active: true,
          researchSummary: "Fresh re-scrape after the advertiser fix",
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
    // Fetched 10 minutes before the cutoff — a genuine broken-era zero result.
    const fetchedAt = "2026-07-21T08:00:00.000Z";
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
        discoveryEmptyReason: "no_results",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
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
        // Deliberately huge (far beyond real cadence caps) so the age check can
        // never be the reason for the miss — the cutoff logic must be.
        acceptCacheYoungerThanMs: 400 * 24 * 60 * 60 * 1000,
      },
    );

    expect(metaApiSearch).toHaveBeenCalledTimes(1);
    expect(result.cacheStatus).not.toBe("hit");
    expect(result.ads).toEqual([expect.objectContaining({ metaAdId: "fresh-after-fix-1" })]);
  });

  it("still serves a within-window non-zero shared cache entry scraped before the cutoff (unaffected)", async () => {
    // Frozen just past the cutoff so the fixed pre-cutoff fetchedAt and the
    // acceptance window stay deterministic forever (no calendar drift).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    // Guardrail: the cutoff only expires ZERO-result entries. A non-zero entry
    // genuinely fetched before the cutoff stays a healthy forceLive shared hit.
    // Use a FIXED pre-cutoff timestamp (not Date.now()-offset, which would land
    // after the cutoff and prove nothing about pre-cutoff non-zero entries); the
    // generous acceptance window keeps age out of the picture so the only thing
    // that could exclude it is the (non-applicable) zero-result rule.
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>();
    const fetchedAt = "2026-07-21T08:00:00.000Z";
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      routeContext: "watchlist_scan",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "pre-cutoff-nonzero-1",
            advertiser: "Nykaa",
            body: "Still valid",
            previewHeadline: "Still valid",
            previewSubhead: "",
            hook: "Still valid",
            offer: null,
            cta: "Shop now",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://www.nykaa.com/valid",
            adSnapshotUrl: "https://www.facebook.com/ads/library/?id=pre-cutoff-nonzero-1",
            countries: ["India"],
            platforms: ["Facebook"],
            firstSeenAt: null,
            lastSeenAt: null,
            active: true,
            researchSummary: "Non-zero pre-cutoff fixture",
            source: "meta_api",
            analysisFields: [],
            tags: [],
          },
        ],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
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
        acceptCacheYoungerThanMs: 400 * 24 * 60 * 60 * 1000,
      },
    );

    expect(metaApiSearch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheStatus: "hit",
      ads: [expect.objectContaining({ metaAdId: "pre-cutoff-nonzero-1" })],
    });
  });

  // ---- broken-advertiser-filter: every cache-serving fallback path is covered ----
  // These four escape paths (provider cooldown, browser-fallback preference,
  // refresh-failure, and distributed-lease resolution) plus hasFreshDiscoveryCacheEntry
  // all read the same isUsableDiscoveryCache choke point, so none can serve a
  // pre-fix advertiser zero. Each fails under the pre-centralization code.
  const PRE_CUTOFF_FETCHED_AT = "2026-07-20T12:00:00.000Z"; // pre-fix write: payload carries NO filter epoch

  function staleAdvertiserZeroEntry(overrides: Record<string, unknown> = {}) {
    return {
      cacheKey: "meta_library_browser:fp-nykaa:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: buildLiveBrowserResult({ ads: [], discoveryEmptyReason: "no_results" }),
      fetchedAt: PRE_CUTOFF_FETCHED_AT,
      expiresAt: "2026-07-20T12:15:00.000Z",
      browserMsUsed: 2500,
      createdAt: PRE_CUTOFF_FETCHED_AT,
      updatedAt: PRE_CUTOFF_FETCHED_AT,
      ...overrides,
    };
  }

  const ADVERTISER_NYKAA_QUERY = {
    mode: "advertiser" as const,
    filters: {
      query: "nykaa",
      country: "India",
      platform: "all" as const,
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
  };

  it("provider cooldown never serves a pre-fix advertiser zero as a stale cache_only hit", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "login_wall",
      summary: "Commercial discovery degraded.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: { cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
      updatedAt: new Date().toISOString(),
    });
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(staleAdvertiserZeroEntry()),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    // Pre-fix: cacheStatus "stale", discoveryStatus "cache_only". Post-fix: honest miss.
    expect(result.cacheStatus).not.toBe("stale");
    expect(result.discoveryStatus).not.toBe("cache_only");
    expect(result.cacheStatus).toBe("miss");
    expect(result.discoveryStatus).toBe("degraded");
  });

  it("browser-fallback preference never serves a pre-fix advertiser zero as a stale cache_only hit", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "login_wall",
      summary: "Commercial discovery degraded.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      // Cooldown already elapsed -> skips the cooldown block, enters the
      // shouldPreferMetaApiFallbackForPublicSearch branch instead.
      metadata: { cooldownUntil: new Date(Date.now() - 60 * 1000).toISOString() },
      updatedAt: new Date().toISOString(),
    });
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(staleAdvertiserZeroEntry()),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    // Pre-fix: the browser-preference branch returns the stale zero (cacheStatus
    // "stale"/cache_only). Post-fix: usableCached is null so it returns an honest
    // degraded miss instead of the known-bad zero.
    expect(result.cacheStatus).not.toBe("stale");
    expect(result.discoveryStatus).not.toBe("cache_only");
    expect(result.cacheStatus).toBe("miss");
    expect(result.discoveryStatus).toBe("degraded");
  });

  it("refresh-failure fallback never serves a pre-fix advertiser zero as stale cache", async () => {
    const browserSearch = vi.fn().mockRejectedValue(new Error("selector drift"));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "selector_drift";
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(staleAdvertiserZeroEntry()),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    // Pre-fix: cacheStatus "stale" / cache_only. Post-fix: honest degraded miss after re-scrape attempt.
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.cacheStatus).not.toBe("stale");
    expect(result.discoveryStatus).not.toBe("cache_only");
    expect(result.cacheStatus).toBe("miss");
    expect(result.discoveryStatus).toBe("degraded");
  });

  it("distributed-lease resolution never reports a pre-fix advertiser zero as a healthy hit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    try {
      const browserSearch = vi.fn();
      const future = new Date(Date.now() + 180_000).toISOString();
      // Another isolate owns the lease (holder_id !== our holderId) -> lease not acquired.
      const db = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue({ holder_id: "other-isolate", lease_expires_at: future }),
          })),
        })),
      } as unknown as D1Database;
      vi.doMock("~/lib/meta-library-browser.server", () => ({
        searchMetaLibraryByBrowser: browserSearch,
        CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
      }));
      vi.doMock("~/lib/data.server", () => ({
        // Lease waiter finds a pre-fix advertiser zero that is still unexpired.
        getDiscoveryCacheEntry: vi.fn().mockResolvedValue(
          staleAdvertiserZeroEntry({
            fetchedAt: "2026-07-21T08:00:00.000Z",
            expiresAt: "2026-07-21T13:00:00.000Z",
          }),
        ),
        getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
        upsertDiscoveryCacheEntry: vi.fn(),
        createDiscoveryFetchLog: vi.fn(),
        upsertDiscoveryProviderState: vi.fn(),
      }));

      const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
      const resultPromise = searchAdsViaSourceResolver(
        { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: db } as never,
        ADVERTISER_NYKAA_QUERY,
        null,
        { purpose: "public_search" },
      );
      // The public waiter with no servable entry returns immediately (no 12s
      // wait-budget burn); the result below is what it resolves to.
      const result = await resultPromise;

      // Pre-fix: cacheStatus "hit" with the zero payload. Post-fix: honest warming state.
      expect(result.cacheStatus).not.toBe("hit");
      expect(result).toMatchObject({ discoveryProgress: "warming" });
      expect(browserSearch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hasFreshDiscoveryCacheEntry treats a pre-fix advertiser zero as NOT fresh, keyword zero stays fresh", async () => {
    // Frozen just past the cutoff so the future expiresAt (keyword-fresh) never
    // drifts into the past on a later calendar day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(
      // Unexpired relative to the frozen clock, so without the fix it would be
      // reported fresh.
      staleAdvertiserZeroEntry({ expiresAt: "2026-07-22T12:00:00.000Z" }),
    );
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");
    const env = { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never;

    // Advertiser mode: known-bad zero -> not fresh, so search keeps its live budget.
    await expect(
      hasFreshDiscoveryCacheEntry(env, ADVERTISER_NYKAA_QUERY, null),
    ).resolves.toBe(false);
    // Keyword mode: the same unexpired zero was never affected -> still fresh.
    await expect(
      hasFreshDiscoveryCacheEntry(env, { ...ADVERTISER_NYKAA_QUERY, mode: "keyword" }, null),
    ).resolves.toBe(true);
  });

  // ---- FIX-1 hardening: route compatibility lives in the same choke point ----
  // The fresh-hit path already refused cross-route entries, but the cooldown /
  // browser-preference / refresh-failure fallbacks and lease resolution read
  // usableCached BEFORE the route filter, and hasFreshDiscoveryCacheEntry never
  // route-filtered at all — so public searches and scheduled scans could consume
  // each other's incompatible results. Each test fails under that code.
  function healthyScanRouteEntry(overrides: Record<string, unknown> = {}) {
    return staleAdvertiserZeroEntry({
      routeContext: "watchlist_scan",
      payload: buildLiveBrowserResult(),
      fetchedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...overrides,
    });
  }

  it("rejects an UNSTAMPED advertiser zero even when written long after the fix deploy", async () => {
    // The scenario no timestamp cutoff can close: a version-pinned Workflow
    // instance running the broken filter sleeps/retries and writes its wrong
    // zero hours (or days) after the fixed worker went live. Recency proves
    // nothing — only the missing epoch stamp does.
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(
        // Unexpired, written "five minutes ago" — but carries no epoch stamp.
        staleAdvertiserZeroEntry({
          fetchedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    // Pre-epoch code: recent fetchedAt beat the cutoff -> served the wrong zero
    // as a fresh hit. Epoch contract: rejected -> live re-scrape.
    expect(result.cacheStatus).not.toBe("hit");
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(result.ads.length).toBeGreaterThan(0);
  });

  it("serves an advertiser-mode zero stamped with the CURRENT epoch as a normal fresh hit", async () => {
    // The epoch gate must not over-purge: a zero written by the FIXED filter is
    // a legitimate, trusted answer ("this advertiser runs no ads right now").
    const browserSearch = vi.fn();
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(
        staleAdvertiserZeroEntry({
          payload: {
            ...buildLiveBrowserResult({ ads: [], discoveryEmptyReason: "no_results" }),
            discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
          },
          fetchedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    expect(result.cacheStatus).toBe("hit");
    expect(result.ads).toEqual([]);
    expect(browserSearch).not.toHaveBeenCalled();
    // The epoch is a persistence-layer fact — it must never be served.
    expect("discoveryFilterEpoch" in result).toBe(false);
  });

  it("strips the writer epoch from every served cache payload (stale fallback included)", async () => {
    // Cooldown stale-serve path: a stamped NON-zero entry is served cache_only —
    // the payload must come back without the internal epoch field.
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "login_wall",
      summary: "Commercial discovery degraded.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: { cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
      updatedAt: new Date().toISOString(),
    });
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(
        staleAdvertiserZeroEntry({
          payload: {
            ...buildLiveBrowserResult(),
            discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
          },
        }),
      ),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    expect(result.cacheStatus).toBe("stale");
    expect(result.ads.length).toBeGreaterThan(0);
    expect("discoveryFilterEpoch" in result).toBe(false);
  });

  it("the direct live-scrape writer stamps the current contract epoch on the cached payload", async () => {
    const browserSearch = vi
      .fn<(...args: unknown[]) => Promise<SearchResponse>>()
      .mockResolvedValue(buildLiveBrowserResult());
    const upsertDiscoveryCacheEntry = vi.fn();
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
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
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
        }),
      }),
    );
  });

  it("provider cooldown never serves a scheduled-scan entry to a public search (FIX-1 escape)", async () => {
    const browserSearch = vi.fn();
    const getDiscoveryProviderState = vi.fn().mockResolvedValue({
      provider: "meta_library_browser",
      status: "degraded",
      failureClass: "login_wall",
      summary: "Commercial discovery degraded.",
      lastSuccessAt: null,
      lastFailureAt: new Date().toISOString(),
      metadata: { cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
      updatedAt: new Date().toISOString(),
    });
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(healthyScanRouteEntry()),
      getDiscoveryProviderState,
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const result = await searchAdsViaSourceResolver(
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never,
      ADVERTISER_NYKAA_QUERY,
      null,
      { purpose: "public_search" },
    );

    // Pre-fix: the shallow scan entry came back as a stale cache_only hit for the
    // deep public search. Post-fix: honest miss.
    expect(result.cacheStatus).not.toBe("stale");
    expect(result.discoveryStatus).not.toBe("cache_only");
    expect(result.ads).toEqual([]);
    expect(result.cacheStatus).toBe("miss");
  });

  it("distributed-lease resolution never resolves a scheduled-scan entry for a public-search waiter (FIX-1 escape)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    try {
      const browserSearch = vi.fn();
      const future = new Date(Date.now() + 180_000).toISOString();
      const db = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue({ holder_id: "other-isolate", lease_expires_at: future }),
          })),
        })),
      } as unknown as D1Database;
      vi.doMock("~/lib/meta-library-browser.server", () => ({
        searchMetaLibraryByBrowser: browserSearch,
        CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
      }));
      vi.doMock("~/lib/data.server", () => ({
        // The lease waiter finds a healthy, unexpired entry — but it belongs to
        // the scheduled scan route, not public_search.
        getDiscoveryCacheEntry: vi.fn().mockResolvedValue(healthyScanRouteEntry()),
        getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
        upsertDiscoveryCacheEntry: vi.fn(),
        createDiscoveryFetchLog: vi.fn(),
        upsertDiscoveryProviderState: vi.fn(),
      }));

      const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
      const resultPromise = searchAdsViaSourceResolver(
        { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: db } as never,
        ADVERTISER_NYKAA_QUERY,
        null,
        { purpose: "public_search" },
      );
      // The public waiter with no servable entry returns immediately (no 12s
      // wait-budget burn); the result below is what it resolves to.
      const result = await resultPromise;

      // Pre-fix: the scan entry resolved as a healthy cross-route "hit".
      expect(result.cacheStatus).not.toBe("hit");
      expect(result).toMatchObject({ discoveryProgress: "warming" });
      expect(browserSearch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hasFreshDiscoveryCacheEntry never counts a route-incompatible entry as fresh (FIX-1 escape)", async () => {
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(healthyScanRouteEntry()),
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry: vi.fn(),
      createDiscoveryFetchLog: vi.fn(),
      upsertDiscoveryProviderState: vi.fn(),
    }));

    const { hasFreshDiscoveryCacheEntry } = await import("~/lib/ad-source.server");
    const env = { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: {} as D1Database } as never;

    // Default (public_search) pre-check must not skip the live-search budget on
    // a scheduled-scan entry the resolver would reject.
    await expect(hasFreshDiscoveryCacheEntry(env, ADVERTISER_NYKAA_QUERY, null)).resolves.toBe(
      false,
    );
    // Positive control: the same entry IS fresh for its own route.
    await expect(
      hasFreshDiscoveryCacheEntry(env, ADVERTISER_NYKAA_QUERY, null, { purpose: "watchlist_scan" }),
    ).resolves.toBe(true);
  });

  it("rejects forceLive shared hits from public_search cache (FIX-1)", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });
    const fetchedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_api:fp-nykaa:india:page-1",
      provider: "meta_api",
      routeContext: "public_search",
      queryFingerprint: "fp-nykaa",
      country: "India",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "deep-public-only",
            advertiser: "Nykaa",
            body: "Deep scroll only",
            previewHeadline: "Deep",
            previewSubhead: "",
            hook: "Deep",
            offer: null,
            cta: "Shop now",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://www.nykaa.com/deep",
            adSnapshotUrl: "https://www.facebook.com/ads/library/?id=deep-public-only",
            countries: ["India"],
            platforms: ["Facebook"],
            firstSeenAt: null,
            lastSeenAt: null,
            active: true,
            researchSummary: "Deep public fixture",
            source: "meta_api",
            analysisFields: [],
            tags: [],
          },
        ],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
      },
      fetchedAt,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
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
        acceptCacheYoungerThanMs: 3 * 60 * 60 * 1000,
      },
    );

    expect(metaApiSearch).toHaveBeenCalledTimes(1);
    expect(result.ads.find((ad) => ad.metaAdId === "deep-public-only")).toBeUndefined();
    expect(result.cacheStatus).not.toBe("hit");
  });

  it("still forceLive scrapes when the shared cache is older than acceptCacheYoungerThanMs", async () => {
    const metaApiSearch = vi.fn<(...args: unknown[]) => Promise<SearchResponse>>().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
    });
    const fetchedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
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
      fetchedAt,
      expiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
      browserMsUsed: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: metaApiSearch,
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
        acceptCacheYoungerThanMs: 3 * 60 * 60 * 1000,
      },
    );

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

  it("returns the warming state immediately and finishes the capture in the background when this request owns the lease", async () => {
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
    let insertedLeaseValues: unknown[] = [];
    const prepare = vi.fn((sql: string) => ({
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
    }));
    const db = { prepare } as unknown as D1Database;

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
    const waitUntil = vi.fn();
    const query: NormalizedSavedQuery = {
      mode: "keyword" as const,
      filters: {
        query: "cold-path-warm",
        country: "India",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    };

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      query,
      null,
      { purpose: "public_search", executionContext: { waitUntil } },
    );

    expect(result).toMatchObject({
      ads: [],
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryProgress: "warming",
      discoveryFailureClass: null,
    });
    // The response is out while the capture is still running: the browser
    // promise is unresolved, so no cache write or fetch log has happened yet,
    // and the capture was handed to waitUntil instead of being awaited.
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(createDiscoveryFetchLog).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const background = waitUntil.mock.calls[0]?.[0];
    resolveSearch(buildLiveBrowserResult());
    await background;

    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(createDiscoveryFetchLog).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryProviderState).toHaveBeenCalledTimes(1);
    // The background run released the lease it owned (expired-cleanup DELETE
    // from acquire + owner DELETE from release).
    const releaseCalls = prepare.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((sql) => sql.includes("DELETE FROM discovery_query_lease"));
    expect(releaseCalls).toHaveLength(2);
    // The cold-path lease is short (60s) so a canceled background run
    // self-heals, and the run renewed it while alive (heartbeat UPDATE).
    const leaseExpiresAtMs = Date.parse(String(insertedLeaseValues[4]));
    expect(leaseExpiresAtMs - Date.now()).toBeGreaterThan(55_000);
    expect(leaseExpiresAtMs - Date.now()).toBeLessThanOrEqual(61_000);
    const heartbeatUpdates = prepare.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((sql) => sql.includes("UPDATE discovery_query_lease"));
    expect(heartbeatUpdates).toHaveLength(1);
  });

  it("returns an expired-but-usable entry immediately and refreshes it in the background when this request owns the lease", async () => {
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
    let insertedLeaseValues: unknown[] = [];
    const prepare = vi.fn((sql: string) => ({
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
    }));
    const db = { prepare } as unknown as D1Database;
    const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-cold-stale:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-cold-stale",
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: expiredAt,
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry,
      getDiscoveryProviderState: vi.fn().mockResolvedValue(null),
      upsertDiscoveryCacheEntry,
      createDiscoveryFetchLog,
      upsertDiscoveryProviderState,
    }));

    const { searchAdsViaSourceResolver } = await import("~/lib/ad-source.server");
    const waitUntil = vi.fn();
    const query: NormalizedSavedQuery = {
      mode: "keyword" as const,
      filters: {
        query: "cold-path-stale",
        country: "India",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    };

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      query,
      null,
      { purpose: "public_search", executionContext: { waitUntil } },
    );

    // The expired-but-usable ads are painted immediately, labeled honestly as
    // stale/cache_only, with the warming flag so the client poll picks up the
    // finished capture instead of stranding the visitor on old data.
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryProgress: "warming",
      discoveryFailureClass: null,
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });
    // The response is out while the refresh is still running: the browser
    // promise is unresolved and the capture was handed to waitUntil. The
    // immediate stale serve also records its cache telemetry row through the
    // same executionContext (one additional waitUntil registration for the
    // background write).
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(waitUntil.mock.calls[1]?.[0]).toBeInstanceOf(Promise);

    const background = waitUntil.mock.calls[0]?.[0];
    resolveSearch(buildLiveBrowserResult());
    await background;

    expect(upsertDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    expect(createDiscoveryFetchLog).toHaveBeenCalledTimes(1);
    expect(upsertDiscoveryProviderState).toHaveBeenCalledTimes(1);
    // The stale refresh uses the short cold-warm lease (60s) so a canceled
    // background run self-heals, exactly like the true cold path.
    const leaseExpiresAtMs = Date.parse(String(insertedLeaseValues[4]));
    expect(leaseExpiresAtMs - Date.now()).toBeGreaterThan(55_000);
    expect(leaseExpiresAtMs - Date.now()).toBeLessThanOrEqual(61_000);
  });

  it("returns an expired-but-usable entry with the warming flag while another isolate owns the live search", async () => {
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
    const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-waiter-stale:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-waiter-stale",
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: expiredAt,
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
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
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "waiter-stale",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search", executionContext: { waitUntil: vi.fn() } },
    );

    // The waiter returns the older results immediately instead of holding the
    // request for the lease holder; the warming flag keeps the client poll
    // alive so the fresh entry lands when the holder finishes.
    expect(result).toMatchObject({
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryProgress: "warming",
      discoveryFailureClass: null,
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });
    expect(browserSearch).not.toHaveBeenCalled();
  });

  it("keeps cursor (load-more) requests on the synchronous discovery path", async () => {
    const browserSearch = vi.fn().mockResolvedValue(buildLiveBrowserResult());
    const waitUntil = vi.fn();
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
    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "load-more-cold",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      "cursor-2",
      { purpose: "public_search", executionContext: { waitUntil } },
    );

    expect(result).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("keeps forceLive public searches on the synchronous discovery path", async () => {
    const browserSearch = vi.fn().mockResolvedValue(buildLiveBrowserResult());
    const waitUntil = vi.fn();
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
    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "force-live-cold",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search", forceLive: true, executionContext: { waitUntil } },
    );

    expect(result).toMatchObject({
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("returns a typed warming state immediately while another isolate owns the live search", async () => {
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
      const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(null);
      const getDiscoveryProviderState = vi.fn().mockResolvedValue(null);
      vi.doMock("~/lib/data.server", () => ({
        getDiscoveryCacheEntry,
        getDiscoveryProviderState,
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

      // Lane-3 cold path: the waiter must NOT burn its 12s wait budget on a
      // true miss — the holder's capture cannot land inside that budget, so
      // the request resolves to the warming state without any timer firing.
      // Awaiting with fake timers (never advancing) proves no sleep happened.
      await expect(resultPromise).resolves.toMatchObject({
        ads: [],
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
        discoveryFailureClass: null,
      });
      expect(browserSearch).not.toHaveBeenCalled();
      // Exactly two cache reads (resolver pre-lease read + the waiter's single
      // poll iteration): the early return skips the 250ms poll loop entirely.
      expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(2);
      // The provider-cooldown check still runs before the warming return.
      expect(getDiscoveryProviderState).toHaveBeenCalled();
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
        // Lease-fallback writer must stamp the current contract epoch.
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
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

  it("returns false when no discovery provider is configured", async () => {
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

describe("browser-job attribution correlation (migration 0075)", () => {
  function telemetryHarness() {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    return harness;
  }

  it("correlates the browser chain and the Meta API fallback under one job id", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    const harness = telemetryHarness();
    // Simulates the real browser chain consuming its first attempt before
    // failing with a login wall (the real module increments the out-param).
    const browserSearch = vi.fn(async (_env: unknown, _query: unknown, options: { jobId?: string; telemetryAttempts?: { used: number } }) => {
      if (options?.telemetryAttempts) {
        options.telemetryAttempts.used = 1;
      }
      throw new MockCommercialDiscoveryError("Meta Ad Library returned a login wall.", "login_wall");
    });
    const apiSearch = vi.fn().mockResolvedValue(
      buildLiveBrowserResult({
        source: "meta",
        provider: undefined,
      }),
    );

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
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

    const result = await searchAdsViaSourceResolver(
      {
        BROWSER: { fetch: vi.fn() } as unknown as Fetcher,
        DB: harness.db,
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
        planTier: "starter",
      },
    );

    expect(result).toMatchObject({ source: "meta_api", provider: "meta_api" });
    // The resolver generated ONE top-level job id and passed it into the
    // browser call; the Meta API fallback row continues that same job.
    const browserCallOptions = browserSearch.mock.calls[0]?.[2] ?? {};
    const jobId = browserCallOptions.jobId as string;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);

    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toBe(jobId);
    expect(rows[0]).toMatchObject({
      job_kind: "meta_discovery",
      actual_provider: "customer_meta_api",
      route_context: "public_search",
      plan_tier: "starter",
      attempt: 2, // continues after the simulated browser chain attempt
      outcome: "succeeded",
    });
    // Stable SHA-256 fingerprint of the canonical correlation input — never
    // the raw query text.
    expect(String(rows[0].idempotency_key)).toMatch(/^[0-9a-f]{64}$/u);
    expect(String(rows[0].idempotency_key)).not.toContain("nykaa");
    harness.close();
  });

  it("persists only a SHA-256 fingerprint of the cache key — the raw paging cursor never lands", async () => {
    const harness = telemetryHarness();
    const rawCursor = "abc+def/ghi==-page2";
    const cachedAt = new Date(Date.now() - 60_000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: `meta_library_browser:fp:india:${rawCursor}`,
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp",
      country: "India",
      cursor: rawCursor,
      payload: {
        ads: [{ metaAdId: "cache-hit-1" }],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "hit",
      },
      fetchedAt: cachedAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      browserMsUsed: null,
      createdAt: cachedAt,
      updatedAt: cachedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
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
      { BROWSER: { fetch: vi.fn() } as unknown as Fetcher, DB: harness.db } as never,
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
      rawCursor,
      { purpose: "public_search" },
    );

    expect(result.ads).toHaveLength(1);
    const rows = harness.sqlite
      .prepare("SELECT idempotency_key, job_id FROM browser_job_telemetry")
      .all() as Array<{ idempotency_key: string; job_id: string }>;
    expect(rows).toHaveLength(1);
    // Bounded SHA-256 fingerprint; no cursor, URL, or query text anywhere.
    expect(rows[0].idempotency_key).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows[0].idempotency_key).not.toContain(rawCursor);
    expect(rows[0].idempotency_key).not.toContain("abc");
    expect(rows[0].idempotency_key).not.toContain("nykaa");
    expect(rows[0].job_id).toMatch(/^[0-9a-f-]{36}$/u);
    harness.close();
  });

  it("continues one job id with strictly increasing attempts from live failure through the stale cache serve", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    const harness = telemetryHarness();
    // Simulates the real browser chain: the leg records its OWN telemetry row
    // through the shared attempt allocator before failing (the real module
    // increments the out-param at each leg's terminal point).
    const browserSearch = vi.fn(
      async (
        _env: unknown,
        _query: unknown,
        options: {
          jobId?: string;
          routeContext?: string;
          planTier?: string | null;
          source?: string;
          telemetryAttempts?: { used: number };
          executionContext?: unknown;
        },
      ) => {
        const startedAt = new Date().toISOString();
        options.telemetryAttempts!.used += 1;
        await recordBrowserJobTelemetry(
          _env as never,
          {
            jobId: options.jobId ?? "job-0001",
            idempotencyKey: "deadbeef".repeat(8),
            jobKind: "meta_discovery",
            actualProvider: "cloudflare_browser_run",
            routeContext: (options.routeContext ?? "public_search") as never,
            planTier: (options.planTier ?? null) as never,
            source: (options.source ?? "manual") as never,
            attempt: options.telemetryAttempts!.used,
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: 5,
            outcome: "failed",
            resultCount: null,
          },
          { executionContext: (options.executionContext ?? null) as never },
        );
        throw new MockCommercialDiscoveryError("selector drift", "selector_drift");
      },
    );
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-stale-attribution:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-stale-attribution",
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
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
        DB: harness.db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "stale-attribution",
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

    // Customer-visible stale/degraded shape is preserved unchanged.
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });

    const browserCallOptions = browserSearch.mock.calls[0]?.[2] ?? {};
    const jobId = browserCallOptions.jobId as string;
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // ONE job id across the failed live leg AND the cache serve.
    expect(new Set(rows.map((row) => row.job_id)).size).toBe(1);
    expect(rows[0].job_id).toBe(jobId);
    // Strictly increasing attempts: the live failure owns 1, the cache serve
    // continues the shared allocator at 2 (no duplicate attempt numbers).
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({
      actual_provider: "cloudflare_browser_run",
      outcome: "failed",
    });
    expect(rows[1]).toMatchObject({
      actual_provider: "cache",
      cache_status: "stale",
      outcome: "degraded",
      result_count: 1,
    });
    harness.close();
  });

  it("records the background stale serve under the job id while the warming capture runs", async () => {
    const harness = telemetryHarness();
    const browserSearch = vi.fn(
      async (
        _env: unknown,
        _query: unknown,
        options: { jobId?: string },
      ) => new Promise<SearchResponse>(() => undefined),
    );
    const waitUntil = vi.fn();
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: "meta_library_browser:fp-bg-stale:india:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fp-bg-stale",
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
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
        DB: harness.db,
      } as never,
      {
        mode: "keyword",
        filters: {
          query: "bg-stale",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
      null,
      { purpose: "public_search", executionContext: { waitUntil } },
    );

    expect(result).toMatchObject({
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryProgress: "warming",
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });
    // The warming capture was handed to waitUntil; the immediate stale serve
    // is attributed to the SAME job id. The serve's telemetry row is also
    // registered with waitUntil (background completion), so two registrations.
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(waitUntil.mock.calls[1]?.[0]).toBeInstanceOf(Promise);
    const browserCallOptions = browserSearch.mock.calls[0]?.[2] ?? {};
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toBe(browserCallOptions.jobId);
    expect(rows[0]).toMatchObject({
      actual_provider: "cache",
      cache_status: "stale",
      outcome: "degraded",
      attempt: 1,
    });
    harness.close();
  });

  it("records the lease-resolved stale serve under the waiting job id", async () => {
    const harness = telemetryHarness();
    // Real lease table with a row owned by ANOTHER isolate: this request's
    // acquisition is ignored, so it waits for lease resolution and serves the
    // stale entry. Telemetry still writes to the real sqlite harness.
    harness.sqlite.exec(`
      CREATE TABLE discovery_query_lease (
        cache_key TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        route_context TEXT NOT NULL,
        holder_id TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const query: NormalizedSavedQuery = {
      mode: "keyword",
      filters: {
        query: "lease-stale",
        country: "India",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    };
    const leaseCacheKey = buildDiscoveryCacheKey({
      provider: "meta_library_browser",
      fingerprint: fingerprintSavedQuery(query),
      country: "India",
      cursor: null,
    });
    const future = new Date(Date.now() + 180_000).toISOString();
    const now = new Date().toISOString();
    harness.sqlite
      .prepare(
        `INSERT INTO discovery_query_lease (
          cache_key, provider, route_context, holder_id, lease_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(leaseCacheKey, "meta_library_browser", "public_search", "other-isolate", future, now, now);

    const browserSearch = vi.fn();
    const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: leaseCacheKey,
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: fingerprintSavedQuery(query),
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
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
        DB: harness.db,
      } as never,
      query,
      null,
      { purpose: "public_search", executionContext: { waitUntil: vi.fn() } },
    );

    expect(result).toMatchObject({
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryProgress: "warming",
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });
    expect(browserSearch).not.toHaveBeenCalled();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(rows[0]).toMatchObject({
      actual_provider: "cache",
      cache_status: "stale",
      outcome: "degraded",
      attempt: 1,
      result_count: 1,
    });
    harness.close();
  });

  it("records the lease-resolved fresh hit under the waiting job id", async () => {
    const harness = telemetryHarness();
    harness.sqlite.exec(`
      CREATE TABLE discovery_query_lease (
        cache_key TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        route_context TEXT NOT NULL,
        holder_id TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const query: NormalizedSavedQuery = {
      mode: "keyword",
      filters: {
        query: "lease-hit",
        country: "India",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    };
    const leaseCacheKey = buildDiscoveryCacheKey({
      provider: "meta_library_browser",
      fingerprint: fingerprintSavedQuery(query),
      country: "India",
      cursor: null,
    });
    const future = new Date(Date.now() + 180_000).toISOString();
    const now = new Date().toISOString();
    harness.sqlite
      .prepare(
        `INSERT INTO discovery_query_lease (
          cache_key, provider, route_context, holder_id, lease_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(leaseCacheKey, "meta_library_browser", "public_search", "other-isolate", future, now, now);

    const browserSearch = vi.fn();
    // Unexpired entry fetched 1.5s ago: outside the 1s forceLive shared-hit
    // window but fresh enough for the lease freshness skew, so the waiter
    // resolves it as a healthy hit.
    const fetchedAt = new Date(Date.now() - 1500).toISOString();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue({
      cacheKey: leaseCacheKey,
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: fingerprintSavedQuery(query),
      country: "India",
      cursor: null,
      payload: {
        ...buildLiveBrowserResult(),
        discoveryEmptyReason: null,
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      browserMsUsed: 12_000,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: vi.fn(),
      MetaApiError: class MetaApiError extends Error {},
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
        DB: harness.db,
      } as never,
      query,
      null,
      { purpose: "public_search", forceLive: true, acceptCacheYoungerThanMs: 1000 },
    );

    expect(result).toMatchObject({
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      ads: [{ metaAdId: "meta-nykaa-1" }],
    });
    expect(browserSearch).not.toHaveBeenCalled();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actual_provider: "cache",
      cache_status: "hit",
      outcome: "succeeded",
      attempt: 1,
      result_count: 1,
    });
    harness.close();
  });

  it("starts the fallback Meta API leg at the provider call, excluding pre-provider work (controlled clock)", async () => {
    class MockCommercialDiscoveryError extends Error {
      constructor(
        message: string,
        public readonly failureClass: string,
      ) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
        const harness = telemetryHarness();

    // Each provider-state lookup consumes 5s of fake clock. The recorded
    // fallback leg must start AFTER them (immediately before the provider
    // call) so pre-provider work is excluded from the recorded duration.
    const getDiscoveryProviderState = vi.fn(async () => {
      vi.setSystemTime(new Date(Date.now() + 5000));
      return null;
    });
    const apiSearch = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + 4000));
      return buildLiveBrowserResult({ source: "meta", provider: undefined });
    });
    const browserSearch = vi.fn().mockRejectedValue(
      new MockCommercialDiscoveryError("Meta Ad Library returned a login wall.", "login_wall"),
    );

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: browserSearch,
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
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
        DB: harness.db,
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
      { purpose: "public_search" },
    );

    expect(result).toMatchObject({ source: "meta_api", provider: "meta_api" });
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The leg starts at the provider call (T0 + 5s resolver lookup + 5s
    // fallback lookup), NOT at the fallback entry: the provider call consumed
    // the final 4s and nothing before it counts.
    expect(rows[0].started_at).toBe("2026-07-21T12:00:10.000Z");
    expect(rows[0].duration_ms).toBe(4000);
    expect(rows[0]).toMatchObject({
      actual_provider: "customer_meta_api",
      outcome: "succeeded",
    });
    harness.close();
  });

  it("starts the direct Meta API leg at the provider call, excluding pre-provider work (controlled clock)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
        const harness = telemetryHarness();

    // The cache/D1 lookup consumes 4s of fake clock before the provider call;
    // the recorded direct leg must start AFTER it (immediately before the
    // provider call) so pre-provider work is excluded from the duration.
    const getDiscoveryCacheEntry = vi.fn(async () => {
      vi.setSystemTime(new Date(Date.now() + 4000));
      return null;
    });
    const apiSearch = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + 5000));
      return buildLiveBrowserResult({
        source: "meta_api",
        provider: "meta_api",
      });
    });

    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
      getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(0),
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      filterAdsBySearchFilters: (ads: unknown[]) => ads,
      searchAds: apiSearch,
      MetaApiError: class MetaApiError extends Error {},
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
        DB: harness.db,
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
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The leg starts at the provider call (T0 + 4s cache/D1 lookup), NOT at
    // the resolver start: the provider call consumed the final 5s and nothing
    // before it counts.
    expect(rows[0].started_at).toBe("2026-07-21T12:00:04.000Z");
    expect(rows[0].duration_ms).toBe(5000);
    expect(rows[0]).toMatchObject({
      actual_provider: "customer_meta_api",
      outcome: "succeeded",
    });
    harness.close();
  });
});
