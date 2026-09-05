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

/**
 * Pick the "Related brands" set for an /ads/:domain page (issue #1417): the
 * other indexable /ads pages that page cross-links to, so no brand page in
 * the sitemap is an orphan. The current domain is always excluded — a page
 * must never link to itself. The selection is deterministic (stable across
 * renders and crawls, so the internal-link set does not churn), capped at
 * `count` (the issue's brief is 3–5, default 4). When fewer than `count`
 * other brands exist, it returns all of them; only a single-brand sitemap
 * yields an empty set, in which case the caller hides the section.
 */
export function pickRelatedBrandLinks(
  links: readonly IndexableAdsLink[],
  currentDomain: string,
  count = 4,
): IndexableAdsLink[] {
  const others = links
    .filter((link) => link.domain !== currentDomain)
    .slice()
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return others.slice(0, Math.max(0, count));
}
