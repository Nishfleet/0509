/**
 * Dynamic public sitemap — the static URLs plus /ads/:domain brand-page
 * entries, generated from the discovery cache at sitemap-render time.
 *
 * This implements the rules documented above SITEMAP_XML in app/lib/seo.ts:
 *   1. No static "/ads/..." list — the set is dynamic.
 *   2. Entries come from discovery_cache_entry rows that would render the
 *      indexable brand-page state (public_search route context, non-demo
 *      source, ads present, fetched_at within the 7-day indexing window), so
 *      we never sitemap a page that serves noindex or the "haven't checked
 *      recently" shell — crawl budget only goes to pages with real cached ads.
 *   3. Pure cache read at sitemap-render time — never triggers live discovery.
 *
 * Cache-READ-ONLY by construction: the only I/O here is one bounded D1 read
 * through `listFreshPublicSearchCacheEntries` + the same per-row usability
 * predicate the brand-page loader itself uses (`toUsableSnapshot`).
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  normalizeBrandPageDomain,
  toUsableSnapshot,
} from "~/lib/brand-page.server";
import { listFreshPublicSearchCacheEntries } from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { buildSitemapXml, canonicalUrl, SITEMAP_PATHS } from "~/lib/seo";

export interface PublicSitemapFile {
  body: string;
  contentType: string;
  cacheControl: string;
}

/**
 * Derive the brand-page domain a cache row backs, or null when the row is not
 * a domain-intent search we can map back to a URL.
 *
 * The search-v2 domain cache key encodes the registrable domain directly
 * (`search-v2:domain:nykaa.com:exact:<provider>:<country>:<cursor>`). Legacy
 * fingerprint keys hash the query and carry no domain, so they cannot be
 * listed — in shadow/legacy rollouts the same live fetch also writes the v2
 * key (the shadow comparison runs the v2 pipeline), so every domain with an
 * indexable legacy row has a v2 row to list here. The payload's
 * `displayDomain` is a second honest source when present.
 */
export function brandPageDomainFromCacheRow(input: {
  cacheKey: string;
  payload: { displayDomain?: string | null } | null;
}): string | null {
  const candidate =
    parseSearchV2DomainCacheKeyDomain(input.cacheKey) ??
    input.payload?.displayDomain?.trim().toLowerCase() ??
    null;
  if (!candidate) {
    return null;
  }
  // Only emit domains whose /ads/:domain route would render (never a 404).
  return normalizeBrandPageDomain(candidate)?.domain ?? null;
}

function parseSearchV2DomainCacheKeyDomain(cacheKey: string): string | null {
  const segments = cacheKey.split(":");
  // ["search-v2", "domain", <registrableDomain>, <scope>, ...]
  if (
    segments.length < 4 ||
    segments[0] !== "search-v2" ||
    segments[1] !== "domain"
  ) {
    return null;
  }
  // The brand-page loader only reads "exact"-scope keys — a broader-only row
  // would not back an indexable page, so it must not be listed either.
  if (segments[3] !== "exact") {
    return null;
  }
  const domain = segments[2]?.trim().toLowerCase();
  return domain || null;
}

/**
 * Domains whose /ads/:domain page would currently render the indexable
 * brand-page state, deduplicated and sorted. Returns [] when D1 is absent or
 * no commercial provider is configured (brand pages then render the noindex
 * shell — mirroring `loadBrandPageCacheSnapshot`).
 */
export async function loadIndexableBrandPageDomains(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<string[]> {
  if (!env.DB) {
    return [];
  }
  // Emergency noindex brake: with PUBLIC_BRAND_PAGES_INDEXABLE="0" every
  // /ads/* page carries noindex (see ads.$domain.tsx), so nothing is listable.
  if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
    return [];
  }
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo") {
    return [];
  }

  const now = options.now ?? new Date();
  const fetchedAtSince = new Date(
    now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  ).toISOString();
  const entries = await listFreshPublicSearchCacheEntries(env, {
    provider,
    fetchedAtSince,
  });

  const domains = new Set<string>();
  for (const entry of entries) {
    // Same predicate as the brand-page loader: public_search context, non-demo
    // source, ads present, and young enough to be indexable.
    const snapshot = toUsableSnapshot(entry, now);
    if (!snapshot || !snapshot.freshForIndexing) {
      continue;
    }
    const domain = brandPageDomainFromCacheRow(entry);
    if (domain) {
      domains.add(domain);
    }
  }
  return [...domains].sort();
}

/**
 * Full sitemap XML: the static paths always, plus the currently indexable
 * /ads/:domain entries when the cache read succeeds. A read failure degrades
 * to the static base set — a sitemap hiccup must never take the sitemap down.
 */
export async function buildPublicSitemapXml(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<string> {
  let domains: string[] = [];
  try {
    domains = await loadIndexableBrandPageDomains(env, options);
  } catch (error) {
    console.warn("Dynamic sitemap read failed; serving the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    domains = [];
  }

  return buildSitemapXml([
    ...SITEMAP_PATHS.map((path) => canonicalUrl(path)),
    ...domains.map((domain) => canonicalUrl(`/ads/${domain}`)),
  ]);
}

/** Worker-ready file shape for the /sitemap.xml response. */
export async function buildPublicSitemapFile(
  env: AppEnv,
  options: { now?: Date } = {},
): Promise<PublicSitemapFile> {
  return {
    body: await buildPublicSitemapXml(env, options),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
