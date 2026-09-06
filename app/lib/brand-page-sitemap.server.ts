/**
 * Dynamic /sitemap.xml entries for public brand pages (/ads/:domain).
 *
 * ZERO-COST CONSTRAINT (same as the brand-page loader): this module is
 * cache-read-only. It never triggers live discovery, Browser Rendering, Meta
 * API calls, provider REST APIs, writes, or any other paid operation.
 *
 * Inclusion contract (see the design note above SITEMAP_XML in
 * `app/lib/seo.ts`): a domain is sitemapped ONLY when the serving brand page
 * would actually render indexable for a crawler. For each candidate domain we
 * re-derive the EXACT cache key `loadBrandPageCacheSnapshot` would read under
 * the current rollout mode (legacy fingerprint key in legacy/shadow, search-v2
 * domain key in v2), provider, and the crawler-visible country fallbacks
 * ("all", then "United States"), read that exact key through the same
 * cache-only read path, and apply the same snapshot filter the route applies
 * (`toUsableBrandPageSnapshot` + the 7-day indexing window). A near-miss key —
 * an unrelated keyword row whose ad destinations merely contain the domain,
 * a customer-token-scoped key, a broader/cursor-page key — can never qualify,
 * because the derived key points at a different (absent) row.
 *
 * D1 reads are explicitly bounded: one indexed scan (provider + fetched_at
 * window, LIMIT BRAND_PAGE_SITEMAP_SCAN_LIMIT) plus at most
 * BRAND_PAGE_SITEMAP_MAX_CANDIDATES × 2 point lookups by primary cache_key.
 * Any D1 failure (missing binding, missing table, query/parse error) degrades
 * to the unchanged static sitemap — sitemap availability never depends on D1.
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  deriveBrandPageCacheLookup,
  normalizeBrandPageDomain,
  toUsableBrandPageSnapshot,
} from "~/lib/brand-page.server";
import { normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { readDiscoveryCacheEntryCacheOnly } from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import { buildSitemapXml, type PublicSeoFile } from "~/lib/seo";

/** Hard bound on scanned cache rows per sitemap render (one query). */
export const BRAND_PAGE_SITEMAP_SCAN_LIMIT = 250;
/** Hard bound on candidate domains verified per sitemap render. */
export const BRAND_PAGE_SITEMAP_MAX_CANDIDATES = 100;

/**
 * The country fallbacks a crawler without a country header would read through:
 * `candidateCountries` in the loader resolves a country-less visitor to
 * ["all", "United States"]. The sitemap must only claim pages a crawler would
 * actually see as indexable, so it verifies exactly this pair.
 */
const SITEMAP_COUNTRY_FALLBACKS: readonly string[] = [
  ALL_COUNTRIES_VALUE,
  "United States",
];

interface DiscoveryCacheScanRow {
  cache_key: string;
  provider: string;
  route_context: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
}

/**
 * Candidate domains for sitemap inclusion, derived ONLY from safe cache-key
 * structure and cached ad destinations. Every candidate still has to pass the
 * exact loader-key compatibility check before it can appear in the sitemap.
 * Returns a deterministic (sorted, deduped, capped) list.
 */
export function collectBrandPageSitemapCandidates(
  rows: readonly DiscoveryCacheScanRow[],
  provider: string,
): string[] {
  const candidates = new Set<string>();
  for (const row of rows) {
    const fromKey = candidateDomainFromCacheKey(row.cache_key, provider);
    if (fromKey) {
      candidates.add(fromKey);
    }
    for (const host of adDestinationHostnames(row.payload_json)) {
      candidates.add(host);
    }
  }
  return [...candidates].sort().slice(0, BRAND_PAGE_SITEMAP_MAX_CANDIDATES);
}

/**
 * Parse a registrable domain out of a well-formed search-v2 EXACT domain
 * cache key: `search-v2:domain:<domain>:exact:<provider>:<country>:page-1`.
 * Anything else (legacy fingerprint keys, broader scope, other cursors, other
 * providers) yields null — those shapes cannot prove a domain on their own.
 */
export function candidateDomainFromCacheKey(
  cacheKey: string,
  provider: string,
): string | null {
  const parts = cacheKey.split(":");
  if (parts.length !== 7) {
    return null;
  }
  const [kind, intent, domain, scope, keyProvider, _country, cursor] = parts;
  if (
    kind !== "search-v2" ||
    intent !== "domain" ||
    scope !== "exact" ||
    cursor !== "page-1" ||
    keyProvider !== provider.trim().toLowerCase() ||
    !domain
  ) {
    return null;
  }
  return domain;
}

/**
 * Registrable hosts of the cached ads' landing-page destinations. Malformed
 * JSON payloads, non-http(s) URLs, and non-domain hosts yield nothing. This is
 * a candidate source only — exact loader-key parity still gates inclusion, so
 * an unrelated keyword row can never leak its destination into the sitemap.
 */
