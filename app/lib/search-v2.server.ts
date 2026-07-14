import type { AppEnv } from "~/lib/env.server";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  classifyDomainMatches,
  dedupeDomainMatches,
  rankDomainMatches,
  type DomainMatchedAd,
} from "~/lib/search-domain-match.server";
import { parseSearchInputFromWebsiteField, type ParsedSearchQuery } from "~/lib/search-query";
import { resolveWebsiteIdentity } from "~/lib/website-identity.server";
import type { AdRecord, NormalizedSavedQuery, SearchResponse } from "~/lib/types";

export type SearchScope = "exact" | "broader";

export interface SearchV2Context {
  queryIntent: ParsedSearchQuery;
  scope: SearchScope;
  displayDomain: string;
  identityAliases: string[];
}

export interface SearchV2Result extends SearchResponse {
  searchIntent: ParsedSearchQuery["intent"];
  searchScope: SearchScope;
  displayDomain: string | null;
  verifiedCount: number;
  rawCandidateCount: number;
  broaderCandidateCount: number;
  missingVerificationCount: number;
  rejectedKeywordOnlyCount: number;
  matchedAds: DomainMatchedAd[];
}

export function buildDomainProviderQuery(intent: ParsedSearchQuery) {
  if (intent.intent !== "domain") {
    return null;
  }

  // Meta Ad Library cannot search by destination domain. Query with the
  // brand-sized term that can discover candidates, then verify the website
  // connection below. Exact vs broader is a proof policy, not a provider
  // search mode.
  return buildBroaderProviderQuery(intent) ??
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
): NormalizedSavedQuery {
  const providerTerm =
    intent.intent === "domain"
      ? buildDomainProviderQuery(intent) ?? intent.originalInput
      : intent.normalizedText ?? intent.originalInput;

  return {
    mode: intent.intent === "domain" ? "advertiser" : "keyword",
    filters: {
      ...filters,
      query: providerTerm ?? "",
    },
  };
}

export async function applySearchV2PostFilter(
  env: Pick<AppEnv, never>,
  result: SearchResponse,
  context: SearchV2Context,
): Promise<SearchV2Result> {
  void env;

  const includeUnverified = context.scope === "broader";
  const aliases = [...context.identityAliases];
  const rawCandidateCount = result.ads.length;

  const allClassified = classifyDomainMatches(result.ads, context.queryIntent, {
    aliases,
    identityAliases: context.identityAliases,
    includeUnverified: true,
  });
  const rejectedKeywordOnlyCount = allClassified.filter(
    (entry) => entry.match.level === "unverified_text_candidate",
  ).length;

  const scopedMatches = classifyDomainMatches(result.ads, context.queryIntent, {
    aliases,
    identityAliases: context.identityAliases,
    includeUnverified,
  });
  const matchedIds = new Set(scopedMatches.map((entry) => entry.ad.metaAdId));
  const providerLabel = result.source === "demo" ? "sample source" : "Meta source";
  const providerCandidates: DomainMatchedAd[] = includeUnverified
    ? result.ads
        .filter((ad) => !matchedIds.has(ad.metaAdId))
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
        }))
    : [];
  const ranked = dedupeDomainMatches(rankDomainMatches([...scopedMatches, ...providerCandidates]));
  const verifiedCount = ranked.filter((entry) => entry.match.confidenceCategory === "verified").length;
  const broaderCandidateCount = Math.max(0, rawCandidateCount - verifiedCount);
  const missingVerificationCount = allClassified.length >= rawCandidateCount
    ? 0
    : rawCandidateCount - allClassified.length;
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
    rawCandidateCount,
    broaderCandidateCount,
    missingVerificationCount,
    rejectedKeywordOnlyCount,
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
