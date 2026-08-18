import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

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
  landingPageUrl: null,
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
  countries: ["all"],
  platforms: ["Instagram"],
  firstSeenAt: isoAgo(5 * DAY_MS),
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_library_browser",
  analysisFields: [],
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

  return {
    env,
    getDiscoveryCacheEntry,
    searchAdsViaSourceResolver,
    hasFreshDiscoveryCacheEntry,
    searchMetaLibraryByBrowser,
    searchMetaApiAds,
    enforcePublicBrandPageRateLimit,
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
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/rate-limit.server");
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
      longestRunningDays: 5,
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

  it("names the country of the Ad Library the cached creatives came from", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ country: "India" }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.adLibraryCountry).toBe("India");
  });

  it("keeps the Ad Library country honest on the cache-miss shell", async () => {
    const mocks = installBrandPageMocks({ entry: null });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.adLibraryCountry).toBeNull();
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
            { ...baseAd, metaAdId: "meta-reseller-1", advertiser: "BeautyDeals Hub" },
            { ...baseAd, metaAdId: "meta-reseller-2", advertiser: "BeautyDeals Hub" },
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

  it("renders the honest shell with noindex on a cache miss, with bounded cache lookups and zero provider calls", async () => {
    const mocks = installBrandPageMocks({ entry: null });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result).toMatchObject({
      hasCachedAds: false,
      ads: [],
      checkedAgo: null,
      lastCheckedAt: null,
      teaser: null,
      noindex: true,
    });
    expect(mocks.getDiscoveryCacheEntry.mock.calls.length).toBeLessThanOrEqual(4);
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.searchMetaLibraryByBrowser).not.toHaveBeenCalled();
    expect(mocks.searchMetaApiAds).not.toHaveBeenCalled();
  });

  it("never presents demo-sourced cache as a brand's real ads", async () => {
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

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.ads).toEqual([]);
    expect(result.noindex).toBe(true);
  });

  it("renders the honest shell when only demo discovery is configured", async () => {
    const mocks = installBrandPageMocks({ entry: cacheEntry(), provider: "demo" });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.noindex).toBe(true);
    expect(mocks.getDiscoveryCacheEntry).not.toHaveBeenCalled();
  });

  it("skips scheduled-scan cache entries (interactive public_search cache only)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ routeContext: "watchlist_scan" }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.noindex).toBe(true);
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

  it("treats cache older than 30 days as not checked recently (honest shell)", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(31 * DAY_MS) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.noindex).toBe(true);
  });

  it('keeps the shell noindexed even when the flag is "1"', async () => {
    const mocks = installBrandPageMocks({
      env: { DB: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "1" },
      entry: null,
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(false);
    expect(result.noindex).toBe(true);
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
  };

  it("emits the brand title, honest description, and canonical URL without robots meta when indexable", async () => {
    installBrandPageMocks();
    const tags = await metaFor(richData);

    // The capture is hours old — the title must not claim "right now".
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads — checked about 2 hours ago | Five to Nine",
    });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://0509.io/ads/nykaa.com",
    });
    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("a public check of the India Ad Library about 2 hours ago");
    expect(tags.some((tag) => tag.name === "robots")).toBe(false);
  });

  it('keeps the "right now" title only when the capture is fresh enough for a live claim', async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, checkedAgo: "moments ago", freshForLiveClaim: true });

    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads right now | Five to Nine",
    });
  });

  it("never claims the capture is right now when the checked-ago stamp is missing", async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, checkedAgo: null, freshForLiveClaim: true });

    expect(tags.some((tag) => tag.title?.includes("right now"))).toBe(false);
    expect(tags).toContainEqual({
      title: "Nykaa Facebook & Instagram ads — checked recently | Five to Nine",
    });
  });

  it("adds the robots noindex meta when the loader marked the page noindex", async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, noindex: true });

    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("never claims the brand owns ads when the cached creatives are other advertisers'", async () => {
    installBrandPageMocks();
    const tags = await metaFor({
      ...richData,
      brandOwnedAdCount: 0,
    });

    // The title describes the page honestly as ads linking to the domain,
    // with the brand as the topic — never "{brand}'s ads".
    expect(tags).toContainEqual({
      title: "Nykaa: Meta ads linking to nykaa.com — checked about 2 hours ago | Five to Nine",
    });
    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("from other advertisers linking to nykaa.com");
    expect(description).not.toContain("ads from Nykaa");
    expect(tags.some((tag) => tag.title?.includes("Nykaa Facebook & Instagram ads"))).toBe(false);
  });

  it("states the brand/other-advertiser split in the meta when the cache mixes both", async () => {
    installBrandPageMocks();
    const tags = await metaFor({
      ...richData,
      ads: [baseAd, { ...baseAd, metaAdId: "meta-2" }],
      brandOwnedAdCount: 1,
    });

    const description = tags.find((tag) => tag.name === "description")?.content ?? "";
    expect(description).toContain("2 Meta ads linking to nykaa.com — 1 from Nykaa and 1 from other advertisers");
    expect(tags.some((tag) => tag.title?.includes("Nykaa Facebook & Instagram ads"))).toBe(false);
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
