import type { AppEnv } from "~/lib/env.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import {
  hasFreshDiscoveryCacheEntry,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import { hydrateAdsWithPersistedCreatives } from "~/lib/ad-persistence.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import {
  applySearchV2PostFilter,
  buildSearchV2CacheKey,
  buildSearchV2Context,
  buildSearchV2SavedQuery,
  type SearchScope,
} from "~/lib/search-v2.server";
import {
  buildSearchObservabilityEvent,
  recordSearchObservabilityEvent,
} from "~/lib/search-observability.server";
import {
  resolveSearchRolloutMode,
  shouldApplySearchV2,
  shouldRunSearchV2Shadow,
} from "~/lib/search-rollout.server";
import type { CompetitorWebsiteState } from "~/lib/competitor-website";
import type { BrowserJobPlanTier } from "~/lib/browser-job-telemetry.server";
import type { NormalizedSavedQuery, SearchFilters, SearchResponse } from "~/lib/types";

export interface ExecuteSearchOptions {
  env: AppEnv;
  competitorWebsite: CompetitorWebsiteState;
  parsed: {
    mode: NormalizedSavedQuery["mode"];
    filters: SearchFilters;
    fingerprint: string;
  };
  scope: SearchScope;
  cursor?: string | null;
  forceLive?: boolean;
  customerMetaAdLibraryToken?: string | null;
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  hydratePersisted?: boolean;
  /**
   * Resolved plan family of the signed-in actor, recorded in
   * `browser_job_telemetry`. Anonymous visitors omit it (rows stay unknown).
   */
  planTier?: BrowserJobPlanTier | null;
}

export interface ExecuteSearchResult {
  result: SearchResponse;
  query: NormalizedSavedQuery;
  searchScope: SearchScope;
  displayDomain: string | null;
  relevanceApplied: boolean;
}

