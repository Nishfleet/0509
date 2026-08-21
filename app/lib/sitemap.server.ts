/**
 * Dynamic sitemap entries for indexable /ads/:domain brand pages.
 *
 * The static sitemap in app/lib/seo.ts deliberately lists no /ads/* path —
 * the set must be dynamic. This module generates it from existing
 * `discovery_cache_entry` rows at sitemap-render time, following the
 * strategy documented above SITEMAP_XML in app/lib/seo.ts:
 *
 *   1. Only rows that WOULD RENDER the indexable brand-page state qualify:
 *      - public_search route context (scheduled scan/warmup entries are
 *        shallow and never back a public page),
 *      - non-demo provider AND payload (sample data is never presented as a
 *        brand's real ads on a public page),
 *      - ads present in the payload (a zero-row would render the honest
 *        "haven't checked recently" shell, which self-noindexes),
 *      - fetched_at within the 7-day freshness window
 *        (BRAND_PAGE_FRESH_FOR_INDEXING_MS) — older captures render with an
 *        honest freshness line but must not rank.
 *   2. Domain recovery is strictly lossless-only: a row maps to a brand page
 *      ONLY when its cache key or payload carries the registrable domain
 *      (search-v2 domain keys embed it; v2 payloads carry searchIntent +
 *      displayDomain). Legacy fingerprint keys are un-mappable and skipped —
 *      we never guess a domain.
 *   3. The emergency brake PUBLIC_BRAND_PAGES_INDEXABLE="0" (noindex on
 *      every /ads/* page) suppresses dynamic entries entirely, and demo
 *      provider environments (no real cache to render) are skipped too, so
 *      the sitemap can never list a page that serves noindex.
 *   4. This is a bounded cache read only — sitemap generation never triggers
 *      live discovery, Browser Rendering, or any paid operation.
 */

import { normalizeBrandPageDomain, BRAND_PAGE_FRESH_FOR_INDEXING_MS } from "~/lib/brand-page.server";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { renderSitemapXml, SITEMAP_STATIC_ENTRIES, type SitemapEntry } from "~/lib/seo";

/**
 * Hard bound on dynamic brand-page entries per sitemap render. Keeps the
 * D1 read, the payload parsing, and the sitemap itself bounded (Google's
 * limit is 50k URLs per sitemap — 500 fresh brand pages is a deliberate
 * crawl-budget ceiling for this acquisition channel).
 */
export const SITEMAP_BRAND_PATH_LIMIT = 500;

/** Subset of discovery_cache_entry columns the sitemap read needs. */
export interface SitemapCacheRow {
  cache_key: string;
  provider: string;
  route_context: string;
  payload_json: string;
  fetched_at: string;
}

/** Tolerant parse of the cached SearchResponse — only the fields we read. */
interface SitemapCachePayload {
  ads: unknown[];
  source?: unknown;
  provider?: unknown;
  searchIntent?: unknown;
  displayDomain?: unknown;
}

function parseSitemapCachePayload(value: string): SitemapCachePayload | null {
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
  if (!Array.isArray(candidate.ads)) {
    return null;
  }
  return candidate as unknown as SitemapCachePayload;
}

/**
 * Recover the registrable brand domain a cache row maps to, or null when the
 * row cannot be losslessly mapped to an /ads/:domain page:
 * - search-v2 domain keys embed the domain and the search scope:
 *   `search-v2:domain:<registrable-domain>:<scope>:<provider>:<country>:<cursor>`.
 *   Only `exact` scope qualifies — the brand-page loader derives its lookup
 *   key with scope "exact" (deriveCacheLookup in brand-page.server.ts), so a
 *   broader row would render the noindex shell, never an indexable page.
 * - v2 payloads (including v2 rows stored under legacy-shaped keys) carry
 *   `searchIntent: "domain"` + `displayDomain`.
 * - legacy fingerprint keys carry no recoverable domain — skipped, never
 *   guessed.
 * The candidate always goes through the same `normalizeBrandPageDomain` the
 * route uses, so anything the page would 404 on is excluded here.
 */
export function brandDomainFromSitemapCacheRow(row: SitemapCacheRow): string | null {
  const keyParts = row.cache_key.split(":");
  if (keyParts[0] === "search-v2" && keyParts[1] === "domain") {
    // The key embeds the registrable domain and the search scope:
    // `search-v2:domain:<registrable-domain>:<scope>:<provider>:<country>:<cursor>`.
    // Only `exact` scope qualifies — the brand-page loader derives its lookup
    // key with scope "exact" (deriveCacheLookup in brand-page.server.ts), so a
    // broader row would render the noindex shell, never an indexable page.
    // Explicitly NOT falling through to the payload below: the scope in the
    // key is the authoritative render-scope fact.
    if (keyParts[3] !== "exact" || !keyParts[2]) {
      return null;
    }
    return normalizeBrandPageDomain(keyParts[2])?.domain ?? null;
  }

  // Legacy-shaped keys carry no scope; a v2 payload on such a row is the only
  // lossless signal (legacy fingerprint keys have no recoverable domain and
  // are skipped — never guessed).
  const payload = parseSitemapCachePayload(row.payload_json);
  if (payload?.searchIntent === "domain") {
    const display = payload.displayDomain;
    if (typeof display === "string" && display.trim()) {
      return normalizeBrandPageDomain(display)?.domain ?? null;
    }
  }

  return null;
}

