import {
  createDiscoveryFetchLog,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
} from "~/lib/data.server";
import { hasBrowserRunQuickActions } from "~/lib/browser-run.server";
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

const PUBLIC_SEARCH_PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;
const RATE_LIMIT_PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const TIMEOUT_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const BROWSER_FAILURE_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const LOGIN_WALL_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const EXTRACTION_FAILURE_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;

interface DiscoveryCooldownState {
  cooldownUntil: string;
  retryAfterSeconds: number | null;
}

type GlobalEnvCarrier = typeof globalThis & {
  __APP_REQUEST_ENV__?: AppEnv;
  __0509InFlightDiscovery__?: Map<string, Promise<SearchResponse>>;
};

let runtimeWorkerEnvPromise: Promise<AppEnv | null> | null = null;

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
  if (env.BROWSER || hasBrowserRunQuickActions(env)) {
    return "meta_library_browser";
  }

  if (env.META_AD_LIBRARY_TOKEN) {
    return "meta_api";
  }

  return "demo";
}

function hasBrowserBinding(binding: AppEnv["BROWSER"] | undefined): binding is Fetcher {
  return Boolean(binding && typeof binding.fetch === "function");
}

async function getRuntimeWorkerEnv(): Promise<AppEnv | null> {
  if (!runtimeWorkerEnvPromise) {
    runtimeWorkerEnvPromise = import("cloudflare:workers")
      .then((runtimeModule) => ((runtimeModule as { env?: AppEnv }).env ?? null))
      .catch(() => null);
  }

  return runtimeWorkerEnvPromise;
}

