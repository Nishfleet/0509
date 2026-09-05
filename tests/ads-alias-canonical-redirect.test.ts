import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import { indexableBrandPageEntriesFromRows } from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * A verified creative for a brand page. No domainMatch is set by default so
 * the loader's own landing-host attribution decides verification — this is
 * what lets the alias-host-landing case (criterion 2) actually exercise the
 * attribution path rather than short-circuiting on persisted verdicts.
 */
function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-ridge-ad-1",
    advertiser: "Ridge Wallet",
    body: "Test body",
    previewHeadline: "Test headline",
    previewSubhead: "",
    hook: "Shop now",
    offer: "",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.ridgewallet.com/",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    // 30-day first-seen clears the 14-day aggression-score floor so the page
    // keeps its differentiator and stays indexable.
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

/**
 * A persisted discovery-cache entry. The cacheKey embeds the registrable
 * domain in v2 mode (`search-v2:domain:<domain>:exact:...`), which is how the
 * mocked read below decides which domain's cache a request is probing.
 */
function cacheEntry(domain: string, ads: AdRecord[] = [ad()]) {
  const registrable = domain.replace(/^www\./, "");
  return {
    cacheKey: `search-v2:domain:${registrable}:exact:meta_library_browser:all:page-1`,
    provider: "meta_library_browser",
    routeContext: "public_search",
    queryFingerprint: "fnv1a-test",
    country: "all",
    cursor: null,
    payload: {
      ads,
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      searchIntent: "domain",
      displayDomain: registrable,
    },
    fetchedAt: isoAgo(2 * 60 * 60 * 1000),
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: isoAgo(2 * 60 * 60 * 1000),
    updatedAt: isoAgo(2 * 60 * 60 * 1000),
  };
}

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

interface MockOptions {
  /**
   * Branches the mocked cache read on the requested domain. `true` serves a
   * populated entry for that domain, `false` serves a cache miss, and an
   * `AdRecord[]` overrides the entry's ads (defaults to a single verified ad).
   */
  byDomain?: (domain: string) => boolean | AdRecord[];
  env?: Record<string, unknown>;
  rateLimitResponse?: Response | null;
}

/**
 * Installs the same module mocks the existing brand-page route test uses, but
 * the cache read branches on the domain embedded in the requested cache key so
 * a single loader invocation can probe both the alias and its canonical target.
 */
function installMocks(options: MockOptions = {}) {
  // v2 rollout so the loader derives search-v2 domain keys whose cache key
  // embeds the registrable domain (search-v2:domain:<domain>:...), which is
  // what the mocked read below branches on per domain.
  const env = options.env ?? { DB: {}, SEARCH_ROLLOUT_MODE: "v2", PUBLIC_BRAND_PAGES_INDEXABLE: "1" };
  const resolveProvider = vi.fn(() => "meta_library_browser");
  const getDiscoveryCacheEntry = vi.fn(async (_env: unknown, cacheKey: string) => {
    // v2 domain keys embed the registrable domain:
    // search-v2:domain:<domain>:exact:meta_library_browser:all:page-1
    const domain = typeof cacheKey === "string" ? cacheKey.split(":")[2] ?? "" : "";
    const byDomain = options.byDomain;
    if (byDomain) {
      const resolved = byDomain(domain);
      if (resolved === false) {
        return null;
      }
      if (Array.isArray(resolved)) {
        return cacheEntry(domain, resolved);
      }
      return cacheEntry(domain);
    }
    return cacheEntry(domain);
  });

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
    resolveCommercialDiscoveryProvider: resolveProvider,
    searchAdsViaSourceResolver: vi.fn(),
    hasFreshDiscoveryCacheEntry: vi.fn(),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit,
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
    loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
    summarizeDomainCaptureFailures: vi.fn().mockReturnValue(null),
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));

  return { env, getDiscoveryCacheEntry, enforcePublicBrandPageRateLimit };
}

async function runLoader(domain: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/ads.$domain");
  return loader({
    context: createContext(env),
    params: { domain },
    request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
  } as never);
}

