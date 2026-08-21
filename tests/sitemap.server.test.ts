import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
} from "~/lib/brand-page.server";
import {
  brandDomainFromSitemapCacheRow,
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

  it("queries only indexable public_search rows and maps them to /ads entries", async () => {
    queryAll.mockResolvedValue([
      cacheRow(),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
      }),
      cacheRow({ route_context: "watchlist_scan" }),
    ]);

    const entries = await runLoader({ DB: {}, BROWSER: {} });

    expect(queryAll).toHaveBeenCalledTimes(1);
    const [, sql, cutoffIso, limit] = queryAll.mock.calls[0] as [unknown, string, string, number];
    expect(sql).toContain("route_context = 'public_search'");
    expect(sql).toContain("provider != 'demo'");
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

  it("degrades to the static-only set when the discovery cache table is missing", async () => {
    queryAll.mockRejectedValue(new Error("D1_ERROR: no such table: discovery_cache_entry"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).resolves.toEqual([]);
  });

  it("propagates genuine D1 failures instead of silently hiding them", async () => {
    queryAll.mockRejectedValue(new Error("connection lost"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).rejects.toThrow("connection lost");
  });
});
