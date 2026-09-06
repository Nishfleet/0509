import { describe, expect, it } from "vitest";

import { adHasVerifiedDomainLink, computeBrandPageAggressionScore } from "~/lib/brand-page.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import {
  indexableBrandPageEntriesFromRows,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";
import type { AdRecord } from "~/lib/types";

/**
 * Warmed staging/prod canary: the five BET 3 demo brands with a fresh
 * public_search capture that matches live 2026-08-26 landing-page shape.
 * allbirds.com and mamaearth.com land on regional properties, not the .com
 * host the URL uses. The other three land on their searched domain.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-26T14:42:00.000Z");

function isoAgo(ms: number) {
  return new Date(NOW.getTime() - ms).toISOString();
}

const WARMED_LANDINGS: Record<(typeof DEMO_BRAND_PAGE_DOMAINS)[number], string> = {
  "nike.com": "https://www.nike.com/launch",
  "nykaa.com": "https://www.nykaa.com/glow-sale",
  "allbirds.com": "https://www.allbirds.co.uk/products/womens-dasher",
  "lenskart.com": "https://www.lenskart.com/eyeglasses.html",
  "mamaearth.com": "https://mamaearth.in/product/ubtan-face-wash",
};

function warmedAd(domain: (typeof DEMO_BRAND_PAGE_DOMAINS)[number]): AdRecord {
  const landingOnSearchedHost = WARMED_LANDINGS[domain].includes(`://${domain}/`) ||
    WARMED_LANDINGS[domain].includes(`://www.${domain}/`);
  return {
    metaAdId: `meta-${domain}`,
    advertiser: domain.split(".")[0] ?? domain,
    body: "Offer",
    previewHeadline: "Offer",
    previewSubhead: "",
    hook: "Shop",
    offer: "",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: WARMED_LANDINGS[domain],
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: landingOnSearchedHost
      ? {
          level: "registrable_domain",
          reason: `Landing page matches ${domain}`,
          matchedDomain: domain,
        }
      : {
          level: "unverified_provider_candidate",
          reason: "Returned by the Meta source; website connection not verified",
          matchedDomain: null,
        },
  };
}

function warmedRow(domain: (typeof DEMO_BRAND_PAGE_DOMAINS)[number]): SitemapCacheRow {
  return {
    cache_key: `search-v2:domain:${domain}:exact:meta_library_browser:all:page-1`,
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify({
      ads: [warmedAd(domain)],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      searchIntent: "domain",
      displayDomain: domain,
    }),
    fetched_at: isoAgo(6 * 60 * 60 * 1000),
  };
}

describe("BET 3 demo brand pages — warmed canary indexability", () => {
  it("names exactly the five BET 3 demo domains", () => {
    expect([...DEMO_BRAND_PAGE_DOMAINS]).toEqual([
      "nike.com",
      "nykaa.com",
      "allbirds.com",
      "lenskart.com",
      "mamaearth.com",
    ]);
  });

  it("treats every warmed demo capture as a verified, scoreable, sitemap-listed brand page", () => {
    const rows = DEMO_BRAND_PAGE_DOMAINS.map(warmedRow);

    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const ad = warmedAd(domain);
      expect(adHasVerifiedDomainLink(ad, domain), domain).toBe(true);
      expect(computeBrandPageAggressionScore([ad], NOW), domain).not.toBeNull();
    }

    const listed = indexableBrandPageEntriesFromRows(rows, NOW).map((entry) => entry.path);
    expect(listed).toEqual(DEMO_BRAND_PAGE_DOMAINS.map((domain) => `/ads/${domain}`));
  });
});
