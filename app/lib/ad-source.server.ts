import {
  createDiscoveryFetchLog,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
} from "~/lib/data.server";
import { hasBrowserRunQuickActions } from "~/lib/browser-run.server";
import { buildDiscoveryCacheKey, resolveDiscoveryCacheTtlMs } from "~/lib/discovery-cache.server";
import type { AppEnv, BrowserBinding } from "~/lib/env.server";
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
  forceLive?: boolean;
  customerMetaAdLibraryToken?: string | null;
  cacheKeyOverride?: string | null;
}

const PUBLIC_SEARCH_PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;
const RATE_LIMIT_PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const TIMEOUT_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const BROWSER_FAILURE_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const LOGIN_WALL_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const EXTRACTION_FAILURE_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const DISCOVERY_QUERY_LEASE_TTL_MS = 30 * 1000;
const PUBLIC_SEARCH_LEASE_WAIT_MS = 12 * 1000;
const BACKGROUND_LEASE_WAIT_MS = 25 * 1000;
const DISCOVERY_QUERY_LEASE_POLL_MS = 250;
const DISCOVERY_QUERY_LEASE_FRESHNESS_SKEW_MS = 2 * 1000;
const PUBLIC_SEARCH_BROWSER_FAILURE_FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const META_API_FALLBACK_SUMMARY =
  "Browser capture is unavailable right now; showing API fallback results.";

interface DiscoveryCooldownState {
  cooldownUntil: string;
  retryAfterSeconds: number | null;
}

