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
  broaderCandidateCount: number;
  rejectedKeywordOnlyCount: number;
  matchedAds: DomainMatchedAd[];
}

export function buildDomainProviderQuery(intent: ParsedSearchQuery) {
  if (intent.intent !== "domain") {
    return null;
  }

  return intent.registrableDomain ?? intent.comparableHostname ?? intent.originalInput;
}

export function buildBroaderProviderQuery(intent: ParsedSearchQuery) {
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return null;
  }

  const label = intent.registrableDomain.split(".")[0] ?? "";
  return label.replace(/^www\./, "").trim() || null;
}

export function buildSearchV2SavedQuery(
  intent: ParsedSearchQuery,
  scope: SearchScope,
  filters: NormalizedSavedQuery["filters"],
): NormalizedSavedQuery {
  const providerTerm =
    intent.intent === "domain"
      ? scope === "broader"
        ? buildBroaderProviderQuery(intent) ?? intent.registrableDomain ?? intent.originalInput
        : buildDomainProviderQuery(intent) ?? intent.originalInput
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
  const ranked = dedupeDomainMatches(rankDomainMatches(scopedMatches));
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
    verifiedCount: ranked.filter((entry) => entry.match.confidenceCategory === "verified").length,
    broaderCandidateCount: includeUnverified
      ? ranked.filter((entry) => entry.match.level === "unverified_text_candidate").length
      : rejectedKeywordOnlyCount,
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
