import type { AppEnv } from "~/lib/env.server";
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import {
  hasFreshDiscoveryCacheEntry,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
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
}

export interface ExecuteSearchResult {
  result: SearchResponse;
  query: NormalizedSavedQuery;
  searchScope: SearchScope;
  displayDomain: string | null;
}

export async function executeSearchWithRelevance(options: ExecuteSearchOptions): Promise<ExecuteSearchResult> {
  const rolloutMode = resolveSearchRolloutMode(options.env);
  const v2Context = options.competitorWebsite.raw
    ? await buildSearchV2Context(options.competitorWebsite.raw, options.scope)
    : null;

  const useDomainV2 = Boolean(v2Context) && (shouldApplySearchV2(options.env) || shouldRunSearchV2Shadow(options.env));

  const query = useDomainV2 && v2Context
    ? buildSearchV2SavedQuery(v2Context.queryIntent, options.scope, options.parsed.filters)
    : normalizeSavedQuery(options.parsed.mode, options.parsed.filters);

  const fingerprint = fingerprintSavedQuery(query);
  const startedAt = Date.now();
  const provider = resolveCommercialDiscoveryProvider(options.env, {
    customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
  });

  const cacheKeyOverride =
    useDomainV2 && v2Context
      ? buildSearchV2CacheKey({
          provider,
          intent: v2Context.queryIntent,
          scope: options.scope,
          country: query.filters.country || "all",
          cursor: options.cursor,
        })
      : null;

  const rawResult = await searchAdsViaSourceResolver(options.env, query, options.cursor, {
    purpose: "public_search",
    forceLive: options.forceLive,
    cacheKeyOverride,
    ...(options.customerMetaAdLibraryToken ? { customerMetaAdLibraryToken: options.customerMetaAdLibraryToken } : {}),
  });

  if (!useDomainV2 || !v2Context) {
    return {
      result: rawResult,
      query,
      searchScope: options.scope,
      displayDomain: options.competitorWebsite.host,
    };
  }

  const v2Result = await applySearchV2PostFilter(options.env, rawResult, v2Context);
  recordSearchObservabilityEvent(
    buildSearchObservabilityEvent({
      result: v2Result,
      durationMs: Date.now() - startedAt,
      identityResolved: v2Context.identityAliases.length > 0,
    }),
  );

  if (shouldRunSearchV2Shadow(options.env) && !shouldApplySearchV2(options.env)) {
    console.info(
      JSON.stringify({
        kind: "search_v2_shadow",
        mode: rolloutMode,
        legacyCount: rawResult.ads.length,
        v2VerifiedCount: v2Result.verifiedCount,
        v2RejectedKeywordOnlyCount: v2Result.rejectedKeywordOnlyCount,
        domain: v2Context.displayDomain,
        ts: new Date().toISOString(),
      }),
    );

    return {
      result: rawResult,
      query,
      searchScope: options.scope,
      displayDomain: v2Context.displayDomain,
    };
  }

  return {
    result: v2Result,
    query,
    searchScope: options.scope,
    displayDomain: v2Context.displayDomain,
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
    const queryIntent =
      shouldApplySearchV2(options.env) && options.competitorWebsite.raw
        ? parseSearchInputFromWebsiteField(options.competitorWebsite.raw)
        : null;
    const useDomainV2 = Boolean(
      queryIntent && queryIntent.intent === "domain" && queryIntent.registrableDomain,
    );

    const query =
      useDomainV2 && queryIntent
        ? buildSearchV2SavedQuery(queryIntent, options.scope, options.parsed.filters)
        : normalizeSavedQuery(options.parsed.mode, options.parsed.filters);

    const cacheKeyOverride =
      useDomainV2 && queryIntent
        ? buildSearchV2CacheKey({
            provider: resolveCommercialDiscoveryProvider(options.env, {
              customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
            }),
            intent: queryIntent,
            scope: options.scope,
            country: query.filters.country || "all",
            cursor: options.cursor,
          })
        : null;

    return await hasFreshDiscoveryCacheEntry(options.env, query, options.cursor, {
      cacheKeyOverride,
      customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
    });
  } catch (error) {
    // A failed probe must fail toward charging the limit, never toward a 500.
    console.warn("Search cache probe failed; charging the rate limit.", error);
    return false;
  }
}
