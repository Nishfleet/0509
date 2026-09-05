import type { AppEnv } from "~/lib/env.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import {
  hasFreshDiscoveryCacheEntry,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import { hydrateAdsWithPersistedCreatives } from "~/lib/ad-persistence.server";
import {
  foldDomainLabel,
  parseSearchInputFromWebsiteField,
  registrableDomainFromHostname,
} from "~/lib/search-query";
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
import type {
  AdRecord,
  NormalizedSavedQuery,
  SearchFilters,
  SearchResponse,
} from "~/lib/types";

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
      const v2Query = buildSearchV2SavedQuery(v2Context.queryIntent, options.scope, options.parsed.filters, {
        identityAliases: v2Context.identityAliases,
      });
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
    ? buildSearchV2SavedQuery(v2Context.queryIntent, options.scope, options.parsed.filters, {
        identityAliases: v2Context.identityAliases,
      })
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

/**
 * BET 2 — keyword (`q=`) search tier labels.
 *
 * The v2 domain-match pipeline is gated on `website=`. A bare `q=` keyword
 * search fell through to the v1 pipeline, so every row rendered with no
 * `Verified`/`Likely`/`Unmatched` confidence marker — a buyer searching
 * "goat" saw mouth-tape ads with no way to tell they were unrelated, and a
 * buyer searching "notion" saw 11 ads with no way to tell which 2 were from
 * Notion.
 *
 * This attaches a `domainMatch` object to every keyword-search row so each
 * one renders its tier label (BET 2 never dead-ends; an unmatched row is
 * still a row, labelled as such):
 * - When the keyword resolves to a recognizable brand/domain
 *   (`q=notion.com`), the existing v2 post-filter classifies rows against
 *   that domain (verified / likely / unmatched), matching `/ads/:domain`.
 * - When a bare brand keyword's returned rows land on that brand's own
 *   domain (`q=nike` → ads landing on nike.com), the keyword is resolved to
 *   the real registrable domain present in the results and the rows are
 *   classified against it — so a Nike ad is `verified`, never blanket
 *   `Unmatched`, matching `/ads/nike.com`.
 * - When it is a genuine text keyword with no brand-domain landing evidence
 *   (`q=goat`, mouth-tape ads on no matching site), every row is labelled
 *   `unmatched` (a provider candidate with no brand connection) so the row
 *   still states its confidence instead of hiding it.
 *
 * Reuses `search-v2.server` and `search-domain-match.server` only; no new
 * classifier, no D1 schema change. A failed identity resolution for a
 * domain-like keyword falls back to the unmatched labelling so the search
 * never breaks on a network hiccup.
 */
export async function attachKeywordSearchDomainMatch(
  env: AppEnv,
  result: SearchResponse,
  queryText: string,
  scope: SearchScope,
): Promise<SearchResponse> {
  if (result.ads.length === 0) {
    return result;
  }

  const queryIntent = parseSearchInputFromWebsiteField(queryText);
  // The registrable domain to classify against. An explicit domain keyword is
  // used as-is. A bare brand keyword is promoted to a brand domain when the
  // returned rows land on a domain whose brand label matches, or — when no
  // landing page in the result set carries the brand — to the brand's
  // canonical `.com` domain so the v2 classifier can still resolve the brand
  // (e.g. `q=oura` → oura.com → ouraring.com) instead of blanket-unmatched.
  // The classifier never fabricates a verified label: a row is only marked
  // verified/likely when it actually connects to the resolved domain.
  const classifyInput =
    queryIntent.intent === "domain" && queryIntent.registrableDomain
      ? queryText
      : resolveBareKeywordBrandDomain(queryText, result.ads);
  if (classifyInput) {
    try {
      const context = await buildSearchV2Context(classifyInput, scope);
      if (context) {
        return await applySearchV2PostFilter(env, result, context);
      }
    } catch (error) {
      console.warn("Keyword search V2 classification failed; labelling rows unmatched.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  // Bare keyword (or a domain-like keyword whose context could not be built):
  // no brand website was searched, so nothing connects a provider row to a
  // brand. Every row is an unmatched candidate — still a row, labelled as
  // such, never a silent unlabelled list.
  const providerLabel = result.source === "demo" ? "sample source" : "Meta source";
  const ads = result.ads.map((ad) => ({
    ...ad,
    domainMatch: {
      level: "unverified_provider_candidate",
      reason: `Returned for “${queryText}” by the ${providerLabel}; no brand website was searched, so the connection is unverified`,
      matchedDomain: null,
    },
  }));
  return {
    ...result,
    ads,
    searchIntent: "text",
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: ads.length,
  };
}

/**
 * Resolve a bare brand keyword (q=nike) to the registrable domain the result
 * rows actually land on, when one exists. The north-star rule: never present
 * unverified as verified. So this promotes a bare keyword to a brand domain
 * when the returned provider rows themselves carry a landing page whose
 * registrable domain's brand label exactly matches the folded keyword
 * (nike.com for "nike"). When no landing page in the result set carries the
 * brand, it falls back to the brand's canonical `.com` domain so the v2
 * classifier can still resolve the brand (issue #1452) — the classifier
 * only marks a row verified/likely when it actually connects to that domain,
 * so the fallback never fabricates a verified label. Returns null for
 * multi-word/phrase keywords, anything already domain-like, short labels, or
 * results with no matching landing domain and no safe `.com` fallback — the
 * caller then labels every row unmatched as before.
 */
function resolveBareKeywordBrandDomain(
  keyword: string,
  ads: AdRecord[],
): string | null {
  const trimmed = keyword.trim();
  if (
    !trimmed ||
    trimmed.includes(".") ||
    trimmed.includes("/") ||
    /\s/.test(trimmed)
  ) {
    return null;
  }
  const stem = foldDomainLabel(trimmed);
  if (!stem || stem.length < 3) {
    return null;
  }

  // Tally distinct landing registrable domains across the result rows. Only
  // landing-page hosts are strong enough to promote a keyword to a brand; a
  // missing/absent landing page (or an unmatched domain) leaves the search on
  // the unmatched fallback rather than risking a wrong verified label.
  const tally = new Map<string, number>();
  for (const ad of ads) {
    const host = hostnameFromUrl(ad.landingPageUrl);
    if (!host) {
      continue;
    }
    const registrable = registrableDomainFromHostname(host);
    if (!registrable) {
      continue;
    }
    tally.set(registrable, (tally.get(registrable) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [domain, count] of tally) {
    const label = foldDomainLabel(domain.split(".")[0] ?? "");
    if (label === stem && count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  if (best) {
    return best;
  }

  // No landing page in the result set carries the brand. Fall back to the
  // brand's canonical `.com` domain so the v2 classifier can still resolve
  // the brand (e.g. oura.com → ouraring.com via identity aliases). The
  // classifier only marks a row verified/likely when it actually connects to
  // the resolved domain, so this never presents unverified as verified.
  return `${stem}.com`;
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
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
