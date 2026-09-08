import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sneakerResaleSeedList from "../data/seed-lists/sneaker-resale.json";
import indexableSnapshot from "./fixtures/sneaker-resale-indexable-domains.snapshot.json";
import { SNEAKER_RESALE_BRAND_PAGES } from "~/components/sneaker-resale-landing";
import {
  brandPageLookupCacheKeysForSitemap,
  indexableBrandPageEntriesFromRows,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";
import type { AdRecord } from "~/lib/types";

/**
 * Issue #2045 regression guard: every /ads/:domain URL the sitemap lists must
 * resolve to a rendered brand page (HTTP 200), NEVER a 301 to /search.
 *
 * On 2026-09-09 the production sitemap still listed zappos.com while
 * /ads/zappos.com 301-redirected to /search?q=zappos.com — the seeded-brand
 * retire redirect (issue #1306) and the cache-miss redirect (issue #1282) can
 * fire for a domain the index generators still consider live, and the only
 * guard was the manual full-sitemap curl scan in the issue. This suite closes
 * the gap mechanically, without a live-HTTP dependency (which would be flaky
 * and rate-limited):
 *
 * 1. The real sitemap generator (`indexableBrandPageEntriesFromRows`) and the
 *    REAL /ads/:domain route loader are run against the SAME fixture cache
 *    row. Any domain the sitemap lists must render loader data (the 200 path)
 *    — if a future change strengthens the redirect conditions without
 *    tightening the sitemap gates (or vice versa), this fails.
 * 2. The inverse agreement is pinned: a seeded brand whose coverage is thin
 *    (zero verified-linked ads) must be excluded from the sitemap AND 301 to
 *    /search — the empty-page 301 is DESIRED behavior (issue #1282) and must
 *    stay; the guard only asserts the index is honest about it.
 * 3. The listing surfaces (recall seed list, /sneaker-resale hub array,
 *    sitemap snapshot fixture) must not re-list zappos.com while its /ads
 *    page cannot serve a wall — the consistency half of the issue's accept.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const PROVIDER = "meta_library_browser";

function verifiedAd(domain: string): AdRecord {
  return {
    metaAdId: `meta-${domain.replace(/\./g, "-")}-1`,
    advertiser: domain,
    body: "Shop the latest.",
    previewHeadline: "Shop the latest.",
    previewSubhead: "New arrivals",
    hook: "Shop the latest.",
    offer: "Free shipping",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: `https://www.${domain}/shop`,
    advertiserPageId: "111",
    adSnapshotUrl: `https://cdn.example.com/meta-${domain}.png`,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: {
      level: "registrable_domain",
      reason: `Landing page matches ${domain}`,
      matchedDomain: domain,
    },
  };
}

function unmatchedAd(domain: string): AdRecord {
  const ad = verifiedAd(domain);
  return {
    ...ad,
    // Lands on an unrelated reseller host (the homonym/reseller case, e.g.
    // goat.com in #1305): no verified match level AND no brand-domain landing
    // host, so adHasVerifiedDomainLink is false.
    landingPageUrl: "https://www.reseller-marketplace-shop.net/deals",
    domainMatch: {
      level: "unverified_provider_candidate",
      reason: "No link evidence ties this creative to the brand domain",
      matchedDomain: null,
    },
  } as AdRecord;
}

/**
 * A sitemap cache row whose cache_key is the EXACT key the sitemap lookup
 * parity gate requires for this domain (rule 5 of the sitemap docblock), so
 * the fixture is reachable both by the generator and by the page's own
 * lookup derivation.
 */
function fixtureRow(domain: string, ads: AdRecord[]): SitemapCacheRow {
  const lookupKeys = brandPageLookupCacheKeysForSitemap(PROVIDER, domain, true);
  const cacheKey = [...lookupKeys][0];
  if (!cacheKey) {
    throw new Error(`no lookup key derived for ${domain}`);
  }
  return {
    cache_key: cacheKey,
    provider: PROVIDER,
    route_context: "public_search",
    payload_json: JSON.stringify({
      ads,
      nextCursor: null,
      source: PROVIDER,
      provider: PROVIDER,
      cacheStatus: "hit",
    }),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
  };
}

// ---- loader harness (same mock surface as tests/ads-brand-page.route.test.ts)

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

interface LoaderMocks {
  env: Record<string, unknown>;
  entry: {
    cacheKey: string;
    provider: string;
    routeContext: string;
    queryFingerprint: string;
    country: string;
    cursor: null;
    payload: Record<string, unknown>;
    fetchedAt: string;
    expiresAt: string;
    browserMsUsed: number;
    createdAt: string;
    updatedAt: string;
  } | null;
}

function installLoaderMocks(options: Omit<LoaderMocks, "env"> & { env?: Record<string, unknown> }) {
  const env = options.env ?? { DB: {} };
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry: vi.fn().mockResolvedValue(options.entry),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => PROVIDER),
    searchAdsViaSourceResolver: vi.fn(),
    hasFreshDiscoveryCacheEntry: vi.fn(),
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser: vi.fn(),
  }));
  vi.doMock("~/lib/meta-api.server", () => ({
    searchAds: vi.fn(),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
    loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
    summarizeDomainCaptureFailures: vi.fn().mockReturnValue(null),
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));
  return env;
}

