/**
 * Dynamic /sitemap.xml brand-page entries — cache-only, read-only, bounded.
 *
 * ZERO-COST CONSTRAINT (same as brand-page.server.ts): this module NEVER
 * triggers live discovery, Browser Rendering, Meta API calls, provider REST
 * APIs, writes, or any paid work. The only I/O is ONE bounded D1 read over
 * existing `discovery_cache_entry` rows using existing indexes.
 *
 * Inclusion rule — a domain is added only when it would actually render as an
 * indexable /ads/:domain page for a crawler visit. A crawler has no geo
 * (no cf-ipcountry), so the loader walks `candidateCountries("all")` =
 * ["all", "United States"]. Every acceptance check mirrors the loader:
 *   1. emergency brake `PUBLIC_BRAND_PAGES_INDEXABLE="0"` → static only;
 *   2. the currently resolved discovery provider is real, not demo;
 *   3. the row belongs to `public_search`, the current provider, and the
 *      first page (cursor NULL — broader/cursor pages never match);
 *   4. `fetched_at` parses, is not in the future, and is no older than
 *      `BRAND_PAGE_FRESH_FOR_INDEXING_MS` (7 days);
 *   5. the parsed payload has at least one non-demo ad and neither payload
 *      source nor provider is demo;
 *   6. the candidate domain normalizes through the same public-domain
 *      validator the /ads/:domain route uses (`normalizeBrandPageDomain`);
 *   7. EXACT-KEY PARITY: under the current legacy/shadow/v2 mode, current
 *      provider, and one of the crawler-visible country fallbacks, the
 *      brand-page loader's own key derivation reproduces this row's
 *      cache_key. A keyword row that merely contains a destination URL never
 *      passes — the fingerprint/v2 key cannot match a domain-derived key.
 *
 * A loader-order guard also refuses a domain whose "all" row in the scanned
 * window is usable-but-stale: the loader tries "all" BEFORE "United States"
 * and renders the first usable snapshot, so a stale "all" row would serve
 * noindex even when a fresh "United States" row exists. Never sitemap a page
 * that would serve noindex.
 *
 * Any failure anywhere — missing DB/binding, missing cache table, query or
 * parse error, demo-only provider, emergency flag — returns the unchanged
 * static sitemap with HTTP 200. Sitemap availability never depends on D1
 * health.
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  BRAND_PAGE_MAX_CACHE_AGE_MS,
  candidateCountries,
  deriveBrandPageCacheLookupKey,
  normalizeBrandPageDomain,
} from "~/lib/brand-page.server";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import type { AppEnv } from "~/lib/env.server";
import { canonicalUrl, renderSitemapXml, staticSitemapUrls } from "~/lib/seo";
import type { AdRecord } from "~/lib/types";

/** Hard cap on discovery rows scanned per sitemap render (bounded read). */
export const BRAND_PAGE_SITEMAP_MAX_ROWS = 500;

/** Countries the loader tries for a crawler visit (no cf-ipcountry). */
const CRAWLER_COUNTRIES = candidateCountries(ALL_COUNTRIES_VALUE);

/**
 * Scan window = the loader's usability window (BRAND_PAGE_MAX_CACHE_AGE_MS),
 * NOT the 7-day indexing window: an older-but-usable "all" row inside it can
 * shadow a fresh "United States" row (loader order), so the guard below needs
 * to see it. Rows older than the window can never be rendered by the loader.
 * `idx_discovery_cache_provider_fetched (provider, fetched_at DESC)` serves
 * the provider prefix and the fetched_at range; route_context/cursor are
 * residual filters; LIMIT bounds the read.
 */
const SITEMAP_CACHE_ROWS_SQL = `
  SELECT
    cache_key,
    provider,
    route_context,
    query_fingerprint,
    country,
    cursor,
    payload_json,
    fetched_at,
    expires_at
  FROM discovery_cache_entry
  WHERE provider = ?
    AND route_context = 'public_search'
    AND cursor IS NULL
    AND fetched_at >= ?
  ORDER BY fetched_at DESC
  LIMIT ?
`;

