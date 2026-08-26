import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyWebsiteSearchFallback,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  deriveBrandPageLookupForCountry,
} from "~/lib/brand-page.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { SITEMAP_PATHS } from "~/lib/seo";
import routes from "~/routes";
import {
  brandDomainFromSitemapCacheRow,
  brandPageLookupCacheKeysForSitemap,
  brandPageRowRendersAggressionScore,
  buildSitemapXml,
  indexableBrandPageEntriesFromRows,
  isIndexableBrandPageRow,
  SITEMAP_BRAND_PATH_LIMIT,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

// A cached ad that carries VERIFIED link evidence (a registrable_domain
// domainMatch verdict) AND enough history (30-day first-seen) for the Ad
// Aggression Score to render. Sitemap rows backed by this ad qualify for the
// sitemap; rows whose ads lack verified-link evidence or history back thin
// pages and must stay out.
const verifiedAd = {
  metaAdId: "meta-nykaa-1",
  source: "meta_library_browser",
  landingPageUrl: "https://nykaa.com/shop",
  domainMatch: {
    level: "registrable_domain",
    reason: "Landing page matches nykaa.com",
    matchedDomain: "nykaa.com",
  },
  firstSeenAt: isoAgo(30 * DAY_MS),
  lastSeenAt: null,
  active: true,
  variantCount: 1,
};

const basePayload = {
  ads: [verifiedAd],
  nextCursor: null,
  source: "meta_library_browser",
  provider: "meta_library_browser",
  cacheStatus: "hit",
  searchIntent: "domain",
  displayDomain: "nykaa.com",
};

function cacheRow(overrides: Partial<SitemapCacheRow> & { payload?: unknown } = {}): SitemapCacheRow {
  const { payload, ...rowOverrides } = overrides;
  return {
    cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify(payload ?? basePayload),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
    ...rowOverrides,
  };
}

describe("brandDomainFromSitemapCacheRow", () => {
  it("recovers the domain from an exact-scope search-v2 cache key", () => {
    expect(
      brandDomainFromSitemapCacheRow(cacheRow()),
    ).toBe("nykaa.com");
  });

  it("skips broader-scope rows — the brand page would render the noindex shell", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1" }),
      ),
    ).toBeNull();
  });

  it("rejects v2 keys whose embedded value is not a valid public domain", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "search-v2:domain:nykaa:exact:meta_library_browser:all:page-1" }),
      ),
    ).toBeNull();
  });

  it("recovers the domain from a legacy-shaped key when the payload is a v2 domain result", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1" }),
      ),
    ).toBe("nykaa.com");
  });

  it("does not map text-intent or plain legacy payloads to a brand page", () => {
    const textPayload = { ...basePayload, searchIntent: "text" };
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload: textPayload }),
      ),
    ).toBeNull();

    const { searchIntent: _searchIntent, displayDomain: _displayDomain, ...legacyPayload } = basePayload;
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload: legacyPayload }),
      ),
    ).toBeNull();
  });

  it("returns null for unparseable payloads", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload_json: "{not json" }),
      ),
    ).toBeNull();
  });
});

describe("isIndexableBrandPageRow", () => {
  const now = new Date();

  it("accepts a fresh non-demo public_search row with ads", () => {
    expect(isIndexableBrandPageRow(cacheRow(), now)).toBe(true);
  });

  it("rejects non-public_search route contexts (scheduled scans are shallow)", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ route_context: "watchlist_scan" }), now),
    ).toBe(false);
  });

  it("rejects demo providers and demo payloads", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ provider: "demo" }), now),
    ).toBe(false);
    expect(
      isIndexableBrandPageRow(
        cacheRow({ payload: { ...basePayload, source: "demo", provider: "demo" } }),
        now,
      ),
    ).toBe(false);
  });

  it("rejects rows with no usable (non-demo) ads", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ payload: { ...basePayload, ads: [] } }), now),
    ).toBe(false);
    expect(
      isIndexableBrandPageRow(
        cacheRow({
          payload: {
            ...basePayload,
            ads: [{ metaAdId: "meta-demo-1", source: "demo" }],
          },
        }),
        now,
      ),
    ).toBe(false);
  });

  it("rejects entries outside the 7-day indexability freshness window", () => {
    expect(
      isIndexableBrandPageRow(
        cacheRow({ fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS + DAY_MS) }),
        now,
      ),
    ).toBe(false);
    // Future timestamps are clock-skew artifacts, never indexable evidence.
    expect(
      isIndexableBrandPageRow(cacheRow({ fetched_at: isoAgo(-DAY_MS) }), now),
    ).toBe(false);
  });

  it("accepts a capture exactly at the 7-day boundary", () => {
    expect(
      isIndexableBrandPageRow(
        cacheRow({ fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS) }),
        now,
      ),
    ).toBe(true);
  });
});

