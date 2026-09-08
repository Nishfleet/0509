import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";
import {
  brandPageRowHasVerifiedAds,
  indexableBrandPageEntriesFromRows,
  loadIndexableBrandPageEntries,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * A verified-linked ad for nike.com — carries real landing-page evidence to
 * the registrable domain, so the page it populates is indexable (issue #1442:
 * indexability is a content-thinness rule, not a score rule).
 */
function verifiedAd(): AdRecord {
  return {
    metaAdId: "meta-nike-1",
    advertiser: "Nike",
    body: "Just do it.",
    previewHeadline: "Just do it.",
    previewSubhead: "New drop",
    hook: "Just do it.",
    offer: "Shop",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nike.com/shop",
    adSnapshotUrl: "https://cdn.example.com/meta-nike-1.png",
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(2 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: {
      level: "registrable_domain",
      reason: "Landing page matches nike.com",
      matchedDomain: "nike.com",
    },
  };
}

function payloadFor(ads: AdRecord[]) {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
  };
}

function sitemapRow(payload: unknown, domain = "nike.com"): SitemapCacheRow {
  return {
    cache_key: `search-v2:domain:${domain}:exact:meta_library_browser:all:page-1`,
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify(payload),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
  };
}

/**
 * Issue #1283 — sitemap/noindex parity. The bug that closed and re-emerged
 * three times (#912, #1071, #1120, #1142) was a drift between the sitemap
 * emission predicate and the page loader's noindex predicate: the sitemap
 * listed /ads/:domain URLs whose pages served `<meta name="robots"
 * content="noindex">`. These guards pin the two predicates together so they
 * cannot drift again:
 *
 *  - the emergency brake (PUBLIC_BRAND_PAGES_INDEXABLE="0") makes every
 *    /ads/* page serve noindex, so the sitemap must emit NOTHING under it;
 *  - a populated page (>=1 verified-linked ad, fresh snapshot) is indexable
 *    and must be in the sitemap;
 *  - a thin page (0 verified-linked ads) self-noindexes and must stay out.
 *
 * This is the code-level half of the mechanical-fix guard (fleet-ops#366).
 * The live-production half is tests/seo/sitemap-noindex-parity.test.sh.
 */
describe("issue #1283 — sitemap/noindex parity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    }));
  });
  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
  });

  it("the sitemap emits NOTHING when the emergency brake is on", async () => {
    // PUBLIC_BRAND_PAGES_INDEXABLE="0" makes every /ads/* page serve noindex
    // (ads.$domain.tsx emergencyNoindex). The sitemap must never list a page
    // that serves noindex, so it must emit zero /ads entries under the brake.
    const env = {
      DB: {},
      PUBLIC_BRAND_PAGES_INDEXABLE: "0",
    } as never;

    const entries = await loadIndexableBrandPageEntries(env, new Date());

    expect(entries).toEqual([]);
  });

  it("a populated page (verified-linked ads) is indexable and in the sitemap", () => {
    const row = sitemapRow(payloadFor([verifiedAd()]));
    const now = new Date();

    expect(brandPageRowHasVerifiedAds(row, "nike.com")).toBe(true);
    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/nike.com",
    ]);
  });

  it("a thin page (0 verified-linked ads) self-noindexes and stays out of the sitemap", () => {
    const thinAd: AdRecord = { ...verifiedAd(), landingPageUrl: null, domainMatch: undefined };
    const row = sitemapRow(payloadFor([thinAd]));
    const now = new Date();

    expect(brandPageRowHasVerifiedAds(row, "nike.com")).toBe(false);
    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([]);
  });
});