export async function executeSearchWithRelevance(options: ExecuteSearchOptions): Promise<ExecuteSearchResult> {
  const rolloutMode = resolveSearchRolloutMode(options.env);
  const applyDomainV2 = Boolean(options.competitorWebsite.raw) && shouldApplySearchV2(options.env);
  const shadowDomainV2 = Boolean(options.competitorWebsite.raw) && shouldRunSearchV2Shadow(options.env);
  const legacyQuery = normalizeSavedQuery(options.parsed.mode, options.parsed.filters);
  const startedAt = Date.now();
  const provider = resolveCommercialDiscoveryProvider(options.env, {
    customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
  });
  const resolverOptions = {
    purpose: "public_search" as const,
    forceLive: options.forceLive,
    // Cold path: let an uncached public search return the warming state
    // immediately while the browser capture finishes via waitUntil.
    executionContext: options.executionContext ?? null,
    // Optional attribution: only attach the plan tier when the caller actually
    // resolved one. Anonymously-scoped searches omit it, which keeps the
    // resolver's `options.planTier ?? null` default (and the call contract that
    // existing callers assert) unchanged for the absent case.
    ...(options.planTier != null ? { planTier: options.planTier } : {}),
    ...(options.customerMetaAdLibraryToken ? { customerMetaAdLibraryToken: options.customerMetaAdLibraryToken } : {}),
  };

  if (shadowDomainV2) {
    const legacyPromise = searchAdsViaSourceResolver(
      options.env,
      legacyQuery,
      options.cursor,
      resolverOptions,
    );
    const comparisonPromise = (async () => {
      const v2Context = await buildSearchV2Context(options.competitorWebsite.raw, options.scope);
      if (!v2Context) return null;
      const v2Query = buildSearchV2SavedQuery(v2Context.queryIntent, options.scope, options.parsed.filters);
      const v2CacheKey = buildSearchV2CacheKey({
        provider,
        intent: v2Context.queryIntent,
        scope: options.scope,
        country: v2Query.filters.country || "all",
        cursor: options.cursor,
      });
      const v2RawResult = await searchAdsViaSourceResolver(options.env, v2Query, options.cursor, {
        ...resolverOptions,
        cacheKeyOverride: v2CacheKey,
      });
      const v2Result = await applySearchV2PostFilter(
        options.env,
        await hydrateSearchCandidates(options.env, v2RawResult, options.hydratePersisted),
        v2Context,
      );
      recordSearchObservabilityEvent(
        buildSearchObservabilityEvent({
          result: v2Result,
          durationMs: Date.now() - startedAt,
          identityResolved: v2Context.identityAliases.length > 0,
        }),
      );
      return v2Result;
    })().catch((error) => {
      console.warn("Search V2 shadow comparison failed; returning the legacy result.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    });
    const legacyResult = await legacyPromise;
    const comparisonTask = comparisonPromise.then((v2Result) => {
      if (!v2Result) return;
      console.info(JSON.stringify({
        kind: "search_v2_shadow",
        mode: rolloutMode,
        legacyCount: legacyResult.ads.length,
        v2VerifiedCount: v2Result.verifiedCount,
        v2RejectedKeywordOnlyCount: v2Result.rejectedKeywordOnlyCount,
        ts: new Date().toISOString(),
      }));
    });
    if (options.executionContext) {
      options.executionContext.waitUntil(comparisonTask);
    } else {
      void comparisonTask;
    }

    return {
      result: legacyResult,
      query: legacyQuery,
      searchScope: options.scope,
      displayDomain: options.competitorWebsite.host,
      relevanceApplied: false,
    };
  }

  const v2Context = applyDomainV2
    ? await buildSearchV2Context(options.competitorWebsite.raw, options.scope)
    : null;

  const query = applyDomainV2 && v2Context
    ? buildSearchV2SavedQuery(v2Context.queryIntent, options.scope, options.parsed.filters)
    : legacyQuery;

  const cacheKeyOverride =
    applyDomainV2 && v2Context
      ? buildSearchV2CacheKey({
          provider,
          intent: v2Context.queryIntent,
          scope: options.scope,
          country: query.filters.country || "all",
          cursor: options.cursor,
        })
      : null;

  const rawResult = await searchAdsViaSourceResolver(options.env, query, options.cursor, {
    ...resolverOptions,
    cacheKeyOverride,
  });

  if (!applyDomainV2 || !v2Context) {
    return {
      result: rawResult,
      query,
      searchScope: options.scope,
      displayDomain: options.competitorWebsite.host,
      relevanceApplied: false,
    };
  }

  const v2Result = await applySearchV2PostFilter(
    options.env,
    await hydrateSearchCandidates(options.env, rawResult, options.hydratePersisted),
    v2Context,
  );
  recordSearchObservabilityEvent(
    buildSearchObservabilityEvent({
      result: v2Result,
      durationMs: Date.now() - startedAt,
      identityResolved: v2Context.identityAliases.length > 0,
    }),
  );

  return {
    result: v2Result,
    query,
    searchScope: options.scope,
    displayDomain: v2Context.displayDomain,
    relevanceApplied: true,
  };
}

export type SearchCacheProbeOptions = Omit<ExecuteSearchOptions, "forceLive">;

// Answers "would this loader request be served from the discovery cache?"
// without running the pipeline: it re-derives the exact query and cache key
// the execution path would use (v2 domain override or legacy fingerprint) and
// does a single cache existence check. The search loader uses it so selecting
// an ad from already-rendered results does not burn the search rate limit.
// Skipped identity resolution is safe here: the v2 cache key only depends on
// the parsed query intent, never on resolved aliases.
export async function hasWarmSearchCacheEntry(options: SearchCacheProbeOptions): Promise<boolean> {
  try {
    const isShadow = shouldRunSearchV2Shadow(options.env);
    const queryIntent =
      shouldApplySearchV2(options.env) &&
      options.competitorWebsite.raw
        ? parseSearchInputFromWebsiteField(options.competitorWebsite.raw)
        : null;
    const useDomainV2 = Boolean(
      queryIntent && queryIntent.intent === "domain" && queryIntent.registrableDomain,
    );

    const v2Query =
      useDomainV2 && queryIntent
        ? buildSearchV2SavedQuery(queryIntent, options.scope, options.parsed.filters)
        : normalizeSavedQuery(options.parsed.mode, options.parsed.filters);
    const legacyQuery = normalizeSavedQuery(options.parsed.mode, options.parsed.filters);

    if (isShadow) {
      return await hasFreshDiscoveryCacheEntry(options.env, legacyQuery, options.cursor, {
        cacheKeyOverride: null,
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
      });
    }

    const cacheKeyOverride =
      useDomainV2 && queryIntent
        ? buildSearchV2CacheKey({
            provider: resolveCommercialDiscoveryProvider(options.env, {
              customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
            }),
            intent: queryIntent,
            scope: options.scope,
            country: v2Query.filters.country || "all",
            cursor: options.cursor,
          })
        : null;

    return await hasFreshDiscoveryCacheEntry(options.env, v2Query, options.cursor, {
      cacheKeyOverride,
      customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
    });
  } catch (error) {
    // A failed probe must fail toward charging the limit, never toward a 500.
    console.warn("Search cache probe failed; charging the rate limit.", error);
    return false;
  }
}

async function hydrateSearchCandidates(
  env: AppEnv,
  result: SearchResponse,
  hydratePersisted = true,
) {
  if (!hydratePersisted || !env.DB || result.ads.length === 0) return result;
  return {
    ...result,
    ads: await hydrateAdsWithPersistedCreatives(env, result.ads),
  };
}
