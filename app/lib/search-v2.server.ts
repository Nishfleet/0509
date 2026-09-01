import type { AppEnv } from "~/lib/env.server";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  classifyDomainMatches,
  dedupeDomainMatches,
  rankDomainMatches,
  type DomainMatchedAd,
} from "~/lib/search-domain-match.server";
import { normalizeNumericPageId } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField, type ParsedSearchQuery } from "~/lib/search-query";
import { resolveWebsiteIdentity } from "~/lib/website-identity.server";
import type { AdRecord, NormalizedSavedQuery, SearchResponse } from "~/lib/types";

export type SearchScope = "exact" | "broader";

export interface SearchV2Context {
  queryIntent: ParsedSearchQuery;
  scope: SearchScope;
  displayDomain: string;
  identityAliases: string[];
  domainAliases: string[];
}

export interface SearchV2Result extends SearchResponse {
  searchIntent: ParsedSearchQuery["intent"];
  searchScope: SearchScope;
  displayDomain: string | null;
  verifiedCount: number;
  likelyCount: number;
  unmatchedCount: number;
  rawCandidateCount: number;
  broaderCandidateCount: number;
  missingVerificationCount: number;
  rejectedKeywordOnlyCount: number;
  matchedAds: DomainMatchedAd[];
  /**
   * Numeric Meta Page id of the verified advertiser, when discovery resolved a
   * single unambiguous one across the verified matches. Lets a watchlist saved
   * from this search persist page-scoped scans (`view_all_page_id`) so repeat
   * scrapes return the brand's own ads instead of keyword junk. Null when no
   * verified match carried a page id or verified ads disagreed.
   */
  verifiedAdvertiserPageId?: string | null;
}

/**
 * A page id is only trustworthy when the verified matches agree on exactly one.
 * Disagreement (two verified advertisers, or none carrying an id) yields null so
 * we never scope future scans to a guessed or conflicting page.
 */
export function resolveVerifiedAdvertiserPageId(
  matchedAds: DomainMatchedAd[],
): string | null {
  const distinct = new Set<string>();
  for (const entry of matchedAds) {
    if (entry.match.confidenceCategory !== "verified") {
      continue;
    }
    const pageId = normalizeNumericPageId(entry.ad.advertiserPageId ?? null);
    if (pageId) {
      distinct.add(pageId);
    }
  }
  return distinct.size === 1 ? [...distinct][0] : null;
}

export function buildDomainProviderQuery(
  intent: ParsedSearchQuery,
  identityAliases: string[] = [],
) {
  if (intent.intent !== "domain") {
    return null;
  }

  // Meta Ad Library cannot search by destination domain. Query with the
  // brand-sized term that can discover candidates, then verify the website
  // connection below. Exact vs broader is a proof policy, not a provider
  // search mode.
  // Prefer the resolved website identity (site name, title) as the search
  // query because generic domain labels like "slack" or "tcs" are too
  // ambiguous for Meta Ad Library. Fall back to the broader provider query
  // (domain label) if no identity is available.
  return identityAliases[0] ??
    buildBroaderProviderQuery(intent) ??
    intent.registrableDomain ??
    intent.comparableHostname ??
    intent.originalInput;
}

