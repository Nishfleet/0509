/**
 * Client-safe helpers for internal links to indexable /ads/:domain pages.
 *
 * The live set comes from the same sitemap indexability signal
 * (`loadIndexableBrandPageEntries`). This module never invents a domain and
 * never links a path the sitemap would refuse.
 */

export interface IndexableAdsLink {
  domain: string;
  path: string;
  name: string;
}

export function displayNameFromDomain(domain: string): string {
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
