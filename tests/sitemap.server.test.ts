import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  brandPageDomainFromCacheRow,
  buildPublicSitemapFile,
  buildPublicSitemapXml,
  loadIndexableBrandPageDomains,
} from "~/lib/sitemap.server";

/** The discovery_cache_entry columns the sitemap query reads (migration 0008). */
const TABLE_DDL = `
CREATE TABLE discovery_cache_entry (
  cache_key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  route_context TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  country TEXT NOT NULL,
  cursor TEXT,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  browser_ms_used INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const NOW = new Date("2026-08-10T00:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const STALE = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

function createDb(rows: Array<{
  cacheKey: string;
  provider?: string;
  routeContext?: string;
  country?: string;
  cursor?: string | null;
  payload: unknown;
  fetchedAt?: string;
}>): { db: AppEnv["DB"]; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(TABLE_DDL);
  type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;
  const toSqliteBindings = (bindings: unknown[]) => bindings as SqliteBindings;
  const insert = sqlite.prepare(`
    INSERT INTO discovery_cache_entry (
      cache_key, provider, route_context, query_fingerprint, country, cursor,
      payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.cacheKey,
      row.provider ?? "meta_library_browser",
      row.routeContext ?? "public_search",
      "fixture-fingerprint",
      row.country ?? "all",
      row.cursor ?? "page-1",
      JSON.stringify(row.payload),
      row.fetchedAt ?? FRESH,
      FRESH,
      null,
      FRESH,
      FRESH,
    );
  }

  return {
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async run() {
                return sqlite.prepare(sql).run(...toSqliteBindings(bindings));
              },
              async all<T>() {
                return {
                  results: sqlite.prepare(sql).all(...toSqliteBindings(bindings)) as T[],
                };
              },
            };
          },
        };
      },
    } as unknown as AppEnv["DB"],
    close: () => {
      try {
        sqlite.close();
      } catch {
        // Already closed.
      }
    },
  };
}

function browserEnv(db: AppEnv["DB"]): AppEnv {
  return { DB: db, BROWSER: {} } as unknown as AppEnv;
}

function adsPayload(source = "meta_library_browser", count = 1) {
  return {
    source,
    provider: source,
    ads: Array.from({ length: count }, (_, index) => ({
      metaAdId: `ad-${index}`,
      source,
    })),
    nextCursor: null,
  };
}

function v2DomainKey(domain: string, scope = "exact", provider = "meta_library_browser") {
  return `search-v2:domain:${domain}:${scope}:${provider}:all:page-1`;
}

describe("brandPageDomainFromCacheRow", () => {
  it("derives the domain from the search-v2 domain cache key", () => {
    expect(
      brandPageDomainFromCacheRow({ cacheKey: v2DomainKey("nykaa.com"), payload: null }),
    ).toBe("nykaa.com");
  });

  it("rejects broader-scope keys (the brand-page loader only reads exact)", () => {
    expect(
      brandPageDomainFromCacheRow({ cacheKey: v2DomainKey("nykaa.com", "broader"), payload: null }),
    ).toBeNull();
  });

  it("falls back to the payload displayDomain when the key is not a v2 domain key", () => {
    expect(
      brandPageDomainFromCacheRow({
        cacheKey: "meta_library_browser:fnv1a-deadbeef:all:page-1",
        payload: { displayDomain: "boat-lifestyle.com" },
      }),
    ).toBe("boat-lifestyle.com");
  });

  it("normalizes and validates the derived domain", () => {
    expect(
      brandPageDomainFromCacheRow({ cacheKey: v2DomainKey("WWW.NyKaa.com"), payload: null }),
    ).toBe("nykaa.com");
    // A single-label host would 404 on /ads/:domain — never listed.
    expect(
      brandPageDomainFromCacheRow({ cacheKey: v2DomainKey("localhost"), payload: null }),
    ).toBeNull();
    expect(brandPageDomainFromCacheRow({ cacheKey: "no-domain-here", payload: null })).toBeNull();
  });
});

