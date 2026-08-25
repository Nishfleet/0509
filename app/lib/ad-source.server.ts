import {
  createDiscoveryFetchLog,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
} from "~/lib/data.server";
import { hasBrowserRunQuickActions } from "~/lib/browser-run.server";
import {
  mapDiscoveryFailureOutcome,
  recordBrowserJobTelemetry,
  sha256Hex,
  type BrowserJobPlanTier,
  type BrowserJobSource,
} from "~/lib/browser-job-telemetry.server";
import {
  buildDiscoveryCacheKey,
  buildTelemetryCorrelationKey,
  DISCOVERY_ADVERTISER_FILTER_EPOCH,
  normalizeCursorForTelemetry,
  toServableDiscoveryPayload,
  isDiscoveryCacheRouteCompatible,
  isDiscoveryCacheWithinMaxAge,
  isStaleZeroResultDiscoveryCacheEntry,
  resolveDiscoveryCacheTtlMs,
} from "~/lib/discovery-cache.server";
import { resolveE2EFixtureProviderFromEnv } from "~/lib/e2e-provider.server";
import type { AppEnv, BrowserBinding } from "~/lib/env.server";
import {
  searchMetaLibraryByBrowser,
  CommercialDiscoveryError,
  getInteractiveMetaApiExtraPages,
} from "~/lib/meta-library-browser.server";
import { demoSearch, MetaApiError, filterAdsBySearchFilters, searchAds as searchMetaApiAds } from "~/lib/meta-api.server";
import { fingerprintSavedQuery, hashString } from "~/lib/normalize";
import type {
  AdDiscoveryProvider,
  AdRecord,
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
  /**
   * When forceLive is set, still serve a shared discovery_cache_entry whose
   * fetched_at is within this window (cross-workspace scheduled-scan reuse).
   * Interactive search should leave this unset.
   */
  acceptCacheYoungerThanMs?: number;
  customerMetaAdLibraryToken?: string | null;
  cacheKeyOverride?: string | null;
  /**
   * Request ExecutionContext for the cold path: when present, an uncached
   * public search that owns the discovery lease returns the typed warming
   * state immediately and finishes the browser capture in the background.
   * Callers without a request context (tests, scheduled handlers) omit it.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  /**
   * Attribution context recorded in `browser_job_telemetry` (optional).
   * Plan tier applies when the caller knows the actor's plan family;
   * public/anonymous search leaves it null.
   */
  planTier?: BrowserJobPlanTier | null;
  telemetrySource?: BrowserJobSource;
}

/**
 * Meta API interactive public search: follow the real after-cursor for a bounded
 * number of extra pages on the first request. Cursor-based "Load more" stays
 * single-page. Watchlist scans never set interactive=true.
 */
export async function searchMetaApiAdsWithInteractiveDepth(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor: string | null | undefined,
  options: { allowDemoFallback?: boolean; interactive?: boolean },
): Promise<SearchResponse> {
  const first = await searchMetaApiAds(env, query, cursor, {
    allowDemoFallback: options.allowDemoFallback,
  });

  if (!options.interactive || cursor) {
    return first;
  }

  const ads = [...first.ads];
  const seen = new Set(ads.map((ad) => ad.metaAdId));
  let nextCursor = first.nextCursor;
  const extraPages = getInteractiveMetaApiExtraPages();

  for (let page = 0; page < extraPages && nextCursor; page += 1) {
    try {
      const more = await searchMetaApiAds(env, query, nextCursor, {
        allowDemoFallback: options.allowDemoFallback,
      });
      for (const ad of more.ads) {
        if (seen.has(ad.metaAdId)) {
          continue;
        }
        seen.add(ad.metaAdId);
        ads.push(ad);
      }
      nextCursor = more.nextCursor;
    } catch (error) {
      // MINOR: a page-2/3 failure must not discard page 1 results already
      // collected for the interactive public search.
      return {
        ...first,
        ads,
        nextCursor,
        discoveryStatus: "healthy",
        discoveryPartial: true,
        discoverySummary:
          "Some additional Meta results could not be loaded. The results shown are partial; retry to continue from the saved cursor.",
        discoveryFailureClass: resolveMetaApiFailureClass(error),
      };
    }
  }

  return {
    ...first,
    ads,
    nextCursor,
  };
}

const PUBLIC_SEARCH_PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;
const RATE_LIMIT_PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const TIMEOUT_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const PROVIDER_UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1000;
const BROWSER_FAILURE_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
const LOGIN_WALL_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const EXTRACTION_FAILURE_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
// Browser discovery can move from a session attempt through two sequential
// 30-second Quick Actions requests and then a 30-second Browserless fallback.
// Keep the distributed single-flight lease beyond that complete fallback chain
// so a public retry cannot start duplicate work in another isolate.
const DISCOVERY_QUERY_LEASE_TTL_MS = 180 * 1000;
// Cold-path background captures run inside waitUntil, which cancels work that
// has not settled 30s after the response. Hold only a short lease there (and
// renew it while the run is alive) so a canceled run self-heals: the lease
// expires and the next poll re-acquires and runs discovery inline, instead of
// leaving the visitor warming for the full fallback-chain TTL.
const COLD_WARM_DISCOVERY_LEASE_TTL_MS = 60 * 1000;
const COLD_WARM_DISCOVERY_LEASE_HEARTBEAT_MS = 20 * 1000;
const PUBLIC_SEARCH_LEASE_WAIT_MS = 12 * 1000;
const BACKGROUND_LEASE_WAIT_MS = 25 * 1000;
const DISCOVERY_QUERY_LEASE_POLL_MS = 250;
const DISCOVERY_QUERY_LEASE_FRESHNESS_SKEW_MS = 2 * 1000;
const PUBLIC_SEARCH_BROWSER_FAILURE_FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const META_API_FALLBACK_SUMMARY =
  "Browser capture is unavailable right now; showing API fallback results.";
// BET 2 (issue #951): TTL for a PARTIAL discovery cache entry written mid-capture
// (after the initial Ad Library surface, before the interactive scroll). Long
// enough that the scroll finishes and the final write replaces it; short enough
// that a crashed background run does not strand the visitor on a partial set
// forever — the next fresh search re-scrapes once it expires.
const PARTIAL_DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1000;

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
  const fixtureProvider = resolveE2EFixtureProviderFromEnv(env);
  if (fixtureProvider) {
    return fixtureProvider;
  }

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
  // The deterministic local release harness deliberately removes provider
  // bindings. Never rehydrate them from the Worker runtime for that request.
  if (env.E2E_PROVIDER_NETWORK_DENY?.trim() === "1") {
    return env;
  }

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

