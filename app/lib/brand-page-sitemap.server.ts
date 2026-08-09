/**
 * Dynamic /sitemap.xml brand-page entries (/ads/:domain) — cache-only data
 * layer, sibling of app/lib/brand-page.server.ts.
 *
 * ABSOLUTE CONSTRAINT: this module is a pure D1 read. It must NEVER trigger
 * live discovery, Browser Rendering, Meta API calls, provider REST calls,
 * writes, or any other paid operation, for any input. Every domain it returns
 * has been proven to be a page the cache-only brand-page loader would serve as
 * indexable under the CURRENT environment (rollout mode + provider), so the
 * sitemap never points crawlers at an honest shell, a demo-sourced page, or a
 * stale (> 7 days) capture.
 *
 * Read shape (bounded, existing indexes):
 *  1. One scan of `discovery_cache_entry` filtered by the current provider
 *     (equality → `idx_discovery_cache_provider_fetched` (provider,
 *     fetched_at DESC)), `route_context = 'public_search'`, the two crawler
 *     fallback countries ('all' / 'United States'), first page only, and the
 *     7-day indexing window — `LIMIT BRAND_PAGE_SITEMAP_SCAN_LIMIT`. This scan
 *     only DISCOVERS candidate domains (from cached ad destinations and, under
 *     any mode, from safe `search-v2:domain:...:exact:...:page-1` key
 *     structure).
 *  2. One batched verification per derived key using `cache_key IN (...)` —
 *     the primary key index — chunked under D1's bound-parameter cap via
 *     `queryIn`. A candidate is included only when a row exists under the
 *     EXACT key `brandPageCacheLookupKey` derives for it (same function the
 *     loader reads through) and that row passes the loader's usability rules
 *     (route context, provider, first page, non-demo payload with at least one
 *     non-demo ad, `fetched_at` valid and inside [now - 7d, now]).
 *
 * Anything that would make the loader serve a noindex or honest-shell page is
 * excluded here: emergency noindex flag, demo-only provider, missing DB or
 * table, malformed JSON/domains, demo ads, zero ads, stale/future rows, wrong
 * route context / provider / country / key, cursor pages, customer-token-
 * scoped keys, and broader-scope keys. Any query error degrades to an empty
 * list — the caller then serves the unchanged static sitemap.
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FALLBACK_COUNTRIES,
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  brandPageCacheLookupKey,
  normalizeBrandPageDomain,
} from "~/lib/brand-page.server";
import { queryAll, queryIn } from "~/lib/data/d1.server";
import { isDiscoveryCacheRouteCompatible } from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import {
  renderSitemapXml,
  SITEMAP_PATHS,
  staticSitemapFile,
  type PublicSeoFile,
} from "~/lib/seo";

/** Hard bound on the candidate-discovery scan (spec: bounded indexed read). */
export const BRAND_PAGE_SITEMAP_SCAN_LIMIT = 250;
/** Hard bound on unique candidate domains verified per sitemap render. */
export const BRAND_PAGE_SITEMAP_MAX_CANDIDATE_DOMAINS = 120;
/**
 * Tolerance for `fetched_at` slightly in the future (writer clock skew). The
 * scan window is generous so skew cannot hide a candidate; the strict
 * loader-parity check below still rejects any `fetched_at` in the future.
 */
const BRAND_PAGE_SITEMAP_FUTURE_SKEW_MS = 5 * 60 * 1000;

const AD_DISCOVERY_SOURCES: readonly string[] = [
  "meta",
  "meta_api",
  "meta_library_browser",
  "demo",
  "external",
];

interface SitemapCacheRow {
  cache_key: string;
  provider: string;
  route_context: string | null;
  query_fingerprint: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
  browser_ms_used: number | null;
  created_at: string;
  updated_at: string;
}

interface SitemapPayload {
  source: string;
  provider: string | undefined;
  ads: ReadonlyArray<{ source?: unknown; landingPageUrl?: unknown } | null | undefined>;
}

/**
 * Parse a cached payload the same way the loader's read path does
 * (`parseDiscoveryCachePayload` in app/lib/data/ads.server.ts): malformed
 * JSON, non-objects, unknown sources, and non-array ads are all rejected — the
 * loader would reject them too, so the row can never back an indexable page.
 */
