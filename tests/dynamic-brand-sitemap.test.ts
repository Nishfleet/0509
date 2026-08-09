/**
 * Dynamic /sitemap.xml brand-page entries — /ads/:domain inclusion contract.
 *
 * The sitemap may only list a domain when the cache-only brand-page loader
 * would serve that page as INDEXABLE under the current environment (rollout
 * mode + provider): the exact loader cache key must exist with a fresh
 * (<= 7 days), non-demo, first-page, public_search row. These tests pin every
 * inclusion rule, every major exclusion, exact-key parity in legacy/shadow/v2
 * modes, the static fallback on D1 failure, deterministic dedupe/order, the
 * zero-provider-call constraint, and the Worker GET/HEAD response path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function isoAhead(ms: number) {
  return new Date(NOW.getTime() + ms).toISOString();
}

/**
 * Timestamp relative to the REAL clock — for tests that exercise code which
 * derives `now` internally (publicSitemapFile), so fixtures are never stale
 * or in the future relative to the runtime clock.
 */
function realIsoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

interface AdFixture {
  metaAdId?: string;
  source?: string;
  landingPageUrl?: string | null;
}

function makeAd(overrides: AdFixture = {}) {
  return {
    metaAdId: overrides.metaAdId ?? "meta-1",
    source: overrides.source ?? "meta_library_browser",
    landingPageUrl: overrides.landingPageUrl ?? null,
  };
}

function makePayload(overrides: { ads?: unknown[]; source?: string; provider?: string } = {}) {
  return JSON.stringify({
    ads: overrides.ads ?? [makeAd({ landingPageUrl: "https://www.nykaa.com/glow-sale" })],
    nextCursor: null,
    source: overrides.source ?? "meta_library_browser",
    provider: overrides.provider ?? "meta_library_browser",
    cacheStatus: "hit",
  });
}

interface RowFixture {
  cacheKey?: string;
  provider?: string;
  routeContext?: string;
  queryFingerprint?: string;
  country?: string;
  cursor?: string | null;
  payloadJson?: string;
  fetchedAt?: string;
}

function makeRow(overrides: RowFixture = {}) {
  return {
    cache_key: overrides.cacheKey ?? "meta_library_browser:fnv1a-0000:all:page-1",
    provider: overrides.provider ?? "meta_library_browser",
    route_context: overrides.routeContext ?? "public_search",
    query_fingerprint: overrides.queryFingerprint ?? "fnv1a-0000",
    country: overrides.country ?? "all",
    cursor: overrides.cursor ?? null,
    payload_json: overrides.payloadJson ?? makePayload(),
    fetched_at: overrides.fetchedAt ?? isoAgo(2 * 60 * 60 * 1000),
    expires_at: isoAgo(2 * 60 * 60 * 1000),
    browser_ms_used: 1200,
    created_at: isoAgo(2 * 60 * 60 * 1000),
    updated_at: isoAgo(2 * 60 * 60 * 1000),
  };
}

interface DbCall {
  sql: string;
  bindings: unknown[];
}

/**
 * In-memory stand-in for the D1 binding. Implements the same predicates the
 * helper's two statements use (provider + fetched_at window + country +
 * route + cursor for the scan; exact cache_key match for the verification),
 * so the real `queryAll` / `queryIn` helpers run against it untouched.
 */
function createFakeDb(rows: ReturnType<typeof makeRow>[]) {
  const calls: DbCall[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings });
          return {
            async all<T>() {
              if (/cache_key IN/i.test(sql)) {
                return {
                  results: rows.filter((row) => bindings.includes(row.cache_key)) as T[],
                };
              }
              const [provider, fromIso, toIso, limit] = bindings as [
                string,
                string,
                string,
                number,
              ];
              return {
                results: rows
                  .filter(
                    (row) =>
                      row.provider === provider &&
                      row.route_context === "public_search" &&
                      (row.country === "all" || row.country === "United States") &&
                      (row.cursor === null || row.cursor === "page-1") &&
                      row.fetched_at >= fromIso &&
                      row.fetched_at <= toIso,
                  )
                  .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))
                  .slice(0, limit) as T[],
              };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function makeEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // BROWSERLESS_TOKEN makes the real provider resolver return
    // meta_library_browser (never demo), matching production.
    BROWSERLESS_TOKEN: "test-token",
    SEARCH_ROLLOUT_MODE: "shadow",
    ...overrides,
  };
}

