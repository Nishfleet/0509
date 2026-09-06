/**
 * Dynamic brand-page sitemap tests: inclusion + every major exclusion,
 * exact-key parity in legacy/shadow/v2 modes, static fallback on D1
 * failure/no binding, deterministic dedupe/order, no provider calls, and the
 * Worker GET/HEAD response path.
 *
 * Fixture cache keys are composed from the WRITER-side public functions
 * (parseSearchParams → applyWebsiteSearchFallback → normalizeSavedQuery →
 * fingerprintSavedQuery → buildDiscoveryCacheKey, and buildSearchV2SavedQuery
 * → buildSearchV2CacheKey) — the same composition the /search execution path
 * uses. The module under test proves parity through the LOADER-side
 * `deriveBrandPageCacheLookupKey`, so a drift between the two compositions
 * fails these tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyWebsiteSearchFallback, normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { buildSearchV2CacheKey, buildSearchV2SavedQuery } from "~/lib/search-v2.server";
import { renderSitemapXml, staticSitemapUrls } from "~/lib/seo";

const PROVIDER = "meta_library_browser";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// Writer-side fixture keys (independent of the loader's deriveCacheLookup).
// ---------------------------------------------------------------------------

function legacyKey(provider: string, domain: string, country: string): string {
  const parsed = applyWebsiteSearchFallback(
    parseSearchParams(new URLSearchParams(), { country }),
    normalizeCompetitorWebsiteInput(domain),
  );
  const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);
  return buildDiscoveryCacheKey({
    provider,
    fingerprint: fingerprintSavedQuery(legacyQuery),
    country: legacyQuery.filters.country || "all",
    cursor: null,
  });
}

function v2Key(
  provider: string,
  domain: string,
  country: string,
  scope: "exact" | "broader" = "exact",
): string {
  const queryIntent = parseSearchInputFromWebsiteField(domain);
  const parsed = applyWebsiteSearchFallback(
    parseSearchParams(new URLSearchParams(), { country }),
    normalizeCompetitorWebsiteInput(domain),
  );
  const v2Query = buildSearchV2SavedQuery(queryIntent, scope, parsed.filters);
  return buildSearchV2CacheKey({
    provider,
    intent: queryIntent,
    scope,
    country: v2Query.filters.country || "all",
    cursor: null,
  });
}

function keywordRowKey(provider: string, term: string, country: string): string {
  const query = normalizeSavedQuery("keyword", { query: term, country });
  return buildDiscoveryCacheKey({
    provider,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || "all",
    cursor: null,
  });
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function ad(metaAdId: string, landingPageUrl: string | null, overrides: Record<string, unknown> = {}) {
  return {
    metaAdId,
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
    landingPageUrl,
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

interface RowOverrides {
  cache_key?: string;
  provider?: string;
  route_context?: string;
  country?: string;
  cursor?: string | null;
  payload_json?: string;
  fetched_at?: string;
  payload?: Record<string, unknown>;
}

function cacheRow(overrides: RowOverrides = {}): Record<string, unknown> {
  const payload = overrides.payload ?? {
    ads: [ad("meta-1", "https://nykaa.com/shop")],
    nextCursor: null,
    source: PROVIDER,
    provider: PROVIDER,
    cacheStatus: "hit",
  };
  return {
    cache_key: overrides.cache_key ?? "unused-key",
    provider: overrides.provider ?? PROVIDER,
    route_context: overrides.route_context ?? "public_search",
    query_fingerprint: "fnv1a-fixture",
    country: overrides.country ?? "all",
    cursor: overrides.cursor ?? null,
    payload_json: overrides.payload_json ?? JSON.stringify(payload),
    fetched_at: overrides.fetched_at ?? isoAgo(2 * HOUR_MS),
    expires_at: isoAgo(-30 * 60 * 1000),
  };
}

function createDb(rows: unknown[] | Error) {
  const all = vi.fn();
  if (rows instanceof Error) {
    all.mockRejectedValue(rows);
  } else {
    all.mockResolvedValue({ results: rows, success: true });
  }
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, all };
}

type SitemapModule = typeof import("~/lib/brand-page-sitemap.server");

async function loadSitemapModule() {
  return import("~/lib/brand-page-sitemap.server");
}

async function buildSitemap(module: SitemapModule, env: Record<string, unknown>) {
  return module.buildPublicSitemapFile(env as never);
}

function bodyLocCount(body: string): number {
  return (body.match(/<url><loc>/g) ?? []).length;
}

function installProviderMock(provider: string) {
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => provider),
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("dynamic sitemap inclusion", () => {
  it("appends indexable brand pages after all 13 static URLs in deterministic order", async () => {
    installProviderMock(PROVIDER);
    const db = createDb([
      cacheRow({
        cache_key: legacyKey(PROVIDER, "nykaa.com", "all"),
        payload: {
          ads: [ad("m1", "https://nykaa.com/shop")],
          nextCursor: null,
          source: PROVIDER,
          provider: PROVIDER,
        },
      }),
      cacheRow({
        cache_key: legacyKey(PROVIDER, "zeta.com", "United States"),
        country: "United States",
        payload: {
          ads: [ad("m2", "https://www.zeta.com/landing")],
          nextCursor: null,
          source: PROVIDER,
          provider: PROVIDER,
        },
      }),
      cacheRow({
        cache_key: legacyKey(PROVIDER, "alpha.com", "all"),
        payload: {
          ads: [ad("m3", "https://alpha.com")],
          nextCursor: null,
          source: PROVIDER,
          provider: PROVIDER,
        },
      }),
    ]);
    const module = await loadSitemapModule();

    const file = await buildSitemap(module, { DB: db });

    expect(file.contentType).toBe("application/xml; charset=utf-8");
    expect(file.cacheControl).toBe("public, max-age=3600");
    expect(file.body).toContain(`<url><loc>https://0509.io/ads/nykaa.com</loc></url>`);
    expect(file.body).toContain(`<url><loc>https://0509.io/ads/alpha.com</loc></url>`);
    expect(file.body).toContain(`<url><loc>https://0509.io/ads/zeta.com</loc></url>`);
    // All 13 static URLs retained.
    for (const url of staticSitemapUrls()) {
      expect(file.body).toContain(`<url><loc>${url}</loc></url>`);
    }
    expect(bodyLocCount(file.body)).toBe(13 + 3);
    // Deterministic order: static first (existing order), then sorted domains.
    expect(file.body.indexOf("https://0509.io/ads/alpha.com")).toBeLessThan(
      file.body.indexOf("https://0509.io/ads/nykaa.com"),
    );
    expect(file.body.indexOf("https://0509.io/ads/nykaa.com")).toBeLessThan(
      file.body.indexOf("https://0509.io/ads/zeta.com"),
    );
    expect(file.body.indexOf("https://0509.io/ads/zeta.com")).toBeGreaterThan(
      file.body.indexOf("https://0509.io/terms"),
    );
    expect(file.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(file.body.trimEnd().endsWith("</urlset>")).toBe(true);
    // Exactly one bounded D1 read with prepared-statement bindings.
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.bind).toHaveBeenCalledTimes(1);
    const bindCall = db.bind.mock.calls[0] as unknown as [string, string, number] | undefined;
    const [provider, cutoff, limit] = bindCall ?? [];
    expect(provider).toBe(PROVIDER);
    expect(typeof cutoff).toBe("string");
    expect(limit).toBe(module.BRAND_PAGE_SITEMAP_MAX_ROWS);
    expect(db.all).toHaveBeenCalledTimes(1);
  });

  it("includes the displayDomain even when no ad carries a landing URL", async () => {
    installProviderMock(PROVIDER);
    const db = createDb([
      cacheRow({
        cache_key: legacyKey(PROVIDER, "nykaa.com", "all"),
        payload: {
          ads: [ad("m1", null)],
          nextCursor: null,
          source: PROVIDER,
          provider: PROVIDER,
          displayDomain: "nykaa.com",
        },
      }),
    ]);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: db });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
  });

  it("deduplicates one domain across country rows and renders byte-identical output across calls", async () => {
    installProviderMock(PROVIDER);
    const rows = [
      cacheRow({
        cache_key: legacyKey(PROVIDER, "nykaa.com", "all"),
        payload: { ads: [ad("m1", "https://nykaa.com/shop")], nextCursor: null, source: PROVIDER, provider: PROVIDER },
      }),
      cacheRow({
        cache_key: legacyKey(PROVIDER, "nykaa.com", "United States"),
        country: "United States",
        payload: { ads: [ad("m2", "https://nykaa.com/us")], nextCursor: null, source: PROVIDER, provider: PROVIDER },
      }),
    ];
    const module = await loadSitemapModule();

    const first = await buildSitemap(module, { DB: createDb(rows) });
    const second = await buildSitemap(module, { DB: createDb(rows) });

    expect(bodyLocCount(first.body)).toBe(13 + 1);
    expect(first.body).toBe(second.body);
    expect(first.body.match(/https:\/\/0509\.io\/ads\/nykaa\.com/g)).toHaveLength(1);
  });
});

describe("exact-key parity across rollout modes", () => {
  it("legacy mode (flag unset) accepts only the legacy fingerprint key", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") }),
        cacheRow({ cache_key: v2Key(PROVIDER, "nykaa.com", "all") }),
      ]),
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });

  it("shadow mode serves the legacy key, never the search-v2 shadow-comparison key", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") }),
        cacheRow({ cache_key: v2Key(PROVIDER, "nykaa.com", "all") }),
      ]),
      SEARCH_ROLLOUT_MODE: "shadow",
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });

  it("v2 mode derives the search-v2 domain key, not the legacy fingerprint key", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") }),
        cacheRow({ cache_key: v2Key(PROVIDER, "nykaa.com", "all") }),
      ]),
      SEARCH_ROLLOUT_MODE: "v2",
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });

  it("v2 mode honors the United States crawler fallback key", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: v2Key(PROVIDER, "nykaa.com", "United States"),
          country: "United States",
        }),
      ]),
      SEARCH_ROLLOUT_MODE: "v2",
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });

  it("never infers indexability from an unrelated keyword row that merely contains a destination URL", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: keywordRowKey(PROVIDER, "beauty deals", "all"),
          payload: {
            ads: [ad("m1", "https://nykaa.com/shop")],
            nextCursor: null,
            source: PROVIDER,
            provider: PROVIDER,
          },
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes customer-token-scoped cache keys", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const base = legacyKey(PROVIDER, "nykaa.com", "all");
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: `${base}:customer_meta:deadbeef` }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes broader-scope search-v2 keys (the loader reads exact scope)", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: v2Key(PROVIDER, "nykaa.com", "all", "broader") }),
      ]),
      SEARCH_ROLLOUT_MODE: "v2",
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });
});

describe("dynamic sitemap exclusions", () => {
  it("serves only the static sitemap when the resolved provider is demo, without querying D1", async () => {
    installProviderMock("demo");
    const db = createDb([cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") })]);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: db });

    expect(file.body).toBe(renderSitemapXml(staticSitemapUrls()));
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('serves only the static sitemap when the emergency noindex flag is "0"', async () => {
    installProviderMock(PROVIDER);
    const db = createDb([]);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: db, PUBLIC_BRAND_PAGES_INDEXABLE: "0" });

    expect(file.body).toBe(renderSitemapXml(staticSitemapUrls()));
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("serves the static sitemap when the flag is unset or '1' but the cache is empty", async () => {
    installProviderMock(PROVIDER);
    for (const flag of [undefined, "1"]) {
      const module = await loadSitemapModule();
      const file = await buildSitemap(module, { DB: createDb([]), PUBLIC_BRAND_PAGES_INDEXABLE: flag });
      expect(file.body).toBe(renderSitemapXml(staticSitemapUrls()));
      expect(bodyLocCount(file.body)).toBe(13);
    }
  });

  it("serves the static sitemap when there is no DB binding", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: undefined });

    expect(file.body).toBe(renderSitemapXml(staticSitemapUrls()));
  });

  it("serves the static sitemap when the DB binding is not a real D1 (no prepare)", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: {} });

    expect(file.body).toBe(renderSitemapXml(staticSitemapUrls()));
  });

  it("serves the static sitemap when the D1 query fails (missing table or query error)", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const missingTable = await buildSitemap(module, {
      DB: createDb(new Error("no such table: discovery_cache_entry")),
    });
    const queryError = await buildSitemap(module, {
      DB: createDb(new Error("D1_ERROR")),
    });

    expect(missingTable.body).toBe(renderSitemapXml(staticSitemapUrls()));
    expect(queryError.body).toBe(renderSitemapXml(staticSitemapUrls()));
  });

  it("excludes scheduled/warmup route contexts", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all"), route_context: "watchlist_scan" }),
        cacheRow({ cache_key: legacyKey(PROVIDER, "alpha.com", "all"), route_context: "scheduled_warmup" }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(file.body).not.toContain("/ads/alpha.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes cursor pages beyond the first", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "all").replace(":page-1", ":page-2"),
          cursor: "page-2",
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes rows for a different provider", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey("meta_api", "nykaa.com", "all"), provider: "meta_api" }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes stale (> 7 days), future, and unparseable fetched_at rows", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "stale.com", "all"), fetched_at: isoAgo(9 * DAY_MS) }),
        cacheRow({ cache_key: legacyKey(PROVIDER, "future.com", "all"), fetched_at: isoAgo(-HOUR_MS) }),
        cacheRow({ cache_key: legacyKey(PROVIDER, "bad.com", "all"), fetched_at: "not-a-date" }),
      ]),
    });

    expect(file.body).not.toContain("/ads/stale.com");
    expect(file.body).not.toContain("/ads/future.com");
    expect(file.body).not.toContain("/ads/bad.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes malformed payload JSON and payloads without an ads array", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "junk.com", "all"), payload_json: "not json" }),
        cacheRow({
          cache_key: legacyKey(PROVIDER, "no-ads.com", "all"),
          payload_json: JSON.stringify({ nextCursor: null, source: PROVIDER }),
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/junk.com");
    expect(file.body).not.toContain("/ads/no-ads.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes demo-sourced payloads, demo payload providers, and all-demo ad sets", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: legacyKey(PROVIDER, "demo-source.com", "all"),
          payload: { ads: [ad("m1", "https://demo-source.com")], nextCursor: null, source: "demo", provider: "demo" },
        }),
        cacheRow({
          cache_key: legacyKey(PROVIDER, "demo-provider.com", "all"),
          payload: { ads: [ad("m2", "https://demo-provider.com")], nextCursor: null, source: PROVIDER, provider: "demo" },
        }),
        cacheRow({
          cache_key: legacyKey(PROVIDER, "demo-ads.com", "all"),
          payload: { ads: [ad("m3", "https://demo-ads.com", { source: "demo" })], nextCursor: null, source: PROVIDER, provider: PROVIDER },
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/demo-source.com");
    expect(file.body).not.toContain("/ads/demo-provider.com");
    expect(file.body).not.toContain("/ads/demo-ads.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes zero-ad payloads", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: legacyKey(PROVIDER, "empty.com", "all"),
          payload: { ads: [], nextCursor: null, source: PROVIDER, provider: PROVIDER },
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/empty.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("excludes candidates that do not normalize as public domains", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "all"),
          payload: {
            ads: [
              ad("m1", "https://nykaa.com/shop"),
              ad("m2", "https://notadomain/"),
              ad("m3", "https://192.168.1.10/"),
            ],
            nextCursor: null,
            source: PROVIDER,
            provider: PROVIDER,
          },
        }),
      ]),
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(file.body).not.toContain("/ads/notadomain");
    expect(file.body).not.toContain("/ads/192.168.1.10");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });

  it("excludes country/key mismatches (a country the crawler fallback never derives)", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "India"),
          country: "India",
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("refuses a domain whose usable-but-stale 'all' row would shadow a fresh 'United States' row", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        // Fresh US row: passes every per-row check on its own.
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "United States"),
          country: "United States",
        }),
        // Usable (≤ 30 days) but stale (> 7 days) "all" row: the loader tries
        // "all" first and would render THIS row with noindex.
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "all"),
          fetched_at: isoAgo(9 * DAY_MS),
        }),
      ]),
    });

    expect(file.body).not.toContain("/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13);
  });

  it("keeps a domain when the shadowing 'all' row is itself fresh and indexable", async () => {
    installProviderMock(PROVIDER);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, {
      DB: createDb([
        cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") }),
        cacheRow({
          cache_key: legacyKey(PROVIDER, "nykaa.com", "United States"),
          country: "United States",
        }),
      ]),
    });

    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
    expect(bodyLocCount(file.body)).toBe(13 + 1);
  });
});

describe("dynamic sitemap zero-cost constraint", () => {
  it("performs a single bounded D1 read and never touches a provider", async () => {
    const resolveProvider = vi.fn(() => PROVIDER);
    vi.doMock("~/lib/ad-source.server", () => ({ resolveCommercialDiscoveryProvider: resolveProvider }));
    const db = createDb([cacheRow({ cache_key: legacyKey(PROVIDER, "nykaa.com", "all") })]);
    const module = await loadSitemapModule();
    const file = await buildSitemap(module, { DB: db });

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    const prepareCall = db.prepare.mock.calls[0] as unknown as [string] | undefined;
    const sql = prepareCall?.[0] ?? "";
    expect(sql).toContain("FROM discovery_cache_entry");
    expect(sql).toContain("LIMIT ?");
    expect(sql).toContain("WHERE provider = ?");
    expect(sql).not.toContain("INSERT");
    expect(sql).not.toContain("UPDATE");
    expect(sql).not.toContain("DELETE");
    expect(file.body).toContain("https://0509.io/ads/nykaa.com");
  });
});

// The Worker module pulls in react-router and the full scheduled-handler graph;
// first load can exceed vitest's default 5s test timeout under CI load.
describe(
  "Worker /sitemap.xml response path",
  () => {
    const builderFile = {
      body: renderSitemapXml([
        ...staticSitemapUrls(),
        "https://0509.io/ads/nykaa.com",
      ]),
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  const staticOnlyFile = {
    body: renderSitemapXml(staticSitemapUrls()),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };

  async function loadWorker(buildPublicSitemapFile: ReturnType<typeof vi.fn>) {
    vi.doMock("../app/lib/monitoring.server", () => ({
      flushDeferredInstantAlerts: vi.fn().mockResolvedValue({ groups: 0 }),
      runScheduledDiscoveryWarmup: vi.fn().mockResolvedValue({}),
      runScheduledMonitoring: vi.fn().mockResolvedValue({}),
      sendCustomerAtRiskAlert: vi.fn().mockResolvedValue({ sent: false }),
      sendWeeklyBusinessNumbers: vi.fn().mockResolvedValue({ sent: false }),
    }));
    vi.doMock("../app/lib/cron-failure-alert.server", () => ({ reportScheduledTaskFailure: vi.fn() }));
    vi.doMock("../app/lib/monthly-recap.server", () => ({ sendMonthlyCustomerRecaps: vi.fn() }));
    vi.doMock("../app/lib/scheduled-observation-health.server", () => ({
      SCHEDULED_OBSERVATION_GAP_CHECK_CRON: "13 * * * *",
      sendScheduledObservationGapAlert: vi.fn().mockResolvedValue({ sent: false, reason: "healthy", health: [] }),
    }));
    vi.doMock("../app/lib/release-scheduled-observation.server", () => ({
      observeScheduledTask: vi.fn((_env, _ctx, _input, taskPromise) => taskPromise),
    }));
    vi.doMock("../app/lib/monitoring-fanout.server", () => ({
      reconcileOrchestratedWatchlistRuns: vi.fn().mockResolvedValue({ redispatched: 0, recovered: 0, cancelled: 0, redispatchFailures: 0 }),
      resolveMonitoringFanoutMode: vi.fn().mockReturnValue("fanout"),
      resolveMonitoringOrchestrationLeaseMs: vi.fn().mockReturnValue(60_000),
    }));
    vi.doMock("../app/lib/presence-service.server", () => ({
      runPresencePollingBatch: vi.fn().mockResolvedValue({ results: [] }),
    }));
    vi.doMock("../app/lib/retention.server", () => ({
      runRetentionSweep: vi.fn().mockResolvedValue({ deleted: {} }),
    }));
    vi.doMock("../workers/delivery-recovery", () => ({ scheduleBillingLifecycleEmailRecovery: vi.fn() }));
    vi.doMock("../workers/digest-schedule-recovery", () => ({ scheduleDigestScheduleExhaustionRecovery: vi.fn() }));
    vi.doMock("../workers/schedule", () => ({
      resolveScheduledTask: vi.fn(() => ({ kind: "monitoring", includeScans: true, includeDigests: true, digestCadence: "weekly", digestLookbackDays: 7, includeRiskAlert: false })),
      resolveOperationalRiskAlertIdempotencyKey: vi.fn(() => null),
      WEEKLY_DIGEST_CRON: "0 9 * * 1",
    }));
    vi.doMock("../workers/primary-domain", () => ({ primaryDomainRedirect: vi.fn().mockReturnValue(null) }));
    vi.doMock("../workers/security-headers", () => ({ withSecurityHeaders: vi.fn((response) => response) }));
    vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class MonitoringWorkflow {} }));
    vi.doMock("../app/lib/rate-limit.server", () => ({ enforceRequestRateLimit: vi.fn().mockResolvedValue(null) }));
    vi.doMock("../app/lib/brand-page-sitemap.server", () => ({ buildPublicSitemapFile }));

    const worker = (await import("../workers/app")).default;
    return worker;
  }

  async function fetchSitemap(
    worker: { fetch: (...args: never[]) => Promise<Response> },
    method: "GET" | "HEAD",
  ) {
    return worker.fetch(
      new Request("https://0509.io/sitemap.xml", { method }) as never,
      { DB: {} } as never,
      {} as never,
    );
  }

  it("serves the dynamic sitemap for GET with the XML content type", async () => {
    const buildPublicSitemapFile = vi.fn().mockResolvedValue(builderFile);
    const worker = await loadWorker(buildPublicSitemapFile);

    const response = await fetchSitemap(worker, "GET");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe(builderFile.body);
    expect(buildPublicSitemapFile).toHaveBeenCalledTimes(1);
  });

  it("serves the sitemap headers with an empty body for HEAD", async () => {
    const buildPublicSitemapFile = vi.fn().mockResolvedValue(builderFile);
    const worker = await loadWorker(buildPublicSitemapFile);

    const response = await fetchSitemap(worker, "HEAD");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await response.text()).toBe("");
    expect(buildPublicSitemapFile).toHaveBeenCalledTimes(1);
  });

  it("returns the unchanged static sitemap with HTTP 200 when the builder falls back", async () => {
    const buildPublicSitemapFile = vi.fn().mockResolvedValue(staticOnlyFile);
    const worker = await loadWorker(buildPublicSitemapFile);

    const response = await fetchSitemap(worker, "GET");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(renderSitemapXml(staticSitemapUrls()));
    expect(body).not.toContain("/ads/");
    expect(bodyLocCount(body)).toBe(13);
  });

  it("does not invoke the sitemap builder for other static files (robots.txt)", async () => {
    const buildPublicSitemapFile = vi.fn().mockResolvedValue(builderFile);
    const worker = await loadWorker(buildPublicSitemapFile);

    const response = await worker.fetch(
      new Request("https://0509.io/robots.txt") as never,
      { DB: {} } as never,
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Disallow: /app/");
    expect(buildPublicSitemapFile).not.toHaveBeenCalled();
  });
  },
  30_000,
);