function parseSitemapCachePayload(value: string): SitemapPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.source !== "string") {
    return null;
  }
  if (!AD_DISCOVERY_SOURCES.includes(candidate.source)) {
    return null;
  }
  if (candidate.provider !== undefined && typeof candidate.provider !== "string") {
    return null;
  }
  if (!Array.isArray(candidate.ads)) {
    return null;
  }

  return {
    source: candidate.source,
    provider: candidate.provider as string | undefined,
    ads: candidate.ads as SitemapPayload["ads"],
  };
}

/** Hostname of a cached ad destination, or null when malformed/unusable. */
function hostnameFromLandingPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Registrable domain embedded in a safe first-page search-v2 cache key:
 * `search-v2:domain:<domain>:exact:<provider>:<country>:page-1`.
 *
 * Rejects everything that must not leak into the sitemap: broader-scope keys
 * (`:broader:`), cursor pages (final segment != `page-1`), and
 * customer-token-scoped keys (extra `:customer_meta:<hash>` segments make the
 * length wrong). The candidate still has to pass the exact loader-key
 * verification, so a key-parsed domain can never be included on structure
 * alone.
 */
function exactDomainFromSearchV2CacheKey(cacheKey: string): string | null {
  const segments = cacheKey.split(":");
  if (segments.length !== 7) {
    return null;
  }
  if (segments[0] !== "search-v2" || segments[1] !== "domain") {
    return null;
  }
  if (segments[3] !== "exact") {
    return null;
  }
  if (segments[6] !== "page-1") {
    return null;
  }
  const domain = segments[2];
  if (!domain || domain.length > 80) {
    return null;
  }
  return domain;
}

/**
 * Exact loader-parity usability check for a verified row — mirrors
 * `toUsableSnapshot` in brand-page.server.ts plus the 7-day indexability
 * window: the loader would render a snapshot from this row, and that snapshot
 * is fresh enough to carry no robots meta.
 */
function isIndexableLoaderRow(
  row: SitemapCacheRow,
  provider: string,
  nowMs: number,
): boolean {
  if (row.provider !== provider) {
    return false;
  }
  // Interactive public_search cache only — scheduled scan/warmup entries are
  // shallow and never back a public brand page (FIX-1).
  if (!isDiscoveryCacheRouteCompatible("public_search", row.route_context)) {
    return false;
  }
  // First page only — the loader reads the page-1 key exclusively.
  if (row.cursor !== null && row.cursor !== "page-1") {
    return false;
  }

  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs)) {
    return false;
  }
  const ageMs = nowMs - fetchedMs;
  // Future rows are invalid to the loader (ageMs < 0 → null) and stale rows
  // (> 7 days) render with noindex — both excluded here.
  if (ageMs < 0 || ageMs > BRAND_PAGE_FRESH_FOR_INDEXING_MS) {
    return false;
  }

  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return false;
  }
  // Demo-sourced entries are never presented as a brand's real ads.
  if (payload.source === "demo" || payload.provider === "demo") {
    return false;
  }
  const nonDemoAds = payload.ads.filter((ad) => ad && ad.source !== "demo");
  return nonDemoAds.length > 0;
}

/**
 * Read the set of domains whose /ads/:domain page would render indexable right
 * now, using ONLY the discovery cache. Returns [] (never throws) when any
 * input makes the dynamic set unknowable: emergency noindex flag, demo-only
 * provider, missing DB/table, query errors, or malformed rows.
 */