describe("indexableBrandPageEntriesFromRows", () => {
  it("dedupes domains across countries/cursors and keeps newest-first order", () => {
    const rows = [
      cacheRow({
        cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
        fetched_at: isoAgo(2 * 60 * 60 * 1000),
      }),
      // Same domain, older capture in a different country — must dedupe.
      cacheRow({
        cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:india:page-1",
        fetched_at: isoAgo(3 * 60 * 60 * 1000),
      }),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
        fetched_at: isoAgo(DAY_MS),
      }),
    ];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual([
      "/ads/nykaa.com",
      "/ads/meesho.com",
    ]);
  });

  it("carries lastmod from fetched_at, plus changefreq and priority", () => {
    const fetchedAt = isoAgo(2 * 60 * 60 * 1000);
    const rows = [cacheRow({ fetched_at: fetchedAt })];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/ads/nykaa.com");
    expect(entries[0].lastmod).toBe(fetchedAt.slice(0, 10));
    expect(entries[0].changefreq).toBe("weekly");
    expect(entries[0].priority).toBe("0.6");
  });

  it("skips rows that would not render an indexable page", () => {
    const rows = [
      cacheRow({ route_context: "watchlist_scan" }),
      cacheRow({ provider: "demo" }),
      cacheRow({ payload: { ...basePayload, ads: [] } }),
      cacheRow({ fetched_at: isoAgo(10 * DAY_MS) }),
      cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1" }),
      cacheRow(),
    ];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual(["/ads/nykaa.com"]);
  });

  it("bounds the sitemap to SITEMAP_BRAND_PATH_LIMIT entries", () => {
    const rows = Array.from({ length: SITEMAP_BRAND_PATH_LIMIT + 25 }, (_, index) =>
      cacheRow({
        cache_key: `search-v2:domain:brand-${index}.com:exact:meta_library_browser:all:page-1`,
      }),
    );

    expect(indexableBrandPageEntriesFromRows(rows)).toHaveLength(SITEMAP_BRAND_PATH_LIMIT);
  });
});

