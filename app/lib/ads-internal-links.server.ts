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
import { PUBLIC_PROOF_FEATURED_WEBSITE } from "~/lib/public-proof.server";
import { loadIndexableBrandPageEntries } from "~/lib/sitemap.server";
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
    return [];
  }
}

export async function loadFeaturedAdsInternalLink(env: AppEnv): Promise<IndexableAdsLink | null> {
  const links = await loadIndexableAdsInternalLinks(env);
  return pickFeaturedAdsInternalLink(links, PUBLIC_PROOF_FEATURED_WEBSITE);
}

/** Shared loader for /compare/* pages that have no other loader work. */
export async function compareAdsExampleLoader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  return { featuredAdsLink: await loadFeaturedAdsInternalLink(getEnv(context)) };
}
