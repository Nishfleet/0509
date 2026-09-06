/**
 * Dynamic /sitemap.xml brand-page entries — the cache-only companion to the
 * /ads/:domain loader (app/lib/brand-page.server.ts).
 *
 * ZERO-COST CONSTRAINT: this module reads D1 only. It never triggers live
 * discovery, Browser Rendering, Meta API calls, provider REST calls, writes,
 * or paid work of any kind.
 *
 * INCLUSION CONTRACT (mirrors the loader's indexable state exactly):
 *   - PUBLIC_BRAND_PAGES_INDEXABLE is not "0" (the emergency noindex brake);
 *   - the currently resolved discovery provider is real, never demo;
 *   - the row is a discovery_cache_entry for public_search, the current
 *     provider, and the first page (cursor NULL or "page-1");
 *   - fetched_at is valid, not in the future, and no older than
 *     BRAND_PAGE_FRESH_FOR_INDEXING_MS (seven days);
 *   - the parsed payload has at least one non-demo ad and neither the payload
 *     source nor the payload provider is demo;
 *   - the candidate domain passes normalizeBrandPageDomain — the same public
 *     domain validator /ads/:domain uses;
 *   - under the current legacy/shadow/v2 rollout mode, the current provider,
 *     and a crawler-visible country fallback ("all" or "United States"), the
 *     brand-page loader would derive and read that exact cache key — proven
 *     via deriveBrandPageLoaderCacheKey against the very rows scanned, so a
 *     sitemap entry is never inferred from an unrelated keyword row, a
 *     customer-token-scoped key, or a broader/cursor-page key.
 *
 * Any failure (missing DB binding, missing cache table, query or parse error,
 * demo-only provider, emergency flag) returns the unchanged static sitemap —
 * sitemap availability never depends on D1 health.
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  deriveBrandPageLoaderCacheKey,
  normalizeBrandPageDomain,
} from "~/lib/brand-page.server";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import type { AppEnv } from "~/lib/env.server";
import { buildSitemapXml, staticSitemapFile } from "~/lib/seo";

/** Hard bound on the cache scan per sitemap render, newest rows first. */
export const BRAND_SITEMAP_MAX_ROWS = 1000;

/**
 * The loader tries [visitorCountry, "all", "United States"]. A crawler's
 * country is not knowable at sitemap time, so an entry is only emitted when
 * the exact loader key exists for one of the country fallbacks every visitor
 * is guaranteed to reach.
 */
const BRAND_SITEMAP_COUNTRY_FALLBACKS = [ALL_COUNTRIES_VALUE, "United States"] as const;

interface BrandSitemapCacheRow {
  cache_key: string;
  route_context: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
}

/**
 * One bounded provider-scoped read: rows are filtered to the interactive
 * public_search route context and first-page cursor, and ordered by
 * fetched_at DESC so the LIMIT prefers recently captured brands. This matches
 * the existing idx_discovery_cache_provider_fetched (provider, fetched_at
 * DESC) index; route_context and cursor are residual filters on that scan.
 */
const BRAND_SITEMAP_QUERY = `
  SELECT cache_key, route_context, country, cursor, payload_json, fetched_at
  FROM discovery_cache_entry
  WHERE provider = ? AND route_context = 'public_search'
    AND (cursor IS NULL OR cursor = 'page-1')
  ORDER BY fetched_at DESC
  LIMIT ?
`;

/**
 * Indexable brand-page domains for the sitemap, sorted and deduplicated.
 * Returns [] (never throws) whenever the environment cannot prove a single
 * indexable brand page: no DB, demo-only provider, emergency flag, missing
 * cache table, or any query/parse error.
 */