export async function loadIndexableBrandPageDomains(
  env: AppEnv,
  now: Date = new Date(),
): Promise<string[]> {
  try {
    if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
      return [];
    }
    const provider = resolveCommercialDiscoveryProvider(env);
    if (provider === "demo" || !env.DB) {
      return [];
    }

    const nowMs = now.getTime();
    const scanRows = await queryAll<SitemapCacheRow>(
      env,
      `
        SELECT
          cache_key,
          provider,
          route_context,
          query_fingerprint,
          country,
          cursor,
          payload_json,
          fetched_at,
          expires_at,
          browser_ms_used,
          created_at,
          updated_at
        FROM discovery_cache_entry
        WHERE provider = ?
          AND route_context = 'public_search'
          AND country IN ('all', 'United States')
          AND (cursor IS NULL OR cursor = 'page-1')
          AND fetched_at >= ?
          AND fetched_at <= ?
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      provider,
      new Date(nowMs - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString(),
      new Date(nowMs + BRAND_PAGE_SITEMAP_FUTURE_SKEW_MS).toISOString(),
      BRAND_PAGE_SITEMAP_SCAN_LIMIT,
    );

    // Candidate discovery, NOT inclusion: the scan only tells us which domains
    // real cached evidence points at. Inclusion requires the exact loader-key
    // verification below. Key-structure candidates are parsed in EVERY rollout
    // mode (search-v2 rows may linger from a previous shadow/v2 rollout); the
    // verification step derives the mode-correct loader key, so a domain only
    // included when the loader would actually read a fresh row for it.
    const candidates = new Set<string>();
    for (const row of scanRows) {
      const payload = parseSitemapCachePayload(row.payload_json);
      if (!payload || payload.source === "demo" || payload.provider === "demo") {
        continue;
      }
      for (const ad of payload.ads) {
        const hostname = hostnameFromLandingPageUrl(ad?.landingPageUrl);
        if (hostname) {
          candidates.add(hostname);
        }
      }
      const keyDomain = exactDomainFromSearchV2CacheKey(row.cache_key);
      if (keyDomain) {
        candidates.add(keyDomain);
      }
    }
    if (candidates.size === 0) {
      return [];
    }

    // Normalize through the exact same public-domain validator the /ads/:domain
    // route uses, then cap deterministically (sorted, so the cap is stable).
    const normalizedDomains: string[] = [];
    for (const candidate of [...candidates].sort()) {
      if (normalizedDomains.length >= BRAND_PAGE_SITEMAP_MAX_CANDIDATE_DOMAINS) {
        break;
      }
      const brand = normalizeBrandPageDomain(candidate);
      if (brand && !normalizedDomains.includes(brand.domain)) {
        normalizedDomains.push(brand.domain);
      }
    }

    // Derive the EXACT key the loader would read for each candidate under the
    // crawler-visible country fallbacks, then verify those keys in one batched
    // primary-key read. A keyword row that merely contains a destination URL
    // never verifies: its key is not the loader key for that domain.
    const keyToDomain = new Map<string, string>();
    for (const domain of normalizedDomains) {
      for (const country of BRAND_PAGE_FALLBACK_COUNTRIES) {
        keyToDomain.set(brandPageCacheLookupKey(env, provider, domain, country), domain);
      }
    }

    const verifiedRows = await queryIn<SitemapCacheRow>(env, {
      buildSql: (placeholders) => `
        SELECT
          cache_key,
          provider,
          route_context,
          query_fingerprint,
          country,
          cursor,
          payload_json,
          fetched_at,
          expires_at,
          browser_ms_used,
          created_at,
          updated_at
        FROM discovery_cache_entry
        WHERE cache_key IN (${placeholders})
      `,
      values: [...keyToDomain.keys()],
    });

    const rowByKey = new Map(verifiedRows.map((row) => [row.cache_key, row]));
    const included = new Set<string>();
    for (const [cacheKey, domain] of keyToDomain) {
      const row = rowByKey.get(cacheKey);
      if (row && isIndexableLoaderRow(row, provider, nowMs)) {
        included.add(domain);
      }
    }

    return [...included].sort();
  } catch {
    // Missing table, query error, or any unexpected failure: the caller serves
    // the unchanged static sitemap. Sitemap availability never depends on D1.
    return [];
  }
}

/**
 * The dynamic /sitemap.xml file. The 13 static paths are ALWAYS present;
 * /ads/:domain entries are appended only for domains the cache-only brand-page
 * loader would serve as indexable right now (`loadIndexableBrandPageDomains`).
 * The D1 read is bounded and cache-only — it can never trigger live
 * discovery — and any failure (missing DB/table, query error, demo-only
 * provider, emergency noindex flag) degrades to the unchanged static sitemap,
 * so sitemap availability never depends on D1.
 *
 * Lives in this server-only module (not app/lib/seo.ts, which routes import
 * into client bundles): the react-router server-only boundary forbids client
 * code from referencing `.server` modules, and this file is exactly that.
 */
export async function publicSitemapFile(env: AppEnv | undefined): Promise<PublicSeoFile> {
  if (!env) {
    // No environment to read D1 from (tests, offline tooling): the unchanged
    // static sitemap, without even touching D1.
    return staticSitemapFile();
  }

  let adsPaths: string[] = [];
  try {
    adsPaths = (await loadIndexableBrandPageDomains(env)).map((domain) => `/ads/${domain}`);
  } catch (error) {
    // Last-resort guard (the loader already degrades internally): a sitemap
    // render must never fail because of a D1 hiccup.
    console.warn("Dynamic sitemap fell back to static entries.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    adsPaths = [];
  }

  return {
    body: renderSitemapXml([...SITEMAP_PATHS, ...adsPaths]),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