// Cheap existence check mirroring searchAdsViaSourceResolver's fresh-cache
// hit path (same provider resolution, cache key, and usability rules) without
// running discovery. Used by the search loader to decide whether a selection
// click can skip the rate-limit charge.
export async function hasFreshDiscoveryCacheEntry(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor?: string | null,
  options: Pick<
    SearchAdsViaSourceOptions,
    "cacheKeyOverride" | "customerMetaAdLibraryToken" | "purpose"
  > = {},
): Promise<boolean> {
  const effectiveEnv = await resolveCommercialDiscoveryEnv(env);
  const provider = resolveCommercialDiscoveryProvider(effectiveEnv, {
    customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
  });
  if (provider === "demo" || !effectiveEnv.DB) {
    return false;
  }

  const hasCustomerMetaToken = Boolean(options.customerMetaAdLibraryToken?.trim());
  const baseCacheKey =
    options.cacheKeyOverride ??
    buildDiscoveryCacheKey({
      provider,
      fingerprint: fingerprintSavedQuery(query),
      country: query.filters.country || "all",
      cursor,
    });
  const customerScopedCacheKey = await scopeDiscoveryCacheKeyForCustomerToken(baseCacheKey, {
    customerMetaAdLibraryToken: hasCustomerMetaToken ? options.customerMetaAdLibraryToken : null,
  });
  const cacheKey =
    provider === "meta_api" && customerScopedCacheKey ? customerScopedCacheKey : baseCacheKey;
  const fixtureProvider = resolveE2EFixtureProviderFromEnv(effectiveEnv);
  if (fixtureProvider) {
    const fixtureResult = await (
      await import("~/lib/e2e-search.server")
    ).readE2EFixtureSearchCache(effectiveEnv, cacheKey);
    return fixtureResult?.cacheStatus === "hit";
  }
  const cached = await getDiscoveryCacheEntry(effectiveEnv, cacheKey);
  // Same choke point as the resolver: a route-incompatible entry or a
  // broken-advertiser-filter pre-fix zero is not "fresh", so authenticated
  // search does not skip its live-search budget on an entry the resolver
  // would reject anyway.
  const precheckRouteContext = options.purpose ?? "public_search";
  if (!cached || !isUsableDiscoveryCache(provider, cached, query.mode, precheckRouteContext)) {
    return false;
  }

  return new Date(cached.expiresAt).getTime() > Date.now();
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
  const acceptCacheYoungerThanMs =
    typeof options.acceptCacheYoungerThanMs === "number" &&
    Number.isFinite(options.acceptCacheYoungerThanMs) &&
    options.acceptCacheYoungerThanMs > 0
      ? options.acceptCacheYoungerThanMs
      : null;
  const fixtureProvider = resolveE2EFixtureProviderFromEnv(effectiveEnv);
  const providerState =
    !fixtureProvider &&
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

  const baseCacheKey =
    options.cacheKeyOverride ??
    buildDiscoveryCacheKey({
      provider,
      fingerprint: fingerprintSavedQuery(query),
      country: query.filters.country || "all",
      cursor,
    });
  const customerScopedCacheKey = await scopeDiscoveryCacheKeyForCustomerToken(baseCacheKey, {
    customerMetaAdLibraryToken: hasCustomerMetaToken ? options.customerMetaAdLibraryToken : null,
  });
  const cacheKey =
    provider === "meta_api" && customerScopedCacheKey ? customerScopedCacheKey : baseCacheKey;
  const customerFallbackCacheKey =
    provider === "meta_library_browser" ? customerScopedCacheKey : null;

  // Attribution telemetry context (browser_job_telemetry, migration 0075).
  // One random job_id per top-level request, passed through every provider
  // leg (browser chain, customer Meta API fallback, cache serves). The
  // idempotency key is a SHA-256 of the complete canonical correlation input
  // (provider + query fingerprint + country + paging cursor, cursor bounded
  // first — see buildTelemetryCorrelationKey), so no raw cursor/query
  // material ever reaches the table (the writer also rejects unbounded keys).
  const telemetrySource =
    options.telemetrySource ??
    (routeContext === "public_search" ? "manual" : "scheduled");
  const telemetryCorrelationKey = await buildTelemetryCorrelationKey({
    provider,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || "all",
    cursor,
    cacheKeyOverride: options.cacheKeyOverride ?? null,
  });
  const telemetryContext = {
    jobId: crypto.randomUUID(),
    idempotencyKey: await sha256Hex(telemetryCorrelationKey),
    routeContext,
    planTier: options.planTier ?? null,
    source: telemetrySource,
  };
  const resolverStartedAt = new Date().toISOString();
  // Central attempt counter: browser legs increment it via
  // searchMetaLibraryByBrowser's out-param; later legs (Meta API fallback,
  // post-failure cache serves) continue from where the chain left off.
  const telemetryAttempts = { used: 0 };

  // Cache-only serves (no browser leg ran in this request) are attributed to
  // the `cache` provider. Leg failures keep their own rows, so serves that
  // follow a failed live attempt are NOT re-recorded here (no double count);
  // their attempt number continues the job chain.
  const recordCacheServe = (
    entry: NonNullable<Awaited<ReturnType<typeof getDiscoveryCacheEntry>>>,
    cacheStatus: "hit" | "stale",
    outcome: "succeeded" | "degraded",
    resultCount: number,
  ) => {
    telemetryAttempts.used += 1;
    return recordBrowserJobTelemetry(
      effectiveEnv,
      {
        ...telemetryContext,
        jobKind: "meta_discovery",
        actualProvider: "cache",
        attempt: telemetryAttempts.used,
        startedAt: resolverStartedAt,
        endedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - Date.parse(resolverStartedAt)),
        cacheStatus,
        cacheAgeMs: Math.max(0, Date.now() - Date.parse(entry.fetchedAt)),
        outcome,
        resultCount,
      },
      // When the caller has a real request ExecutionContext, the row write is
      // registered with waitUntil so a slow D1 write still lands after the
      // response (the bounded race still caps how long we wait).
      { executionContext: options.executionContext ?? null },
    );
  };

  if (fixtureProvider) {
    const fixtureResult = await (
      await import("~/lib/e2e-search.server")
    ).readE2EFixtureSearchCache(effectiveEnv, cacheKey);
    if (fixtureResult) {
      return fixtureResult;
    }

    return {
      ads: [],
      nextCursor: null,
      source: fixtureProvider,
      provider: fixtureProvider,
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoverySummary:
        "This deterministic release-proof scenario is not present in the isolated cache.",
      discoveryFailureClass: "browser_unavailable",
    };
  }

  const cached = effectiveEnv.DB ? await getDiscoveryCacheEntry(effectiveEnv, cacheKey) : null;
  // isUsableDiscoveryCache is the single choke point: it rejects
  // route-incompatible entries (FIX-1 — public_search and scheduled scan/warmup
  // must never serve each other) AND broken-advertiser-filter pre-fix zeros.
  // Everything derived from usableCached — fresh hit, forceLive shared hit, and
  // the cooldown/browser/refresh-failure stale fallbacks — inherits both
  // exclusions, so no fallback path can cross routes or serve a known-bad zero.
  const usableCached = isUsableDiscoveryCache(provider, cached, query.mode, routeContext)
    ? cached
    : null;
  const unexpiredCache =
    usableCached && new Date(usableCached.expiresAt).getTime() > Date.now() ? usableCached : null;
  // forceLive path (WP-36): shared scan/warmup cache younger than the caller's
  // cadence window — still a healthy hit so N workspaces pay one scrape.
  const forceLiveSharedHit =
    forceLive &&
    acceptCacheYoungerThanMs != null &&
    usableCached &&
    isDiscoveryCacheWithinMaxAge(usableCached.fetchedAt, acceptCacheYoungerThanMs)
      ? usableCached
      : null;
  const freshCacheHit = !forceLive ? unexpiredCache : forceLiveSharedHit;
  if (freshCacheHit) {
    // BET 2 (issue #951): a partial entry was written mid-capture (initial
    // surface, before the scroll finished). Serve its ads so the first card
    // paints immediately, but PRESERVE the warming/partial flags so the
    // client keeps polling for the final complete write instead of stopping
    // at a "healthy" hit and hiding the in-progress state. The partial TTL
    // (2 min) is short enough that a crashed background run expires and the
    // next fresh search re-scrapes; the final write replaces it sooner.
    if (isPartialDiscoveryCacheEntry(freshCacheHit)) {
      await recordCacheServe(
        freshCacheHit,
        "hit",
        "degraded",
        freshCacheHit.payload.ads.length,
      );
      return {
        ...toServableDiscoveryPayload(freshCacheHit.payload),
        source: provider,
        provider,
        cacheStatus: "hit",
        cacheFetchedAt: freshCacheHit.fetchedAt,
        // Keep warming + degraded so the client renders a real progress state
        // ("N ads so far, loading more…") and keeps polling. The final write
        // clears these flags and the next poll swaps in the complete set.
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
        discoveryPartial: true,
        discoverySummary:
          freshCacheHit.payload.discoverySummary ??
          "Showing the first ads while we load more from the Ad Library.",
        discoveryFailureClass: null,
      };
    }
    await recordCacheServe(freshCacheHit, "hit", "succeeded", freshCacheHit.payload.ads.length);
    return {
      ...toServableDiscoveryPayload(freshCacheHit.payload),
      source: provider,
      provider,
      cacheStatus: "hit",
      cacheFetchedAt: freshCacheHit.fetchedAt,
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
  }

  if (!forceLive && providerState && shouldUseProviderCooldown(providerState)) {
    if (usableCached) {
      await recordCacheServe(usableCached, "stale", "degraded", usableCached.payload.ads.length);
      return {
        ...toServableDiscoveryPayload(usableCached.payload),
        source: provider,
        provider,
        cacheStatus: "stale",
        cacheFetchedAt: usableCached.fetchedAt,
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
        planTier: options.planTier ?? null,
        telemetrySource,
        jobId: telemetryContext.jobId,
        telemetryAttempts,
        executionContext: options.executionContext ?? null,
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
      planTier: options.planTier ?? null,
      telemetrySource,
      jobId: telemetryContext.jobId,
      telemetryAttempts,
      executionContext: options.executionContext ?? null,
    });
    if (apiFallback) {
      return apiFallback;
    }

    if (usableCached) {
      await recordCacheServe(usableCached, "stale", "degraded", usableCached.payload.ads.length);
      return {
        ...toServableDiscoveryPayload(usableCached.payload),
        source: provider,
        provider,
        cacheStatus: "stale",
        cacheFetchedAt: usableCached.fetchedAt,
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
  // COLD-PATH (0509 lane 1): the first public search for an uncached advertiser
  // used to keep the request open for the entire ~20s browser capture before
  // any useful response. When THIS request owns the discovery lease, run the
  // capture in the background (waitUntil) and return immediately; the search
  // page's existing warming poll (5s x 12) picks up the finished cache entry.
  // Two shapes qualify - a true miss (no usable cache entry) returns the typed
  // warming state, and an expired-but-usable entry (no UNEXPIRED entry) returns
  // the older results right away labeled cache_only while the background
  // capture refreshes them. Without the expired-entry shape, the first query
  // after a 15-minute public TTL expiry still ran the capture synchronously and
  // the visitor waited the full ~20s again. forceLive, API, cursor, and
  // background-route behavior is unchanged. The lease owner check happens
  // after acquisition below.
  const wantsBackgroundWarm =
    provider === "meta_library_browser" &&
    routeContext === "public_search" &&
    !forceLive &&
    // No FRESH usable entry: a true miss OR an expired-but-usable entry. When
    // unexpiredCache exists the fresh hit above already returned.
    !unexpiredCache &&
    !cursor &&
    typeof options.executionContext?.waitUntil === "function";
  const discoveryLease =
    canUseDistributedDiscoveryLease(effectiveEnv.DB)
      ? await acquireDiscoveryQueryLease(effectiveEnv, {
          cacheKey,
          provider,
          routeContext,
          // Background captures live inside waitUntil, which cancels work not
          // settled 30s after the response. Hold a shorter lease there and
          // renew it while the run is alive, so a canceled run self-heals.
          leaseTtlMs: wantsBackgroundWarm
            ? COLD_WARM_DISCOVERY_LEASE_TTL_MS
            : DISCOVERY_QUERY_LEASE_TTL_MS,
        })
      : null;
  const canWarmInBackground =
    wantsBackgroundWarm && discoveryLease?.acquired === true;

  if (discoveryLease && !discoveryLease.acquired) {
    const settledResponse = await waitForDiscoveryLeaseResolution(effectiveEnv, {
      cacheKey,
      fallbackCacheKey: customerFallbackCacheKey,
      provider,
      mode: query.mode,
      routeContext,
      waitMs: resolveDiscoveryLeaseWaitMs(routeContext),
      minFetchedAtMs: leaseFreshAfterMs,
      ignoreProviderCooldown: forceLive,
      stopOnProviderCooldown: Boolean(
        forceLive && provider === "meta_library_browser" && options.customerMetaAdLibraryToken?.trim(),
      ),
      stopOnProviderCooldownAfterMs: leaseFreshAfterMs,
      // Cache serves returned by the lease waiter belong to THIS job: they
      // are recorded through the resolver's cache telemetry helper and
      // consume the next value from the same shared attempt allocator.
      recordCacheServe,
    });

    if (settledResponse) {
      return settledResponse;
    }

    if (forceLive && provider === "meta_library_browser" && options.customerMetaAdLibraryToken?.trim()) {
      const apiFallback = await tryMetaApiFallback(effectiveEnv, query, cursor, {
        browserFailureClass: "timeout",
        browserSummary:
          "Commercial discovery is already warming this query; using customer Meta API fallback after waiting.",
        routeContext,
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken,
        planTier: options.planTier ?? null,
        telemetrySource,
        jobId: telemetryContext.jobId,
        telemetryAttempts,
        executionContext: options.executionContext ?? null,
      });
      if (apiFallback) {
        if (effectiveEnv.DB && customerFallbackCacheKey) {
          await publishDiscoveryLeaseFallbackResult(effectiveEnv, {
            cacheKey: customerFallbackCacheKey,
            routeContext,
            query,
            cursor,
            fallback: apiFallback,
          }).catch(() => undefined);
        }
        return apiFallback;
      }
    }

    if (routeContext === "public_search") {
      return {
        ads: [],
        nextCursor: null,
        source: provider,
        provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
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

  const runDiscoveryWithLease = async (): Promise<SearchResponse> => {
    // The background (cold-path) run renews its shorter lease while alive so
    // it cannot be stolen mid-capture; when it is canceled by the waitUntil
    // 30s cap, the lease expires and the next poll re-acquires it.
    const leaseHeartbeat = canWarmInBackground
      ? startDiscoveryLeaseHeartbeat(
          effectiveEnv,
          cacheKey,
          discoveryLease?.holderId ?? null,
        )
      : null;
    // Provider-only timing for the Meta API path: the leg start is captured
    // immediately before the actual provider call — after cursor hashing,
    // provider-state/cache/D1 lookups, and lease work — so the recorded
    // duration never includes pre-provider work. Set right before the call;
    // read in both the success and failure telemetry rows below.
    let metaApiProviderStartedAtMs: number | null = null;
    try {
      const result = await runWithSharedDiscoveryRequest(cacheKey, async () => {
        const startedAt = Date.now();
        let liveResultRaw: SearchResponse;
        if (provider === "meta_library_browser") {
          liveResultRaw = await searchMetaLibraryByBrowser(effectiveEnv, query, {
            // Deep scroll only for interactive public search. Watchlist and
            // scheduled warmup keep the shallow default so DEFAULT_PAGE_BUDGET
            // remains the scan-cost guard.
            mode: routeContext === "public_search" ? "interactive" : "shallow",
            routeContext,
            planTier: options.planTier ?? null,
            source: telemetrySource,
            jobId: telemetryContext.jobId,
            telemetryAttempts,
            executionContext: options.executionContext ?? null,
            // BET 2 (issue #951): progressive streaming. The browser capture
            // fires this with the first batch of ads (initial surface, before
            // the scroll) so the resolver can write a PARTIAL cache entry that
            // the search page's poll paints immediately — first card in
            // seconds, not after the whole scroll. Only armed for the
            // background cold-path warm (canWarmInBackground), where the
            // response already returned and the poll is the only consumer.
            onPartialResults: canWarmInBackground
              ? (partialAds) =>
                  writePartialDiscoveryCacheEntry(effectiveEnv, {
                    cacheKey,
                    provider,
                    routeContext,
                    query,
                    cursor: cursor ?? null,
                    partialAds,
                  })
              : undefined,
          });
        } else {
          metaApiProviderStartedAtMs = Date.now();
          liveResultRaw = normalizeSearchResponse(
            await searchMetaApiAdsWithInteractiveDepth(
              {
                ...effectiveEnv,
                META_AD_LIBRARY_TOKEN: metaApiToken ?? effectiveEnv.META_AD_LIBRARY_TOKEN,
              },
              query,
              cursor,
              {
                allowDemoFallback: false,
                interactive: routeContext === "public_search" && !cursor,
              },
            ),
            provider,
          );
        }
        // Browser scrape only encodes country/query in the Ad Library URL — apply
        // platform/creative/status filters client-side so exposed UI filters work.
        // A usable scrape narrowed to zero ads by those filters is an honest
        // empty result; without the explicit reason it would be misclassified as
        // a provider failure, degrade shared provider health, and burn the
        // gated API fallback on a scrape that actually worked.
        const liveResult = (() => {
          if (provider !== "meta_library_browser") {
            return liveResultRaw;
          }
          const filteredAds = filterAdsBySearchFilters(liveResultRaw.ads, query);
          if (filteredAds.length === 0 && isUsableLiveDiscoveryResult(provider, liveResultRaw)) {
            return { ...liveResultRaw, ads: filteredAds, discoveryEmptyReason: "no_results" as const };
          }
          return { ...liveResultRaw, ads: filteredAds };
        })();
        if (!isUsableLiveDiscoveryResult(provider, liveResult)) {
          throw new CommercialDiscoveryError(
            "Live commercial discovery returned no extractable ad cards.",
            "empty_result",
          );
        }
        const browserMsUsed = Date.now() - startedAt;
        const timestamp = new Date().toISOString();
        const partial = liveResult.discoveryPartial === true;

        // The Meta API path never reaches a browser leg, so its attribution
        // row is recorded here (the browser legs record their own rows).
        if (provider === "meta_api") {
          telemetryAttempts.used += 1;
          await recordBrowserJobTelemetry(
            effectiveEnv,
            {
              ...telemetryContext,
              jobKind: "meta_discovery",
              actualProvider: "customer_meta_api",
              attempt: telemetryAttempts.used,
              // Provider-only window: started immediately before the actual
              // Meta API provider call (see `metaApiProviderStartedAtMs`).
              startedAt:
                metaApiProviderStartedAtMs != null
                  ? new Date(metaApiProviderStartedAtMs).toISOString()
                  : resolverStartedAt,
              endedAt: timestamp,
              durationMs:
                metaApiProviderStartedAtMs != null
                  ? Math.max(0, Date.now() - metaApiProviderStartedAtMs)
                  : Math.max(0, Date.now() - Date.parse(resolverStartedAt)),
              outcome:
                partial ? "degraded"
                : liveResult.ads.length === 0 ? "empty"
                : "succeeded",
              resultCount: liveResult.ads.length,
            },
            { executionContext: options.executionContext ?? null },
          );
        }

        if (effectiveEnv.DB) {
          if (!partial) {
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
                // Writer contract stamp — proves this entry was produced by the
                // current advertiser evidence filter (see epoch doc).
                discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
              },
              fetchedAt: timestamp,
              expiresAt: new Date(Date.now() + resolveDiscoveryCacheTtlMs(routeContext)).toISOString(),
              browserMsUsed,
            });
          }
          await createDiscoveryFetchLog(effectiveEnv, {
            provider,
            routeContext,
            queryFingerprint: fingerprintSavedQuery(query),
            country: query.filters.country || "all",
            status: partial ? "failed" : "succeeded",
            cacheStatus: usableCached ? "stale" : "miss",
            failureClass: liveResult.discoveryFailureClass ?? null,
            browserMsUsed,
            metadata: {
              cursor: cursor ?? null,
              customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
              partial,
            },
          });
          await upsertDiscoveryProviderState(effectiveEnv, {
            provider,
            status: partial ? "degraded" : "healthy",
            failureClass: liveResult.discoveryFailureClass ?? null,
            summary:
              partial
                ? liveResult.discoverySummary ??
                  "Interactive discovery returned partial results."
                : provider === "meta_library_browser"
                ? "Live commercial discovery running through Browser Run."
                : "Official Meta API is available for limited diagnostic use.",
            lastSuccessAt: partial
              ? providerState?.lastSuccessAt ?? usableCached?.fetchedAt ?? null
              : timestamp,
            lastFailureAt: partial ? timestamp : null,
            metadata: {
              customerOwned: provider === "meta_api" ? hasCustomerMetaToken : false,
              partial,
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
        discoveryStatus: result.discoveryStatus ?? "healthy",
        discoveryPartial: result.discoveryPartial ?? false,
        discoverySummary: result.discoverySummary ?? null,
        discoveryFailureClass: result.discoveryFailureClass ?? null,
      };
    } catch (error) {
      const failureClass =
        provider === "meta_api"
          ? resolveMetaApiFailureClass(error)
          : resolveFailureClass(error);
      const timestamp = new Date().toISOString();
      const cooldownState = buildDiscoveryCooldownState(error, failureClass);
      const summary = buildDiscoveryFailureSummary({
        cached: Boolean(usableCached),
        cooldownState,
        failureClass,
        provider,
      });

      // The Meta API path has no browser leg rows; record its failure here.
      if (provider === "meta_api") {
        telemetryAttempts.used += 1;
        await recordBrowserJobTelemetry(
          effectiveEnv,
          {
            ...telemetryContext,
            jobKind: "meta_discovery",
            actualProvider: "customer_meta_api",
            attempt: telemetryAttempts.used,
            // Provider-only window: started immediately before the actual
            // Meta API provider call (see `metaApiProviderStartedAtMs`).
            startedAt:
              metaApiProviderStartedAtMs != null
                ? new Date(metaApiProviderStartedAtMs).toISOString()
                : resolverStartedAt,
            endedAt: timestamp,
            durationMs:
              metaApiProviderStartedAtMs != null
                ? Math.max(0, Date.now() - metaApiProviderStartedAtMs)
                : Math.max(0, Date.now() - Date.parse(resolverStartedAt)),
            outcome: mapDiscoveryFailureOutcome(failureClass),
            resultCount: null,
          },
          { executionContext: options.executionContext ?? null },
        );
      }

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

      if (provider === "meta_library_browser" && (!forceLive || options.customerMetaAdLibraryToken?.trim())) {
        const apiFallback = await tryMetaApiFallback(effectiveEnv, query, cursor, {
          browserFailureClass: failureClass,
          browserSummary: summary,
          routeContext,
          customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
          planTier: options.planTier ?? null,
          telemetrySource,
          jobId: telemetryContext.jobId,
          telemetryAttempts,
          executionContext: options.executionContext ?? null,
        });
        if (apiFallback) {
          if (forceLive && effectiveEnv.DB) {
            await publishDiscoveryLeaseFallbackResult(effectiveEnv, {
              cacheKey: customerFallbackCacheKey ?? cacheKey,
              routeContext,
              query,
              cursor,
              fallback: apiFallback,
            }).catch(() => undefined);
          }
          return apiFallback;
        }
      }

      if (!forceLive && usableCached) {
        // Cache serve after the failed live chain: attributed to the same job
        // and continuing the shared attempt allocator (the browser/API legs
        // already consumed their attempt numbers above).
        await recordCacheServe(usableCached, "stale", "degraded", usableCached.payload.ads.length);
        return {
          ...toServableDiscoveryPayload(usableCached.payload),
          source: provider,
          provider,
          cacheStatus: "stale",
          cacheFetchedAt: usableCached.fetchedAt,
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
    leaseHeartbeat?.stop();
    if (discoveryLease?.acquired) {
      await releaseDiscoveryQueryLease(effectiveEnv, {
        cacheKey,
        holderId: discoveryLease.holderId,
      }).catch(() => undefined);
    }
  }
  };

  if (canWarmInBackground) {
    options.executionContext!.waitUntil(
      runDiscoveryWithLease().catch((error) => {
        // The public-search failure path always returns a response; a rethrow
        // here must never take the isolate down after the response is sent.
        console.warn(
          JSON.stringify({
            event: "public_search_cold_warm_background_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }),
    );

    if (usableCached) {
      // Expired-but-usable entry: paint the older results immediately (labeled
      // cache_only) instead of leaving the visitor on a blank page, and keep
      // the warming flag so the client poll swaps in the finished capture when
      // the background run lands instead of stranding them on old data. The
      // serve is attributed to this job through the cache telemetry helper
      // (the background run shares the same job id and attempt allocator).
      await recordCacheServe(usableCached, "stale", "degraded", usableCached.payload.ads.length);
      return {
        ...toServableDiscoveryPayload(usableCached.payload),
        source: provider,
        provider,
        cacheStatus: "stale",
        cacheFetchedAt: usableCached.fetchedAt,
        discoveryStatus: "cache_only",
        discoveryProgress: "warming",
        discoverySummary:
          "Showing previously captured results while refreshing this query in the background.",
        discoveryFailureClass: null,
      };
    }

    return {
      ads: [],
      nextCursor: null,
      source: provider,
      provider,
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryProgress: "warming",
      discoverySummary:
        "Commercial discovery is warming this query. Results should appear shortly.",
      discoveryFailureClass: null,
    };
  }

  return runDiscoveryWithLease();
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
    planTier?: BrowserJobPlanTier | null;
    telemetrySource?: BrowserJobSource;
    /**
     * Top-level job correlation id from the resolver. REQUIRED: this
     * fallback is a leg of the same job and must never mint its own id.
     */
    jobId: string;
    /**
     * Central attempt counter from the resolver. REQUIRED: the fallback
     * continues from the browser chain; it must never restart at attempt 1.
     */
    telemetryAttempts: { used: number };
    /**
     * Request ExecutionContext when the caller has one; the row write is
     * registered with waitUntil for background completion.
     */
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
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
  // The idempotency key is a SHA-256 of the canonical correlation input
  // (meta_api + query fingerprint + country + paging cursor, cursor bounded
  // first) — the raw cursor and query text never reach the telemetry table.
  const idempotencyKey = await sha256Hex(
    `meta_api:${queryFingerprint}:${country}:${await normalizeCursorForTelemetry(cursor)}`,
  );
  const nextAttempt = input.telemetryAttempts.used + 1;
  const providerState =
    metaApiEnv.DB && !hasCustomerMetaToken
      ? await getDiscoveryProviderState(metaApiEnv, "meta_api")
      : null;
  if (providerState && shouldUseProviderCooldown(providerState)) {
    return null;
  }
  // Provider-only timing: the recorded leg starts immediately before the
  // actual Meta API provider call — after cursor hashing, provider-state/D1
  // lookups, and cooldown checks — so pre-provider work is never included in
  // the recorded duration.
  const fallbackProviderStartedAt = new Date().toISOString();

  try {
    const apiResult = normalizeSearchResponse(
      await searchMetaApiAds(metaApiEnv, query, cursor, {
        allowDemoFallback: false,
      }),
      "meta_api",
    );
    const timestamp = new Date().toISOString();
    input.telemetryAttempts.used = nextAttempt;
    await recordBrowserJobTelemetry(
      metaApiEnv,
      {
        jobId: input.jobId,
        idempotencyKey,
        jobKind: "meta_discovery",
        actualProvider: "customer_meta_api",
        routeContext: input.routeContext,
        planTier: input.planTier ?? null,
        source:
          input.telemetrySource ??
          (input.routeContext === "public_search" ? "manual" : "scheduled"),
        attempt: nextAttempt,
        startedAt: fallbackProviderStartedAt,
        endedAt: timestamp,
        durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(fallbackProviderStartedAt)),
        outcome: apiResult.ads.length === 0 ? "empty" : "succeeded",
        resultCount: apiResult.ads.length,
      },
      { executionContext: input.executionContext ?? null },
    );

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

    input.telemetryAttempts.used = nextAttempt;
    await recordBrowserJobTelemetry(
      metaApiEnv,
      {
        jobId: input.jobId,
        idempotencyKey,
        jobKind: "meta_discovery",
        actualProvider: "customer_meta_api",
        routeContext: input.routeContext,
        planTier: input.planTier ?? null,
        source:
          input.telemetrySource ??
          (input.routeContext === "public_search" ? "manual" : "scheduled"),
        attempt: nextAttempt,
        startedAt: fallbackProviderStartedAt,
        endedAt: timestamp,
        durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(fallbackProviderStartedAt)),
        outcome: mapDiscoveryFailureOutcome(failureClass),
        resultCount: null,
      },
      { executionContext: input.executionContext ?? null },
    );

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
    /**
     * Lease TTL override for the cold-path background capture; defaults to
     * the full fallback-chain TTL for inline discovery.
     */
    leaseTtlMs?: number;
  },
): Promise<DiscoveryQueryLease> {
  const db = env.DB;
  if (!db) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  const holderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(
    Date.now() + (input.leaseTtlMs ?? DISCOVERY_QUERY_LEASE_TTL_MS),
  ).toISOString();
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

/**
 * Cold-path background captures renew their shorter lease every 20s while the
 * capture is alive. If the isolate is terminated by the waitUntil 30s cap, the
 * renewal stops with it and the lease expires ~60s after the last beat, so the
 * next public poll re-acquires the lease and runs discovery inline instead of
 * leaving the visitor warming for the full fallback-chain TTL.
 */
function startDiscoveryLeaseHeartbeat(
  env: AppEnv,
  cacheKey: string,
  holderId: string | null,
) {
  if (!holderId) {
    return null;
  }

  const renew = () => {
    const db = env.DB;
    if (!db) {
      return;
    }

    db.prepare(
      `UPDATE discovery_query_lease
          SET lease_expires_at = ?, updated_at = ?
        WHERE cache_key = ? AND holder_id = ?`,
    )
      .bind(
        new Date(Date.now() + COLD_WARM_DISCOVERY_LEASE_TTL_MS).toISOString(),
        new Date().toISOString(),
        cacheKey,
        holderId,
      )
      .run()
      .catch((error) => {
        if (!isMissingDiscoveryLeaseTableError(error)) {
          console.warn(
            JSON.stringify({
              event: "discovery_lease_heartbeat_failed",
              errorName: error instanceof Error ? error.name : "UnknownError",
            }),
          );
        }
      });
  };

  renew();
  const timer = setInterval(renew, COLD_WARM_DISCOVERY_LEASE_HEARTBEAT_MS);
  return {
    stop() {
      clearInterval(timer);
    },
  };
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
    fallbackCacheKey?: string | null;
    provider: AdDiscoveryProvider;
    mode: string;
    routeContext: DiscoveryRouteContext;
    waitMs: number;
    minFetchedAtMs?: number | null;
    ignoreProviderCooldown?: boolean;
    stopOnProviderCooldown?: boolean;
    stopOnProviderCooldownAfterMs?: number | null;
    /**
     * Resolver-owned cache-serve telemetry callback (see
     * `searchAdsViaSourceResolver.recordCacheServe`). Called for EVERY cache
     * entry this waiter returns so the serve is attributed to the waiter's
     * own job and consumes the next value from the shared attempt allocator.
     */
    recordCacheServe?: (
      entry: DiscoveryCacheEntry,
      cacheStatus: "hit" | "stale",
      outcome: "succeeded" | "degraded",
      resultCount: number,
    ) => Promise<void>;
  },
): Promise<SearchResponse | null> {
  const deadline = Date.now() + input.waitMs;

  while (Date.now() < deadline) {
    const usableCachedEntries = await getUsableDiscoveryLeaseCacheEntries(env, input);
    const freshCached = usableCachedEntries.find(
      (entry) =>
        new Date(entry.expiresAt).getTime() > Date.now() &&
        isDiscoveryLeaseCacheFreshEnough(entry.fetchedAt, input.minFetchedAtMs),
    );
    if (freshCached) {
      await input.recordCacheServe?.(freshCached, "hit", "succeeded", freshCached.payload.ads.length);
      return {
        ...toServableDiscoveryPayload(freshCached.payload),
        source: freshCached.payload.source,
        provider: freshCached.payload.provider,
        cacheStatus: "hit",
        cacheFetchedAt: freshCached.fetchedAt,
        discoveryStatus: "healthy",
        discoverySummary: null,
        discoveryFailureClass: null,
      };
    }

    // Public-search waiter with an expired-but-usable entry: return it right
    // away (labeled cache_only with the warming flag) instead of holding the
    // request until the lease holder finishes or the wait budget expires. The
    // holder is already refreshing this query, and the client's warming poll
    // picks up the fresh entry when it lands. Non-public route contexts keep
    // their existing behavior below (stale only via the provider-cooldown
    // branch).
    if (input.routeContext === "public_search") {
      const staleCached = usableCachedEntries.find((entry) =>
        isDiscoveryLeaseCacheFreshEnough(entry.fetchedAt, input.minFetchedAtMs),
      );
      if (staleCached) {
        await input.recordCacheServe?.(staleCached, "stale", "degraded", staleCached.payload.ads.length);
        return {
          ...toServableDiscoveryPayload(staleCached.payload),
          source: staleCached.payload.source,
          provider: staleCached.payload.provider,
          cacheStatus: "stale",
          cacheFetchedAt: staleCached.fetchedAt,
          discoveryStatus: "cache_only",
          discoveryProgress: "warming",
          discoverySummary:
            "Showing previously captured results while this query refreshes in the background.",
          discoveryFailureClass: null,
        };
      }
    }

    const providerState = await getDiscoveryProviderState(env, input.provider);
    if (
      input.stopOnProviderCooldown &&
      providerState?.updatedAt &&
      shouldUseProviderCooldown(providerState) &&
      isDiscoveryLeaseCacheFreshEnough(providerState.updatedAt, input.stopOnProviderCooldownAfterMs)
    ) {
      return null;
    }
    if (
      !input.ignoreProviderCooldown &&
      providerState &&
      shouldUseProviderCooldown(providerState)
    ) {
      const staleCached = usableCachedEntries.find((entry) =>
        isDiscoveryLeaseCacheFreshEnough(entry.fetchedAt, input.minFetchedAtMs),
      );
      if (staleCached) {
        await input.recordCacheServe?.(staleCached, "stale", "degraded", staleCached.payload.ads.length);
        return {
          ...toServableDiscoveryPayload(staleCached.payload),
          source: staleCached.payload.source,
          provider: staleCached.payload.provider,
          cacheStatus: "stale",
          cacheFetchedAt: staleCached.fetchedAt,
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

    // COLD-PATH (0509 lane 3): a public_search waiter with NO servable entry
    // returns the typed warming state immediately instead of holding the
    // request for the full 12s wait budget. The lease holder's capture cannot
    // land inside that budget anyway (a true-miss capture takes the full
    // fallback chain, far beyond the wait), so the polling loop can never win
    // here: every public waiter without usable content was timing out empty
    // and leaving the first anonymous query for an uncached advertiser waiting
    // ~12s before any useful response. The client's existing 5s x 12 poll
    // picks up the finished capture, exactly like the lease-owner warm path.
    // Provider-cooldown handling above still runs first, so a cooldown summary
    // is never masked by this generic warming copy. Non-public route contexts
    // (watchlist scans, scheduled warmup) keep the full 25s polling loop below
    // — they have no client poll and still benefit from catching a fresh entry
    // mid-wait.
    if (input.routeContext === "public_search") {
      return {
        ads: [],
        nextCursor: null,
        source: input.provider,
        provider: input.provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
        discoverySummary:
          "Commercial discovery is already warming this query. Cached results should appear shortly.",
        discoveryFailureClass: null,
      };
    }

    await sleep(DISCOVERY_QUERY_LEASE_POLL_MS);
  }

  return null;
}

type DiscoveryCacheEntry = NonNullable<Awaited<ReturnType<typeof getDiscoveryCacheEntry>>>;

async function getUsableDiscoveryLeaseCacheEntries(
  env: AppEnv,
  input: {
    cacheKey: string;
    fallbackCacheKey?: string | null;
    provider: AdDiscoveryProvider;
    mode: string;
    routeContext: DiscoveryRouteContext;
  },
): Promise<DiscoveryCacheEntry[]> {
  const cacheKeys =
    input.fallbackCacheKey && input.fallbackCacheKey !== input.cacheKey
      ? [input.cacheKey, input.fallbackCacheKey]
      : [input.cacheKey];
  const entries = await Promise.all(
    cacheKeys.map((cacheKey) => getDiscoveryCacheEntry(env, cacheKey)),
  );

  return entries
    .filter(
      (cached): cached is DiscoveryCacheEntry =>
        // Choke point: excludes route-incompatible entries (a lease waiter on a
        // public search must never resolve a scheduled scan/warmup entry, and
        // vice versa) and broken-advertiser-filter pre-fix zeros, so a lease
        // can never resolve either as a healthy "hit".
        Boolean(cached) &&
        isUsableDiscoveryCache(input.provider, cached, input.mode, input.routeContext),
    )
    .sort(
      (left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime(),
    );
}

async function publishDiscoveryLeaseFallbackResult(
  env: AppEnv,
  input: {
    cacheKey: string;
    routeContext: DiscoveryRouteContext;
    query: NormalizedSavedQuery;
    cursor: string | null | undefined;
    fallback: SearchResponse;
  },
) {
  const timestamp = new Date().toISOString();
  const normalized =
    input.fallback.ads.length === 0 && !input.fallback.discoveryEmptyReason
      ? {
          ...input.fallback,
          discoveryEmptyReason: "no_results" as const,
        }
      : input.fallback;
  // Lease-fallback writer stamps the same contract epoch as the direct writer.
  const payload = { ...normalized, discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH };

  await upsertDiscoveryCacheEntry(env, {
    cacheKey: input.cacheKey,
    provider: "meta_library_browser",
    routeContext: input.routeContext,
    queryFingerprint: fingerprintSavedQuery(input.query),
    country: input.query.filters.country || "all",
    cursor: input.cursor ?? null,
    payload,
    fetchedAt: timestamp,
    expiresAt: new Date(Date.now() + DISCOVERY_QUERY_LEASE_TTL_MS).toISOString(),
    browserMsUsed: null,
  });
}

async function scopeDiscoveryCacheKeyForCustomerToken(
  cacheKey: string,
  options: { customerMetaAdLibraryToken?: string | null },
): Promise<string | null> {
  const token = options.customerMetaAdLibraryToken?.trim();
  if (!token) {
    return null;
  }

  return `${cacheKey}:customer_meta:${await fingerprintCustomerMetaToken(token)}`;
}

async function fingerprintCustomerMetaToken(token: string) {
  if (!globalThis.crypto?.subtle) {
    return hashString(token);
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

/**
 * Single choke point deciding whether a persisted cache entry may be served.
 * Every cache-serving path (fresh hit, forceLive shared hit, provider-cooldown
 * stale fallback, browser-preference fallback, refresh-failure fallback,
 * distributed-lease resolution, and the fresh-cache pre-check) funnels through
 * here, so BOTH cross-cutting exclusions live here and nowhere else:
 *   - route compatibility (FIX-1): interactive public_search and scheduled
 *     scan/warmup share a fingerprint key but must never serve each other —
 *     enforced here so no fallback or lease path can bypass it; and
 *   - the advertiser-filter contract gate: an advertiser/domain zero-result
 *     entry not stamped with the current writer epoch is never usable and
 *     always forces a fresh scrape. `mode` is the request's search mode
 *     (advertiser / keyword / domain); keyword zeros are unaffected
 *     (see DISCOVERY_ADVERTISER_FILTER_EPOCH).
 */
function isUsableDiscoveryCache(
  provider: AdDiscoveryProvider,
  cached: Awaited<ReturnType<typeof getDiscoveryCacheEntry>>,
  mode: string,
  routeContext: DiscoveryRouteContext,
) {
  if (!cached) {
    return false;
  }

  if (!isDiscoveryCacheRouteCompatible(routeContext, cached.routeContext)) {
    return false;
  }

  if (!isUsableLiveDiscoveryResult(provider, cached.payload)) {
    return false;
  }

  if (
    isStaleZeroResultDiscoveryCacheEntry({
      adCount: cached.payload.ads.length,
      mode,
      filterEpoch: cached.payload.discoveryFilterEpoch ?? null,
    })
  ) {
    return false;
  }

  return true;
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

/**
 * BET 2 (issue #951): writes a PARTIAL discovery cache entry mid-capture — the
 * first batch of ads from the initial Ad Library surface, before the
 * interactive scroll finishes. The payload carries `discoveryPartial: true`
 * and `discoveryProgress: "warming"` so the poll-side serve path (below) keeps
 * the client polling and renders a real progress state instead of stopping at
 * a "healthy" hit. The final `upsertDiscoveryCacheEntry` in
 * `runDiscoveryWithLease` replaces this entry (same cache key) with the
 * complete, non-partial result once the scroll lands. Never throws: a failed
 * partial write is a missed streaming opportunity, not a failed search — the
 * background capture keeps running and the final write still lands.
 */
async function writePartialDiscoveryCacheEntry(
  env: AppEnv,
  input: {
    cacheKey: string;
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    query: NormalizedSavedQuery;
    cursor: string | null;
    partialAds: AdRecord[];
  },
): Promise<void> {
  if (!env.DB || input.partialAds.length === 0) {
    return;
  }
  const timestamp = new Date().toISOString();
  try {
    await upsertDiscoveryCacheEntry(env, {
      cacheKey: input.cacheKey,
      provider: input.provider,
      routeContext: input.routeContext,
      queryFingerprint: fingerprintSavedQuery(input.query),
      country: input.query.filters.country || "all",
      cursor: input.cursor,
      payload: {
        ads: input.partialAds,
        nextCursor: null,
        source: input.provider,
        provider: input.provider,
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoveryPartial: true,
        discoveryProgress: "warming",
        discoverySummary:
          "Showing the first ads while we load more from the Ad Library.",
        discoveryFailureClass: null,
        // Writer contract stamp — same as the final write, so a partial entry
        // is never rejected by the broken-advertiser-filter zero-result gate
        // (it carries ads, so it would pass anyway, but the stamp keeps the
        // invariant that every written entry declares its filter contract).
        discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      },
      fetchedAt: timestamp,
      expiresAt: new Date(Date.now() + PARTIAL_DISCOVERY_CACHE_TTL_MS).toISOString(),
      browserMsUsed: null,
    });
  } catch (error) {
    // Swallow: a failed partial write must never abort the background capture.
    // `upsertDiscoveryCacheEntry` already swallows missing-table errors
    // internally; anything else here is a transient D1 blip that the final
    // write (same key) will overwrite when the scroll lands.
    console.warn(
      JSON.stringify({
        event: "public_search_partial_cache_write_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

/**
 * BET 2 (issue #951): a cached entry written mid-capture carries
 * `discoveryPartial: true` in its payload. The fresh-hit path serves it but
 * MUST preserve the warming flag so the client keeps polling for the final
 * (complete) write instead of stopping at a "healthy" hit and hiding the
 * in-progress state.
 */
function isPartialDiscoveryCacheEntry(
  cached: NonNullable<Awaited<ReturnType<typeof getDiscoveryCacheEntry>>>,
): boolean {
  return Boolean(cached.payload?.discoveryPartial);
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

function resolveMetaApiFailureClass(error: unknown): DiscoveryFailureClass {
  const failureClass = resolveFailureClass(error);
  // The shared fallback is browser-specific. Keep opaque API failures in a
  // provider-neutral class so persisted health, cooldowns, and operator copy
  // never claim that the browser path failed.
  return failureClass === "browser_launch_failed" ? "provider_unavailable" : failureClass;
}

function shouldUseProviderCooldown(
  providerState: Awaited<ReturnType<typeof getDiscoveryProviderState>>,
) {
  if (!providerState?.updatedAt) {
    return false;
  }

  // A later-page failure still produced a successful first page. Keep that
  // request visibly degraded without blocking unrelated uncached searches.
  if (providerState.metadata?.partial === true) {
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
    case "provider_unavailable":
      return PROVIDER_UNAVAILABLE_COOLDOWN_MS;
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
