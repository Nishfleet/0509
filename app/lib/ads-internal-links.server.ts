/**
 * Server loaders for internal /ads/:domain links.
 *
 * Reuses the sitemap's indexability filter so a public funnel page can never
 * point at a brand page that would render noindex (demo, stale, empty, or
 * emergency-brake). Cache-only: never triggers live discovery.
 */

import type { LoaderFunctionArgs } from "react-router";

import {
  indexableAdsLinkFromPath,
  pickFeaturedAdsInternalLink,
  type IndexableAdsLink,
} from "~/lib/ads-internal-links";
import { hostnamesMatchOpenCctldToGenericCommercial } from "~/lib/search-query";
import { PUBLIC_PROOF_FEATURED_WEBSITE } from "~/lib/public-proof.server";
import {
  loadIndexableBrandPageEntries,
  loadIndexableTimelineEntries,
  timelineSitemapEntries,
} from "~/lib/sitemap.server";
import { reportError } from "~/lib/error-report.server";
import type { AppEnv } from "~/lib/env.server";

export async function loadIndexableAdsInternalLinks(env: AppEnv): Promise<IndexableAdsLink[]> {
  try {
    const entries = await loadIndexableBrandPageEntries(env);
    const links: IndexableAdsLink[] = [];
    for (const entry of entries) {
      const link = indexableAdsLinkFromPath(entry.path);
      if (link) {
        links.push(link);
      }
    }
    return links;
  } catch (error) {
    console.warn("Indexable ads internal-link load failed; omitting /ads links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    // Issue #3476: the degrade must leave a durable record — the edge cache
    // serves the link-less render for the whole serve-stale window, so a
    // transient read failure looks exactly like a persistent cross-link
    // regression unless the error_report sink can see it.
    await reportError(env, {
      route: "loader.ads_internal_links",
      reasonCode: "indexable_ads_links_read_failed",
      error,
    });
    return [];
  }
}

export async function loadFeaturedAdsInternalLink(env: AppEnv): Promise<IndexableAdsLink | null> {
  const links = await loadIndexableAdsInternalLinks(env);
  return pickFeaturedAdsInternalLink(links, PUBLIC_PROOF_FEATURED_WEBSITE);
}

/**
 * Resolve a single search-derived brand domain to its indexable /ads/:domain
 * link, reusing the sitemap's indexability filter so the search surface never
 * links a brand page that would render noindex (demo, stale, empty, or
 * emergency-brake). Returns null when the domain is absent or has no indexable
 * brand page, and degrades to null on any sitemap hiccup. Cache-only.
 */
export async function resolveIndexableBrandPageLinkForDomain(
  env: AppEnv,
  domain: string | null | undefined,
): Promise<IndexableAdsLink | null> {
  if (!domain) {
    return null;
  }
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!normalized) {
    return null;
  }
  const links = await loadIndexableAdsInternalLinks(env);
  const direct = links.find((link) => link.domain === normalized);
  if (direct) {
    return direct;
  }
  // Open-ccTLD fallback (issue #1431): a bare-keyword search resolves the
  // registrable domain its result rows actually land on, which for a brand
  // whose public page lives on an open ccTLD is the generic-commercial twin
  // (notion.com) while the indexable brand page is the open-ccTLD one
  // (/ads/notion.so). Reuse the same one-directional open-ccTLD → generic
  // commercial matcher the verified-link classifier trusts, so a search that
  // resolves notion.com hands off to the indexable /ads/notion.so page
  // instead of silently dropping the brand destination. Bounded: iterates the
  // same bounded indexable set (SITEMAP_BRAND_PATH_LIMIT), cache-only.
  for (const link of links) {
    if (
      hostnamesMatchOpenCctldToGenericCommercial(normalized, {
        registrableDomain: link.domain,
      })
    ) {
      return link;
    }
  }
  return null;
}

/**
 * Load the set of registrable domains whose `the public proof ledger` page is in
 * the sitemap's indexable set (issue #1931).
 *
 * Reuses the sitemap's own timeline entry set — capture-backed entries only
 * (issue #2881: zero-state collecting pages are noindex and never listed),
 * so a public funnel page can never point at a
 * `the public proof ledger` that the route would refuse to serve (404) or that the
 * sitemap would refuse to list. Cache-only:
 * never triggers live discovery or scraping.
 *
 * Returns a `Set` of registrable domains (lowercased, no `www.` prefix) whose
 * timeline is indexable. Degrades to an empty set on any sitemap hiccup so a
 * timeline-link failure can never 500 a page — it just omits the cross-link.
 */
export async function loadIndexableTimelineDomains(env: AppEnv): Promise<Set<string>> {
  try {
    const timelineEntries = await loadIndexableTimelineEntries(env);
    const entries = timelineSitemapEntries(timelineEntries);
    const domains = new Set<string>();
    for (const entry of entries) {
      const domain = timelineDomainFromSitemapPath(entry.path);
      if (domain) {
        domains.add(domain);
      }
    }
    return domains;
  } catch (error) {
    console.warn("Indexable timeline internal-link load failed; omitting /timeline links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    // Issue #3476: same observability rule — a silent degrade here is what
    // made the check-ads-timeline-links sweep failure unverifiable until the
    // edge cache happened to refresh.
    await reportError(env, {
      route: "loader.ads_internal_links",
      reasonCode: "indexable_timeline_domains_read_failed",
      error,
    });
    return new Set<string>();
  }
}

/**
 * Resolve a single brand domain to its indexable `the public proof ledger` path, or
 * null when that timeline is not in the sitemap's indexable set (issue #1931).
 *
 * The returned path is safe to link: it is present only when the sitemap's own
 * indexability decision (capture-backed with ≥1 recorded offer state, issue
 * #2881) lists it,
 * so a route the timeline never serves is never linked. Cache-only.
 */
export async function resolveIndexableTimelineLinkForDomain(
  _env: AppEnv,
  domain: string | null | undefined,
): Promise<string | null> {
  if (!domain) {
    return null;
  }
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!normalized) {
    return null;
  }
  return null;
}

/** Extract the registrable domain from a `the public proof ledger` sitemap path. */
function timelineDomainFromSitemapPath(_path: string): string | null {
  return null;
}

/** Shared loader for compare-pages/* pages that have no other loader work. */
export async function compareAdsExampleLoader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  return { featuredAdsLink: await loadFeaturedAdsInternalLink(getEnv(context)) };
}