interface SitemapCacheRow {
  cache_key: string;
  provider: string;
  route_context: string;
  query_fingerprint: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
}

export interface PublicSitemapFile {
  body: string;
  contentType: string;
  cacheControl: string;
}

/** The unchanged 13-entry static sitemap — the fallback for every failure. */
export function staticSitemapFile(): PublicSitemapFile {
  return {
    body: renderSitemapXml(staticSitemapUrls()),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}

/**
 * Build the public sitemap: the 13 static URLs followed by deduplicated
 * canonical /ads/<normalized-domain> URLs in deterministic (sorted) order.
 * Never throws — every failure degrades to `staticSitemapFile()`.
 */
export async function buildPublicSitemapFile(env: AppEnv): Promise<PublicSitemapFile> {
  try {
    if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
      return staticSitemapFile();
    }

    const provider = resolveCommercialDiscoveryProvider(env);
    if (provider === "demo" || !env.DB || typeof env.DB.prepare !== "function") {
      return staticSitemapFile();
    }

    const now = new Date();
    const cutoffIso = new Date(now.getTime() - BRAND_PAGE_MAX_CACHE_AGE_MS).toISOString();
    const result = await env.DB
      .prepare(SITEMAP_CACHE_ROWS_SQL)
      .bind(provider, cutoffIso, BRAND_PAGE_SITEMAP_MAX_ROWS)
      .all<SitemapCacheRow>();
    const rows = result.results ?? [];

    const domains = indexableBrandDomains(env, provider, rows, now);
    if (domains.length === 0) {
      return staticSitemapFile();
    }

    return {
      ...staticSitemapFile(),
      body: renderSitemapXml([
        ...staticSitemapUrls(),
        ...domains.map((domain) => canonicalUrl(`/ads/${domain}`)),
      ]),
    };
  } catch (error) {
    // Missing table, query error, parse error — any failure degrades to the
    // unchanged static sitemap; availability never depends on D1 health.
    console.warn("Dynamic sitemap build failed; serving the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return staticSitemapFile();
  }
}

/** Deterministically ordered, deduplicated set of sitemappable brand domains. */
function indexableBrandDomains(
  env: AppEnv,
  provider: string,
  rows: SitemapCacheRow[],
  now: Date,
): string[] {
  const byCacheKey = new Map<string, SitemapCacheRow>();
  const accepted = new Set<string>();

  for (const row of rows) {
    byCacheKey.set(row.cache_key, row);
    for (const domain of indexableDomainsFromRow(env, provider, row, now)) {
      accepted.add(domain);
    }
  }

  // Loader-order guard: the loader tries the "all" key before "United States"
  // and renders the FIRST usable snapshot. A usable-but-stale "all" row would
  // render with noindex even when a fresh "United States" row exists — the
  // domain must not be sitemapped in that case.
  const domains: string[] = [];
  for (const domain of accepted) {
    const allKey = deriveBrandPageCacheLookupKey(env, provider, domain, ALL_COUNTRIES_VALUE);
    const allRow = byCacheKey.get(allKey);
    if (
      allRow &&
      isLoaderUsableSnapshot(allRow, provider, now) &&
      !isIndexableRow(allRow, now)
    ) {
      continue;
    }
    domains.push(domain);
  }

  return domains.sort();
}

/** Domains this single row proves indexable, via exact loader-key parity. */
function indexableDomainsFromRow(
  env: AppEnv,
  provider: string,
  row: SitemapCacheRow,
  now: Date,
): string[] {
  // JS mirrors of the SQL bound so correctness never depends on the query
  // plan (and holds for unfiltered row sets in tests).
  if (row.provider !== provider) return [];
  if (row.route_context !== "public_search") return [];
  if (row.cursor !== null && row.cursor !== undefined) return [];
  if (!isIndexableRow(row, now)) return [];

  const payload = parseSitemapPayload(row.payload_json);
  if (!payload) return [];
  if (payload.source === "demo" || payload.provider === "demo") return [];
  const ads = payload.ads.filter((ad) => ad && typeof ad === "object" && ad.source !== "demo");
  if (ads.length === 0) return [];

  const candidates = new Set<string>();
  const fromKey = domainFromCacheKey(row.cache_key);
  if (fromKey) candidates.add(fromKey);
  if (payload.displayDomain?.trim()) candidates.add(payload.displayDomain.trim());
  for (const ad of ads) {
    for (const value of [ad.landingPageUrl, ad.landingPage?.canonicalUrl, ad.landingPage?.rawUrl]) {
      const domain = domainFromUrl(value);
      if (domain) candidates.add(domain);
    }
  }

  const domains: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeBrandPageDomain(candidate);
    if (!normalized) continue;
    // Exact-key parity under the current mode/provider/crawler countries.
    const keyMatches = CRAWLER_COUNTRIES.some(
      (country) =>
        deriveBrandPageCacheLookupKey(env, provider, normalized.domain, country) ===
        row.cache_key,
    );
    if (keyMatches) {
      domains.push(normalized.domain);
    }
  }
  return domains;
}