/**
 * Mirror of the brand-page loader's indexability rules (toUsableSnapshot in
 * brand-page.server.ts): the row must render the indexable page state, not a
 * noindex variant. route_context/provider/age are also filtered in SQL — the
 * JS mirror keeps the pure core independently correct and testable.
 */
export function isIndexableBrandPageRow(row: SitemapCacheRow, now: Date): boolean {
  if (row.route_context !== "public_search") {
    return false;
  }
  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return false;
  }
  // Never present sample data as a brand's real ads on a public page.
  // Legacy rows may still carry a demo source even though new captures cannot.
  if (
    payload.source === "demo" ||
    payload.provider === "demo"
  ) {
    return false;
  }
  const ads = payload.ads.filter((ad) => ad && (ad as { source?: unknown }).source !== "demo");
  if (ads.length === 0) {
    return false;
  }

  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs)) {
    return false;
  }
  const ageMs = now.getTime() - fetchedMs;
  return ageMs >= 0 && ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS;
}

/**
 * Pure core: reduce cache rows (ordered newest-first) to deduped, bounded
 * /ads/:domain sitemap entries that would render indexable. Each entry
 * carries a `lastmod` derived from the cache row's `fetched_at` (the honest
 * freshness signal — when we last saw real ads for this brand) plus
 * `changefreq=weekly` and `priority=0.6` (brand pages are secondary to the
 * funnel but worth periodic re-crawl). Kept separate from the D1 read so the
 * filtering rules are unit-testable without a database.
 */
export function indexableBrandPageEntriesFromRows(
  rows: readonly SitemapCacheRow[],
  now: Date = new Date(),
): SitemapEntry[] {
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  for (const row of rows) {
    if (!isIndexableBrandPageRow(row, now)) {
      continue;
    }
    const domain = brandDomainFromSitemapCacheRow(row);
    if (!domain || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    const fetchedDate = row.fetched_at.slice(0, 10);
    entries.push({
      path: `/ads/${domain}`,
      lastmod: fetchedDate,
      changefreq: "weekly",
      priority: "0.6",
    });
    if (entries.length >= SITEMAP_BRAND_PATH_LIMIT) {
      break;
    }
  }
  return entries;
}

/**
 * Read the bounded candidate set of indexable brand-page cache rows.
 * Cache-only: one SELECT, never a live-provider call. Any hiccup (missing
 * table on a fresh D1, unparseable rows) degrades to the static sitemap,
 * never a 500.
 */
export async function loadIndexableBrandPageEntries(
  env: AppEnv,
  now: Date = new Date(),
): Promise<SitemapEntry[]> {
  if (!env.DB) {
    return [];
  }

  // Emergency brake: every /ads/* page serves noindex — never sitemap it.
  if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
    return [];
  }

  const cutoffIso = new Date(now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString();
  try {
    const rows = await queryAll<SitemapCacheRow>(
      env,
      `
        SELECT cache_key, provider, route_context, payload_json, fetched_at
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND fetched_at >= ?
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      cutoffIso,
      SITEMAP_BRAND_PATH_LIMIT,
    );
    return indexableBrandPageEntriesFromRows(rows, now);
  } catch (error) {
    if (isMissingSitemapTableError(error)) {
      return [];
    }
    throw error;
  }
}

/** Degrade to the static sitemap when a fresh D1 has no discovery cache table. */
function isMissingSitemapTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("discovery_cache_entry")
  );
}

/**
 * Full production sitemap body: static funnel entries first (with changefreq
 * and priority), then the dynamic indexable brand-page entries (with lastmod
 * from their cache fetched_at).
 */
export function buildSitemapXml(brandEntries: readonly SitemapEntry[]): string {
  return renderSitemapXml([...SITEMAP_STATIC_ENTRIES, ...brandEntries]);
}

/** Sitemap file shape consumed by workers/app.ts (publicSeoFileForPathname's). */
export async function publicSitemapFile(env: AppEnv): Promise<{
  body: string;
  contentType: string;
  cacheControl: string;
}> {
  return {
    body: buildSitemapXml(await loadIndexableBrandPageEntries(env)),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
