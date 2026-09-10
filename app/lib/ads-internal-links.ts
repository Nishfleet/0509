/**
 * Client-safe helpers for internal links to indexable /ads/:domain pages.
 *
 * The live set comes from the same sitemap indexability signal
 * (`loadIndexableBrandPageEntries`). This module never invents a domain and
 * never links a path the sitemap would refuse.
 */

import { publicBrandNameFromDomain } from "~/lib/public-brand-name";

export interface IndexableAdsLink {
  domain: string;
  path: string;
  name: string;
}

export function displayNameFromDomain(domain: string): string {
  const override = publicBrandNameFromDomain(domain);
  if (override) {
    return override;
  }
  const host = domain.replace(/^www\./, "").split(".")[0] ?? "";
  return host ? host.charAt(0).toUpperCase() + host.slice(1) : domain;
}

/**
 * Map a sitemap path onto an internal ads link. Only a bare `/ads/:domain`
 * path qualifies — extra segments, query strings, or an empty domain are
 * skipped so a caller cannot accidentally link a noindex shell.
 */
export function indexableAdsLinkFromPath(path: string): IndexableAdsLink | null {
  if (!path.startsWith("/ads/")) {
    return null;
  }
  const domain = path.slice("/ads/".length);
  if (!domain || domain.includes("/") || domain.includes("?") || domain.includes("#")) {
    return null;
  }
  return {
    domain,
    path: `/ads/${domain}`,
    name: displayNameFromDomain(domain),
  };
}

export interface SearchBrandPageSource {
  /** A resolved registrable domain (e.g. the `?website=` domain search host). */
  displayDomain: string | null;
  /** Result rows, used only to fall back to the matched domain for bare keywords. */
  ads: readonly { domainMatch?: { matchedDomain: string | null } | null }[];
}

/**
 * Resolve the most defensible `/ads/:domain` target from a search context.
 *
 * An explicit domain search (`?website=nike.com`) and a V2-resolved brand
 * keyword both pin the brand domain on `displayDomain`. A bare keyword that
 * only produced verified rows on the legacy path (which discards
 * `displayDomain`) falls back to the registrable domain those rows actually
 * land on via `domainMatch.matchedDomain`. The north-star rule: never invent
 * a `<label>.com` guess from the query text alone — only a domain the results
 * themselves establish is returned. Returns null when nothing is defensible.
 */
export function resolveSearchBrandPageDomain(
  source: SearchBrandPageSource,
): string | null {
  const explicit = source.displayDomain;
  if (explicit) {
    const normalized = explicit.trim().toLowerCase().replace(/^www\./, "");
    if (normalized) {
      return normalized;
    }
  }
  for (const ad of source.ads) {
    const matched = ad.domainMatch?.matchedDomain;
    if (matched) {
      const normalized = matched.trim().toLowerCase().replace(/^www\./, "");
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

/**
 * The fresh sneaker/sport brands to feature ahead of the historical Nykaa
 * default on the public proof surfaces that use a featured `/ads/:domain`
 * link (issue #2314). Every entry is a brand the global ICP — the product's
 * core buyer — recognises, and each has a live, indexable `/ads/:domain`
 * page built from real Meta Ad Library captures. Order is precedence: a
 * fresh Footlocker beats a fresh New Balance, and so on down to JD Sports.
 */
export const FEATURED_PROOF_BRAND_PRIORITY: readonly string[] = [
  "footlocker.com",
  "newbalance.com",
  "adidas.com",
  "nike.com",
  "jdsports.com",
];

export function pickFeaturedAdsInternalLink(
  links: readonly IndexableAdsLink[],
  preferredDomain?: string,
): IndexableAdsLink | null {
  // Issue #2314: prefer the newest fresh capture from the sneaker/sport
  // brands the global buyer knows, in `FEATURED_PROOF_BRAND_PRIORITY` order,
  // instead of defaulting every visitor to the Indian brand Nykaa. Freshness
  // is the caller's contract: the links fed here come from
  // `loadIndexableBrandPageEntries`, which returns only captures within the
  // brand-page fresh-for-indexing window (`BRAND_PAGE_FRESH_FOR_INDEXING_MS`,
  // 7 days) — so any brand present here is a fresh capture, and an absent
  // brand means its capture is stale or missing. No country→brand mapping:
  // the same fixed order serves every visitor. Nykaa is a fallback only when
  // none of the priority brands has a fresh capture.
  const byDomain = new Map(links.map((link) => [link.domain, link]));
  for (const domain of FEATURED_PROOF_BRAND_PRIORITY) {
    const candidate = byDomain.get(domain);
    if (candidate) {
      return candidate;
    }
  }
  if (preferredDomain) {
    const preferred = byDomain.get(preferredDomain);
    if (preferred) {
      return preferred;
    }
  }
  return links[0] ?? null;
}

/**
 * How many sibling /ads/:domain cross-links a brand page renders in its
 * "More tracked brands" cluster (issue #2048). The live /ads pages linked
 * only ~4 siblings each (the #1417 brief), which left the 50+-page
 * programmatic cohort crawl-shallow — Google discovered the surface page by
 * page instead of traversing a connected brand graph. 12 keeps the accepted
 * >=10-sibling floor with headroom against single-set indexability churn
 * while the deterministic alphabetical slice stays stable across renders.
 */
export const RELATED_BRAND_LINK_COUNT = 12;

/**
 * Pick the "More tracked brands" set for an /ads/:domain page (issues
 * #1417, #2048): the other indexable /ads pages that page cross-links to, so
 * no brand page in the sitemap is an orphan and the cohort forms a connected
 * crawlable cluster (>=10 siblings per page, issue #2048). The current
 * domain is always excluded — a page must never link to itself. The
 * selection is deterministic (stable across renders and crawls, so the
 * internal-link set does not churn), capped at `count` (default
 * RELATED_BRAND_LINK_COUNT). When fewer than `count` other brands exist, it
 * returns all of them; only a single-brand sitemap yields an empty set, in
 * which case the caller hides the section. Every returned link comes from
 * the caller's sitemap-indexability-filtered set, so no dead (cache-miss
 * /search-redirect) page is ever linked.
 */
export function pickRelatedBrandLinks(
  links: readonly IndexableAdsLink[],
  currentDomain: string,
  count = RELATED_BRAND_LINK_COUNT,
): IndexableAdsLink[] {
  const others = links
    .filter((link) => link.domain !== currentDomain)
    .slice()
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return others.slice(0, Math.max(0, count));
}
