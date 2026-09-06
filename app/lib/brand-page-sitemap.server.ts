/**
 * Dynamic /sitemap.xml brand-page entries — cache-only, bounded D1 reads.
 *
 * Contract (mirrors the comment above SITEMAP_XML in app/lib/seo.ts): the
 * sitemap lists an /ads/:domain page ONLY when that page would ACTUALLY
 * render indexable under the current environment. The final gate is exact
 * loader-key parity — for each candidate domain we reproduce the cache key
 * the /ads/:domain loader would derive right now (same
 * `deriveBrandPageCacheLookup` + `toUsableBrandPageCacheSnapshot` functions,
 * same provider resolution, crawler-visible country fallback of "all" then
 * "United States") and only include the domain when that key resolves to a
 * snapshot still inside the seven-day indexing window.
 *
 * Zero-cost constraint, same as the brand-page loader: this module NEVER
 * triggers live discovery, Browser Rendering, Meta API calls, or any paid
 * operation. The only I/O is one bounded indexed SELECT (provider +
 * route_context + first-page cursor, ordered by the existing
 * idx_discovery_cache_provider_fetched index, LIMIT-capped) plus exact-key
 * point reads that reuse `readDiscoveryCacheEntryCacheOnly`.
 *
 * Failure posture: missing DB, missing cache table, or any query/parse error
 * degrades to the unchanged static sitemap (HTTP 200) — sitemap availability
 * never depends on D1 health.
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  candidateCountries,
  deriveBrandPageCacheLookup,
  normalizeBrandPageDomain,
  toUsableBrandPageCacheSnapshot,
} from "~/lib/brand-page.server";
import { readDiscoveryCacheEntryCacheOnly } from "~/lib/discovery-cache.server";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { publicSeoFileForPathname, sitemapXmlForPathnames } from "~/lib/seo";

/** Bounded enumeration: never scan more than this many cache rows. */
export const SITEMAP_DISCOVERY_ROW_LIMIT = 200;
/** Bounded confirmation: never confirm more than this many distinct domains. */
export const SITEMAP_MAX_BRAND_DOMAINS = 40;
/**
 * Crawler-visible country fallback used for loader-key parity: exactly the
 * loader's `candidateCountries` list for a visitor with no geo signal
 * (defaultCountryForVisitor(null) → "all" → ["all", "United States"]).
 */
export const SITEMAP_CRAWLER_COUNTRIES: readonly string[] = candidateCountries(
  ALL_COUNTRIES_VALUE,
);

interface SitemapCandidateRow {
  cache_key: string;
  cursor: string | null;
  fetched_at: string;
  payload_json: string;
}

interface SitemapUsablePayload {
  ads: Array<{ landingPageUrl?: string | null; source?: string }>;
}

/**
 * One bounded, index-backed SELECT for candidate rows: current provider's
 * interactive public_search cache, first page only, fetched within the
 * seven-day indexing window. Returns null (→ static sitemap) on any DB error,
 * including a missing table.
 */