async function loaderKey(
  env: Record<string, unknown>,
  provider: string,
  domain: string,
  country: string,
) {
  const { brandPageCacheLookupKey } = await import("~/lib/brand-page.server");
  return brandPageCacheLookupKey(env as never, provider, domain, country);
}

async function loadDomains(env: Record<string, unknown>, db: unknown) {
  const { loadIndexableBrandPageDomains } = await import(
    "~/lib/brand-page-sitemap.server"
  );
  return loadIndexableBrandPageDomains({ ...env, DB: db } as never, NOW);
}

const searchAdsMock = vi.hoisted(() => vi.fn());
const searchMetaLibraryByBrowserMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.resetModules();
  searchAdsMock.mockReset();
  searchMetaLibraryByBrowserMock.mockReset();
});

afterEach(() => {
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/data.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

function installProviderMocks() {
  // The real ad-source.server chain imports these; mock them so provider
  // resolution is controlled by env alone and no live path can be reached.
  vi.doMock("~/lib/meta-api.server", () => ({
    searchAds: searchAdsMock,
    demoSearch: vi.fn(),
    filterAdsBySearchFilters: (ads: unknown[]) => ads,
    MetaApiError: class MetaApiError extends Error {},
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser: searchMetaLibraryByBrowserMock,
    getInteractiveMetaApiExtraPages: vi.fn().mockReturnValue(2),
    CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
  }));
}

describe("loadIndexableBrandPageDomains — inclusion, dedupe, order", () => {
  it("includes domains whose exact loader key has a fresh indexable row, deduped and sorted (shadow mode)", async () => {
    installProviderMocks();
    const env = makeEnv();
    const provider = "meta_library_browser";
    const nykaaKey = await loaderKey(env, provider, "nykaa.com", "all");
    const mamaearthKey = await loaderKey(env, provider, "mamaearth.com", "United States");
    const keywordKey = "meta_library_browser:fnv1a-keyword:all:page-1";

    const { db, calls } = createFakeDb([
      makeRow({
        cacheKey: nykaaKey,
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://www.nykaa.com/glow-sale" })],
        }),
      }),
      makeRow({
        cacheKey: mamaearthKey,
        country: "United States",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://mamaearth.com/shop" })],
        }),
      }),
      // Unrelated keyword row: its ad destination points at nykaa.com but its
      // key is NOT the loader key for nykaa.com — candidate only, never proof.
      makeRow({
        cacheKey: keywordKey,
        queryFingerprint: "fnv1a-keyword",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/deals" })],
        }),
      }),
    ]);

    const domains = await loadDomains(env, db);

    expect(domains).toEqual(["mamaearth.com", "nykaa.com"]);

    // Bounded indexed scan: provider equality + fetched_at window + LIMIT on
    // the (provider, fetched_at DESC) index.
    const scanCall = calls.find((call) => call.sql.includes("LIMIT"));
    expect(scanCall).toBeDefined();
    expect(scanCall!.sql).toContain("WHERE provider = ?");
    expect(scanCall!.sql).toContain("AND route_context = 'public_search'");
    expect(scanCall!.sql).toContain("AND country IN ('all', 'United States')");
    expect(scanCall!.sql).toContain("AND (cursor IS NULL OR cursor = 'page-1')");
    expect(scanCall!.sql).toContain("AND fetched_at >= ?");
    expect(scanCall!.sql).toContain("AND fetched_at <= ?");
    expect(scanCall!.sql).toContain("ORDER BY fetched_at DESC");
    expect(scanCall!.bindings[0]).toBe(provider);
    expect(scanCall!.bindings[3]).toBe(250);

    // Verification uses the primary key (cache_key IN ...) with EXACTLY the
    // loader-derived keys for the two crawler-visible fallback countries.
    const verifyCall = calls.find((call) => /cache_key IN/i.test(call.sql));
    expect(verifyCall).toBeDefined();
    expect(verifyCall!.sql).toContain("WHERE cache_key IN (");
    const expectedKeys = [
      nykaaKey,
      await loaderKey(env, provider, "nykaa.com", "United States"),
      mamaearthKey,
      await loaderKey(env, provider, "mamaearth.com", "all"),
    ];
    expect([...verifyCall!.bindings].sort()).toEqual([...expectedKeys].sort());
    expect(verifyCall!.bindings.length).toBeLessThanOrEqual(90);

    // Zero-cost constraint: no discovery provider was invoked.
    expect(searchAdsMock).not.toHaveBeenCalled();
    expect(searchMetaLibraryByBrowserMock).not.toHaveBeenCalled();
  });

  it("dedupes www-prefixed destinations and both country keys into one canonical domain", async () => {
    installProviderMocks();
    const env = makeEnv();
    const provider = "meta_library_browser";
    const nykaaKey = await loaderKey(env, provider, "nykaa.com", "all");
    const usKey = await loaderKey(env, provider, "nykaa.com", "United States");

    const { db } = createFakeDb([
      makeRow({
        cacheKey: nykaaKey,
        payloadJson: makePayload({
          ads: [
            makeAd({ landingPageUrl: "https://www.nykaa.com/sale" }),
            makeAd({ landingPageUrl: "https://nykaa.com/sale" }),
          ],
        }),
      }),
      makeRow({
        cacheKey: usKey,
        country: "United States",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://www.nykaa.com/us-sale" })],
        }),
      }),
    ]);

    const domains = await loadDomains(env, db);
    expect(domains).toEqual(["nykaa.com"]);
  });

  it("verifies through the United States fallback when the global-all key is missing", async () => {
    installProviderMocks();
    const env = makeEnv();
    const provider = "meta_library_browser";
    const usKey = await loaderKey(env, provider, "nykaa.com", "United States");

    const { db } = createFakeDb([
      makeRow({
        cacheKey: usKey,
        country: "United States",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/us" })],
        }),
      }),
    ]);

    expect(await loadDomains(env, db)).toEqual(["nykaa.com"]);
  });
});