describe("loadIndexableBrandPageDomains", () => {
  it("includes only rows that would render the indexable brand-page state", async () => {
    const { db, close } = createDb([
      // Included: fresh public_search browser row with real ads.
      { cacheKey: v2DomainKey("nykaa.com"), payload: adsPayload() },
      // Same domain, second country — deduped to one URL.
      { cacheKey: v2DomainKey("nykaa.com", "exact", "meta_library_browser").replace(":all:", ":india:"), country: "India", payload: adsPayload() },
      // Included via payload displayDomain fallback.
      { cacheKey: "meta_library_browser:fnv1a-1234:all:page-1", payload: { ...adsPayload(), displayDomain: "boat-lifestyle.com" } },
      // Excluded: stale (8 days) — noindex on the page, must not be listed.
      { cacheKey: v2DomainKey("stalebrand.com"), fetchedAt: STALE, payload: adsPayload() },
      // Excluded: demo provider.
      { cacheKey: v2DomainKey("demobrand.com"), provider: "demo", payload: adsPayload("demo") },
      // Excluded: scheduled scan route context.
      { cacheKey: v2DomainKey("scanbrand.com"), routeContext: "watchlist_scan", payload: adsPayload() },
      // Excluded: zero ads.
      { cacheKey: v2DomainKey("emptybrand.com"), payload: { source: "meta_library_browser", provider: "meta_library_browser", ads: [], nextCursor: null } },
      // Excluded: demo-only ads (payload looks like a real brand's ads).
      { cacheKey: v2DomainKey("demoadsbrand.com"), payload: adsPayload("demo") },
      // Excluded: different provider than the environment resolves to.
      { cacheKey: v2DomainKey("apibrand.com"), provider: "meta_api", payload: adsPayload("meta_api") },
      // Excluded: keyword-mode legacy row — no domain derivable from key or payload.
      { cacheKey: "meta_library_browser:fnv1a-5678:all:page-1", payload: adsPayload() },
    ]);
    try {
      const domains = await loadIndexableBrandPageDomains(browserEnv(db), { now: NOW });
      expect(domains).toEqual(["boat-lifestyle.com", "nykaa.com"]);
    } finally {
      close();
    }
  });

  it("returns [] without a D1 binding", async () => {
    expect(await loadIndexableBrandPageDomains({} as unknown as AppEnv, { now: NOW })).toEqual([]);
  });

  it("returns [] when no commercial provider is configured (brand pages render the shell)", async () => {
    const { db, close } = createDb([{ cacheKey: v2DomainKey("nykaa.com"), payload: adsPayload() }]);
    try {
      // No BROWSER binding → resolveCommercialDiscoveryProvider() = demo.
      expect(await loadIndexableBrandPageDomains({ DB: db } as unknown as AppEnv, { now: NOW })).toEqual([]);
    } finally {
      close();
    }
  });

  it("returns [] when the emergency noindex brake is on", async () => {
    const { db, close } = createDb([{ cacheKey: v2DomainKey("nykaa.com"), payload: adsPayload() }]);
    try {
      const env = browserEnv(db);
      env.PUBLIC_BRAND_PAGES_INDEXABLE = "0";
      expect(await loadIndexableBrandPageDomains(env, { now: NOW })).toEqual([]);
    } finally {
      close();
    }
  });

  it("returns [] when the discovery_cache_entry table is missing", async () => {
    const missingTableDb = {
      prepare(_sql: string) {
        return {
          bind() {
            return {
              async all<T>() {
                throw new Error("D1_ERROR: no such table: discovery_cache_entry: SQLITE_ERROR");
              },
            };
          },
        };
      },
    } as unknown as AppEnv["DB"];
    expect(await loadIndexableBrandPageDomains(browserEnv(missingTableDb), { now: NOW })).toEqual([]);
  });
});

describe("buildPublicSitemapXml", () => {
  it("keeps the static 13 URLs and appends indexable /ads/:domain entries", async () => {
    const { db, close } = createDb([
      { cacheKey: v2DomainKey("nykaa.com"), payload: adsPayload() },
      { cacheKey: v2DomainKey("stalebrand.com"), fetchedAt: STALE, payload: adsPayload() },
      { cacheKey: v2DomainKey("demobrand.com"), provider: "demo", payload: adsPayload("demo") },
    ]);
    try {
      const xml = await buildPublicSitemapXml(browserEnv(db), { now: NOW });

      expect(xml).toContain("<url><loc>https://0509.io/</loc></url>");
      expect(xml).toContain("<url><loc>https://0509.io/search</loc></url>");
      expect(xml).toContain("<url><loc>https://0509.io/auth/signup</loc></url>");
      expect(xml).toContain("<url><loc>https://0509.io/compare/meta-ad-library</loc></url>");
      expect(xml).toContain("<url><loc>https://0509.io/terms</loc></url>");
      // The 13 static URLs remain, plus the one indexable brand page.
      expect(xml).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
      expect(xml).not.toContain("stalebrand.com");
      expect(xml).not.toContain("demobrand.com");
      const urlCount = xml.match(/<url>/g)?.length ?? 0;
      expect(urlCount).toBe(14);
    } finally {
      close();
    }
  });

  it("serves only the static URLs when D1 is absent", async () => {
    const xml = await buildPublicSitemapXml({} as unknown as AppEnv, { now: NOW });
    expect(xml).toContain("<url><loc>https://0509.io/</loc></url>");
    expect(xml).not.toContain("/ads/");
  });

  it("returns the worker-ready file shape", async () => {
    const file = await buildPublicSitemapFile({} as unknown as AppEnv, { now: NOW });
    expect(file.contentType).toBe("application/xml; charset=utf-8");
    expect(file.cacheControl).toBe("public, max-age=3600");
    expect(file.body).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
  });
});
