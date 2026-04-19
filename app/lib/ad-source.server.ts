import { demoSearch, searchAds as searchMetaApiAds } from "~/lib/meta-api.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  AdDiscoveryProvider,
  MetaIntegrationStatus,
  NormalizedSavedQuery,
  SearchResponse,
} from "~/lib/types";

export interface SearchAdsViaSourceOptions {
  allowDemoFallback?: boolean;
  purpose?: "public_search" | "watchlist_scan";
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
  if (env.META_AD_LIBRARY_TOKEN) {
    return "meta_api";
  }

  return "demo";
}

export async function resolveCommercialAdSourceStatus(
  env: AppEnv,
): Promise<MetaIntegrationStatus> {
  const provider = resolveCommercialDiscoveryProvider(env);

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

  if (provider === "meta_api") {
    const result = await searchMetaApiAds(env, query, cursor, {
      allowDemoFallback: options.allowDemoFallback,
    });
    return normalizeSearchResponse(result, provider);
  }

  return normalizeSearchResponse(demoSearch(query, cursor), "demo");
}