function cacheEntryFromRow(row: SitemapCacheRow) {
  return {
    cacheKey: row.cache_key,
    provider: row.provider,
    routeContext: row.route_context,
    queryFingerprint: "fnv1a-test",
    country: "all",
    cursor: null,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    fetchedAt: row.fetched_at,
    // Expired TTL must not hide the entry from the brand page.
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: row.fetched_at,
    updatedAt: row.fetched_at,
  };
}

async function runLoader(domain: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/ads.$domain");
  return loader({
    context: createContext(env),
    params: { domain },
    request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const path of [
    "~/lib/ad-source.server",
    "~/lib/context.server",
    "~/lib/data.server",
    "~/lib/meta-api.server",
    "~/lib/meta-library-browser.server",
    "~/lib/rate-limit.server",
    "~/lib/offer-timeline.server",
  ]) {
    vi.doUnmock(path);
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("sitemap /ads entries never redirect to /search (issue #2045)", () => {
  it("every domain the sitemap generator lists renders the real loader's 200 path, never a 301", async () => {
    const domains = ["nykaa.com", "stockx.com", "footlocker.com"];
    const rows = domains.map((domain) => fixtureRow(domain, [verifiedAd(domain)]));

    const entries = indexableBrandPageEntriesFromRows(rows, new Date(), { provider: PROVIDER });
    const listed = entries.map((entry) => entry.path).sort();
    expect(listed).toEqual(domains.map((domain) => `/ads/${domain}`).sort());

    for (const domain of domains) {
      const row = rows[domains.indexOf(domain)];
      installLoaderMocks({ entry: cacheEntryFromRow(row) });
      const result = (await runLoader(domain, { DB: {} })) as { noindex: boolean; domain: string };
      // The 200 path: loader data returned (no redirect thrown), page indexable.
      expect(result.domain).toBe(domain);
      expect(result.noindex).toBe(false);
    }
  });

  it("a seeded brand with zero verified-linked ads is excluded from the sitemap AND 301s to /search — the generators agree", async () => {
    // stockx.com is still a bundled seed-list brand, so the retire redirect
    // (issue #1306) applies; the row carries only unmatched creatives.
    const row = fixtureRow("stockx.com", [unmatchedAd("stockx.com")]);

    const entries = indexableBrandPageEntriesFromRows([row], new Date(), { provider: PROVIDER });
    expect(entries.map((entry) => entry.path)).not.toContain("/ads/stockx.com");

    installLoaderMocks({ entry: cacheEntryFromRow(row) });
    let thrown: unknown = null;
    try {
      await runLoader("stockx.com", { DB: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    const redirect = thrown as Response;
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("/search?q=stockx.com");
  });

  it("zappos.com stays out of every listing surface while its /ads page cannot serve a wall", () => {
    // The recall seed list: the recall canary must not guard a brand whose
    // /ads page 301s to /search (2026-09-08 detector run: rows=0).
    expect(
      sneakerResaleSeedList.domains.map((entry) => entry.domain.toLowerCase()),
    ).not.toContain("zappos.com");
    // The /sneaker-resale hub array: never a dead /ads/ link.
    expect(
      SNEAKER_RESALE_BRAND_PAGES.map((entry) => entry.domain.toLowerCase()),
    ).not.toContain("zappos.com");
    // The sitemap snapshot fixture used as the indexability reference.
    expect(
      (indexableSnapshot.domains as string[]).map((domain) => domain.toLowerCase()),
    ).not.toContain("zappos.com");
  });

  it("a fresh row with verified-linked ads cannot be silently dropped from the sitemap either", () => {
    // The guard only asserts index honesty — never a weaker index. A
    // qualifying row MUST still be listed.
    const row = fixtureRow("nykaa.com", [verifiedAd("nykaa.com")]);
    const entries = indexableBrandPageEntriesFromRows([row], new Date(), { provider: PROVIDER });
    expect(entries.map((entry) => entry.path)).toContain("/ads/nykaa.com");
  });
});
