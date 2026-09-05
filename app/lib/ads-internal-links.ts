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

export function pickFeaturedAdsInternalLink(
  links: readonly IndexableAdsLink[],
  preferredDomain?: string,
): IndexableAdsLink | null {
  if (preferredDomain) {
    const preferred = links.find((link) => link.domain === preferredDomain);
    if (preferred) {
      return preferred;
    }
  }
  return links[0] ?? null;
}