/** Within the 7-day indexing window, not in the future, timestamp parses. */
function isIndexableRow(row: SitemapCacheRow, now: Date): boolean {
  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs)) return false;
  const ageMs = now.getTime() - fetchedMs;
  return ageMs >= 0 && ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS;
}

/**
 * Mirror of the loader's `toUsableSnapshot` non-null decision: a row the
 * loader would actually render for this provider (route/context/cursor,
 * parseable non-demo payload with ≥ 1 non-demo ad, age within the 30-day
 * usability window). Does NOT check the 7-day indexing window — callers
 * combine it with `isIndexableRow`.
 */
function isLoaderUsableSnapshot(row: SitemapCacheRow, provider: string, now: Date): boolean {
  if (row.provider !== provider || row.route_context !== "public_search") return false;
  if (row.cursor !== null && row.cursor !== undefined) return false;
  const payload = parseSitemapPayload(row.payload_json);
  if (!payload || payload.source === "demo" || payload.provider === "demo") return false;
  if (!payload.ads.some((ad) => ad && typeof ad === "object" && ad.source !== "demo")) {
    return false;
  }
  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs)) return false;
  const ageMs = now.getTime() - fetchedMs;
  return ageMs >= 0 && ageMs <= BRAND_PAGE_MAX_CACHE_AGE_MS;
}

/** Payload fields the sitemap needs; validated with the cache-reader's rules. */
interface SitemapPayload {
  ads: AdRecord[];
  source: string;
  provider: string | undefined;
  displayDomain: string | undefined;
}

const DISCOVERY_SOURCES = new Set(["meta", "meta_api", "meta_library_browser", "demo", "external"]);

function parseSitemapPayload(value: string): SitemapPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (!Array.isArray(candidate.ads)) return null;
  if (typeof candidate.source !== "string" || !DISCOVERY_SOURCES.has(candidate.source)) {
    return null;
  }
  return {
    ads: candidate.ads as AdRecord[],
    source: candidate.source,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    displayDomain: typeof candidate.displayDomain === "string" ? candidate.displayDomain : undefined,
  };
}

const SEARCH_V2_DOMAIN_KEY_PREFIX = "search-v2:domain:";

/** Registrable domain embedded in a search-v2 domain cache key, if any. */
function domainFromCacheKey(cacheKey: string): string | null {
  if (!cacheKey.startsWith(SEARCH_V2_DOMAIN_KEY_PREFIX)) return null;
  return cacheKey.slice(SEARCH_V2_DOMAIN_KEY_PREFIX.length).split(":")[0] ?? null;
}

/** Hostname (www stripped, lowercased) of a landing URL, if parseable. */
function domainFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}