describe("loadIndexableBrandPageDomains — exact-key parity across rollout modes", () => {
  it("shadow mode: a search-v2 row alone is never included; the legacy row is what the loader reads", async () => {
    installProviderMocks();
    const env = makeEnv({ SEARCH_ROLLOUT_MODE: "shadow" });
    const provider = "meta_library_browser";
    const v2Key = "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1";
    const legacyKey = await loaderKey(env, provider, "nykaa.com", "all");

    // Shadow artifact row only — the loader serves the legacy key, so the
    // page would NOT render indexable from this row alone.
    let { db, calls } = createFakeDb([
      makeRow({
        cacheKey: v2Key,
        queryFingerprint: "search-v2",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/shadow" })],
        }),
      }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);
    let verifyCall = calls.find((call) => /cache_key IN/i.test(call.sql));
    expect(verifyCall).toBeDefined();
    expect(verifyCall!.bindings.every((key) => !String(key).startsWith("search-v2"))).toBe(true);

    // Add the row under the exact legacy key the loader reads → included.
    ({ db, calls } = createFakeDb([
      makeRow({ cacheKey: v2Key, queryFingerprint: "search-v2" }),
      makeRow({ cacheKey: legacyKey }),
    ]));
    expect(await loadDomains(env, db)).toEqual(["nykaa.com"]);
  });

  it("legacy mode: same parity — only legacy keys can prove indexability", async () => {
    installProviderMocks();
    const env = makeEnv({ SEARCH_ROLLOUT_MODE: "legacy" });
    const provider = "meta_library_browser";
    const v2Key = "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1";
    const legacyKey = await loaderKey(env, provider, "nykaa.com", "all");

    let { db } = createFakeDb([
      makeRow({ cacheKey: v2Key, queryFingerprint: "search-v2" }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);

    ({ db } = createFakeDb([makeRow({ cacheKey: legacyKey })]));
    expect(await loadDomains(env, db)).toEqual(["nykaa.com"]);
  });

  it("v2 mode: the search-v2 key is the loader key; a legacy-only row never includes", async () => {
    installProviderMocks();
    const env = makeEnv({ SEARCH_ROLLOUT_MODE: "v2" });
    const provider = "meta_library_browser";
    const v2AllKey = "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1";
    // The loader key in v2 mode IS the search-v2 key. A true legacy
    // fingerprint key (what a legacy-mode environment would derive) is not
    // read in v2 mode, so a legacy-only row proves nothing.
    const legacyKey = await loaderKey(
      makeEnv({ SEARCH_ROLLOUT_MODE: "legacy" }),
      provider,
      "nykaa.com",
      "all",
    );
    expect(legacyKey).not.toBe(v2AllKey);

    let { db, calls } = createFakeDb([
      makeRow({ cacheKey: legacyKey, queryFingerprint: "fnv1a-0000" }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);

    ({ db, calls } = createFakeDb([
      makeRow({ cacheKey: v2AllKey, queryFingerprint: "search-v2" }),
    ]));
    expect(await loadDomains(env, db)).toEqual(["nykaa.com"]);
    const verifyCall = calls.find((call) => /cache_key IN/i.test(call.sql));
    expect(verifyCall!.bindings).toContain(v2AllKey);
    expect(verifyCall!.bindings).toContain(
      "search-v2:domain:nykaa.com:exact:meta_library_browser:united-states:page-1",
    );
  });

  it("pins the sitemap's derived key to the key the loader actually reads", async () => {
    installProviderMocks();
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/data.server", () => ({ getDiscoveryCacheEntry }));

    const { loadBrandPageCacheSnapshot } = await import("~/lib/brand-page.server");

    for (const mode of ["shadow", "v2"] as const) {
      const env = makeEnv({ SEARCH_ROLLOUT_MODE: mode, DB: {} });
      getDiscoveryCacheEntry.mockClear();
      await loadBrandPageCacheSnapshot(env as never, {
        domain: "nykaa.com",
        visitorCountry: "all",
        now: NOW,
      });
      // The loader's first cache read is for country "all" — its exact key.
      const loaderReadKey = getDiscoveryCacheEntry.mock.calls[0]?.[1];
      const sitemapKey = await loaderKey(env, "meta_library_browser", "nykaa.com", "all");
      expect(loaderReadKey).toBe(sitemapKey);
    }
  });
});

describe("loadIndexableBrandPageDomains — every major exclusion", () => {
  it("excludes non-indexable shapes even when the row sits at the exact loader key", async () => {
    installProviderMocks();
    const env = makeEnv();
    const provider = "meta_library_browser";
    const nykaaAllKey = await loaderKey(env, provider, "nykaa.com", "all");

    const cases: [string, RowFixture][] = [
      [
        "demo-sourced payload",
        {
          cacheKey: nykaaAllKey,
          payloadJson: makePayload({
            source: "demo",
            provider: "demo",
            ads: [makeAd({ source: "demo" })],
          }),
        },
      ],
      ["zero ads", { cacheKey: nykaaAllKey, payloadJson: makePayload({ ads: [] }) }],
      ["stale row (8 days old)", { cacheKey: nykaaAllKey, fetchedAt: isoAgo(8 * DAY_MS) }],
      ["future fetched_at (clock skew)", { cacheKey: nykaaAllKey, fetchedAt: isoAhead(60 * 1000) }],
      [
        "scheduled-scan route context",
        { cacheKey: nykaaAllKey, routeContext: "watchlist_scan" },
      ],
      ["wrong provider column", { cacheKey: nykaaAllKey, provider: "meta_api" }],
      ["malformed payload JSON", { cacheKey: nykaaAllKey, payloadJson: "{not json" }],
    ];

    for (const [label, rowOverrides] of cases) {
      const { db } = createFakeDb([makeRow(rowOverrides)]);
      expect(await loadDomains(env, db), label).toEqual([]);
    }

    expect(searchAdsMock).not.toHaveBeenCalled();
    expect(searchMetaLibraryByBrowserMock).not.toHaveBeenCalled();
  });

  it("excludes cursor-page, customer-token-scoped, and malformed-key rows", async () => {
    installProviderMocks();
    const env = makeEnv();
    const { db, calls } = createFakeDb([
      makeRow({
        cacheKey: "meta_library_browser:fnv1a-0000:all:page-2",
        cursor: "page-2",
      }),
      makeRow({
        cacheKey: "meta_library_browser:fnv1a-0000:all:page-1:customer_meta:abc123",
      }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);
    // Customer-token-scoped keys must never reach the verification read.
    const verifyCall = calls.find((call) => /cache_key IN/i.test(call.sql));
    expect(verifyCall).toBeDefined();
    expect(verifyCall!.bindings.every((key) => !String(key).includes("customer_meta"))).toBe(
      true,
    );
  });

  it("does not infer indexability from an unrelated keyword row's destination URL", async () => {
    installProviderMocks();
    const env = makeEnv();
    const { db } = createFakeDb([
      // Fresh keyword row whose ad links to nykaa.com, but whose key is not
      // the loader key for nykaa.com — and no row under the loader key exists.
      makeRow({
        cacheKey: "meta_library_browser:fnv1a-keyword:all:page-1",
        queryFingerprint: "fnv1a-keyword",
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/deals" })],
        }),
      }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);
  });

  it("rejects malformed candidate domains through the /ads/:domain validator", async () => {
    installProviderMocks();
    const env = makeEnv();
    const { db } = createFakeDb([
      makeRow({
        cacheKey: "meta_library_browser:fnv1a-0000:all:page-1",
        payloadJson: makePayload({
          ads: [
            makeAd({ landingPageUrl: "https://nykaa/" }), // single label, no TLD
            makeAd({ landingPageUrl: "not a url" }),
            makeAd({ landingPageUrl: "https://foo..com/x" }),
          ],
        }),
      }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);
  });

  it("v2 mode: broader-scope and customer-token-scoped search-v2 keys never include", async () => {
    installProviderMocks();
    const env = makeEnv({ SEARCH_ROLLOUT_MODE: "v2" });
    const { db, calls } = createFakeDb([
      makeRow({
        cacheKey: "search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1",
        queryFingerprint: "search-v2",
      }),
      makeRow({
        cacheKey:
          "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1:customer_meta:abc123",
        queryFingerprint: "search-v2",
      }),
    ]);
    expect(await loadDomains(env, db)).toEqual([]);
    const verifyCall = calls.find((call) => /cache_key IN/i.test(call.sql));
    expect(
      verifyCall!.bindings.every((key) => {
        const value = String(key);
        return !value.includes(":broader:") && !value.includes("customer_meta");
      }),
    ).toBe(true);
  });
});

describe("loadIndexableBrandPageDomains — static fallback conditions", () => {
  it("returns [] without any D1 query when the emergency noindex flag is set", async () => {
    installProviderMocks();
    const env = makeEnv({ PUBLIC_BRAND_PAGES_INDEXABLE: "0" });
    const { db, calls } = createFakeDb([makeRow()]);
    expect(await loadDomains(env, db)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns [] without any D1 query when only demo discovery is configured", async () => {
    installProviderMocks();
    const env = { SEARCH_ROLLOUT_MODE: "shadow" }; // no provider binding → demo
    const { db, calls } = createFakeDb([makeRow()]);
    expect(await loadDomains(env, db)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns [] without any D1 query when the DB binding is missing", async () => {
    installProviderMocks();
    const env = makeEnv({ DB: undefined });
    const { loadIndexableBrandPageDomains } = await import(
      "~/lib/brand-page-sitemap.server"
    );
    expect(await loadIndexableBrandPageDomains(env as never, NOW)).toEqual([]);
  });

  it("returns [] on a query failure (missing table / D1 error)", async () => {
    installProviderMocks();
    const env = makeEnv();
    const failingDb = {
      prepare() {
        throw new Error("no such table: discovery_cache_entry");
      },
    };
    expect(await loadDomains(env, failingDb)).toEqual([]);

    const explodingDb = {
      prepare() {
        throw new Error("D1 statement timed out");
      },
    };
    expect(await loadDomains(env, explodingDb)).toEqual([]);
  });
});

describe("publicSitemapFile — dynamic document assembly and static fallback", () => {
  it("renders all 13 static URLs plus sorted /ads entries when the cache has indexable domains", async () => {
    installProviderMocks();
    const env = makeEnv();
    const provider = "meta_library_browser";
    const nykaaKey = await loaderKey(env, provider, "nykaa.com", "all");
    const mamaearthKey = await loaderKey(env, provider, "mamaearth.com", "United States");
    const { db } = createFakeDb([
      makeRow({
        cacheKey: nykaaKey,
        fetchedAt: realIsoAgo(2 * 60 * 60 * 1000),
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/sale" })],
        }),
      }),
      makeRow({
        cacheKey: mamaearthKey,
        country: "United States",
        fetchedAt: realIsoAgo(2 * 60 * 60 * 1000),
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://mamaearth.com/shop" })],
        }),
      }),
    ]);

    const { publicSitemapFile } = await import("~/lib/brand-page-sitemap.server");
    const file = await publicSitemapFile({ ...env, DB: db } as never);
    expect(file.contentType).toBe("application/xml; charset=utf-8");
    expect(file.cacheControl).toBe("public, max-age=3600");
    const urls = [
      ...file.body.matchAll(/<url><loc>(https:\/\/0509\.io[^<]+)<\/loc><\/url>/g),
    ].map((match) => match[1]);
    expect(urls).toHaveLength(15);
    expect(urls.slice(0, 13)).toEqual([
      "https://0509.io/",
      "https://0509.io/search",
      "https://0509.io/auth/signup",
      "https://0509.io/compare/magicbrief",
      "https://0509.io/compare/meta-ad-library",
      "https://0509.io/help",
      "https://0509.io/docs",
      "https://0509.io/api/docs",
      "https://0509.io/status",
      "https://0509.io/changelog",
      "https://0509.io/trust",
      "https://0509.io/privacy",
      "https://0509.io/terms",
    ]);
    expect(urls.slice(13)).toEqual([
      "https://0509.io/ads/mamaearth.com",
      "https://0509.io/ads/nykaa.com",
    ]);
    expect(new Set(urls).size).toBe(15);
  });

  it("renders only the static sitemap with no D1 read when env is absent or D1 fails", async () => {
    installProviderMocks();
    const { publicSitemapFile } = await import("~/lib/brand-page-sitemap.server");
    const staticFile = await publicSitemapFile(undefined);
    expect(staticFile.body).not.toContain("/ads/");
    expect((staticFile.body.match(/<url><loc>/g) ?? []).length).toBe(13);

    const env = makeEnv();
    const failingDb = {
      prepare() {
        throw new Error("no such table: discovery_cache_entry");
      },
    };
    const degraded = await publicSitemapFile({ ...env, DB: failingDb } as never);
    expect(degraded.body).toBe(staticFile.body);
  });

  it("escapes XML so a domain in the URL can never inject markup", async () => {
    // Domains pass through normalizeBrandPageDomain (letters/digits/dots/dashes
    // only), but the renderer must still escape anything it is handed.
    const { renderSitemapXml } = await import("~/lib/seo");
    const body = renderSitemapXml(["/", "/ads/nykaa.com", "/ads/a&b.co"]);
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/ads/a&amp;b.co</loc></url>");
    expect(body).not.toContain("a&b.co</loc>");
  });
});

describe("publicSitemapFile — worker GET/HEAD response path", () => {
  beforeEach(() => {
    vi.resetModules();
    installProviderMocks();
    vi.doMock("react-router", () => ({
      createContext: vi.fn(() => ({})),
      createRequestHandler: vi.fn(() => vi.fn()),
      RouterContextProvider: class {},
    }));
    vi.doMock("~/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));
    vi.doMock("~/lib/digest-orchestration.server", () => ({
      resumePendingDigestScheduleJobsDetailed: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      flushDeferredInstantAlerts: vi.fn(),
      runScheduledDiscoveryWarmup: vi.fn(),
      runScheduledMonitoring: vi.fn(),
      sendCustomerAtRiskAlert: vi.fn(),
      sendWeeklyBusinessNumbers: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring-fanout.server", () => ({
      reconcileOrchestratedWatchlistRuns: vi.fn(),
      resolveMonitoringFanoutMode: vi.fn(() => "inline"),
      resolveMonitoringOrchestrationLeaseMs: vi.fn(() => 30_000),
    }));
    vi.doMock("~/lib/presence-service.server", () => ({
      runPresencePollingBatch: vi.fn(),
    }));
    vi.doMock("~/lib/public-markdown", () => ({
      isPublicMarkdownPage: vi.fn(() => false),
      LLMS_TEXT: "",
      PUBLIC_MARKDOWN: "",
      wantsPublicMarkdown: vi.fn(() => false),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({ enforceRequestRateLimit: vi.fn() }));
    vi.doMock("~/lib/retention.server", () => ({ runRetentionSweep: vi.fn() }));
    vi.doMock("../workers/delivery-recovery", () => ({
      scheduleBillingLifecycleEmailRecovery: vi.fn(),
    }));
    vi.doMock("../workers/digest-schedule-recovery", () => ({
      scheduleDigestScheduleExhaustionRecovery: vi.fn(),
    }));
    vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
    vi.doMock("../workers/primary-domain", () => ({
      primaryDomainRedirect: vi.fn(() => null),
    }));
    vi.doMock("../workers/security-headers", () => ({
      withSecurityHeaders: vi.fn((response: Response) => response),
    }));
  });

  afterEach(() => {
    vi.doUnmock("react-router");
    vi.doUnmock("~/lib/cron-failure-alert.server");
    vi.doUnmock("~/lib/digest-orchestration.server");
    vi.doUnmock("~/lib/monitoring.server");
    vi.doUnmock("~/lib/monitoring-fanout.server");
    vi.doUnmock("~/lib/presence-service.server");
    vi.doUnmock("~/lib/public-markdown");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/retention.server");
    vi.doUnmock("../workers/delivery-recovery");
    vi.doUnmock("../workers/digest-schedule-recovery");
    vi.doUnmock("../workers/monitoring-workflow");
    vi.doUnmock("../workers/primary-domain");
    vi.doUnmock("../workers/security-headers");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function fetchSitemap(method: string, env: Record<string, unknown>) {
    const { default: worker } = await import("../workers/app");
    const response = await worker.fetch(
      new Request(`https://0509.io/sitemap.xml`, { method }) as never,
      env as never,
      { waitUntil: vi.fn() } as never,
    );
    return response as Response;
  }

  function sitemapEnvWithDb(rows: ReturnType<typeof makeRow>[]) {
    const { db } = createFakeDb(rows);
    return { ...makeEnv(), DB: db };
  }

  it("GET /sitemap.xml keeps all 13 static URLs and appends sorted, deduped /ads entries", async () => {
    const provider = "meta_library_browser";
    const env = makeEnv();
    const nykaaKey = await loaderKey(env, provider, "nykaa.com", "all");
    const mamaearthKey = await loaderKey(env, provider, "mamaearth.com", "United States");
    const envWithDb = sitemapEnvWithDb([
      makeRow({
        cacheKey: nykaaKey,
        fetchedAt: realIsoAgo(2 * 60 * 60 * 1000),
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://nykaa.com/sale" })],
        }),
      }),
      makeRow({
        cacheKey: mamaearthKey,
        country: "United States",
        fetchedAt: realIsoAgo(2 * 60 * 60 * 1000),
        payloadJson: makePayload({
          ads: [makeAd({ landingPageUrl: "https://mamaearth.com/shop" })],
        }),
      }),
    ]);

    const response = await fetchSitemap("GET", envWithDb);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = await response.text();
    const urls = [...body.matchAll(/<url><loc>(https:\/\/0509\.io[^<]+)<\/loc><\/url>/g)].map(
      (match) => match[1],
    );
    expect(urls).toHaveLength(15);
    // All 13 static paths first, in their declared order.
    expect(urls.slice(0, 13)).toEqual([
      "https://0509.io/",
      "https://0509.io/search",
      "https://0509.io/auth/signup",
      "https://0509.io/compare/magicbrief",
      "https://0509.io/compare/meta-ad-library",
      "https://0509.io/help",
      "https://0509.io/docs",
      "https://0509.io/api/docs",
      "https://0509.io/status",
      "https://0509.io/changelog",
      "https://0509.io/trust",
      "https://0509.io/privacy",
      "https://0509.io/terms",
    ]);
    // Dynamic entries appended in deterministic (sorted) order, each once.
    expect(urls.slice(13)).toEqual([
      "https://0509.io/ads/mamaearth.com",
      "https://0509.io/ads/nykaa.com",
    ]);
    expect(new Set(urls).size).toBe(15);
  });

  it("HEAD /sitemap.xml returns 200 with an empty body", async () => {
    const env = makeEnv();
    const nykaaKey = await loaderKey(env, "meta_library_browser", "nykaa.com", "all");
    const response = await fetchSitemap(
      "HEAD",
      sitemapEnvWithDb([makeRow({ cacheKey: nykaaKey })]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("serves the unchanged static sitemap (HTTP 200) when D1 fails", async () => {
    const failingEnv = {
      ...makeEnv(),
      DB: {
        prepare() {
          throw new Error("no such table: discovery_cache_entry");
        },
      },
    };
    const response = await fetchSitemap("GET", failingEnv);
    expect(response.status).toBe(200);

    const body = await response.text();
    const urls = [...body.matchAll(/<url><loc>(https:\/\/0509\.io[^<]+)<\/loc><\/url>/g)].map(
      (match) => match[1],
    );
    expect(urls).toHaveLength(13);
    expect(body).not.toContain("/ads/");
  });

  it("keeps serving /robots.txt through the static public-file path without touching D1", async () => {
    const { db, calls } = createFakeDb([]);
    const { default: worker } = await import("../workers/app");
    const response = (await worker.fetch(
      new Request("https://0509.io/robots.txt") as never,
      { ...makeEnv(), DB: db } as never,
      { waitUntil: vi.fn() } as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("Sitemap: https://0509.io/sitemap.xml");
    expect(calls).toHaveLength(0);
    expect(searchAdsMock).not.toHaveBeenCalled();
    expect(searchMetaLibraryByBrowserMock).not.toHaveBeenCalled();
  });
});
