import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

/**
 * Home ↔ /ads/:domain count parity (issue #1468).
 *
 * The live defect: /api/demo-proof (and the homepage proof brief) rendered
 * `adCount` from a re-derived `.slice(0, 12)` of the discovery-cache
 * snapshot, while the /ads/nykaa.com page counted the FULL snapshot
 * (brandOwnedAdCount + unverifiedMatchCount = snapshot.ads.length). Same
 * row, same brand, same day — two different totals. Observed live
 * 2026-08-30: home said 12, the brand page wall read 11; live today the
 * wall reads 24 (3 brand-owned + 6 verified links + 18 unverified matches)
 * while the home still prints 12.
 *
 * The contract these tests lock: the home proof brief and the brand page
 * read the SAME discovery-cache snapshot via `loadBrandPageCacheSnapshot`
 * — same visitor country ladder, no re-derived subset count — so they can
 * never report different totals for the same brand on the same day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

// Frozen "now" for the home loader so the count math is deterministic
// regardless of when the suite runs.
const NOW = new Date("2026-08-30T06:00:00.000Z");
// Two hours before the frozen now: positive-age, fresh-for-indexing capture
// under BOTH the frozen clock and the real wall clock when the suite runs.
const FETCHED_AT = "2026-08-30T04:00:00.000Z";

const OWNED_ADS = 3;
const VERIFIED_NOT_OWNED_ADS = 3;
const UNVERIFIED_ADS = 18;
const DEMO_ADS = 2;
const SNAPSHOT_AD_COUNT = OWNED_ADS + VERIFIED_NOT_OWNED_ADS + UNVERIFIED_ADS; // 24, > the old 12 cap

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-parity-1",
    advertiser: "Resale Store",
    body: "Body copy",
    previewHeadline: "Preview headline",
    previewSubhead: "Preview subhead",
    hook: "Parity fixture hook",
    offer: "20% off",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: "https://cdn.example.com/ad.png",
    countries: ["all"],
    platforms: ["Instagram"],
    // 30-day first-seen: clears the 14-day aggression-score floor so the
    // page renders its differentiator and stays indexable.
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: isoAgo(2 * 60 * 60 * 1000),
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

// Brand-owned creative: advertiser page is the brand itself, with the
// search-v2 pipeline's verified advertiser-domain match attached.
function ownedAd(id: string): AdRecord {
  return ad({
    metaAdId: id,
    advertiser: "Nykaa",
    landingPageUrl: "https://www.nykaa.com/lp",
    domainMatch: {
      level: "verified_advertiser_domain",
      reason: "Advertiser domain matches nykaa.com",
      matchedDomain: "nykaa.com",
    },
  });
}

// Verified-linked creative that is NOT the brand's own ad: the landing link
// evidence is verified, but the advertiser is an unrelated page (reseller).
function verifiedNotOwnedAd(id: string): AdRecord {
  return ad({
    metaAdId: id,
    advertiser: "Beauty Drops",
    domainMatch: {
      level: "registrable_domain",
      reason: "Landing page matches nykaa.com",
      matchedDomain: "nykaa.com",
    },
  });
}

// Unverified match: the provider returned it, but nothing links it to the
// brand — no domainMatch verdict, no landing page.
function unverifiedAd(id: string): AdRecord {
  return ad({ metaAdId: id, advertiser: "Resale Store" });
}

// Sample/demo creative: never rendered on any public surface.
function demoAd(id: string): AdRecord {
  return ad({ metaAdId: id, advertiser: "Sample Co", source: "demo" });
}

function cacheEntry() {
  return {
    cacheKey: "meta_library_browser:fnv1a-parity:all:page-1",
    provider: "meta_library_browser",
    routeContext: "public_search",
    queryFingerprint: "fnv1a-parity",
    country: "all",
    cursor: null,
    payload: {
      ads: [
        ...Array.from({ length: OWNED_ADS }, (_, i) => ownedAd(`owned-${i}`)),
        ...Array.from({ length: VERIFIED_NOT_OWNED_ADS }, (_, i) =>
          verifiedNotOwnedAd(`verified-${i}`),
        ),
        ...Array.from({ length: UNVERIFIED_ADS }, (_, i) => unverifiedAd(`unv-${i}`)),
        ...Array.from({ length: DEMO_ADS }, (_, i) => demoAd(`demo-${i}`)),
      ],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    },
    fetchedAt: FETCHED_AT,
    expiresAt: "2026-08-30T05:00:00.000Z",
    browserMsUsed: 1200,
    createdAt: FETCHED_AT,
    updatedAt: FETCHED_AT,
  };
}

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

interface MockOptions {
  env?: Record<string, unknown>;
  entry?: ReturnType<typeof cacheEntry> | null;
}

// Mirrors the ad-source/data mocks of tests/ads-brand-page.route.test.ts so
// BOTH the api.demo-proof loader and the /ads/:domain loader resolve through
// the same mocked discovery-cache read.
function installMocks(options: MockOptions = {}) {
  const env = options.env ?? { DB: {} };
  const getDiscoveryCacheEntry = vi.fn().mockImplementation(async () => options.entry ?? null);

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry,
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
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
    summarizeDomainCaptureFailures: vi.fn(() => null),
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));

  return { env, getDiscoveryCacheEntry };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("home proof brief ↔ brand page count parity (#1468)", () => {
  // Cold first import of two route graphs on a shared self-hosted runner
  // can push the 10s default; the repo's own 10s budget is per-file. Route
  // module transform is infra-time, not assertion-time (see ci-vitest-run.sh).
  it("loadPublicProofBrief with a frozen now counts the FULL snapshot, not a 12-ad subset", { timeout: 30_000 }, async () => {
    installMocks({ entry: cacheEntry() });

    const { loadPublicProofBrief } = await import("~/lib/public-proof.server");
    const brief = await loadPublicProofBrief({ DB: {} } as never, {
      now: NOW,
      visitorCountry: "Germany",
    });

    expect(brief).not.toBeNull();
    // The live defect: the home capped at 12 while the shared row held 24.
    expect(brief?.adCount).toBe(SNAPSHOT_AD_COUNT);
    expect(brief?.activeAdCount).toBe(SNAPSHOT_AD_COUNT);
  });

  it("home /api/demo-proof and /ads/nykaa.com report the same total for the same visitor", { timeout: 30_000 }, async () => {
    installMocks({ entry: cacheEntry() });

    const { loader: apiLoader } = await import("~/routes/api.demo-proof");
    const apiResponse = await apiLoader({
      request: new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-ipcountry": "DE" },
      }),
      context: createContext({ DB: {} }),
    } as never);
    const brief = (await apiResponse.json()) as {
      status: string;
      adCount: number;
    };

    const { loader: adsLoader } = await import("~/routes/ads.$domain");
    const page = await adsLoader({
      context: createContext({ DB: {} }),
      params: { domain: "nykaa.com" },
      request: new Request("https://0509.io/ads/nykaa.com", {
        headers: { "cf-ipcountry": "DE" },
      }),
    } as never);

    // The audit metric: home count == brand page total.
    expect(brief.adCount).toBe(page.brandOwnedAdCount + page.unverifiedMatchCount);
    expect(brief.adCount).toBe(page.ads.length);
    // The live defect: home printed 12 while the wall read 24.
    expect(brief.adCount).toBeGreaterThan(12);
  });

  it("home and brand page resolve the SAME cache row (same first discovery-cache lookup)", async () => {
    const mocks = installMocks({ entry: cacheEntry() });

    const { loader: apiLoader } = await import("~/routes/api.demo-proof");
    await apiLoader({
      request: new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-ipcountry": "DE" },
      }),
      context: createContext({ DB: {} }),
    } as never);
    // readDiscoveryCacheEntryCacheOnly calls getDiscoveryCacheEntry(env, key).
    const homeFirstLookupKey = mocks.getDiscoveryCacheEntry.mock.calls[0]?.[1] as string;
    mocks.getDiscoveryCacheEntry.mockClear();

    const { loader: adsLoader } = await import("~/routes/ads.$domain");
    await adsLoader({
      context: createContext({ DB: {} }),
      params: { domain: "nykaa.com" },
      request: new Request("https://0509.io/ads/nykaa.com", {
        headers: { "cf-ipcountry": "DE" },
      }),
    } as never);
    const pageFirstLookupKey = mocks.getDiscoveryCacheEntry.mock.calls[0]?.[1] as string;

    // Same cache key => same snapshot => same adCount. The current home
    // pin is ":all:", which FAILS this assertion for a geolocated visitor.
    expect(homeFirstLookupKey).toBe(pageFirstLookupKey);
    expect(homeFirstLookupKey).not.toContain(":all:");
  });
});