interface DiscoveryQueryLease {
  acquired: boolean;
  holderId: string;
  leaseExpiresAt: string;
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

function envFlagEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function resolveCustomerOwnedMetaToken(
  env: AppEnv,
  options: Pick<SearchAdsViaSourceOptions, "customerMetaAdLibraryToken"> = {},
) {
  const customerToken = options.customerMetaAdLibraryToken?.trim();
  if (customerToken) {
    return customerToken;
  }

  if (envFlagEnabled(env.ALLOW_PLATFORM_META_API_FALLBACK)) {
    return env.META_AD_LIBRARY_TOKEN?.trim() || null;
  }

  return null;
}

export function resolveCommercialDiscoveryProvider(
  env: AppEnv,
  options: Pick<SearchAdsViaSourceOptions, "customerMetaAdLibraryToken"> = {},
): AdDiscoveryProvider {
  if (env.BROWSER || hasBrowserRunQuickActions(env) || env.BROWSERLESS_TOKEN?.trim()) {
    return "meta_library_browser";
  }

  if (resolveCustomerOwnedMetaToken(env, options)) {
    return "meta_api";
  }

  return "demo";
}

function hasBrowserBinding(binding: AppEnv["BROWSER"] | undefined): binding is BrowserBinding {
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
      BROWSERLESS_BQL_URL: env.BROWSERLESS_BQL_URL ?? requestEnv.BROWSERLESS_BQL_URL,
      BROWSERLESS_TOKEN: env.BROWSERLESS_TOKEN ?? requestEnv.BROWSERLESS_TOKEN,
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
      BROWSERLESS_BQL_URL: env.BROWSERLESS_BQL_URL ?? requestEnv.BROWSERLESS_BQL_URL,
      BROWSERLESS_TOKEN: env.BROWSERLESS_TOKEN ?? requestEnv.BROWSERLESS_TOKEN,
      BROWSER_RUN_ACCOUNT_ID: env.BROWSER_RUN_ACCOUNT_ID ?? requestEnv.BROWSER_RUN_ACCOUNT_ID,
      BROWSER_RUN_API_TOKEN: env.BROWSER_RUN_API_TOKEN ?? requestEnv.BROWSER_RUN_API_TOKEN,
      DB: env.DB ?? requestEnv.DB,
      LANDING_PAGE_ARTIFACTS: env.LANDING_PAGE_ARTIFACTS ?? requestEnv.LANDING_PAGE_ARTIFACTS,
      MONITORING_WORKFLOW: env.MONITORING_WORKFLOW ?? requestEnv.MONITORING_WORKFLOW,
    };
  }

  if (requestEnv?.BROWSERLESS_TOKEN?.trim()) {
    return {
      ...requestEnv,
      ...env,
      AI: env.AI ?? requestEnv.AI,
      BROWSERLESS_BQL_URL: env.BROWSERLESS_BQL_URL ?? requestEnv.BROWSERLESS_BQL_URL,
      BROWSERLESS_TOKEN: env.BROWSERLESS_TOKEN ?? requestEnv.BROWSERLESS_TOKEN,
      DB: env.DB ?? requestEnv.DB,
      LANDING_PAGE_ARTIFACTS: env.LANDING_PAGE_ARTIFACTS ?? requestEnv.LANDING_PAGE_ARTIFACTS,
      MONITORING_WORKFLOW: env.MONITORING_WORKFLOW ?? requestEnv.MONITORING_WORKFLOW,
    };
  }

  const runtimeEnv = await getRuntimeWorkerEnv();
  if (
    !hasBrowserBinding(runtimeEnv?.BROWSER) &&
    !hasBrowserRunQuickActions(runtimeEnv) &&
    !runtimeEnv?.BROWSERLESS_TOKEN?.trim()
  ) {
    return env;
  }

  return {
    ...runtimeEnv,
    ...env,
    AI: env.AI ?? runtimeEnv.AI,
    BROWSER: hasBrowserBinding(env.BROWSER) ? env.BROWSER : runtimeEnv.BROWSER,
    BROWSERLESS_BQL_URL: env.BROWSERLESS_BQL_URL ?? runtimeEnv.BROWSERLESS_BQL_URL,
    BROWSERLESS_TOKEN: env.BROWSERLESS_TOKEN ?? runtimeEnv.BROWSERLESS_TOKEN,
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
  const diagnosticMetaProviderState =
    provider === "demo" && effectiveEnv.META_AD_LIBRARY_TOKEN?.trim() && effectiveEnv.DB
      ? await getDiscoveryProviderState(effectiveEnv, "meta_api")
      : null;

  if (providerState || diagnosticMetaProviderState) {
    const state = providerState ?? diagnosticMetaProviderState!;
    const stateProvider = providerState ? provider : "meta_api";
    return {
      status: state.status,
      provider: stateProvider,
      mode:
        state.status === "cache_only"
          ? "cache"
          : stateProvider === "meta_api"
            ? "diagnostic"
            : "live",
      summary: state.summary,
      lastCheckedAt: state.updatedAt,
      lastErrorCode: state.failureClass,
      lastErrorMessage: extractProviderStateErrorMessage(state.metadata),
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

  if (provider === "meta_api" || effectiveEnv.META_AD_LIBRARY_TOKEN?.trim()) {
    return {
      status: "degraded",
      provider: "meta_api",
      mode: "diagnostic",
      summary:
        "Official Meta API is configured for limited diagnostic use. Customer-facing fallback requires a customer-owned Meta connection or an explicit platform-token exception.",
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
  const provider = resolveCommercialDiscoveryProvider(effectiveEnv, {
    customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
  });
  const hasCustomerMetaToken = Boolean(options.customerMetaAdLibraryToken?.trim());
  const metaApiToken = resolveCustomerOwnedMetaToken(effectiveEnv, {
    customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
  });
  const routeContext = options.purpose ?? "public_search";
  const forceLive = options.forceLive === true && provider !== "demo";
  const providerState =
    provider !== "demo" &&
    effectiveEnv.DB &&
    !(provider === "meta_api" && hasCustomerMetaToken)
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

  const cacheKey =
    options.cacheKeyOverride ??
    buildDiscoveryCacheKey({
      provider,
      fingerprint: fingerprintSavedQuery(query),
      country: query.filters.country || "all",
      cursor,
    });
  const cached = effectiveEnv.DB ? await getDiscoveryCacheEntry(effectiveEnv, cacheKey) : null;
  const usableCached = isUsableDiscoveryCache(provider, cached) ? cached : null;
  if (!forceLive && usableCached && new Date(usableCached.expiresAt).getTime() > Date.now()) {
    return {
      ...usableCached.payload,
      source: provider,
      provider,
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
  }

  if (!forceLive && providerState && shouldUseProviderCooldown(providerState)) {
    if (usableCached) {
      return {
        ...usableCached.payload,
        source: provider,
        provider,
        cacheStatus: "stale",
        discoveryStatus: "cache_only",
        discoverySummary: providerState.summary,
        discoveryFailureClass: providerState.failureClass,
      };
    }

    if (routeContext === "public_search") {
      const apiFallback = await tryMetaApiFallback(effectiveEnv, query, cursor, {
        browserFailureClass: providerState.failureClass,
        browserSummary: providerState.summary,
        routeContext,
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
      });
      if (apiFallback) {
        return apiFallback;
      }

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

  if (
    !forceLive &&
    provider === "meta_library_browser" &&
    routeContext === "public_search" &&
    providerState &&
    shouldPreferMetaApiFallbackForPublicSearch(providerState)
  ) {
    const apiFallback = await tryMetaApiFallback(effectiveEnv, query, cursor, {
      browserFailureClass: providerState.failureClass,
      browserSummary: providerState.summary,
      routeContext,
      customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
    });
    if (apiFallback) {
      return apiFallback;
    }

    if (usableCached) {
      return {
        ...usableCached.payload,
        source: provider,
        provider,
        cacheStatus: "stale",
        discoveryStatus: "cache_only",
        discoverySummary: providerState.summary,
        discoveryFailureClass: providerState.failureClass,
      };
    }

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

  const leaseFreshAfterMs = forceLive
    ? Date.now() - DISCOVERY_QUERY_LEASE_FRESHNESS_SKEW_MS
    : null;
  const discoveryLease =
    canUseDistributedDiscoveryLease(effectiveEnv.DB)
      ? await acquireDiscoveryQueryLease(effectiveEnv, {
          cacheKey,
          provider,
          routeContext,
        })
      : null;

  if (discoveryLease && !discoveryLease.acquired) {
    const settledResponse = await waitForDiscoveryLeaseResolution(effectiveEnv, {
      cacheKey,
      provider,
      routeContext,
      waitMs: resolveDiscoveryLeaseWaitMs(routeContext),
      minFetchedAtMs: leaseFreshAfterMs,
      ignoreProviderCooldown: forceLive,
    });

    if (settledResponse) {
      return settledResponse;
    }

    if (routeContext === "public_search") {
      return {
        ads: [],
        nextCursor: null,
        source: provider,
        provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoverySummary:
          "Commercial discovery is already warming this query. Cached results should appear shortly.",
        discoveryFailureClass: null,
      };
    }

    throw new CommercialDiscoveryError(
      "Commercial discovery is already warming this query. Try again in a few seconds.",
      "timeout",
    );
  }

  try {
    const result = await runWithSharedDiscoveryRequest(cacheKey, async () => {
      const startedAt = Date.now();
      const liveResult =
        provider === "meta_library_browser"
          ? await searchMetaLibraryByBrowser(effectiveEnv, query)
          : normalizeSearchResponse(
              await searchMetaApiAds(
                {
                  ...effectiveEnv,
                  META_AD_LIBRARY_TOKEN: metaApiToken ?? effectiveEnv.META_AD_LIBRARY_TOKEN,
                },
                query,
                cursor,
                {
                  allowDemoFallback: false,
                },
              ),
              provider,
            );
      if (!isUsableLiveDiscoveryResult(provider, liveResult)) {
        throw new CommercialDiscoveryError(
          "Live commercial discovery returned no extractable ad cards.",
          "empty_result",
        );
      }
      const browserMsUsed = Date.now() - startedAt;
      const timestamp = new Date().toISOString();

      if (effectiveEnv.DB) {
        await upsertDiscoveryCacheEntry(effectiveEnv, {
          cacheKey,
          provider,
          routeContext,
          queryFingerprint: fingerprintSavedQuery(query),
          country: query.filters.country || "all",
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
          country: query.filters.country || "all",
          status: "succeeded",
          cacheStatus: usableCached ? "stale" : "miss",
          failureClass: null,
          browserMsUsed,
          metadata: {
            cursor: cursor ?? null,
            customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
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
            customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
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
      cached: Boolean(usableCached),
      cooldownState,
      failureClass,
      provider,
    });

    if (effectiveEnv.DB) {
      await createDiscoveryFetchLog(effectiveEnv, {
        provider,
        routeContext,
        queryFingerprint: fingerprintSavedQuery(query),
        country: query.filters.country || "all",
        status: "failed",
        cacheStatus: usableCached ? "stale" : "miss",
        failureClass,
        browserMsUsed: null,
        metadata: {
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          cursor: cursor ?? null,
          customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
          errorMessage: error instanceof Error ? error.message : "Unknown discovery error.",
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
        },
      });
      await upsertDiscoveryProviderState(effectiveEnv, {
        provider,
        status: usableCached ? "cache_only" : "degraded",
        failureClass,
        summary,
        lastSuccessAt: usableCached?.fetchedAt ?? null,
        lastFailureAt: timestamp,
        metadata: {
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
          routeContext,
        },
      });
    }

    if (!forceLive || options.customerMetaAdLibraryToken?.trim()) {
      const apiFallback = await tryMetaApiFallback(effectiveEnv, query, cursor, {
        browserFailureClass: failureClass,
        browserSummary: summary,
        routeContext,
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
      });
      if (apiFallback) {
        return apiFallback;
      }
    }

    if (!forceLive && usableCached) {
      return {
        ...usableCached.payload,
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
  } finally {
    if (discoveryLease?.acquired) {
      await releaseDiscoveryQueryLease(effectiveEnv, {
        cacheKey,
        holderId: discoveryLease.holderId,
      }).catch(() => undefined);
    }
  }
}

async function tryMetaApiFallback(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor: string | null | undefined,
  input: {
    browserFailureClass: DiscoveryFailureClass | null | undefined;
    browserSummary: string | null | undefined;
    routeContext: DiscoveryRouteContext;
    customerMetaAdLibraryToken?: string | null;
  },
): Promise<SearchResponse | null> {
  const metaApiToken = resolveCustomerOwnedMetaToken(env, {
    customerMetaAdLibraryToken: input.customerMetaAdLibraryToken ?? null,
  });
  if (!metaApiToken) {
    return null;
  }

  const metaApiEnv = {
    ...env,
    META_AD_LIBRARY_TOKEN: metaApiToken,
  };
  const hasCustomerMetaToken = Boolean(input.customerMetaAdLibraryToken?.trim());
  const queryFingerprint = fingerprintSavedQuery(query);
  const country = query.filters.country || "all";
  const providerState =
    metaApiEnv.DB && !hasCustomerMetaToken
      ? await getDiscoveryProviderState(metaApiEnv, "meta_api")
      : null;
  if (providerState && shouldUseProviderCooldown(providerState)) {
    return null;
  }

  try {
    const apiResult = normalizeSearchResponse(
      await searchMetaApiAds(metaApiEnv, query, cursor, {
        allowDemoFallback: false,
      }),
      "meta_api",
    );
    const timestamp = new Date().toISOString();

    if (metaApiEnv.DB) {
      await createDiscoveryFetchLog(metaApiEnv, {
        provider: "meta_api",
        routeContext: input.routeContext,
        queryFingerprint,
        country,
        status: "succeeded",
        cacheStatus: "miss",
        failureClass: null,
        browserMsUsed: null,
        metadata: {
          browserFailureClass: input.browserFailureClass ?? null,
          browserSummary: input.browserSummary ?? null,
          cursor: cursor ?? null,
          customerOwned: hasCustomerMetaToken,
          fallbackFor: "meta_library_browser",
        },
      });
      await upsertDiscoveryProviderState(metaApiEnv, {
        provider: "meta_api",
        status: "healthy",
        failureClass: null,
        summary: "Meta Ad Library API fallback is available while browser capture is unavailable.",
        lastSuccessAt: timestamp,
        lastFailureAt: null,
        metadata: {
          customerOwned: hasCustomerMetaToken,
          fallbackFor: "meta_library_browser",
          routeContext: input.routeContext,
        },
      });
    }

    return {
      ...apiResult,
      source: "meta_api",
      provider: "meta_api",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: META_API_FALLBACK_SUMMARY,
      discoveryFailureClass: null,
    };
  } catch (error) {
    const failureClass = resolveFailureClass(error);
    const timestamp = new Date().toISOString();
    const cooldownState = buildDiscoveryCooldownState(error, failureClass);
    const errorMessage = error instanceof Error ? error.message : "Unknown API fallback error.";

    if (metaApiEnv.DB) {
      await createDiscoveryFetchLog(metaApiEnv, {
        provider: "meta_api",
        routeContext: input.routeContext,
        queryFingerprint,
        country,
        status: "failed",
        cacheStatus: "miss",
        failureClass,
        browserMsUsed: null,
        metadata: {
          browserFailureClass: input.browserFailureClass ?? null,
          browserSummary: input.browserSummary ?? null,
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          cursor: cursor ?? null,
          customerOwned: hasCustomerMetaToken,
          errorMessage,
          fallbackFor: "meta_library_browser",
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
        },
      });
      await upsertDiscoveryProviderState(metaApiEnv, {
        provider: "meta_api",
        status: "degraded",
        failureClass,
        summary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
        lastSuccessAt: null,
        lastFailureAt: timestamp,
        metadata: {
          cooldownUntil: cooldownState?.cooldownUntil ?? null,
          customerOwned: hasCustomerMetaToken,
          errorMessage,
          fallbackFor: "meta_library_browser",
          retryAfterSeconds: cooldownState?.retryAfterSeconds ?? null,
          routeContext: input.routeContext,
        },
      });
    }

    return null;
  }
}

function extractProviderStateErrorMessage(metadata: Record<string, unknown> | null | undefined) {
  const errorMessage = metadata?.errorMessage;
  return typeof errorMessage === "string" && errorMessage.trim() ? errorMessage : null;
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

async function acquireDiscoveryQueryLease(
  env: AppEnv,
  input: {
    cacheKey: string;
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
  },
): Promise<DiscoveryQueryLease> {
  const db = env.DB;
  if (!db) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  const holderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + DISCOVERY_QUERY_LEASE_TTL_MS).toISOString();
  let leaseRow: { holder_id: string; lease_expires_at: string } | null | undefined;

  try {
    await db
      .prepare("DELETE FROM discovery_query_lease WHERE cache_key = ? AND lease_expires_at <= ?")
      .bind(input.cacheKey, now)
      .run();
    await db
      .prepare(
        `
          INSERT OR IGNORE INTO discovery_query_lease (
            cache_key,
            provider,
            route_context,
            holder_id,
            lease_expires_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.cacheKey,
        input.provider,
        input.routeContext,
        holderId,
        leaseExpiresAt,
        now,
        now,
      )
      .run();

    leaseRow = await db
      .prepare(
        `
          SELECT holder_id, lease_expires_at
          FROM discovery_query_lease
          WHERE cache_key = ?
          LIMIT 1
        `,
      )
      .bind(input.cacheKey)
      .first<{ holder_id: string; lease_expires_at: string }>();
  } catch (error) {
    if (!isMissingDiscoveryLeaseTableError(error)) {
      throw error;
    }
    leaseRow = {
      holder_id: holderId,
      lease_expires_at: leaseExpiresAt,
    };
  }

  return {
    acquired: leaseRow?.holder_id === holderId,
    holderId: leaseRow?.holder_id ?? holderId,
    leaseExpiresAt: leaseRow?.lease_expires_at ?? leaseExpiresAt,
  };
}

async function releaseDiscoveryQueryLease(
  env: AppEnv,
  input: {
    cacheKey: string;
    holderId: string;
  },
) {
  const db = env.DB;
  if (!db) {
    return;
  }

  await db
    .prepare("DELETE FROM discovery_query_lease WHERE cache_key = ? AND holder_id = ?")
    .bind(input.cacheKey, input.holderId)
    .run()
    .catch((error) => {
      if (!isMissingDiscoveryLeaseTableError(error)) {
        throw error;
      }
    });
}

function canUseDistributedDiscoveryLease(db: AppEnv["DB"] | undefined): db is D1Database {
  return Boolean(db && typeof db.prepare === "function");
}

function isMissingDiscoveryLeaseTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes("discovery_query_lease");
}

async function waitForDiscoveryLeaseResolution(
  env: AppEnv,
  input: {
    cacheKey: string;
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    waitMs: number;
    minFetchedAtMs?: number | null;
    ignoreProviderCooldown?: boolean;
  },
): Promise<SearchResponse | null> {
  const deadline = Date.now() + input.waitMs;

  while (Date.now() < deadline) {
    const cached = await getDiscoveryCacheEntry(env, input.cacheKey);
    const usableCached = isUsableDiscoveryCache(input.provider, cached) ? cached : null;
    if (
      usableCached &&
      new Date(usableCached.expiresAt).getTime() > Date.now() &&
      isDiscoveryLeaseCacheFreshEnough(usableCached.fetchedAt, input.minFetchedAtMs)
    ) {
      return {
        ...usableCached.payload,
        source: input.provider,
        provider: input.provider,
        cacheStatus: "hit",
        discoveryStatus: "healthy",
        discoverySummary: null,
        discoveryFailureClass: null,
      };
    }

    const providerState = await getDiscoveryProviderState(env, input.provider);
    if (
      !input.ignoreProviderCooldown &&
      providerState &&
      shouldUseProviderCooldown(providerState)
    ) {
      if (
        usableCached &&
        isDiscoveryLeaseCacheFreshEnough(usableCached.fetchedAt, input.minFetchedAtMs)
      ) {
        return {
          ...usableCached.payload,
          source: input.provider,
          provider: input.provider,
          cacheStatus: "stale",
          discoveryStatus: "cache_only",
          discoverySummary: providerState.summary,
          discoveryFailureClass: providerState.failureClass,
        };
      }

      if (input.routeContext === "public_search") {
        return {
          ads: [],
          nextCursor: null,
          source: input.provider,
          provider: input.provider,
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

    await sleep(DISCOVERY_QUERY_LEASE_POLL_MS);
  }

  return null;
}

function isDiscoveryLeaseCacheFreshEnough(
  fetchedAt: string,
  minFetchedAtMs: number | null | undefined,
) {
  if (!minFetchedAtMs) {
    return true;
  }

  const fetchedAtMs = Date.parse(fetchedAt);
  return Number.isFinite(fetchedAtMs) && fetchedAtMs >= minFetchedAtMs;
}

function resolveDiscoveryLeaseWaitMs(routeContext: DiscoveryRouteContext) {
  return routeContext === "public_search"
    ? PUBLIC_SEARCH_LEASE_WAIT_MS
    : BACKGROUND_LEASE_WAIT_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUsableDiscoveryCache(
  provider: AdDiscoveryProvider,
  cached: Awaited<ReturnType<typeof getDiscoveryCacheEntry>>,
) {
  if (!cached) {
    return false;
  }

  return isUsableLiveDiscoveryResult(provider, cached.payload);
}

function isUsableLiveDiscoveryResult(
  provider: AdDiscoveryProvider,
  result: Pick<SearchResponse, "ads" | "discoveryEmptyReason">,
) {
  if (provider !== "meta_library_browser") {
    return true;
  }

  return result.ads.length > 0 || result.discoveryEmptyReason === "no_results";
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

function shouldPreferMetaApiFallbackForPublicSearch(
  providerState: Awaited<ReturnType<typeof getDiscoveryProviderState>>,
) {
  if (!providerState?.updatedAt || !providerState.failureClass || providerState.status === "healthy") {
    return false;
  }

  const updatedAtMs = Date.parse(providerState.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs < PUBLIC_SEARCH_BROWSER_FAILURE_FALLBACK_WINDOW_MS;
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