export function buildBroaderProviderQuery(intent: ParsedSearchQuery) {
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return null;
  }

  const label = intent.registrableDomain.split(".")[0] ?? "";
  return label
    .replace(/^www\./, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

export function buildSearchV2SavedQuery(
  intent: ParsedSearchQuery,
  scope: SearchScope,
  filters: NormalizedSavedQuery["filters"],
  options: { pageId?: string | null; identityAliases?: string[] } = {},
): NormalizedSavedQuery {
  const providerTerm =
    intent.intent === "domain"
      ? buildDomainProviderQuery(intent, options.identityAliases) ?? intent.originalInput
      : intent.normalizedText ?? intent.originalInput;

  // A verified page id scopes the scrape to the exact advertiser page — persist
  // it so watchlist re-scans skip the keyword guess entirely. Omitted (not
  // stored) unless it is a real numeric id, keeping keyword fingerprints stable.
  const pageId = normalizeNumericPageId(options.pageId);

  return {
    mode: intent.intent === "domain" ? "advertiser" : "keyword",
    filters: {
      ...filters,
      query: providerTerm ?? "",
      ...(pageId ? { pageId } : {}),
    },
  };
}

export async function applySearchV2PostFilter(
  env: Pick<AppEnv, never>,
  result: SearchResponse,
  context: SearchV2Context,
): Promise<SearchV2Result> {
  void env;

  const aliases = [...context.domainAliases, ...context.identityAliases];
  const rawCandidateCount = result.ads.length;

  // BET 2: the free preview never dead-ends. Every provider candidate is kept
  // and labelled by tier (verified / likely / unmatched). The exact scope used
  // to drop non-verified candidates to an empty page; it now keeps them so a
  // brand with 11–24 unverified candidates renders those rows instead of "No
  // verified ads found." The precision fix is preserved by the tier labels:
  // an unmatched candidate is shown AS unmatched, never as verified.
  const classified = classifyDomainMatches(result.ads, context.queryIntent, {
    aliases,
    identityAliases: context.identityAliases,
    includeUnverified: true,
  });
  const classifiedIds = new Set(classified.map((entry) => entry.ad.metaAdId));
  const providerLabel = result.source === "demo" ? "sample source" : "Meta source";
  const providerCandidates: DomainMatchedAd[] = result.ads
    .filter((ad) => !classifiedIds.has(ad.metaAdId))
    .map((ad) => ({
      ad,
      match: {
        level: "unverified_provider_candidate" as const,
        matchedDomain: null,
        matchedSignal: "provider_query",
        confidenceCategory: "unverified" as const,
        providerSource: ad.source,
        customerReason: `Returned for “${buildBroaderProviderQuery(context.queryIntent) ?? context.displayDomain}” by the ${providerLabel}; website connection not verified`,
      },
    }));

  const ranked = dedupeDomainMatches(rankDomainMatches([...classified, ...providerCandidates]));
  const verifiedCount = ranked.filter((entry) => entry.match.confidenceCategory === "verified").length;
  const likelyCount = ranked.filter((entry) => entry.match.confidenceCategory === "likely").length;
  const unmatchedCount = ranked.filter((entry) => entry.match.confidenceCategory === "unverified").length;
  const rejectedKeywordOnlyCount = ranked.filter(
    (entry) => entry.match.level === "unverified_text_candidate",
  ).length;
  const broaderCandidateCount = Math.max(0, rawCandidateCount - verifiedCount);
  const missingVerificationCount = classified.length >= rawCandidateCount
    ? 0
    : rawCandidateCount - classified.length;
  const ads = ranked.map((entry) => ({
    ...entry.ad,
    domainMatch: {
      level: entry.match.level,
      reason: entry.match.customerReason,
      matchedDomain: entry.match.matchedDomain,
    },
  }));

  return {
    ...result,
    ads,
    matchedAds: ranked,
    searchIntent: context.queryIntent.intent,
    searchScope: context.scope,
    displayDomain: context.displayDomain,
    verifiedCount,
    likelyCount,
    unmatchedCount,
    rawCandidateCount,
    broaderCandidateCount,
    missingVerificationCount,
    rejectedKeywordOnlyCount,
    verifiedAdvertiserPageId: resolveVerifiedAdvertiserPageId(ranked),
    discoveryEmptyReason: ads.length === 0 ? "no_results" : result.discoveryEmptyReason,
  };
}

export async function buildSearchV2Context(
  websiteInput: string,
  scope: SearchScope,
): Promise<SearchV2Context | null> {
  const queryIntent = parseSearchInputFromWebsiteField(websiteInput);
  if (queryIntent.intent !== "domain" || !queryIntent.registrableDomain) {
    return null;
  }

  const identity = queryIntent.normalizedUrl
    ? await resolveWebsiteIdentity(queryIntent.normalizedUrl)
    : null;

  return {
    queryIntent,
    scope,
    displayDomain: queryIntent.registrableDomain,
    identityAliases: identity?.aliases ?? [],
    domainAliases: identity?.domainAliases ?? [],
  };
}

export function buildSearchV2CacheKey(input: {
  provider: string;
  intent: ParsedSearchQuery;
  scope: SearchScope;
  country: string;
  cursor?: string | null;
}) {
  if (input.intent.intent === "domain" && input.intent.registrableDomain) {
    return [
      "search-v2",
      "domain",
      input.intent.registrableDomain,
      input.scope,
      input.provider.trim().toLowerCase(),
      input.country.trim().toLowerCase().replace(/\s+/g, "-"),
      (input.cursor ?? "page-1").trim(),
    ].join(":");
  }

  return buildDiscoveryCacheKey({
    provider: input.provider,
    fingerprint: `text:${input.intent.normalizedText ?? input.intent.originalInput}`,
    country: input.country,
    cursor: input.cursor,
  });
}

export function attachDomainMatchMetadata(ad: AdRecord, matched: DomainMatchedAd | undefined) {
  if (!matched) {
    return ad;
  }

  return {
    ...ad,
    domainMatch: {
      level: matched.match.level,
      reason: matched.match.customerReason,
      matchedDomain: matched.match.matchedDomain,
    },
  };
}
