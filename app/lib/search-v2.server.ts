import type { AppEnv } from "~/lib/env.server";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  classifyDomainMatches,
  dedupeDomainMatches,
  rankDomainMatches,
  type DomainMatchedAd,
} from "~/lib/search-domain-match.server";
import { hashString, normalizeNumericPageId, stableStringify } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField, type ParsedSearchQuery } from "~/lib/search-query";
import { getCuratedProviderQuery, resolveWebsiteIdentity } from "~/lib/website-identity.server";
import type {
  AdRecord,
  NormalizedSavedQuery,
  SearchFilters,
  SearchResponse,
} from "~/lib/types";

export type SearchScope = "exact" | "broader";

export interface SearchV2Context {
  queryIntent: ParsedSearchQuery;
  scope: SearchScope;
  displayDomain: string;
  identityAliases: string[];
  domainAliases: string[];
  /**
   * Curated Meta Page id for the brand, when identity resolution supplied one.
   * Scopes the provider search to that exact page (`view_all_page_id`) instead
   * of a keyword query, so the brand's own ads surface instead of keyword
   * junk. Null when no curated id exists (the common case). The matcher still
   * verifies each ad lands on the brand's domain — a curated page id never
   * fabricates a verified row (issue #1982). Optional so legacy fixtures that
   * predate the field still type-check; production always sets it via `?? null`.
   */
  advertiserPageId?: string | null;
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
  // Identity aliases still classify rows after scrape (on-running.com,
  // ridgewallet.com). They must not pick the Meta query: live 2026-09-09,
  // website=on.com asked Meta for identityAliases[0] ("On" / "On Shop") and
  // returned 0 verified rows, while q=on.com returned 30 verified (issue #1999).
  identityAliases: string[] = [],
) {
  if (intent.intent !== "domain") {
    return null;
  }

  // Meta Ad Library cannot search by destination domain. The registrable
  // domain is the term a buyer types and the term the live keyword path
  // already proves (q=on.com, q=reebok.com, q=footlocker.com). Site-name
  // aliases ("On", "GOAT", "Reebok") stay on the matcher; using them as the
  // provider query is what left website=on.com / website=reebok.com empty
  // after #1950 / #1993. Exact vs broader is a proof policy, not a provider
  // search mode.
  //
  // A curated provider term overrides it for the one class where the
  // registrable domain is not a term Meta indexes: a country storefront that
  // redirects onto the brand's primary host (saucony.co.uk -> www.saucony.com),
  // so the brand's ads never carry the .co.uk host (issue #2233). The curated
  // term is a brand name, not a domain guess, and the matcher still requires a
  // row to land on the searched domain or one of its live aliases.
  void identityAliases;
  return getCuratedProviderQuery(intent.registrableDomain ?? "") ??
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
    advertiserPageId: identity?.advertiserPageId ?? null,
  };
}

export function buildSearchV2CacheKey(input: {
  provider: string;
  intent: ParsedSearchQuery;
  scope: SearchScope;
  country: string;
  cursor?: string | null;
  /**
   * Curated Meta Page id scoping the search. Included in the key so a
   * page-scoped search does not collide with a stale keyword-scoped cache
   * entry for the same domain (issue #1982).
   */
  pageId?: string | null;
  /**
   * Result filters carried by the same saved query the key is used for.
   * `creativeType` and `status` become the provider request's `media_type` and
   * `active_status` (meta-library-browser.server.ts buildSearchUrl), while
   * `platform`, `firstSeenFrom` and `lastSeenFrom` narrow the rows afterwards
   * (ad-source.server.ts `filterAdsBySearchFilters`), so every one of them
   * changes the payload written under the key. Omitting them let an unfiltered
   * and a video-only search for one domain share a cache entry (issue #2437).
   * Optional: when every filter is default the key keeps its exact legacy
   * shape, which the format-pinning canaries assert.
   */
  filters?: SearchFilters | null;
}) {
  if (input.intent.intent === "domain" && input.intent.registrableDomain) {
    const base = [
      "search-v2",
      "domain",
      input.intent.registrableDomain,
      input.scope,
      input.provider.trim().toLowerCase(),
      input.country.trim().toLowerCase().replace(/\s+/g, "-"),
    ];
    // A curated page id gets its own key segment so a page-scoped search
    // bypasses any stale keyword-scoped cache entry for the same domain.
    // Normalize the same way buildSearchV2SavedQuery does so the write key
    // (saved query's filters.pageId) and the read key stay identical for any
    // override data — a non-numeric id is dropped by both, never mismatched
    // (reviewer Act-on, issue #1982).
    const normalizedPageId = normalizeNumericPageId(input.pageId);
    if (normalizedPageId) {
      base.push(`page:${normalizedPageId}`);
    }
    // A curated provider term is part of the question asked of Meta, so it is
    // part of the key: without it, a settled 0-row entry cached under the old
    // registrable-domain query keeps serving the empty page and the fix never
    // shows up (issue #2233). Same rail as the page-id segment above.
    const curatedQuery = getCuratedProviderQuery(input.intent.registrableDomain);
    if (curatedQuery) {
      base.push(`q:${curatedQuery.trim().toLowerCase()}`);
    }
    // Result filters get their own segment only when at least one is
    // non-default. Emitting the segment unconditionally would change the key
    // for the default filters the format-pinning canaries (ads-programmatic-seo
    // .canary.test.tsx, sitemap.server.test.ts) hard-code, so the legacy
    // six-segment form stays byte-identical (judge edit, issue #2437).
    const filterSegment = buildResultFilterSegment(input.filters);
    if (filterSegment) {
      base.push(filterSegment);
    }
    base.push((input.cursor ?? "page-1").trim());
    return base.join(":");
  }

  return buildDiscoveryCacheKey({
    provider: input.provider,
    fingerprint: `text:${input.intent.normalizedText ?? input.intent.originalInput}`,
    country: input.country,
    cursor: input.cursor,
  });
}

/**
 * A filter segment for the v2 domain cache key, or null when every result
 * filter is at its default. Null is what keeps the legacy key shape intact for
 * unfiltered searches: `creativeType`/`status`/`platform` default to "all" and
 * the two date bounds default to the empty string (normalizeSearchFilters).
 *
 * `platform` is included because the browser scrape encodes only
 * country/query in the Ad Library URL, so platform is applied client-side
 * (ad-source.server.ts `filterAdsBySearchFilters`) and the narrowed payload is
 * what lands in the cache. Omitting it reproduced the same bug for
 * `?platform=Instagram` (reviewer BLOCKING on issue #2437).
 */
function buildResultFilterSegment(
  filters: SearchFilters | null | undefined,
): string | null {
  const platform = (filters?.platform ?? "all").trim() || "all";
  const creativeType = (filters?.creativeType ?? "all").trim() || "all";
  const status = (filters?.status ?? "all").trim() || "all";
  const firstSeenFrom = (filters?.firstSeenFrom ?? "").trim();
  const lastSeenFrom = (filters?.lastSeenFrom ?? "").trim();

  if (
    platform === "all" &&
    creativeType === "all" &&
    status === "all" &&
    !firstSeenFrom &&
    !lastSeenFrom
  ) {
    return null;
  }

  return `f:${hashString(stableStringify({ platform, creativeType, status, firstSeenFrom, lastSeenFrom }))}`;
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