export async function loadIndexableBrandPageDomains(
  env: AppEnv,
  now: Date = new Date(),
): Promise<string[]> {
  if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
    return [];
  }
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    return [];
  }

  let rows: BrandSitemapCacheRow[];
  try {
    const result = await env.DB.prepare(BRAND_SITEMAP_QUERY)
      .bind(provider, BRAND_SITEMAP_MAX_ROWS)
      .all<BrandSitemapCacheRow>();
    rows = result.results ?? [];
  } catch (error) {
    // Missing cache table or any query hiccup: degrade to the static sitemap.
    console.warn("Brand-page sitemap cache read failed; using the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }

  const nowMs = now.getTime();
  const freshCutoffMs = nowMs - BRAND_PAGE_FRESH_FOR_INDEXING_MS;
  const validLoaderKeys = new Set<string>();
  const candidateDomains = new Set<string>();

  for (const row of rows) {
    // Same freshness gate as the loader: valid, not in the future, ≤ 7 days.
    const fetchedMs = Date.parse(row.fetched_at);
    if (!Number.isFinite(fetchedMs) || fetchedMs > nowMs || fetchedMs < freshCutoffMs) {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const payloadRecord = payload as { source?: unknown; provider?: unknown; ads?: unknown };
    if (payloadRecord.source === "demo" || payloadRecord.provider === "demo") {
      continue;
    }
    if (!Array.isArray(payloadRecord.ads)) {
      continue;
    }

    let nonDemoAdCount = 0;
    for (const ad of payloadRecord.ads) {
      if (!ad || typeof ad !== "object") {
        continue;
      }
      const adRecord = ad as { source?: unknown; landingPageUrl?: unknown };
      if (adRecord.source === "demo") {
        continue;
      }
      nonDemoAdCount += 1;
      const landingUrl =
        typeof adRecord.landingPageUrl === "string" ? adRecord.landingPageUrl : null;
      if (landingUrl) {
        const candidate = domainFromLandingUrl(landingUrl);
        if (candidate) {
          candidateDomains.add(candidate);
        }
      }
    }
    if (nonDemoAdCount === 0) {
      continue;
    }

    const keyDomain = domainFromV2CacheKey(row.cache_key);
    if (keyDomain) {
      candidateDomains.add(keyDomain);
    }
    validLoaderKeys.add(row.cache_key);
  }

  // Exact loader-key parity: a candidate only makes the sitemap when the
  // brand-page loader would derive and read that key for a crawler-visible
  // country fallback under the current mode/provider. Customer-token-scoped,
  // broader, cursor-page, and unrelated keyword keys never match a derived
  // loader key, so they can never leak into the sitemap.
  const indexable: string[] = [];
  for (const candidate of candidateDomains) {
    const brand = normalizeBrandPageDomain(candidate);
    if (!brand) {
      continue;
    }
    for (const country of BRAND_SITEMAP_COUNTRY_FALLBACKS) {
      const loaderKey = deriveBrandPageLoaderCacheKey(env, provider, brand.domain, country);
      if (validLoaderKeys.has(loaderKey)) {
        indexable.push(brand.domain);
        break;
      }
    }
  }

  return [...new Set(indexable)].sort();
}

/** The full sitemap file object for the Worker: dynamic entries when proven, static otherwise. */
export interface PublicSitemapFile {
  body: string;
  contentType: string;
  cacheControl: string;
}

export async function buildPublicSitemapFile(env: AppEnv): Promise<PublicSitemapFile> {
  try {
    const domains = await loadIndexableBrandPageDomains(env);
    return {
      body: buildSitemapXml(domains.map((domain) => `/ads/${domain}`)),
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  } catch (error) {
    console.warn("Dynamic sitemap build failed; serving the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return staticSitemapFile();
  }
}

/** www-stripped hostname of an ad's landing URL — the /ads/:domain raw param shape. */
function domainFromLandingUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.trim().toLowerCase().replace(/^www\./, "");
  return host || null;
}

/**
 * v2 domain cache keys embed the searched registrable domain
 * (`search-v2:domain:<domain>:exact:<provider>:<country>:<page>`), so the key
 * itself is a safe candidate source in v2 mode. Only the exact-scope shape is
 * parsed: broader and text keys never produce candidates, and any candidate
 * still has to pass the exact loader-key parity check above.
 */
function domainFromV2CacheKey(cacheKey: string): string | null {
  if (!cacheKey.startsWith("search-v2:domain:")) {
    return null;
  }
  const parts = cacheKey.split(":");
  if (parts.length !== 7 || parts[3] !== "exact") {
    return null;
  }
  return parts[2] || null;
}
