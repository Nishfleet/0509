import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import { summarizeDomainCaptureFailures } from "~/lib/offer-timeline.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const baseAd: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Glow like never before.",
  previewHeadline: "Glow like never before.",
  previewSubhead: "Festive sale",
  hook: "Glow like never before.",
  offer: "Up to 40% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://www.nykaa.com/glow",
  advertiserPageId: "111",
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
  countries: ["all"],
  platforms: ["Instagram"],
  // 30-day first-seen: clears the 14-day aggression-score floor so the page
  // renders its differentiator and stays indexable (a sub-floor capture would
  // self-noindex as thin content — see the loader's aggression gate).
  firstSeenAt: isoAgo(30 * DAY_MS),
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_library_browser",
  analysisFields: [],
  // Verified link evidence: the search-v2 pipeline attached a confirmed
  // landing-page/registrable-domain match to this creative, so the page may
  // truthfully say it "links to nykaa.com".
  domainMatch: {
    level: "registrable_domain",
    reason: "Landing page matches nykaa.com",
    matchedDomain: "nykaa.com",
  },
};

function cacheEntry(
  overrides: Partial<{
    routeContext: string;
    fetchedAt: string;
    country: string;
    payload: Record<string, unknown>;
  }> = {},
) {
  return {
    cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
    provider: "meta_library_browser",
    routeContext: overrides.routeContext ?? "public_search",
    queryFingerprint: "fnv1a-test",
    country: overrides.country ?? "all",
    cursor: null,
    payload: overrides.payload ?? {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    },
    fetchedAt: overrides.fetchedAt ?? isoAgo(2 * 60 * 60 * 1000),
    // The 15-minute public_search TTL will usually be expired by the time a
    // brand page reads the entry — expiry must NOT hide the entry here.
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: isoAgo(2 * 60 * 60 * 1000),
    updatedAt: isoAgo(2 * 60 * 60 * 1000),
  };
}

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

interface MockOptions {
  env?: Record<string, unknown>;
  entry?: ReturnType<typeof cacheEntry> | null;
  provider?: string;
  rateLimitResponse?: Response | null;
  onCacheRead?: () => void;
  offerTimelineEntries?: OfferLedgerEntry[];
  captureFailures?: unknown[];
  captureFailuresSummary?: unknown;
}