export function adDestinationHostnames(payloadJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const ads = (parsed as { ads?: unknown }).ads;
  if (!Array.isArray(ads)) {
    return [];
  }

  const hosts: string[] = [];
  for (const ad of ads) {
    if (!ad || typeof ad !== "object" || Array.isArray(ad)) {
      continue;
    }
    const urlValue = (ad as { landingPageUrl?: unknown }).landingPageUrl;
    if (typeof urlValue !== "string" || !urlValue.trim()) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      continue;
    }
    const website = normalizeCompetitorWebsiteInput(url.hostname);
    if (website.host && !website.error) {
      hosts.push(website.host);
    }
  }
  return hosts;
}

/**
 * Scan the discovery cache for rows that could back an indexable brand page
 * under the current provider: public_search route context, first page only,
 * fetched within the 7-day indexing window. The provider + fetched_at range
 * rides the existing `idx_discovery_cache_provider_fetched` index and the
 * result is bounded by BRAND_PAGE_SITEMAP_SCAN_LIMIT. Any read failure
 * returns [] so the caller falls back to the static sitemap.
 */
export async function scanIndexableBrandPageCacheRows(
  env: AppEnv,
  provider: string,
  now: Date,
): Promise<DiscoveryCacheScanRow[]> {
  const db = env.DB;
  if (!db) {
    return [];
  }
  const cutoffIso = new Date(now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString();
  try {
    const result = await db
      .prepare(
        `
          SELECT
            cache_key,
            provider,
            route_context,
            country,
            cursor,
            payload_json,
            fetched_at
          FROM discovery_cache_entry
          WHERE provider = ?
            AND route_context = 'public_search'
            AND (cursor IS NULL OR cursor = 'page-1')
            AND fetched_at >= ?
          ORDER BY fetched_at DESC
          LIMIT ?
        `,
      )
      .bind(provider, cutoffIso, BRAND_PAGE_SITEMAP_SCAN_LIMIT)
      .all<DiscoveryCacheScanRow>();
    return result.results ?? [];
  } catch (error) {
    console.warn(
      "Brand-page sitemap cache scan failed; serving the static sitemap.",
      { errorName: error instanceof Error ? error.name : typeof error },
    );
    return [];
  }
}

/**
 * Domains whose /ads/:domain page would render indexable for a crawler right
 * now, under the current environment (indexing flag, provider, rollout mode).
 * Each candidate must pass the exact loader-key compatibility check: the
 * derived key for that domain and a crawler-visible country fallback must be
 * the key of a row that also passes the loader's own snapshot filter and the
 * 7-day freshness window. Deterministic order: sorted unique domains.
 */
export async function listIndexableBrandPageDomains(
  env: AppEnv,
  now: Date = new Date(),
): Promise<string[]> {
  // Emergency brake: "0" noindexes every /ads/* page regardless of cache.
  if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
    return [];
  }
  if (!env.DB) {
    return [];
  }
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo") {
    // Demo-only environments have no real public cache to prove indexability.
    return [];
  }

  const rows = await scanIndexableBrandPageCacheRows(env, provider, now);
  const candidates = collectBrandPageSitemapCandidates(rows, provider);

  const included = new Set<string>();
  for (const candidate of candidates) {
    const brand = normalizeBrandPageDomain(candidate);
    if (!brand) {
      continue;
    }
    if (await domainIndexableAtLoaderKey(env, provider, brand.domain, now)) {
      included.add(brand.domain);
    }
  }
  return [...included].sort();
}

/**
 * True when the brand-page loader, for a country-less crawler, would derive
 * and read the cache key of a row that yields an indexable snapshot. Mirrors
 * `loadBrandPageCacheSnapshot`'s country fallback loop exactly ("all" first,
 * then "United States"), with the loader's own derivation and snapshot filter.
 */
async function domainIndexableAtLoaderKey(
  env: AppEnv,
  provider: string,
  domain: string,
  now: Date,
): Promise<boolean> {
  for (const country of SITEMAP_COUNTRY_FALLBACKS) {
    try {
      const lookup = deriveBrandPageCacheLookup(env, provider, domain, country);
      const entry = await readDiscoveryCacheEntryCacheOnly(env, {
        provider,
        ...lookup,
      });
      const snapshot = toUsableBrandPageSnapshot(entry, now);
      if (snapshot && snapshot.freshForIndexing) {
        return true;
      }
    } catch (error) {
      // One failing point read must not take the whole sitemap down; the
      // domain is simply not proven indexable and is excluded.
      console.warn("Brand-page sitemap cache read failed; excluding domain.", {
        domain,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  return false;
}

/**
 * The /sitemap.xml response descriptor: every static SITEMAP_PATHS entry plus
 * the currently indexable /ads/:domain entries, in deterministic order. Any
 * failure — missing DB, missing cache table, query/parse error, demo-only
 * provider, or the emergency noindex flag — yields the unchanged static
 * sitemap. The sitemap must never fail because D1 is unhealthy.
 */
export async function publicSitemapFile(env: AppEnv): Promise<PublicSeoFile> {
  let dynamicPaths: string[] = [];
  try {
    const domains = await listIndexableBrandPageDomains(env);
    dynamicPaths = domains.map((domain) => `/ads/${domain}`);
  } catch (error) {
    console.warn(
      "Dynamic brand-page sitemap generation failed; serving the static sitemap.",
      { errorName: error instanceof Error ? error.name : typeof error },
    );
  }
  return {
    body: buildSitemapXml(dynamicPaths),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