describe("lookup parity — never list a page that would serve noindex", () => {
  const now = new Date();

  it("excludes a fresh capture stored only under a country scope unknown-geo crawlers never probe (the /ads/myntra.com regression)", () => {
    // Passes every pre-parity rule (public_search, non-demo, ads, fresh), but
    // the page probes [visitor-country, all, United States] — never "india" —
    // so a US crawler got the noindex shell while the sitemap listed it.
    const row = cacheRow({
      cache_key: "search-v2:domain:myntra.com:exact:meta_library_browser:india:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([]);
  });

  it("lists the same domain once captured under an always-tried country scope", () => {
    const row = cacheRow({
      cache_key:
        "search-v2:domain:myntra.com:exact:meta_library_browser:united-states:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/myntra.com",
    ]);
  });

  it("excludes rows written by a provider other than the resolved commercial provider", () => {
    const row = cacheRow({ provider: "meta_api" });

    expect(
      indexableBrandPageEntriesFromRows([row], now, { provider: "meta_library_browser" }).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("under a legacy rollout posture, only rows keyed exactly like the page's legacy lookups qualify", () => {
    const provider = "meta_library_browser";
    const legacyKey = deriveBrandPageLookupForCountry(provider, "nykaa.com", "all", false).cacheKey;

    // A v2-keyed row is unreachable when the page derives legacy fingerprint
    // keys (shadow/legacy mode) — listing it would promise an indexable page
    // that serves noindex.
    expect(
      indexableBrandPageEntriesFromRows([cacheRow()], now, { useDomainV2: false }).map(
        (e) => e.path,
      ),
    ).toEqual([]);

    // A v2-payload row stored under the exact legacy-derived key IS reachable.
    expect(
      indexableBrandPageEntriesFromRows(
        [cacheRow({ cache_key: legacyKey })],
        now,
        { useDomainV2: false },
      ).map((e) => e.path),
    ).toEqual(["/ads/nykaa.com"]);
  });
});

describe("aggression-score gate — never list a thin page (ad wall without its score)", () => {
  const now = new Date();

  it("lists a row whose verified-linked ad clears the 14-day score floor", () => {
    expect(indexableBrandPageEntriesFromRows([cacheRow()], now).map((e) => e.path)).toEqual([
      "/ads/nykaa.com",
    ]);
  });

  it("excludes a row whose ads have NO verified link evidence (the 0-verified-ads thin-page defect)", () => {
    // 24 unverified text-mention matches: the provider returned them for the
    // domain, but none carries a landing-page or domainMatch verdict linking
    // them to it. The page would render the ad wall without the score, so it
    // self-noindexes — the sitemap must not list it.
    const unverifiedOnlyPayload = {
      ...basePayload,
      ads: [
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: unverifiedOnlyPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("excludes a row whose verified-linked ad is too recent to clear the 14-day floor", () => {
    // A verified link exists, but the only first-seen is 2 days ago — the
    // score cannot render (window < MIN_AGGRESSION_WINDOW_DAYS), so the page
    // is thin and must stay out of the sitemap.
    const tooRecentPayload = {
      ...basePayload,
      ads: [{ ...verifiedAd, firstSeenAt: isoAgo(2 * DAY_MS) }],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: tooRecentPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("excludes a row whose verified-linked ad carries no first-seen date", () => {
    const noFirstSeenPayload = {
      ...basePayload,
      ads: [{ ...verifiedAd, firstSeenAt: null }],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: noFirstSeenPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("lists a row when at least one verified-linked ad clears the floor even if other ads do not", () => {
    const mixedPayload = {
      ...basePayload,
      ads: [
        // An unverified text-mention match — renders on the wall, never feeds
        // the score.
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
        // The verified-linked ad with enough history — the score renders.
        verifiedAd,
      ],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: mixedPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual(["/ads/nykaa.com"]);
  });

  it("brandPageRowRendersAggressionScore mirrors the gate for a verified, scoreable row", () => {
    expect(brandPageRowRendersAggressionScore(cacheRow(), "nykaa.com", now)).toBe(true);
  });

  it("brandPageRowRendersAggressionScore is false for a 0-verified-ads row", () => {
    const unverifiedOnlyPayload = {
      ...basePayload,
      ads: [
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };
    expect(
      brandPageRowRendersAggressionScore(
        cacheRow({ payload: unverifiedOnlyPayload }),
        "nykaa.com",
        now,
      ),
    ).toBe(false);
  });
});

describe("brandPageLookupCacheKeysForSitemap", () => {
  it("returns exactly the always-tried scopes' keys in the page's key format", () => {
    const keys = brandPageLookupCacheKeysForSitemap(
      "meta_library_browser",
      "nykaa.com",
      true,
    );

    expect([...keys].sort()).toEqual(
      [
        "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
        "search-v2:domain:nykaa.com:exact:meta_library_browser:united-states:page-1",
      ].sort(),
    );
  });

  it("derives legacy-shaped keys outside the v2 posture", () => {
    const keys = brandPageLookupCacheKeysForSitemap("meta_library_browser", "nykaa.com", false);

    expect(keys.size).toBe(2);
    for (const key of keys) {
      expect(key.startsWith("search-v2:")).toBe(false);
      expect(key.startsWith("meta_library_browser:")).toBe(true);
      expect(key.endsWith(":page-1")).toBe(true);
    }
  });
});

describe("deriveBrandPageLookupForCountry", () => {
  it("reproduces the exact search-v2 domain key the page reads under v2 posture", () => {
    const derived = deriveBrandPageLookupForCountry(
      "meta_library_browser",
      "nykaa.com",
      "United States",
      true,
    );
    const intent = parseSearchInputFromWebsiteField("nykaa.com");

    expect(derived.usedDomainKey).toBe(true);
    expect(derived.cacheKey).toBe(
      buildSearchV2CacheKey({
        provider: "meta_library_browser",
        intent,
        scope: "exact",
        country: "United States",
        cursor: null,
      }),
    );
  });

  it("falls back to the legacy fingerprint triple outside v2 posture (shadow serves legacy)", () => {
    const derived = deriveBrandPageLookupForCountry(
      "meta_library_browser",
      "nykaa.com",
      "all",
      false,
    );

    // Mirror the original deriveCacheLookup chain through independent
    // primitives so composition order cannot drift from the page's lookups.
    const website = normalizeCompetitorWebsiteInput("nykaa.com");
    const parsedInput = parseSearchParams(new URLSearchParams(), { country: "all" });
    const parsed = applyWebsiteSearchFallback(parsedInput, website);
    const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);

    expect(derived.usedDomainKey).toBe(false);
    expect(derived.fingerprint).toBe(fingerprintSavedQuery(legacyQuery));
    expect(derived.country).toBe(legacyQuery.filters.country || ALL_COUNTRIES_VALUE);
    expect(derived.cacheKey).toBe(
      buildDiscoveryCacheKey({
        provider: "meta_library_browser",
        fingerprint: fingerprintSavedQuery(legacyQuery),
        country: legacyQuery.filters.country || ALL_COUNTRIES_VALUE,
        cursor: null,
      }),
    );
  });
});

describe("buildSitemapXml", () => {
  it("keeps the static funnel paths first, then appends dynamic brand pages", () => {
    const xml = buildSitemapXml([
      { path: "/ads/nykaa.com", lastmod: "2026-08-21", changefreq: "weekly", priority: "0.6" },
      { path: "/ads/meesho.com", lastmod: "2026-08-20", changefreq: "weekly", priority: "0.6" },
    ]);

    expect(xml).toContain("<loc>https://0509.io/</loc>");
    expect(xml).toContain("<loc>https://0509.io/search</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/nykaa.com</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/meesho.com</loc>");
    // Static entries carry changefreq and priority.
    expect(xml).toContain("<changefreq>daily</changefreq>");
    expect(xml).toContain("<priority>1.0</priority>");
    // Brand entries carry lastmod.
    expect(xml).toContain("<lastmod>2026-08-21</lastmod>");
    // Static list never carries a hardcoded /ads/ path.
    expect(xml.indexOf("https://0509.io/ads/")).toBe(
      xml.indexOf("https://0509.io/ads/nykaa.com"),
    );
  });

  it("renders a valid static-only sitemap when there are no brand pages", () => {
    const xml = buildSitemapXml([]);

    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(xml).not.toContain("/ads/");
  });
});

describe("llms.txt parity with dynamic sitemap brand paths", () => {
  it("includes every indexable sitemap brand path and omits noindex shells", async () => {
    const { buildLlmsText } = await import("~/lib/public-markdown");
    const now = new Date();
    const nikeAd = {
      ...verifiedAd,
      metaAdId: "meta-nike-1",
      landingPageUrl: "https://nike.com/shop",
      domainMatch: {
        ...verifiedAd.domainMatch,
        reason: "Landing page matches nike.com",
        matchedDomain: "nike.com",
      },
    };
    const indexable = cacheRow({
      cache_key: "search-v2:domain:nike.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "nike.com", ads: [nikeAd] },
    });
    const stale = cacheRow({
      cache_key: "search-v2:domain:stale.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "stale.com" },
      fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS + DAY_MS),
    });
    const demo = cacheRow({
      cache_key: "search-v2:domain:demo.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "demo.com", source: "demo", provider: "demo" },
    });
    const otherCountry = cacheRow({
      cache_key: "search-v2:domain:myntra.com:exact:meta_library_browser:india:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    const brandEntries = indexableBrandPageEntriesFromRows(
      [indexable, stale, demo, otherCountry, cacheRow()],
      now,
    );
    const sitemapAds = [...buildSitemapXml(brandEntries).matchAll(/https:\/\/0509\.io\/ads\/[^<]+/g)].map(
      (match) => match[0],
    );
    const llmsAds = [...buildLlmsText(brandEntries).matchAll(/https:\/\/0509\.io\/ads\/[^)]+/g)].map(
      (match) => match[0],
    );

    expect(sitemapAds).toEqual(["https://0509.io/ads/nike.com", "https://0509.io/ads/nykaa.com"]);
    expect(llmsAds).toEqual(sitemapAds);
    expect(llmsAds).not.toContain("https://0509.io/ads/stale.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/demo.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/myntra.com");
  });
});

describe("loadIndexableBrandPageEntries (D1 read)", () => {
  let queryAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    queryAll = vi.fn();
    vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data/d1.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runLoader(env: Record<string, unknown>) {
    const { loadIndexableBrandPageEntries } = await import("~/lib/sitemap.server");
    return loadIndexableBrandPageEntries(env as never);
  }

  it("returns the static-only set when D1 is absent", async () => {
    await expect(runLoader({})).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("returns the static-only set in demo-provider environments", async () => {
    // No BROWSER binding → provider resolves to demo → no real pages exist.
    await expect(runLoader({ DB: {} })).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("returns the static-only set under the PUBLIC_BRAND_PAGES_INDEXABLE emergency brake", async () => {
    await expect(
      runLoader({ DB: {}, BROWSER: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "0" }),
    ).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("queries only the resolved provider's indexable public_search rows and maps them to /ads entries", async () => {
    queryAll.mockResolvedValue([
      cacheRow(),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
      }),
      cacheRow({ route_context: "watchlist_scan" }),
    ]);

    // Production posture (wrangler.jsonc): SEARCH_ROLLOUT_MODE="v2".
    const entries = await runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" });

    expect(queryAll).toHaveBeenCalledTimes(1);
    const [, sql, providerParam, cutoffIso, limit] = queryAll.mock.calls[0] as [
      unknown,
      string,
      string,
      string,
      number,
    ];
    expect(sql).toContain("route_context = 'public_search'");
    expect(sql).toContain("provider = ?");
    expect(providerParam).toBe("meta_library_browser");
    expect(sql).toContain("fetched_at >= ?");
    expect(new Date(cutoffIso).getTime()).toBeCloseTo(
      Date.now() - BRAND_PAGE_FRESH_FOR_INDEXING_MS,
      -3,
    );
    expect(limit).toBe(SITEMAP_BRAND_PATH_LIMIT);
    expect(entries.map((e: { path: string }) => e.path)).toEqual(["/ads/nykaa.com", "/ads/meesho.com"]);
    // Entries carry lastmod from fetched_at.
    for (const entry of entries) {
      expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changefreq).toBe("weekly");
      expect(entry.priority).toBe("0.6");
    }
  });

  it("mirrors the SEARCH_ROLLOUT_MODE posture when matching row keys", async () => {
    // v2 posture: the page derives search-v2 domain keys, so the v2-keyed row
    // is reachable and listable.
    queryAll.mockResolvedValue([cacheRow()]);
    await expect(
      runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" }),
    ).resolves.toEqual([
      expect.objectContaining({ path: "/ads/nykaa.com" }),
    ]);

    // Legacy/shadow posture: the same v2-keyed row would render the noindex
    // shell (the page derives legacy fingerprint keys), so it must not be
    // listed.
    queryAll.mockResolvedValue([cacheRow()]);
    await expect(
      runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "legacy" }),
    ).resolves.toEqual([]);
  });

  it("degrades to the static-only set when the discovery cache table is missing", async () => {
    queryAll.mockRejectedValue(new Error("D1_ERROR: no such table: discovery_cache_entry"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).resolves.toEqual([]);
  });

  it("propagates genuine D1 failures instead of silently hiding them", async () => {
    queryAll.mockRejectedValue(new Error("connection lost"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).rejects.toThrow("connection lost");
  });
});

interface PlainRoute {
  path?: string;
  index?: boolean;
  children?: PlainRoute[];
}

function patternToRegex(pattern: string): RegExp | null {
  if (pattern.includes("*")) return null;
  const escaped = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function collectRoutePatterns(routes: PlainRoute[], parent = ""): RegExp[] {
  const patterns: RegExp[] = [];
  for (const r of routes) {
    if (r.index) {
      const re = patternToRegex(parent);
      if (re) patterns.push(re);
      continue;
    }
    if (r.path) {
      const full = parent ? `${parent}/${r.path}` : r.path;
      if (r.children) {
        if (r.children.some((child) => child.index)) {
          const re = patternToRegex(full);
          if (re) patterns.push(re);
        }
        patterns.push(...collectRoutePatterns(r.children, full));
      } else {
        const re = patternToRegex(full);
        if (re) patterns.push(re);
      }
    }
  }
  return patterns;
}

describe("SITEMAP_PATHS", () => {
  it("only includes paths that resolve to a registered non-splat route", () => {
    const patterns = collectRoutePatterns(routes as unknown as PlainRoute[]);

    for (const sitemapPath of SITEMAP_PATHS) {
      const pathname = sitemapPath === "/" ? "" : sitemapPath.replace(/^\/+/, "");
      const matched = patterns.some((pattern) => pattern.test(pathname));
      expect(matched, `${sitemapPath} has no registered, non-splat route`).toBe(true);
    }
  });
});
