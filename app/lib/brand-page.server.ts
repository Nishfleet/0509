/**
 * Public programmatic brand pages (/ads/:domain) — cache-only data layer.
 *
 * ABSOLUTE CONSTRAINT: everything here renders from the existing discovery
 * cache. A public brand-page request must NEVER trigger live scraping,
 * Browser Rendering, Meta API calls, or any other paid operation, for any
 * input. The only I/O in this module is bounded D1 reads through
 * `readDiscoveryCacheEntryCacheOnly` (max BRAND_PAGE_MAX_CACHE_LOOKUPS rows).
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import { adLongevityDays } from "~/lib/ad-display";
import {
  applyWebsiteSearchFallback,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import {
  isDiscoveryCacheRouteCompatible,
  readDiscoveryCacheEntryCacheOnly,
} from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { shouldApplySearchV2 } from "~/lib/search-rollout.server";
import { buildSearchV2CacheKey, buildSearchV2SavedQuery } from "~/lib/search-v2.server";
import type { AdRecord } from "~/lib/types";

/** Path params beyond this length are rejected before any parsing. */
const BRAND_PAGE_DOMAIN_MAX_LENGTH = 80;
/** Letters/digits/dots/hyphens only — anything else is a hard 404. */
const BRAND_PAGE_DOMAIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,78}[a-zA-Z0-9])?$/;
/** Hard bound on cache lookups per request (spec: ≤ 4). */
export const BRAND_PAGE_MAX_CACHE_LOOKUPS = 4;
/** Entries older than this render the honest "not checked recently" shell. */
export const BRAND_PAGE_MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Entries older than this still render but always carry noindex. */
export const BRAND_PAGE_FRESH_FOR_INDEXING_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the number of ads rendered on a public page. */
const BRAND_PAGE_MAX_ADS = 24;

export interface BrandPageDomain {
  /** Normalized registrable host, e.g. "nykaa.com" — safe for URLs and copy. */
  domain: string;
  /** Title-cased brand label, e.g. "Nykaa". */
  displayName: string;
}

export interface BrandPageCacheSnapshot {
  ads: AdRecord[];
  /** ISO timestamp of the underlying Ad Library check. */
  fetchedAt: string;
  /** Country the cached search targeted ("all" or a catalog country name). */
  country: string;
  /** Age of the cache entry in ms at read time. */
  ageMs: number;
  /** True when young enough (≤ 7 days) to be indexable. */
  freshForIndexing: boolean;
}

export interface BrandIntelTeaser {
  totalCount: number;
  activeCount: number;
  longestRunningDays: number | null;
  longestRunningHook: string | null;
  formats: string[];
}

/**
 * Validate and normalize the :domain path param. Returns null (→ 404) for
 * anything that is not a plain public domain: bad characters, over-length
 * input, userinfo/scheme smuggling, or single labels without a TLD.
 */
export function normalizeBrandPageDomain(param: string | undefined): BrandPageDomain | null {
  const raw = (param ?? "").trim().toLowerCase();
  if (!raw || raw.length > BRAND_PAGE_DOMAIN_MAX_LENGTH) {
    return null;
  }
  if (!BRAND_PAGE_DOMAIN_PATTERN.test(raw) || raw.includes("..")) {
    return null;
  }

  const website = normalizeCompetitorWebsiteInput(raw);
  if (!website.host || website.error) {
    return null;
  }
  // The param must BE the domain — reject anything that normalized away
  // (defense in depth; the charset already blocks paths/schemes/userinfo).
  if (website.host !== raw.replace(/^www\./, "")) {
    return null;
  }

  return {
    domain: website.host,
    displayName: website.displayName ?? website.host,
  };
}

/**
 * Read the most likely discovery-cache entries for this brand — visitor
 * country first, then "all", then "United States" — and return the first
 * usable public snapshot. Cache-only: zero provider calls, ≤ 4 D1 reads.
 *
 * Honesty rules: demo-sourced entries are never returned (a public page must
 * not present sample data as a brand's real ads), scheduled-scan entries are
 * skipped (interactive public_search cache only), and entries older than 30
 * days are treated as "not checked recently".
 */