async function resolveCommercialDiscoveryEnv(env: AppEnv): Promise<AppEnv> {
  if (env.BROWSER) {
    return env;
  }

  const requestEnv = (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ ?? null;
  if (requestEnv?.BROWSER) {
    return {
      ...requestEnv,
      ...env,
      AI: env.AI ?? requestEnv.AI,
      BROWSER: requestEnv.BROWSER,
      BROWSER_RUN_ACCOUNT_ID: env.BROWSER_RUN_ACCOUNT_ID ?? requestEnv.BROWSER_RUN_ACCOUNT_ID,
      BROWSER_RUN_API_TOKEN: env.BROWSER_RUN_API_TOKEN ?? requestEnv.BROWSER_RUN_API_TOKEN,
      DB: env.DB ?? requestEnv.DB,
      LANDING_PAGE_ARTIFACTS: env.LANDING_PAGE_ARTIFACTS ?? requestEnv.LANDING_PAGE_ARTIFACTS,
      MONITORING_WORKFLOW: env.MONITORING_WORKFLOW ?? requestEnv.MONITORING_WORKFLOW,
    };
  }

  if (hasBrowserRunQuickActions(requestEnv)) {
    return {
      ...requestEnv,
      ...env,
      AI: env.AI ?? requestEnv.AI,
      BROWSER_RUN_ACCOUNT_ID: env.BROWSER_RUN_ACCOUNT_ID ?? requestEnv.BROWSER_RUN_ACCOUNT_ID,
      BROWSER_RUN_API_TOKEN: env.BROWSER_RUN_API_TOKEN ?? requestEnv.BROWSER_RUN_API_TOKEN,
      DB: env.DB ?? requestEnv.DB,
      LANDING_PAGE_ARTIFACTS: env.LANDING_PAGE_ARTIFACTS ?? requestEnv.LANDING_PAGE_ARTIFACTS,
      MONITORING_WORKFLOW: env.MONITORING_WORKFLOW ?? requestEnv.MONITORING_WORKFLOW,
    };
  }

  const runtimeEnv = await getRuntimeWorkerEnv();
  if (!hasBrowserBinding(runtimeEnv?.BROWSER) && !hasBrowserRunQuickActions(runtimeEnv)) {
    return env;
  }

  return {
    ...runtimeEnv,
    ...env,
    AI: env.AI ?? runtimeEnv.AI,
    BROWSER: hasBrowserBinding(env.BROWSER) ? env.BROWSER : runtimeEnv.BROWSER,
    BROWSER_RUN_ACCOUNT_ID: env.BROWSER_RUN_ACCOUNT_ID ?? runtimeEnv.BROWSER_RUN_ACCOUNT_ID,
    BROWSER_RUN_API_TOKEN: env.BROWSER_RUN_API_TOKEN ?? runtimeEnv.BROWSER_RUN_API_TOKEN,
    DB: env.DB ?? runtimeEnv.DB,
    LANDING_PAGE_ARTIFACTS: env.LANDING_PAGE_ARTIFACTS ?? runtimeEnv.LANDING_PAGE_ARTIFACTS,
    MONITORING_WORKFLOW: env.MONITORING_WORKFLOW ?? runtimeEnv.MONITORING_WORKFLOW,
  };
}

export async function resolveCommercialAdSourceStatus(
  env: AppEnv,
): Promise<MetaIntegrationStatus> {
  const effectiveEnv = await resolveCommercialDiscoveryEnv(env);
  const provider = resolveCommercialDiscoveryProvider(effectiveEnv);
  const providerState =
    provider !== "demo" && effectiveEnv.DB
      ? await getDiscoveryProviderState(effectiveEnv, provider)
      : null;

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
  const effectiveEnv = await resolveCommercialDiscoveryEnv(env);
  const provider = resolveCommercialDiscoveryProvider(effectiveEnv);
  const routeContext = options.purpose ?? "public_search";
  const providerState =
    provider !== "demo" && effectiveEnv.DB
      ? await getDiscoveryProviderState(effectiveEnv, provider)
      : null;

  if (provider === "demo") {
    return {
      ...normalizeSearchResponse(demoSearch(query, cursor), "demo"),
      discoveryStatus: "demo",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
  }

  const cacheKey = buildDiscoveryCacheKey({
    provider,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || "India",
    cursor,
  });
  const cached = effectiveEnv.DB ? await getDiscoveryCacheEntry(effectiveEnv, cacheKey) : null;
  if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
    return {
      ...cached.payload,
      source: provider,
      provider,
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
  }

  if (providerState && shouldUseProviderCooldown(providerState)) {
    if (cached) {
      return {
        ...cached.payload,
        source: provider,
        provider,
        cacheStatus: "stale",
        discoveryStatus: "cache_only",
        discoverySummary: providerState.summary,
        discoveryFailureClass: providerState.failureClass,
      };
    }

    if (routeContext === "public_search") {
      return {
        ads: [],
        nextCursor: null,
        source: provider,
        provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoverySummary: providerState.summary,
        discoveryFailureClass: providerState.failureClass,
      };
    }

    throw new CommercialDiscoveryError(
      providerState.summary,
      providerState.failureClass ?? "browser_launch_failed",
    );
  }

  try {
    const result = await runWithSharedDiscoveryRequest(cacheKey, async () => {
      const startedAt = Date.now();
      const liveResult =
        provider === "meta_library_browser"
          ? await searchMetaLibraryByBrowser(effectiveEnv, query)
          : normalizeSearchResponse(
              await searchMetaApiAds(effectiveEnv, query, cursor, {
                allowDemoFallback: false,
              }),
              provider,
            );
      const browserMsUsed = Date.now() - startedAt;
      const timestamp = new Date().toISOString();

      if (effectiveEnv.DB) {
        await upsertDiscoveryCacheEntry(effectiveEnv, {
          cacheKey,
          provider,
          routeContext,
          queryFingerprint: fingerprintSavedQuery(query),
          country: query.filters.country || "India",
          cursor: cursor ?? null,
          payload: {
            ...liveResult,
            source: provider,
            provider,
          },
          fetchedAt: timestamp,
          expiresAt: new Date(Date.now() + resolveDiscoveryCacheTtlMs(routeContext)).toISOString(),
          browserMsUsed,
        });
        await createDiscoveryFetchLog(effectiveEnv, {
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
        await upsertDiscoveryProviderState(effectiveEnv, {
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

      return liveResult;
    });

    return {
      ...result,
      source: provider,
      provider,
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
  } catch (error) {
    const failureClass = resolveFailureClass(error);
    const timestamp = new Date().toISOString();
    const cooldownState = buildDiscoveryCooldownState(error, failureClass);
    const summary = buildDiscoveryFailureSummary({
      cached: Boolean(cached),
      cooldownState,
      failureClass,
      provider,
    });

    if (effectiveEnv.DB) {
      await createDiscoveryFetchLog(effectiveEnv, {
        provider,
        routeContext,
        queryFingerprint: fingerprintSavedQuery(query),
        country: query.filters.country || "India",
        status: "failed",
        cacheStatus: cached ? "stale" : "miss",
        failureClass,
        browserMsUsed: null,
        metadata: {
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          cursor: cursor ?? null,
          errorMessage: error instanceof Error ? error.message : "Unknown discovery error.",
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
        },
      });
      await upsertDiscoveryProviderState(effectiveEnv, {
        provider,
        status: cached ? "cache_only" : "degraded",
        failureClass,
        summary,
        lastSuccessAt: cached?.fetchedAt ?? null,
        lastFailureAt: timestamp,
        metadata: {
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
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
        discoveryStatus: "cache_only",
        discoverySummary: summary,
        discoveryFailureClass: failureClass,
      };
    }

    if (routeContext === "public_search") {
      return {
        ads: [],
        nextCursor: null,
        source: provider,
        provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoverySummary: summary,
        discoveryFailureClass: failureClass,
      };
    }

    throw error;
  }
}

function getInFlightDiscoveryMap() {
  const carrier = globalThis as GlobalEnvCarrier;
  if (!carrier.__0509InFlightDiscovery__) {
    carrier.__0509InFlightDiscovery__ = new Map<string, Promise<SearchResponse>>();
  }

  return carrier.__0509InFlightDiscovery__;
}

async function runWithSharedDiscoveryRequest(
  cacheKey: string,
  fn: () => Promise<SearchResponse>,
) {
  const inFlightDiscovery = getInFlightDiscoveryMap();
  const existing = inFlightDiscovery.get(cacheKey);
  if (existing) {
    return existing;
  }

  const pending = fn().finally(() => {
    if (inFlightDiscovery.get(cacheKey) === pending) {
      inFlightDiscovery.delete(cacheKey);
    }
  });
  inFlightDiscovery.set(cacheKey, pending);
  return pending;
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
  if (message.includes("rate limit") || message.includes("429")) {
    return "rate_limited";
  }
  if (message.includes("timeout")) {
    return "timeout";
  }

  return "browser_launch_failed";
}

function shouldUseProviderCooldown(
  providerState: Awaited<ReturnType<typeof getDiscoveryProviderState>>,
) {
  if (!providerState?.updatedAt) {
    return false;
  }

  if (!providerState.failureClass || providerState.status === "healthy") {
    return false;
  }

  const cooldownUntil = resolveProviderCooldownUntil(providerState);
  if (cooldownUntil) {
    return Date.now() < cooldownUntil.getTime();
  }

  const updatedAtMs = Date.parse(providerState.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs < PUBLIC_SEARCH_PROVIDER_COOLDOWN_MS;
}

function buildDiscoveryCooldownState(
  error: unknown,
  failureClass: DiscoveryFailureClass,
): DiscoveryCooldownState | null {
  const cooldownMs = resolveDiscoveryCooldownMs(failureClass, error);
  if (!cooldownMs) {
    return null;
  }

  return {
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
    retryAfterSeconds: resolveRetryAfterSeconds(error),
  };
}

function buildDiscoveryFailureSummary(input: {
  cached: boolean;
  cooldownState: DiscoveryCooldownState | null;
  failureClass: DiscoveryFailureClass;
  provider: AdDiscoveryProvider;
}) {
  if (input.provider === "meta_api") {
    return "Official Meta API diagnostic fetch failed.";
  }

  const retryLabel = formatRetryAfterLabel(input.cooldownState?.retryAfterSeconds ?? null);
  const retryClause = retryLabel ? ` Retrying after about ${retryLabel}.` : "";

  if (input.failureClass === "rate_limited") {
    return input.cached
      ? `Commercial discovery rate limited; serving cached results.${retryClause}`
      : `Commercial discovery rate limited and no cached results are available.${retryClause}`;
  }

  return input.cached
    ? `Commercial discovery degraded; serving cached results.${retryClause}`
    : `Commercial discovery degraded and no cached results are available.${retryClause}`;
}

function formatRetryAfterLabel(retryAfterSeconds: number | null) {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return null;
  }

  if (retryAfterSeconds < 60) {
    return `${retryAfterSeconds}s`;
  }

  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function resolveDiscoveryCooldownMs(
  failureClass: DiscoveryFailureClass,
  error: unknown,
) {
  const retryAfterSeconds = resolveRetryAfterSeconds(error);
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  switch (failureClass) {
    case "rate_limited":
      return RATE_LIMIT_PROVIDER_COOLDOWN_MS;
    case "timeout":
      return TIMEOUT_PROVIDER_COOLDOWN_MS;
    case "login_wall":
      return LOGIN_WALL_PROVIDER_COOLDOWN_MS;
    case "selector_drift":
    case "empty_result":
      return EXTRACTION_FAILURE_PROVIDER_COOLDOWN_MS;
    case "browser_unavailable":
    case "browser_launch_failed":
      return BROWSER_FAILURE_PROVIDER_COOLDOWN_MS;
    default:
      return PUBLIC_SEARCH_PROVIDER_COOLDOWN_MS;
  }
}

function resolveProviderCooldownUntil(
  providerState: Awaited<ReturnType<typeof getDiscoveryProviderState>>,
) {
  const rawCooldownUntil = providerState?.metadata?.cooldownUntil;
  if (typeof rawCooldownUntil !== "string" || !rawCooldownUntil.trim()) {
    return null;
  }

  const cooldownUntil = new Date(rawCooldownUntil);
  return Number.isNaN(cooldownUntil.getTime()) ? null : cooldownUntil;
}

function resolveRetryAfterSeconds(error: unknown) {
  return error instanceof CommercialDiscoveryError && error.retryAfterSeconds && error.retryAfterSeconds > 0
    ? error.retryAfterSeconds
    : null;
}
