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
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import {
  brandDomainFromSitemapCacheRow,
  brandPageLookupCacheKeysForSitemap,
  buildSitemapXml,
  indexableBrandPagePathsFromRows,
  isIndexableBrandPageRow,
  SITEMAP_BRAND_PATH_LIMIT,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const basePayload = {
  ads: [{ metaAdId: "meta-nykaa-1", source: "meta_library_browser" }],
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

describe("indexableBrandPagePathsFromRows", () => {
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

    expect(indexableBrandPagePathsFromRows(rows)).toEqual([
      "/ads/nykaa.com",
      "/ads/meesho.com",
    ]);
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

    expect(indexableBrandPagePathsFromRows(rows)).toEqual(["/ads/nykaa.com"]);
  });

  it("bounds the sitemap to SITEMAP_BRAND_PATH_LIMIT entries", () => {
    const rows = Array.from({ length: SITEMAP_BRAND_PATH_LIMIT + 25 }, (_, index) =>
      cacheRow({
        cache_key: `search-v2:domain:brand-${index}.com:exact:meta_library_browser:all:page-1`,
      }),
    );

    expect(indexableBrandPagePathsFromRows(rows)).toHaveLength(SITEMAP_BRAND_PATH_LIMIT);
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

    expect(indexableBrandPagePathsFromRows([row], now)).toEqual([]);
  });

  it("lists the same domain once captured under an always-tried country scope", () => {
    const row = cacheRow({
      cache_key:
        "search-v2:domain:myntra.com:exact:meta_library_browser:united-states:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    expect(indexableBrandPagePathsFromRows([row], now)).toEqual(["/ads/myntra.com"]);
  });

  it("excludes rows written by a provider other than the resolved commercial provider", () => {
    const row = cacheRow({ provider: "meta_api" });

    expect(
      indexableBrandPagePathsFromRows([row], now, { provider: "meta_library_browser" }),
    ).toEqual([]);
  });

  it("under a legacy rollout posture, only rows keyed exactly like the page's legacy lookups qualify", () => {
    const provider = "meta_library_browser";
    const legacyKey = deriveBrandPageLookupForCountry(provider, "nykaa.com", "all", false).cacheKey;

    // A v2-keyed row is unreachable when the page derives legacy fingerprint
    // keys (shadow/legacy mode) — listing it would promise an indexable page
    // that serves noindex.
    expect(
      indexableBrandPagePathsFromRows([cacheRow()], now, { useDomainV2: false }),
    ).toEqual([]);

    // A v2-payload row stored under the exact legacy-derived key IS reachable.
    expect(
      indexableBrandPagePathsFromRows(
        [cacheRow({ cache_key: legacyKey })],
        now,
        { useDomainV2: false },
      ),
    ).toEqual(["/ads/nykaa.com"]);
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
    const xml = buildSitemapXml(["/ads/nykaa.com", "/ads/meesho.com"]);

    expect(xml).toContain("<url><loc>https://0509.io/</loc></url>");
    expect(xml).toContain("<url><loc>https://0509.io/search</loc></url>");
    expect(xml).toContain(
      "<url><loc>https://0509.io/ads/nykaa.com</loc></url>",
    );
    expect(xml).toContain(
      "<url><loc>https://0509.io/ads/meesho.com</loc></url>",
    );
    // Static list never carries a hardcoded /ads/ path.
    expect(xml.indexOf("<url><loc>https://0509.io/ads/")).toBe(
      xml.indexOf("<url><loc>https://0509.io/ads/nykaa.com</loc></url>"),
    );
  });

  it("renders a valid static-only sitemap when there are no brand pages", () => {
    const xml = buildSitemapXml([]);

    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(xml).not.toContain("/ads/");
  });
});

describe("loadIndexableBrandPagePaths (D1 read)", () => {
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
    const { loadIndexableBrandPagePaths } = await import("~/lib/sitemap.server");
    return loadIndexableBrandPagePaths(env as never);
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

  it("queries only the resolved provider's indexable public_search rows and maps them to /ads paths", async () => {
    queryAll.mockResolvedValue([
      cacheRow(),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
      }),
      cacheRow({ route_context: "watchlist_scan" }),
    ]);

    // Production posture (wrangler.jsonc): SEARCH_ROLLOUT_MODE="v2".
    const paths = await runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" });

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
    expect(paths).toEqual(["/ads/nykaa.com", "/ads/meesho.com"]);
  });

  it("mirrors the SEARCH_ROLLOUT_MODE posture when matching row keys", async () => {
    // v2 posture: the page derives search-v2 domain keys, so the v2-keyed row
    // is reachable and listable.
    queryAll.mockResolvedValue([cacheRow()]);
    await expect(
      runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" }),
    ).resolves.toEqual(["/ads/nykaa.com"]);

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