async function listRecentPublicSearchRows(
  env: AppEnv,
  provider: string,
  nowMs: number,
): Promise<SitemapCandidateRow[] | null> {
  const cutoff = new Date(nowMs - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString();
  try {
    return await queryAll<SitemapCandidateRow>(
      env,
      `
        SELECT cache_key, cursor, fetched_at, payload_json
        FROM discovery_cache_entry
        WHERE provider = ?
          AND route_context = 'public_search'
          AND (cursor IS NULL OR cursor = 'page-1')
          AND fetched_at >= ?
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      provider,
      cutoff,
      SITEMAP_DISCOVERY_ROW_LIMIT,
    );
  } catch (error) {
    console.warn("Brand-page sitemap enumeration failed; serving the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

/**
 * Row-level gate, mirroring toUsableBrandPageCacheSnapshot's honesty rules:
 * parsed JSON only, real (non-demo) payload source/provider, at least one
 * non-demo ad, fetched_at parseable, not in the future, and within the
 * seven-day indexing window.
 */
function parseSitemapUsablePayload(
  row: SitemapCandidateRow,
  nowMs: number,
): SitemapUsablePayload | null {
  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs) || fetchedMs > nowMs) {
    return null;
  }
  if (nowMs - fetchedMs > BRAND_PAGE_FRESH_FOR_INDEXING_MS) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const payload = parsed as { ads?: unknown; source?: string; provider?: string };
  if (payload.source === "demo" || payload.provider === "demo") {
    return null;
  }
  const ads = Array.isArray(payload.ads)
    ? payload.ads.filter(
        (ad): ad is { landingPageUrl?: string | null; source?: string } =>
          Boolean(ad) && typeof ad === "object" && (ad as { source?: string }).source !== "demo",
      )
    : [];
  if (ads.length === 0) {
    return null;
  }
  return { ads };
}

/**
 * Candidate domains from safe cache-key structure and/or cached ad
 * destinations. The search-v2 exact domain key carries its registrable domain
 * ("search-v2:domain:<registrable>:exact:<provider>:<country>:page-1");
 * broader-scope and cursor-page variants are rejected here. Ads contribute
 * their landing-page hostname. Every candidate is re-validated through the
 * same public-domain validator /ads/:domain uses, and only the loader-key
 * confirmation below decides inclusion — a keyword row merely containing a
 * destination URL can never vouch for a domain whose own page key is absent.
 */
function candidateDomainsFromRow(row: SitemapCandidateRow, payload: SitemapUsablePayload): string[] {
  const candidates: string[] = [];

  const parts = row.cache_key.split(":");
  if (
    parts.length === 7 &&
    parts[0] === "search-v2" &&
    parts[1] === "domain" &&
    parts[3] === "exact" &&
    parts[6] === "page-1"
  ) {
    candidates.push(parts[2] ?? "");
  }

  for (const ad of payload.ads) {
    const host = hostnameFromLandingPageUrl(ad.landingPageUrl);
    if (host) {
      candidates.push(host);
    }
  }

  return candidates;
}

function hostnameFromLandingPageUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Exact loader-key parity check. For each crawler-visible country, derive the
 * key the /ads/:domain loader would read for this domain under the CURRENT
 * rollout mode and provider, read that exact key cache-only, and accept only
 * when the entry yields a snapshot still inside the seven-day indexing
 * window. This is the same derive → read → snapshot sequence the loader runs,
 * so a sitemap row is only ever emitted for a page the loader would render
 * indexable. Customer-token-scoped and broader/cursor keys never match a
 * derived loader key and are therefore never confirmed.
 */
async function confirmIndexableLoaderKey(
  env: AppEnv,
  provider: string,
  domain: string,
  now: Date,
): Promise<boolean> {
  for (const country of SITEMAP_CRAWLER_COUNTRIES) {
    const lookup = deriveBrandPageCacheLookup(env, provider, domain, country);
    const entry = await readDiscoveryCacheEntryCacheOnly(env, { provider, ...lookup });
    const snapshot = toUsableBrandPageCacheSnapshot(entry, now);
    if (snapshot?.freshForIndexing) {
      return true;
    }
  }
  return false;
}

/**
 * Load the indexable /ads/:domain set for the current environment, in
 * deterministic (sorted) order. Returns [] — never throws — whenever the
 * indexable flag is off, the provider is demo, D1 is missing, or any read or
 * parse fails, so callers always fall back to the static sitemap.
 */
export async function loadIndexableBrandPageDomains(
  env: AppEnv,
  now: Date = new Date(),
): Promise<string[]> {
  // Emergency noindex brake — same flag the /ads/:domain route honors.
  if ((env.PUBLIC_BRAND_PAGES_INDEXABLE ?? "").trim() === "0") {
    return [];
  }

  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    return [];
  }

  const nowMs = now.getTime();
  const rows = await listRecentPublicSearchRows(env, provider, nowMs);
  if (!rows) {
    return [];
  }

  const candidates = new Set<string>();
  for (const row of rows) {
    const payload = parseSitemapUsablePayload(row, nowMs);
    if (!payload) {
      continue;
    }
    for (const raw of candidateDomainsFromRow(row, payload)) {
      const normalized = normalizeBrandPageDomain(raw);
      if (normalized) {
        candidates.add(normalized.domain);
      }
    }
  }

  const domains = [...candidates].sort().slice(0, SITEMAP_MAX_BRAND_DOMAINS);
  const confirmed: string[] = [];
  await Promise.all(
    domains.map(async (domain) => {
      if (await confirmIndexableLoaderKey(env, provider, domain, now)) {
        confirmed.push(domain);
      }
    }),
  );
  // Re-sort so the result is deterministic regardless of promise completion order.
  return confirmed.sort();
}

/**
 * Request-time /sitemap.xml file: the static 13-path skeleton plus every
 * indexable /ads/:domain entry when D1 is healthy, otherwise the unchanged
 * static sitemap. Never throws and never triggers live discovery.
 */
export async function publicSitemapFile(env: AppEnv, now: Date = new Date()) {
  // /sitemap.xml is always in the static file map, but keep the fallback
  // explicit so the return type is never null and the response path stays
  // byte-identical to the pre-dynamic sitemap (same builder, same constants).
  const staticFile =
    publicSeoFileForPathname("/sitemap.xml") ?? {
      body: sitemapXmlForPathnames(),
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  try {
    const domains = await loadIndexableBrandPageDomains(env, now);
    if (domains.length === 0) {
      return staticFile;
    }
    return {
      body: sitemapXmlForPathnames(domains.map((domain) => `/ads/${domain}`)),
      contentType: staticFile.contentType,
      cacheControl: staticFile.cacheControl,
    };
  } catch (error) {
    // A dynamic-generation hiccup must degrade to the static sitemap, never 500.
    console.warn("Dynamic sitemap generation failed; serving the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return staticFile;
  }
}