function installBrandPageMocks(options: MockOptions = {}) {
  const env = options.env ?? { DB: {} };
  const getDiscoveryCacheEntry = vi.fn().mockImplementation(async () => {
    options.onCacheRead?.();
    return options.entry ?? null;
  });
  const searchAdsViaSourceResolver = vi.fn();
  const hasFreshDiscoveryCacheEntry = vi.fn();
  const searchMetaLibraryByBrowser = vi.fn();
  const searchMetaApiAds = vi.fn();
  const enforcePublicBrandPageRateLimit = vi
    .fn()
    .mockResolvedValue(options.rateLimitResponse ?? null);
  const loadOfferTimeline = vi.fn().mockResolvedValue({
    entries: options.offerTimelineEntries ?? [],
    asOfState: null,
  });
  const loadDomainCaptureFailures = vi.fn().mockResolvedValue(options.captureFailures ?? []);

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry,
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => options.provider ?? "meta_library_browser"),
    searchAdsViaSourceResolver,
    hasFreshDiscoveryCacheEntry,
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser,
  }));
  vi.doMock("~/lib/meta-api.server", () => ({
    searchAds: searchMetaApiAds,
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit,
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline,
    loadDomainCaptureFailures,
    summarizeDomainCaptureFailures,
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));

  return {
    env,
    getDiscoveryCacheEntry,
    searchAdsViaSourceResolver,
    hasFreshDiscoveryCacheEntry,
    searchMetaLibraryByBrowser,
    searchMetaApiAds,
    enforcePublicBrandPageRateLimit,
    loadOfferTimeline,
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

/**
 * Runs the loader and asserts it threw a redirect Response (issue #1282: the
 * cache-miss /ads/:domain loader 301-redirects to /search?q=<domain> instead
 * of rendering a noindex empty shell). Returns the thrown Response so the
 * caller can assert status and Location.
 */
async function runLoaderRedirect(
  domain: string,
  env: Record<string, unknown>,
): Promise<Response> {
  let thrown: unknown = null;
  try {
    await runLoader(domain, env);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  return thrown as Response;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/ads/:domain loader", () => {
  it("renders cached ads with an honest freshness line and signup CTA data, without any provider call", async () => {
    const entry = cacheEntry();
    const mocks = installBrandPageMocks({ entry });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result).toMatchObject({
      domain: "nykaa.com",
      brandName: "Nykaa",
      hasCachedAds: true,
      noindex: false,
      canonicalPath: "/ads/nykaa.com",
    });
    // The all-countries cache view is spelled out — the page must name the
    // Ad Library country it renders from, never hide it behind the geo
    // defaulted lookup.
    expect(result.adLibraryCountry).toBe("all countries");
    // The machine-readable twin of the visible "Last checked" stamp.
    expect(result.lastCheckedAt).toBe(entry.fetchedAt);
    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]?.metaAdId).toBe("meta-nykaa-1");
    expect(result.checkedAgo).toBe("about 2 hours ago");
    // A capture hours old must NOT present itself as "right now".
    expect(result.freshForLiveClaim).toBe(false);
    // The cached creative's advertiser ("Nykaa") is the brand itself.
    expect(result.brandOwnedAdCount).toBe(1);
    expect(result.teaser).toMatchObject({
      totalCount: 1,
      activeCount: 1,
      longestRunningDays: 30,
      longestRunningHook: "Glow like never before.",
      formats: ["image"],
    });

    // The zero-cost constraint: cache reads only, never live discovery.
    expect(mocks.enforcePublicBrandPageRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.getDiscoveryCacheEntry).toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.hasFreshDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(mocks.searchMetaLibraryByBrowser).not.toHaveBeenCalled();
    expect(mocks.searchMetaApiAds).not.toHaveBeenCalled();
  });

  it("uses the public brand name for stylised domains", async () => {
    const entry = cacheEntry();
    const mocks = installBrandPageMocks({ entry });

    const result = await runLoader("hm.com", mocks.env);

    expect(result.brandName).toBe("H&M");
    expect(result.domain).toBe("hm.com");
  });

  it("loads stored offer timeline states without any live capture", async () => {
    const entry: OfferLedgerEntry = {
      id: "backfill-nykaa-20260825",
      capturedAt: "2026-08-25T00:00:00.000Z",
      dateLabel: "25 Aug 2026",
      canonicalUrl: "https://www.nykaa.com/",
      headline: "Nykaa. Beauty and wellness.",
      ctaText: null,
      priceText: null,
      formPresent: null,
      screenshotHref: null,
      pageTextHref: null,
      evidenceNote: "Captured on 25 Aug 2026, no screenshot",
      transition: null,
    };
    const mocks = installBrandPageMocks({
      entry: cacheEntry(),
      offerTimelineEntries: [entry],
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.offerTimelineEntries).toEqual([entry]);
    expect(mocks.loadOfferTimeline).toHaveBeenCalledWith(mocks.env, {
      domain: "nykaa.com",
      asOf: null,
    });
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.searchMetaLibraryByBrowser).not.toHaveBeenCalled();
    expect(mocks.searchMetaApiAds).not.toHaveBeenCalled();
  });

  it("names the country of the Ad Library the cached creatives came from", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ country: "India" }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.adLibraryCountry).toBe("India");
  });

  it("301-redirects to /search on a cache miss (issue #1282: no page ships empty)", async () => {
    const mocks = installBrandPageMocks({ entry: null });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
  });

  it("marks the capture fresh for a live claim only while the check is still in the moments-ago window", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(90 * 1000) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.checkedAgo).toBe("moments ago");
    expect(result.freshForLiveClaim).toBe(true);
  });

  it("withholds the live claim at the exact moments-ago boundary so the stamp and the claim never disagree", async () => {
    // The loader computes its own `now` a moment after the fixture timestamp,
    // so pin the snapshot directly with a fixed `now`: the live claim must
    // flip at EXACTLY the same 2-minute boundary the "Last checked" stamp
    // uses ("moments ago"), not one millisecond later.
    const now = new Date("2026-08-09T12:00:00.000Z");
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: new Date(now.getTime() - 120 * 1000).toISOString() }),
    });

    const { formatBrandPageCheckedAgo, loadBrandPageCacheSnapshot } = await import(
      "~/lib/brand-page.server"
    );
    const atBoundary = await loadBrandPageCacheSnapshot(mocks.env as never, {
      domain: "nykaa.com",
      visitorCountry: "all",
      now,
    });
    const justInside = await loadBrandPageCacheSnapshot(mocks.env as never, {
      domain: "nykaa.com",
      visitorCountry: "all",
      now: new Date(now.getTime() - 1),
    });

    expect(atBoundary).not.toBeNull();
    expect(formatBrandPageCheckedAgo(atBoundary!.fetchedAt, now)).toBe("about 2 minutes ago");
    expect(atBoundary?.freshForLiveClaim).toBe(false);

    // One millisecond inside the window the stamp still says "moments ago"
    // and the live claim is still honest — the flip is exactly at the
    // boundary, never a whole bucket earlier.
    expect(justInside?.freshForLiveClaim).toBe(true);
  });

  it("keeps the live claim and checked-ago stamp on one post-read clock across a 2ms cache-read gap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t0 = new Date("2026-08-14T12:00:00.000Z");
      vi.setSystemTime(t0);
      const fetchedAt = new Date(t0.getTime() - 119_999).toISOString();
      const mocks = installBrandPageMocks({
        entry: cacheEntry({ fetchedAt }),
        onCacheRead: () => {
          vi.setSystemTime(new Date(t0.getTime() + 2));
        },
      });

      const result = await runLoader("nykaa.com", mocks.env);

      expect(result.hasCachedAds).toBe(true);
      expect(result.checkedAgo).toBe("about 2 minutes ago");
      expect(result.freshForLiveClaim).toBe(false);
      expect(result.freshForLiveClaim).toBe(result.checkedAgo === "moments ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("withholds the live-claim freshness for a capture minutes old — not just hours", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(5 * 60 * 1000) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.checkedAgo).toBe("about 5 minutes ago");
    // A capture up to an hour old must never present itself as "right now".
    expect(result.freshForLiveClaim).toBe(false);
  });

  it("withholds the live-claim freshness for a capture over an hour old", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(61 * 60 * 1000) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.checkedAgo).toBe("about an hour ago");
    expect(result.freshForLiveClaim).toBe(false);
  });

  it("counts only the brand's own creatives as brand-owned when the cache mixes in other advertisers", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            baseAd,
            { ...baseAd, metaAdId: "meta-reseller-1", advertiser: "BeautyDeals Hub", advertiserPageId: "222" },
            { ...baseAd, metaAdId: "meta-reseller-2", advertiser: "BeautyDeals Hub", advertiserPageId: "222" },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.ads).toHaveLength(3);
    // Only the "Nykaa" creative is the brand's own; the two "BeautyDeals Hub"
    // creatives are other advertisers whose ads link to nykaa.com.
    expect(result.brandOwnedAdCount).toBe(1);
  });

  it("builds every attribution signal from verified-linked creatives only — text-mention matches never score the brand", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            // 30-day-old first-seen: clears the 14-day aggression floor, so
            // the score CAN compute from this creative alone.
            { ...baseAd, firstSeenAt: isoAgo(30 * DAY_MS) },
            // A real creative the provider returned for "nykaa.com" that merely
            // MENTIONS nykaa in its text — no landing page, no domainMatch
            // verdict. It must never feed the score, teaser, or change feed.
            // Its first-seen (5 days ago) sits INSIDE the 14-day change-feed
            // window — an unfiltered feed would emit its event, so an empty
            // feed proves the exclusion.
            {
              ...baseAd,
              metaAdId: "meta-text-1",
              advertiser: "BeautyDeals Hub",
              landingPageUrl: null,
              domainMatch: undefined,
              previewHeadline: "Nykaa sale code inside!",
              variantCount: 4,
              firstSeenAt: isoAgo(5 * DAY_MS),
            },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    // The wall carries both creatives…
    expect(result.ads).toHaveLength(2);
    // …but only one carries verified link evidence, and the loader exposes
    // exactly that subset for the client (which must never re-derive it from
    // the server-only evidence module).
    expect(result.verifiedLinkCount).toBe(1);
    expect(result.verifiedLinkedAds.map((ad) => ad.metaAdId)).toEqual(["meta-nykaa-1"]);
    expect(result.unverifiedMatchCount).toBe(1);
    expect(result.brandOwnedAdCount).toBe(1);
    // The teaser/score/change feed speak only about the verified capture
    // (the unverified ad's 5-day first-seen sits inside the change-feed
    // window, so an empty feed proves the exclusion — see the ad fixture).
    expect(result.teaser?.totalCount).toBe(1);
    expect(result.aggression?.adCount).toBe(1);
    expect(result.changeEvents).toHaveLength(0);
  });

  it("reports zero brand-owned creatives when every cached ad is another advertiser's", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            { ...baseAd, metaAdId: "meta-seller-1", advertiser: "BeautyDeals Hub" },
            { ...baseAd, metaAdId: "meta-seller-2", advertiser: "Outlet City" },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.brandOwnedAdCount).toBe(0);
  });

  it("301-redirects on a cache miss with bounded cache lookups and zero provider calls (issue #1282)", async () => {
    const mocks = installBrandPageMocks({ entry: null });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
    expect(mocks.getDiscoveryCacheEntry.mock.calls.length).toBeLessThanOrEqual(4);
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.searchMetaLibraryByBrowser).not.toHaveBeenCalled();
    expect(mocks.searchMetaApiAds).not.toHaveBeenCalled();
  });

  it("never presents demo-sourced cache as a brand's real ads — redirects instead (issue #1282)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [{ ...baseAd, source: "demo" }],
          nextCursor: null,
          source: "demo",
          provider: "demo",
          cacheStatus: "hit",
        },
      }),
    });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
  });

  it("redirects to /search when only demo discovery is configured (issue #1282)", async () => {
    const mocks = installBrandPageMocks({ entry: cacheEntry(), provider: "demo" });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
    expect(mocks.getDiscoveryCacheEntry).not.toHaveBeenCalled();
  });

  it("skips scheduled-scan cache entries — redirects instead (issue #1282)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ routeContext: "watchlist_scan" }),
    });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
  });

  it("404s malformed domains before touching the cache or rate limiter", async () => {
    const mocks = installBrandPageMocks({ entry: cacheEntry() });
    const malformed = [
      "not a domain",
      "nykaa",
      "foo..com",
      "-nykaa.com",
      "nykaa.com-",
      "java%3Ascript.com!",
      `${"a".repeat(90)}.com`,
      "",
    ];

    for (const domain of malformed) {
      let thrown: unknown = null;
      try {
        await runLoader(domain, mocks.env);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected 404 for ${JSON.stringify(domain)}`).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(404);
    }

    expect(mocks.getDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(mocks.enforcePublicBrandPageRateLimit).not.toHaveBeenCalled();
  });

  it("404s RFC-reserved names even when a cache entry exists — a reserved name can never own real ads", async () => {
    const mocks = installBrandPageMocks({ entry: cacheEntry() });
    const reserved = [
      "example.com",
      "www.example.com",
      "zzz-noway-12345.example.com",
      "example.net",
      "example.org",
      "brand.example",
      "brand.invalid",
      "brand.test",
      "brand.localhost",
      "brand.local",
    ];

    for (const domain of reserved) {
      let thrown: unknown = null;
      try {
        await runLoader(domain, mocks.env);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `expected 404 for reserved ${JSON.stringify(domain)}`).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(404);
    }

    // Reserved names must never read the cache or burn the rate limiter.
    expect(mocks.getDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(mocks.enforcePublicBrandPageRateLimit).not.toHaveBeenCalled();
  });

  it("throws the public rate-limit response when the bucket is exhausted", async () => {
    const limited = new Response("Too many requests", { status: 429 });
    const mocks = installBrandPageMocks({ entry: cacheEntry(), rateLimitResponse: limited });

    let thrown: unknown = null;
    try {
      await runLoader("nykaa.com", mocks.env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(limited);
    expect(mocks.getDiscoveryCacheEntry).not.toHaveBeenCalled();
  });
});

describe("/ads/:domain indexing flag", () => {
  it("is indexable by default when the cache is fresh (flag unset)", async () => {
    const mocks = installBrandPageMocks({ entry: cacheEntry() });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.noindex).toBe(false);
  });

  it('stays indexable when the flag is explicitly "1" and the cache is fresh', async () => {
    const mocks = installBrandPageMocks({
      env: { DB: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "1" },
      entry: cacheEntry(),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.noindex).toBe(false);
  });

  it('noindexes everything when the emergency brake ("0") is set', async () => {
    const mocks = installBrandPageMocks({
      env: { DB: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "0" },
      entry: cacheEntry(),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.noindex).toBe(true);
  });

  it("still renders but noindexes cache older than 7 days", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(8 * DAY_MS) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.ads).toHaveLength(1);
    expect(result.noindex).toBe(true);
  });

  it("treats cache older than 30 days as not checked recently — redirects (issue #1282)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(31 * DAY_MS) }),
    });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
  });

  it('redirects even when the flag is "1" (issue #1282: no page ships empty)', async () => {
    const mocks = installBrandPageMocks({
      env: { DB: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "1" },
      entry: null,
    });

    const response = await runLoaderRedirect("nykaa.com", mocks.env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/search?q=nykaa.com");
  });

  it("noindexes a fresh capture with 0 verified-linked ads (thin page: ad wall without the score)", async () => {
    // 24 unverified text-mention matches: the provider returned them for
    // nykaa.com, but none carries a landing-page or domainMatch verdict
    // linking it to the domain. The wall renders, but the Ad Aggression Score
    // (the page's differentiator) cannot — so the page self-noindexes rather
    // than ship as indexable thin content.
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            {
              ...baseAd,
              metaAdId: "meta-text-1",
              advertiser: "BeautyDeals Hub",
              landingPageUrl: null,
              domainMatch: undefined,
              firstSeenAt: isoAgo(30 * DAY_MS),
            },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.ads).toHaveLength(1);
    expect(result.verifiedLinkCount).toBe(0);
    expect(result.aggression).toBeNull();
    expect(result.noindex).toBe(true);
  });

  it("indexes a fresh capture whose verified-linked ad is too recent to score (window < 14 days)", async () => {
    // The 14-day Aggression Score window must NOT gate indexability on a
    // populated page (issue #1442): the verified-linked ad's first-seen is
    // 2 days ago, so the score is still deferred (aggression === null), but
    // the page has a real ad wall and is NOT thin — it stays indexable.
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [{ ...baseAd, firstSeenAt: isoAgo(2 * DAY_MS) }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.verifiedLinkCount).toBe(1);
    expect(result.aggression).toBeNull();
    // The score is deferred, but the populated page is indexable (issue #1442).
    expect(result.noindex).toBe(false);
    // Honest "N/14 days so far" figure for the deferred score state.
    expect(result.observationDays).toBe(2);
  });

  it("indexes a fresh populated capture whose verified-linked ad carries no first-seen date", async () => {
    // A verified-link ad with no first-seen date: the Ad Aggression Score
    // cannot render (no window), but the page is populated — indexability is
    // decoupled from score computability (issue #1442), so it stays
    // indexable. The score card degrades to the generic "not enough history"
    // note because no observation window is computable.
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [{ ...baseAd, firstSeenAt: null }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.verifiedLinkCount).toBe(1);
    expect(result.aggression).toBeNull();
    expect(result.observationDays).toBeNull();
    expect(result.noindex).toBe(false);
  });

  it("stays indexable when the verified-linked capture clears the 14-day score floor", async () => {
    // baseAd carries a verified domainMatch and a 30-day first-seen — the
    // score renders, so the page stays indexable (no regression to the
    // pages that already render the full score).
    const mocks = installBrandPageMocks({ entry: cacheEntry() });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.verifiedLinkCount).toBe(1);
    expect(result.aggression).not.toBeNull();
    expect(result.noindex).toBe(false);
  });

  it("indexes allbirds.com when the warmed cache lands on allbirds.co.uk (production 2026-08-26 shape)", async () => {
    // Live /ads/allbirds.com served 17 ads landing on allbirds.co.uk / .ae /
    // .co.nz / .com.kw with 0 verified allbirds.com links, so the score hid
    // and the page self-noindexed. Repair: a regional Allbirds store is a
    // verified link to the brand, even if the cached domainMatch is still
    // unverified from the pre-repair capture.
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            {
              ...baseAd,
              metaAdId: "meta-allbirds-uk",
              advertiser: "Allbirds",
              landingPageUrl: "https://www.allbirds.co.uk/products/womens-dasher",
              domainMatch: {
                level: "unverified_provider_candidate",
                reason: "Returned by the Meta source; website connection not verified",
                matchedDomain: null,
              },
              firstSeenAt: isoAgo(131 * DAY_MS),
            },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("allbirds.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.verifiedLinkCount).toBe(1);
    expect(result.aggression).not.toBeNull();
    expect(result.noindex).toBe(false);
  });

  it("indexes mamaearth.com when the warmed cache lands on mamaearth.in (production 2026-08-26 shape)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({
        payload: {
          ads: [
            {
              ...baseAd,
              metaAdId: "meta-mamaearth-in",
              advertiser: "Mamaearth",
              landingPageUrl: "https://mamaearth.in/product/ubtan-face-wash",
              domainMatch: {
                level: "unverified_text_candidate",
                reason: "Mentions “mamaearth” in ad text only",
                matchedDomain: null,
              },
              firstSeenAt: isoAgo(120 * DAY_MS),
            },
          ],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "hit",
        },
      }),
    });

    const result = await runLoader("mamaearth.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.verifiedLinkCount).toBe(1);
    expect(result.aggression).not.toBeNull();
    expect(result.noindex).toBe(false);
  });
});

describe("/ads/:domain meta", () => {
  async function metaFor(data: Record<string, unknown> | undefined) {
    const { meta } = await import("~/routes/ads.$domain");
    return meta({ loaderData: data, params: {}, location: { pathname: "/ads/nykaa.com" } } as never) as Array<
      Record<string, string>
    >;
  }

  const richData = {
    domain: "nykaa.com",
    brandName: "Nykaa",
    hasCachedAds: true,
    ads: [baseAd],
    checkedAgo: "about 2 hours ago",
    teaser: null,
    adLibraryCountry: "India",
    noindex: false,
    canonicalPath: "/ads/nykaa.com",
    freshForLiveClaim: false,
    brandOwnedAdCount: 1,
    verifiedLinkCount: 1,
    unverifiedMatchCount: 0,
  };

  it("emits the brand title, honest description, and canonical URL without robots meta when indexable", async () => {
    installBrandPageMocks();
    const tags = await metaFor(richData);

    // The title is time-stable: the freshness stamp ("checked about N…",
    // "right now") lives in the visible page and the description — never in
    // the indexed title, which must not churn with the capture clock.
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads | Five to Nine",
    });
    expect(tags.some((tag) => tag.title?.includes("checked about"))).toBe(false);
    expect(tags.some((tag) => tag.title?.includes("right now"))).toBe(false);
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://0509.io/ads/nykaa.com",
    });
    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("a public check of the India Ad Library about 2 hours ago");
    expect(tags.some((tag) => tag.name === "robots")).toBe(false);
  });

  it("keeps the title time-stable even when the capture is fresh enough for a live claim", async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, checkedAgo: "moments ago", freshForLiveClaim: true });

    // The live-scrape "right now" claim never enters the indexed title — it
    // belongs to the visible captions and the meta description, whose honesty
    // gate already guards it.
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads | Five to Nine",
    });
    expect(tags.some((tag) => tag.title?.includes("right now"))).toBe(false);
  });

  it("never claims the capture is right now when the checked-ago stamp is missing", async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, checkedAgo: null, freshForLiveClaim: true });

    expect(tags.some((tag) => tag.title?.includes("right now"))).toBe(false);
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads | Five to Nine",
    });
  });

  it("adds the robots noindex meta when the loader marked the page noindex", async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, noindex: true });

    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("never claims the brand owns ads when the cached creatives are other advertisers'", async () => {
    installBrandPageMocks();
    // No Aggression Score card renders in this state (the cache-miss strip):
    // this is the ONLY state in which the description may carry the
    // "could not verify" hedge (issue #1447). Aggression null also means the
    // loader would self-noindex, so this copy never reaches the sitemap.
    const tags = await metaFor({
      ...richData,
      brandOwnedAdCount: 0,
      aggression: null,
    });

    // The title describes the page honestly as ads linking to the domain,
    // with the brand as the topic — never "{brand}'s ads".
    expect(tags).toContainEqual({
      title: "Nykaa: Meta ads linking to nykaa.com | Five to Nine",
    });
    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    // Issue #1428: when no creative could be attributed to the brand, the
    // description must NOT frame them as "from other advertisers" (that
    // disclaims the page's own subject on the indexed surface). It keeps the
    // brand as the subject and says ownership could not be verified.
    expect(description).toContain("linking to nykaa.com");
    expect(description).toContain("We could not verify from the cached capture that Nykaa runs these ads");
    expect(description).not.toContain("from other advertisers");
    expect(description).not.toContain("ads from Nykaa");
    expect(tags.some((tag) => tag.title?.includes("Nykaa Facebook & Instagram ads"))).toBe(false);
  });

  it("never carries the could-not-verify hedge when the Aggression Score card renders (issue #1447)", async () => {
    installBrandPageMocks();
    // The score card renders (a fixture with verified link evidence that
    // cleared the score floor — like the live ouraring.com/ulta.com pages from
    // the issue): the description must speak the verified phrasing and must
    // never say "could not verify" next to proof the page renders.
    const tags = await metaFor({
      ...richData,
      brandOwnedAdCount: 0,
      aggression: { score: 53 },
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("See 1 Meta ad linking to nykaa.com");
    expect(description).not.toContain("could not verify");
    // Still no ownership over-claim: the creatives are verified to LINK to
    // the domain, never claimed to be the brand's own.
    expect(description).not.toContain("ads from Nykaa");
    expect(description).not.toContain("from other advertisers");
    expect(tags.some((tag) => tag.title?.includes("Nykaa Facebook & Instagram ads"))).toBe(false);
  });

  it("states the brand/other-advertiser split in the meta when the cache mixes both", async () => {
    installBrandPageMocks();
    const tags = await metaFor({
      ...richData,
      ads: [baseAd, { ...baseAd, metaAdId: "meta-2" }],
      brandOwnedAdCount: 1,
      verifiedLinkCount: 2,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("2 Meta ads linking to nykaa.com — 1 from Nykaa and 1 from other advertisers");
    expect(tags.some((tag) => tag.title?.includes("Nykaa Facebook & Instagram ads"))).toBe(false);
  });

  it("never claims ads LINK to the domain when the capture has no verified link evidence", async () => {
    installBrandPageMocks();
    // The cached creatives were returned by the provider query (text mention /
    // provider candidate) — no landing page, no domainMatch verdict.
    const unverifiedAd = { ...baseAd, metaAdId: "meta-text-1", domainMatch: undefined };
    const tags = await metaFor({
      ...richData,
      ads: [unverifiedAd, { ...unverifiedAd, metaAdId: "meta-text-2" }],
      brandOwnedAdCount: 0,
      verifiedLinkCount: 0,
      unverifiedMatchCount: 2,
    });

    expect(tags).toContainEqual({
      title: "Nykaa: Meta ads matching nykaa.com | Five to Nine",
    });
    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("2 Meta ads matching nykaa.com");
    expect(description).toContain("Their link to the site is not verified");
    // The unverified capture must never be described as linking to the domain.
    expect(description).not.toContain("linking to nykaa.com");
    expect(tags.some((tag) => tag.title?.includes("linking to nykaa.com"))).toBe(false);
  });

  it("counts only verified-linked creatives in linking language when matches are mixed", async () => {
    installBrandPageMocks();
    // 1 verified ad (baseAd) + 1 text-mention ad. The wall shows both, but the
    // "linking to" counts must cover only the verified capture.
    const unverifiedAd = { ...baseAd, metaAdId: "meta-text-1", domainMatch: undefined };
    const tags = await metaFor({
      ...richData,
      ads: [baseAd, unverifiedAd],
      brandOwnedAdCount: 1,
      verifiedLinkCount: 1,
      unverifiedMatchCount: 1,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("1 Meta ad linking to nykaa.com — 1 from Nykaa");
    expect(description).toContain(
      "Another 1 ad matched the search without a verified link to nykaa.com.",
    );
  });

  it("omits 'from other advertisers' when every verified linking creative is the brand's own (unverified matches only)", async () => {
    installBrandPageMocks();
    // Mirrors the live hubspot.com defect: 4 verified brand-owned ads + 6
    // unverified text-matches. The prefix must say 4, the breakdown must NOT
    // fold the 6 unverified matches into "from other advertisers", and the
    // unverified matches appear only in the labelled tail.
    const verifiedAds = Array.from({ length: 4 }, (_v, i) => ({
      ...baseAd,
      metaAdId: `meta-verified-${i}`,
    }));
    const unverifiedAds = Array.from({ length: 6 }, (_v, i) => ({
      ...baseAd,
      metaAdId: `meta-text-${i}`,
      domainMatch: undefined,
    }));
    const tags = await metaFor({
      ...richData,
      domain: "hubspot.com",
      brandName: "HubSpot",
      ads: [...verifiedAds, ...unverifiedAds],
      brandOwnedAdCount: 4,
      verifiedLinkCount: 4,
      unverifiedMatchCount: 6,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("See 4 Meta ads linking to hubspot.com");
    expect(description).toContain("4 from HubSpot");
    // The unverified text-matches must NOT be attributed to other advertisers.
    expect(description).not.toContain("6 from other advertisers");
    expect(description).not.toContain("0 from other advertisers");
    // The unverified matches appear only in the labelled tail.
    expect(description).toContain(
      "Another 6 ads matched the search without a verified link to hubspot.com.",
    );
  });

  it("keeps the 'and Y from other advertisers' split when verified-from-other creatives exist alongside unverified matches", async () => {
    installBrandPageMocks();
    // 4 verified brand-owned + 2 verified-from-other + 6 unverified matches.
    // The breakdown sums to verifiedLinkCount (4 + 2 == 6); the 6 unverified
    // matches stay in the tail and never enter the "from other advertisers" count.
    const brandVerified = Array.from({ length: 4 }, (_v, i) => ({
      ...baseAd,
      metaAdId: `meta-brand-${i}`,
    }));
    const otherVerified = Array.from({ length: 2 }, (_v, i) => ({
      ...baseAd,
      metaAdId: `meta-other-${i}`,
      advertiser: "Competitor Co",
    }));
    const unverifiedAds = Array.from({ length: 6 }, (_v, i) => ({
      ...baseAd,
      metaAdId: `meta-text-${i}`,
      domainMatch: undefined,
    }));
    const tags = await metaFor({
      ...richData,
      ads: [...brandVerified, ...otherVerified, ...unverifiedAds],
      brandOwnedAdCount: 4,
      verifiedLinkCount: 6,
      unverifiedMatchCount: 6,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("See 6 Meta ads linking to nykaa.com — 4 from Nykaa and 2 from other advertisers");
    expect(description).toContain(
      "Another 6 ads matched the search without a verified link to nykaa.com.",
    );
    // The unverified count must not leak into the "from other advertisers" slot.
    expect(description).not.toContain("8 from other advertisers");
  });

  it("describes the honest shell without fabricating ad data", async () => {
    installBrandPageMocks();
    const tags = await metaFor({
      ...richData,
      hasCachedAds: false,
      ads: [],
      checkedAgo: null,
      noindex: true,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("We haven't checked nykaa.com recently");
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
    // The cache-miss shell must not claim the brand is running ads right now.
    expect(tags.some((tag) => tag.title?.includes("right now"))).toBe(false);
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads | Five to Nine",
    });
  });

  it("noindexes when loader data is unavailable (error boundary)", async () => {
    installBrandPageMocks();
    const tags = await metaFor(undefined);

    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});
