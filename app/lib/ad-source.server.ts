import {
  createDiscoveryFetchLog,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
} from "~/lib/data.server";
import { buildDiscoveryCacheKey, resolveDiscoveryCacheTtlMs } from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import { searchMetaLibraryByBrowser, CommercialDiscoveryError } from "~/lib/meta-library-browser.server";
import { demoSearch, MetaApiError, searchAds as searchMetaApiAds } from "~/lib/meta-api.server";
import { fingerprintSavedQuery } from "~/lib/normalize";
import type {
  AdDiscoveryProvider,
  DiscoveryFailureClass,
  DiscoveryRouteContext,
  MetaIntegrationStatus,
  NormalizedSavedQuery,
  SearchResponse,
} from "~/lib/types";

export { CommercialDiscoveryError } from "~/lib/meta-library-browser.server";

export interface SearchAdsViaSourceOptions {
  purpose?: DiscoveryRouteContext;
}

function normalizeSearchResponse(
  result: SearchResponse,
  provider: AdDiscoveryProvider,
): SearchResponse {
  if (provider === "meta_api" && result.source === "meta") {
    return {
      ...result,
      source: "meta_api",
      provider,
      cacheStatus: "miss",
    };
  }

  if (provider === "demo" || result.source === "demo") {
    return {
      ...result,
      source: "demo",
      provider: "demo",
      cacheStatus: "none",
    };
  }

  return {
    ...result,
    provider,
    cacheStatus: result.cacheStatus ?? "miss",
  };
}

export function resolveCommercialDiscoveryProvider(env: AppEnv): AdDiscoveryProvider {
  if (env.BROWSER) {
    return "meta_library_browser";
  }

  if (env.META_AD_LIBRARY_TOKEN) {
    return "meta_api";
  }

  return "demo";
}

export async function resolveCommercialAdSourceStatus(
  env: AppEnv,
): Promise<MetaIntegrationStatus> {
  const provider = resolveCommercialDiscoveryProvider(env);
  const providerState =
    provider !== "demo" && env.DB ? await getDiscoveryProviderState(env, provider) : null;

  if (providerState) {
    return {
      status: providerState.status,
      provider,
      mode:
        providerState.status === "cache_only"
          ? "cache"
          : provider === "meta_api"
            ? "diagnostic"
            : "live",
      summary: providerState.summary,
      lastCheckedAt: providerState.updatedAt,
      lastErrorCode: providerState.failureClass,
      lastErrorMessage: null,
    };
  }

  if (provider === "meta_library_browser") {
    return {
      status: "degraded",
      provider,
      mode: "live",
      summary:
        "Live commercial discovery is configured through Browser Run, but provider health has not been confirmed yet.",
      lastCheckedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }

  if (provider === "meta_api") {
    return {
      status: "degraded",
      provider,
      mode: "diagnostic",
      summary:
        "Official Meta API is configured for limited diagnostic use. It should not be treated as the live commercial discovery provider for India.",
      lastCheckedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }

  return {
    status: "demo",
    provider: "demo",
    mode: "demo",
    summary:
      "No live commercial discovery provider is configured. The app is running in explicit demo mode.",
    lastCheckedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export async function searchAdsViaSourceResolver(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor?: string | null,
  options: SearchAdsViaSourceOptions = {},
): Promise<SearchResponse> {
  const provider = resolveCommercialDiscoveryProvider(env);
  const routeContext = options.purpose ?? "public_search";

  if (provider === "demo") {
    return normalizeSearchResponse(demoSearch(query, cursor), "demo");
  }

  const cacheKey = buildDiscoveryCacheKey({
    provider,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || "India",
    cursor,
  });
  const cached = env.DB ? await getDiscoveryCacheEntry(env, cacheKey) : null;
  if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
    return {
      ...cached.payload,
      source: provider,
      provider,
      cacheStatus: "hit",
    };
  }

  try {
    const startedAt = Date.now();
    const result =
      provider === "meta_library_browser"
        ? await searchMetaLibraryByBrowser(env, query)
        : normalizeSearchResponse(
            await searchMetaApiAds(env, query, cursor, {
              allowDemoFallback: false,
            }),
            provider,
          );
    const browserMsUsed = Date.now() - startedAt;
    const timestamp = new Date().toISOString();

    if (env.DB) {
      await upsertDiscoveryCacheEntry(env, {
        cacheKey,
        provider,
        routeContext,
        queryFingerprint: fingerprintSavedQuery(query),
        country: query.filters.country || "India",
        cursor: cursor ?? null,
        payload: {
          ...result,
          source: provider,
          provider,
        },
        fetchedAt: timestamp,
        expiresAt: new Date(Date.now() + resolveDiscoveryCacheTtlMs(routeContext)).toISOString(),
        browserMsUsed,
      });
      await createDiscoveryFetchLog(env, {
        provider,
        routeContext,
        queryFingerprint: fingerprintSavedQuery(query),
        country: query.filters.country || "India",
        status: "succeeded",
        cacheStatus: cached ? "stale" : "miss",
        failureClass: null,
        browserMsUsed,
        metadata: {
          cursor: cursor ?? null,
        },
      });
      await upsertDiscoveryProviderState(env, {
        provider,
        status: "healthy",
        failureClass: null,
        summary:
          provider === "meta_library_browser"
            ? "Live commercial discovery running through Browser Run."
            : "Official Meta API is available for limited diagnostic use.",
        lastSuccessAt: timestamp,
        lastFailureAt: null,
        metadata: {
          routeContext,
        },
      });
    }

    return {
      ...result,
      source: provider,
      provider,
      cacheStatus: cached ? "stale" : "miss",
    };
  } catch (error) {
    const failureClass = resolveFailureClass(error);
    const summary =
      cached
        ? "Commercial discovery degraded; serving cached results."
        : provider === "meta_library_browser"
          ? "Commercial discovery degraded and no cached results are available."
          : "Official Meta API diagnostic fetch failed.";
    const timestamp = new Date().toISOString();

    if (env.DB) {
      await createDiscoveryFetchLog(env, {
        provider,
        routeContext,
        queryFingerprint: fingerprintSavedQuery(query),
        country: query.filters.country || "India",
        status: "failed",
        cacheStatus: cached ? "stale" : "miss",
        failureClass,
        browserMsUsed: null,
        metadata: {
          cursor: cursor ?? null,
          errorMessage: error instanceof Error ? error.message : "Unknown discovery error.",
        },
      });
      await upsertDiscoveryProviderState(env, {
        provider,
        status: cached ? "cache_only" : "degraded",
        failureClass,
        summary,
        lastSuccessAt: cached?.fetchedAt ?? null,
        lastFailureAt: timestamp,
        metadata: {
          routeContext,
        },
      });
    }

    if (cached) {
      return {
        ...cached.payload,
        source: provider,
        provider,
        cacheStatus: "stale",
      };
    }

    throw error;
  }
}

function resolveFailureClass(error: unknown): DiscoveryFailureClass {
  if (error instanceof CommercialDiscoveryError) {
    return error.failureClass;
  }

  if (error instanceof MetaApiError) {
    if (error.isRateLimit) {
      return "rate_limited";
    }
    if (error.isAuthError) {
      return "login_wall";
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) {
    return "timeout";
  }

  return "browser_launch_failed";
}
