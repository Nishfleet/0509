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
    payload: Record<string, unknown>;
  }> = {},
) {
  return {
    cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
    provider: "meta_library_browser",
    routeContext: overrides.routeContext ?? "public_search",
    queryFingerprint: "fnv1a-test",
    country: "all",
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
}

function installBrandPageMocks(options: MockOptions = {}) {
  const env = options.env ?? { DB: {} };
  const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(options.entry ?? null);
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
    // The machine-readable twin of the visible "Last checked" stamp.
    expect(result.lastCheckedAt).toBe(entry.fetchedAt);
    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]?.metaAdId).toBe("meta-nykaa-1");
    expect(result.checkedAgo).toBe("about 2 hours ago");
    // A capture hours old must NOT present itself as "right now".
    expect(result.freshForLiveClaim).toBe(false);
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

  it("marks the capture fresh for a live claim only while the check is under an hour old", async () => {
    const mocks = installBrandPageMocks({
      entry: cacheEntry({ fetchedAt: isoAgo(5 * 60 * 1000) }),
    });

    const result = await runLoader("nykaa.com", mocks.env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.checkedAgo).toBe("about 5 minutes ago");
    expect(result.freshForLiveClaim).toBe(true);
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
    noindex: false,
    canonicalPath: "/ads/nykaa.com",
    freshForLiveClaim: false,
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
    expect(description).toContain("public Ad Library check about 2 hours ago");
    expect(tags.some((tag) => tag.name === "robots")).toBe(false);
  });

  it('keeps the "right now" title only when the capture is fresh enough for a live claim', async () => {
    installBrandPageMocks();
    const tags = await metaFor({ ...richData, checkedAgo: "about 5 minutes ago", freshForLiveClaim: true });

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