export async function loadBrandPageCacheSnapshot(
  env: AppEnv,
  input: { domain: string; visitorCountry: string; now?: Date },
): Promise<BrandPageCacheSnapshot | null> {
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    // Unconfigured/demo environments have no real public cache to show.
    return null;
  }

  const now = input.now ?? new Date();
  const countries = candidateCountries(input.visitorCountry);

  let lookups = 0;
  for (const country of countries) {
    if (lookups >= BRAND_PAGE_MAX_CACHE_LOOKUPS) {
      break;
    }
    lookups += 1;

    const entry = await readDiscoveryCacheEntryCacheOnly(env, {
      provider,
      ...deriveCacheLookup(env, provider, input.domain, country),
    });
    const snapshot = toUsableSnapshot(entry, now);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

/** Compact honest intelligence teaser derived from the cached ads only. */
export function buildBrandIntelTeaser(ads: AdRecord[], now: Date = new Date()): BrandIntelTeaser {
  const activeCount = ads.filter((ad) => ad.active).length;
  const formats = [...new Set(ads.map((ad) => ad.format).filter(Boolean))];

  let longestRunningDays: number | null = null;
  let longestRunningHook: string | null = null;
  for (const ad of ads) {
    const days = adLongevityDays(ad, now);
    if (days !== null && (longestRunningDays === null || days > longestRunningDays)) {
      longestRunningDays = days;
      longestRunningHook = ad.hook?.trim() || ad.previewHeadline?.trim() || null;
    }
  }

  return {
    totalCount: ads.length,
    activeCount,
    longestRunningDays,
    longestRunningHook,
    formats,
  };
}

/** Coarse honest relative label for the freshness line ("about 3 hours ago"). */
export function formatBrandPageCheckedAgo(fetchedAt: string, now: Date = new Date()): string {
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return "a while ago";
  }

  const elapsedMs = Math.max(0, now.getTime() - fetchedMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 2) return "moments ago";
  if (minutes < 60) return `about ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 2) return "about an hour ago";
  if (hours < 24) return `about ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "about a day ago";
  return `about ${days} days ago`;
}

function candidateCountries(visitorCountry: string): string[] {
  const candidates = [
    visitorCountry?.trim() || ALL_COUNTRIES_VALUE,
    ALL_COUNTRIES_VALUE,
    "United States",
  ];
  return [...new Set(candidates)].slice(0, BRAND_PAGE_MAX_CACHE_LOOKUPS);
}

/**
 * Reproduce the exact cache key the /search execution path would have written
 * for this domain + country (see `hasWarmSearchCacheEntry`): the search-v2
 * domain key when the v2 rollout applies, else the legacy fingerprint triple.
 * Shadow mode serves customers from the legacy key, so it maps to legacy here.
 */
function deriveCacheLookup(
  env: AppEnv,
  provider: string,
  domain: string,
  country: string,
): { fingerprint: string; country: string; cacheKeyOverride: string | null } {
  const website = normalizeCompetitorWebsiteInput(domain);
  const parsedInput = parseSearchParams(new URLSearchParams(), { country });
  const parsed = applyWebsiteSearchFallback(parsedInput, website);
  const queryIntent = shouldApplySearchV2(env) ? parseSearchInputFromWebsiteField(domain) : null;
  const useDomainV2 = Boolean(
    queryIntent && queryIntent.intent === "domain" && queryIntent.registrableDomain,
  );

  if (useDomainV2 && queryIntent) {
    const v2Query = buildSearchV2SavedQuery(queryIntent, "exact", parsed.filters);
    return {
      fingerprint: parsed.fingerprint,
      country: v2Query.filters.country || ALL_COUNTRIES_VALUE,
      cacheKeyOverride: buildSearchV2CacheKey({
        provider,
        intent: queryIntent,
        scope: "exact",
        country: v2Query.filters.country || ALL_COUNTRIES_VALUE,
        cursor: null,
      }),
    };
  }

  // Recompute the fingerprint from the exact NormalizedSavedQuery shape the
  // resolver caches under (searchAdsViaSourceResolver fingerprints the
  // normalized query, not the parsed route input) so the two never drift.
  const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);
  return {
    fingerprint: fingerprintSavedQuery(legacyQuery),
    country: legacyQuery.filters.country || ALL_COUNTRIES_VALUE,
    cacheKeyOverride: null,
  };
}

type CacheEntry = Awaited<ReturnType<typeof readDiscoveryCacheEntryCacheOnly>>;

function toUsableSnapshot(entry: CacheEntry, now: Date): BrandPageCacheSnapshot | null {
  if (!entry) {
    return null;
  }
  // Interactive public_search cache only — scheduled scan/warmup entries are
  // shallow and must not back a public page.
  if (!isDiscoveryCacheRouteCompatible("public_search", entry.routeContext)) {
    return null;
  }

  const payload = entry.payload;
  // Never present demo/sample data as a brand's real ads on a public page.
  if (payload.source === "demo" || payload.provider === "demo") {
    return null;
  }
  const ads = Array.isArray(payload.ads)
    ? payload.ads.filter((ad) => ad && ad.source !== "demo")
    : [];
  if (ads.length === 0) {
    return null;
  }

  const fetchedMs = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return null;
  }
  const ageMs = now.getTime() - fetchedMs;
  if (ageMs < 0 || ageMs > BRAND_PAGE_MAX_CACHE_AGE_MS) {
    return null;
  }

  return {
    ads: ads.slice(0, BRAND_PAGE_MAX_ADS),
    fetchedAt: entry.fetchedAt,
    country: entry.country,
    ageMs,
    freshForIndexing: ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  };
}