/** Runs the loader and returns the thrown redirect Response, or null if it rendered. */
async function loaderResponse(
  domain: string,
  env: Record<string, unknown>,
): Promise<{
  redirect: Response | null;
  data: BrandPageLoaderData | null;
}> {
  try {
    const data = await runLoader(domain, env);
    return { redirect: null, data };
  } catch (error) {
    if (error instanceof Response) {
      return { redirect: error, data: null };
    }
    throw error;
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("brand-page alias resolution (issue #1446)", () => {
  it("301-redirects an alias ridge.com to the populated canonical ridgewallet.com", async () => {
    const mocks = installMocks({
      // Canonical (product) page is populated; the alias page is a cache miss.
      byDomain: (domain) => domain === "ridgewallet.com",
    });

    const { redirect } = await loaderResponse("ridge.com", mocks.env);

    expect(redirect).toBeInstanceOf(Response);
    expect(redirect!.status).toBe(301);
    expect(redirect!.headers.get("Location")).toBe("/ads/ridgewallet.com");
  });

  it("301-redirects an alias oura.com to the populated canonical ouraring.com", async () => {
    const mocks = installMocks({
      // Canonical (product) page is populated; the alias page is a cache miss.
      byDomain: (domain) => domain === "ouraring.com",
    });

    const { redirect } = await loaderResponse("oura.com", mocks.env);

    expect(redirect).toBeInstanceOf(Response);
    expect(redirect!.status).toBe(301);
    expect(redirect!.headers.get("Location")).toBe("/ads/ouraring.com");
  });

  it("does NOT redirect the alias when its canonical page is not populated (criterion 4: keep weak alias noindex)", async () => {
    // The canonical product page is a cache miss; the alias has its own thin
    // snapshot (a single verified ad under the aggression-scale floor because
    // it only ever saw a sub-14-day window).
    const mocks = installMocks({
      byDomain: (domain) => {
        if (domain === "ridgewallet.com") return false;
        if (domain === "ridge.com") {
          return [
            ad({
              metaAdId: "meta-ridge-stub-1",
              firstSeenAt: isoAgo(5 * DAY_MS), // sub-14-day window → no score → noindex
            }),
          ];
        }
        return true;
      },
    });

    const { redirect, data } = await loaderResponse("ridge.com", mocks.env);

    expect(redirect).toBeNull();
    expect(data).not.toBeNull();
    // The weak alias page still serves its own thin render and stays noindex.
    expect(data!.noindex).toBe(true);
  });

  it("keeps a canonical page's verified set whole when an ad lands on the brand's alias host (criterion 2)", async () => {
    const mocks = installMocks({
      // Serve the canonical page directly with a creative that lands on the
      // brand's natural base domain (ridge.com) — the #1428-style identity
      // must attribute it to the ridgewallet.com page, never drop it.
      byDomain: (domain) =>
        domain === "ridgewallet.com"
          ? [ad({ landingPageUrl: "https://www.ridge.com/shop" })]
          : true,
    });

    const { redirect, data } = await loaderResponse("ridgewallet.com", mocks.env);

    expect(redirect).toBeNull();
    expect(data!.verifiedLinkCount).toBe(1);
    expect(data!.brandOwnedAdCount).toBe(1);
  });

  it("does not treat an unrelated plain domain as a canonical alias", async () => {
    const mocks = installMocks({
      // nykaa.com is not an alias; its own page should render, not redirect.
      byDomain: (domain) => domain === "nykaa.com",
    });

    const { redirect, data } = await loaderResponse("nykaa.com", mocks.env);

    expect(redirect).toBeNull();
    expect(data!.domain).toBe("nykaa.com");
  });
});

describe("sitemap excludes alias brand-page domains (issue #1446 criterion 3)", () => {
  /** Build a v2-domain-keyed indexable cache row for a domain. */
  function indexableRow(domain: string) {
    return {
      cache_key: `search-v2:domain:${domain}:exact:meta_library_browser:all:page-1`,
      provider: "meta_library_browser",
      route_context: "public_search",
      payload_json: JSON.stringify({
        ads: [ad({ landingPageUrl: `https://www.${domain}/` })],
        source: "meta_library_browser",
        provider: "meta_library_browser",
        searchIntent: "domain",
        displayDomain: domain,
      }),
      fetched_at: isoAgo(2 * 60 * 60 * 1000),
    };
  }

  it("lists the canonical product page but drops its alias from the sitemap", () => {
    const rows = [indexableRow("ridge.com"), indexableRow("ridgewallet.com")];
    const entries = indexableBrandPageEntriesFromRows(rows, new Date(), {
      provider: "meta_library_browser",
      useDomainV2: true,
    });

    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/ads/ridgewallet.com");
    expect(paths).not.toContain("/ads/ridge.com");
  });

  it("drops a populated alias that a cache row would otherwise make indexable", () => {
    const rows = [indexableRow("oura.com"), indexableRow("ouraring.com")];
    const entries = indexableBrandPageEntriesFromRows(rows, new Date(), {
      provider: "meta_library_browser",
      useDomainV2: true,
    });

    const paths = entries.map((e) => e.path);
    expect(paths).toContain("/ads/ouraring.com");
    expect(paths).not.toContain("/ads/oura.com");
  });
});
