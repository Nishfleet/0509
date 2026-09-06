/**
 * Dynamic /sitemap.xml brand-page entries (candidate 4: dynamic-brand-sitemap).
 *
 * Contract under test: /ads/:domain appears in the sitemap ONLY when the
 * serving page would render indexable for a crawler — cache-only proof, exact
 * loader-key parity under the current rollout mode/provider, 7-day freshness,
 * non-demo data — and every static URL survives. Any D1 failure degrades to
 * the unchanged static sitemap with HTTP 200.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import { buildSitemapXml } from "~/lib/seo";
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
  landingPageUrl: "https://www.nykaa.com/sale",
  adSnapshotUrl: null,
  countries: ["all"],
  platforms: ["Instagram"],
  firstSeenAt: isoAgo(5 * DAY_MS),
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_library_browser",
  analysisFields: [],
};

interface ScanRow {
  cache_key: string;
  provider: string;
  route_context: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
}

/**
 * The legacy cache key the /ads/:domain loader derives in legacy/shadow mode
 * (see deriveBrandPageCacheLookup): the fingerprint of the normalized
 * advertiser query for the domain. Computed here independently of the
 * implementation under test, so exact-key parity is actually proven.
 */
function legacyFingerprintKey(provider: string, query: string, country: string) {
  const normalized = normalizeSavedQuery("advertiser", {
    query,
    country,
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  });
  return `${provider}:${fingerprintSavedQuery(normalized)}:${country.toLowerCase().replace(/\s+/g, "-")}:page-1`;
}

/** The search-v2 domain key the loader derives in v2 mode. */
function v2Key(
  provider: string,
  domain: string,
  scope: "exact" | "broader",
  country: string,
  cursor = "page-1",
) {
  return `search-v2:domain:${domain}:${scope}:${provider}:${country.toLowerCase().replace(/\s+/g, "-")}:${cursor}`;
}

function scanRow(cacheKey: string, overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    cache_key: cacheKey,
    provider: "meta_library_browser",
    route_context: "public_search",
    country: "all",
    cursor: null,
    payload_json: JSON.stringify({
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    }),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Minimal D1 mock: the bounded scan resolves the module-level `rows` at call
 * time, so tests can mutate the fixture between setup and invocation.
 */
function mockDb() {
  const all = vi.fn().mockImplementation(async () => ({ results: rows }));
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, all, db: { prepare } as never };
}

const getDiscoveryCacheEntry = vi.fn();
const searchAdsViaSourceResolver = vi.fn();
const hasFreshDiscoveryCacheEntry = vi.fn();
const searchMetaLibraryByBrowser = vi.fn();
const searchMetaApiAds = vi.fn();
let provider = "meta_library_browser";
let rows: ScanRow[] = [];

beforeEach(() => {
  vi.resetModules();
  provider = "meta_library_browser";
  rows = [];
  // Mirrors the real getDiscoveryCacheEntry: malformed payload JSON returns
  // null, and the servable payload is parsed from the row's payload_json.
  getDiscoveryCacheEntry.mockReset().mockImplementation(
    async (_env: unknown, cacheKey: string) => {
      const row = rows.find((r) => r.cache_key === cacheKey);
      if (!row) {
        return null;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return null;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
      }
      return {
        cacheKey: row.cache_key,
        provider: row.provider,
        routeContext: row.route_context,
        queryFingerprint: "fp",
        country: row.country,
        cursor: row.cursor,
        payload,
        fetchedAt: row.fetched_at,
        expiresAt: isoAgo(60 * 60 * 1000),
        browserMsUsed: 1000,
        createdAt: row.fetched_at,
        updatedAt: row.fetched_at,
      };
    },
  );
  searchAdsViaSourceResolver.mockReset();
  hasFreshDiscoveryCacheEntry.mockReset();
  searchMetaLibraryByBrowser.mockReset();
  searchMetaApiAds.mockReset();

  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => provider),
    searchAdsViaSourceResolver,
    hasFreshDiscoveryCacheEntry,
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser,
  }));
  vi.doMock("~/lib/meta-api.server", () => ({
    searchAds: searchMetaApiAds,
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry,
  }));
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

function makeEnv(db: unknown, mode = "shadow") {
  return { DB: db, SEARCH_ROLLOUT_MODE: mode } as never;
}

async function sitemapBody(env: ReturnType<typeof makeEnv>) {
  const { publicSitemapFile } = await import("~/lib/brand-page-sitemap.server");
  const file = await publicSitemapFile(env);
  return file.body;
}

describe("dynamic brand-page sitemap inclusion (exact loader-key parity)", () => {
  it("includes a fresh legacy-key domain in shadow mode, proving the exact key the loader reads", async () => {
    const { db, prepare, bind } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [scanRow(nykaaKey)];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    // The dynamic entry appears once, alongside every static URL.
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect((body.match(/ads\/nykaa\.com/g) ?? []).length).toBe(1);
    for (const path of ["/search", "/help", "/docs", "/terms"]) {
      expect(body).toContain(`<url><loc>https://0509.io${path}</loc></url>`);
    }
    expect(body).toContain("<url><loc>https://0509.io/</loc></url>");
    // The point read went to EXACTLY the key the loader would derive in
    // shadow mode (legacy fingerprint, country "all", page-1).
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(expect.anything(), nykaaKey);
    expect(getDiscoveryCacheEntry).toHaveBeenCalledTimes(1);
    // The scan is one bounded, indexed query.
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("FROM discovery_cache_entry"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("WHERE provider = ?"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("route_context = 'public_search'"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ORDER BY fetched_at DESC"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("LIMIT ?"));
    expect(bind).toHaveBeenCalledWith("meta_library_browser", expect.any(String), 250);
    // Zero provider calls, ever.
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(hasFreshDiscoveryCacheEntry).not.toHaveBeenCalled();
    expect(searchMetaLibraryByBrowser).not.toHaveBeenCalled();
    expect(searchMetaApiAds).not.toHaveBeenCalled();
  });

  it("treats legacy mode exactly like shadow (both read the legacy fingerprint key)", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [scanRow(nykaaKey)];

    const body = await sitemapBody(makeEnv(db, "legacy"));

    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(expect.anything(), nykaaKey);
  });

  it("includes a fresh search-v2 exact-key domain in v2 mode (candidate from key structure alone)", async () => {
    const { db } = mockDb();
    const nykaaV2 = v2Key("meta_library_browser", "nykaa.com", "exact", "all");
    // No landing page URLs: the candidate comes from the key structure.
    rows = [
      scanRow(nykaaV2, {
        payload_json: JSON.stringify({
          ads: [{ ...baseAd, landingPageUrl: null }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "v2"));

    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(expect.anything(), nykaaV2);
  });

  it("never qualifies a v2-key row under shadow mode (loader reads the legacy key)", async () => {
    const { db } = mockDb();
    rows = [scanRow(v2Key("meta_library_browser", "nykaa.com", "exact", "all"))];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).not.toContain("/ads/");
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"),
    );
    expect(getDiscoveryCacheEntry).not.toHaveBeenCalledWith(
      expect.anything(),
      v2Key("meta_library_browser", "nykaa.com", "exact", "all"),
    );
  });

  it("excludes an unrelated keyword row whose ad destinations merely contain the domain", async () => {
    const { db } = mockDb();
    // A keyword/other-query row (different fingerprint) whose ads link to
    // nykaa.com. Recency + plausible landing URL are NOT enough: the derived
    // loader key points at a different, absent row.
    const keywordKey = legacyFingerprintKey("meta_library_browser", "nykaa", "all");
    rows = [scanRow(keywordKey)];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).not.toContain("/ads/");
    expect(getDiscoveryCacheEntry).not.toHaveBeenCalledWith(expect.anything(), keywordKey);
  });

  it("qualifies a fresh row under the United States fallback (the loader's second country try)", async () => {
    const { db } = mockDb();
    // The row lives only under the "United States" key. The loader tries "all"
    // first (miss), then "United States" (hit, usable, fresh) — so a
    // country-less crawler WOULD see the indexable page and the sitemap must
    // include it.
    const usKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "United States");
    rows = [scanRow(usKey, { country: "United States" })];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(expect.anything(), usKey);
  });
});

describe("dynamic brand-page sitemap exclusions", () => {
  it("excludes demo-sourced payloads (payload source, payload provider, ad source)", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    const demoPayload = (ads: AdRecord[]) =>
      JSON.stringify({
        ads,
        nextCursor: null,
        source: "demo",
        provider: "demo",
        cacheStatus: "hit",
      });

    for (const payloadJson of [
      demoPayload([baseAd]),
      JSON.stringify({
        ads: [baseAd],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "demo",
      }),
      JSON.stringify({
        ads: [{ ...baseAd, source: "demo" }],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
      }),
    ]) {
      rows = [scanRow(nykaaKey, { payload_json: payloadJson })];
      const body = await sitemapBody(makeEnv(db, "shadow"));
      expect(body).not.toContain("/ads/");
    }
  });

  it("excludes zero-ad payloads", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [
      scanRow(nykaaKey, {
        payload_json: JSON.stringify({
          ads: [],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).not.toContain("/ads/");
  });

  it("excludes stale (>7 days) and future-dated rows", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");

    for (const fetchedAt of [isoAgo(8 * DAY_MS), new Date(Date.now() + 60 * 60 * 1000).toISOString()]) {
      rows = [scanRow(nykaaKey, { fetched_at: fetchedAt })];
      const body = await sitemapBody(makeEnv(db, "shadow"));
      expect(body).not.toContain("/ads/");
    }
  });

  it("excludes malformed fetched_at values", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [scanRow(nykaaKey, { fetched_at: "not-a-date" })];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).not.toContain("/ads/");
  });

  it("excludes scheduled-scan rows (public_search route context only)", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [scanRow(nykaaKey, { route_context: "watchlist_scan" })];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).not.toContain("/ads/");
  });

  it("excludes rows under a different provider (scan is provider-filtered and parity holds)", async () => {
    const { db, prepare } = mockDb();
    // A meta_api row cannot be reached by the meta_library_browser-derived key.
    rows = [
      scanRow(`meta_api:${legacyFingerprintKey("meta_library_browser", "nykaa.com", "all").split(":")[1] ?? ""}:all:page-1`, {
        provider: "meta_api",
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).not.toContain("/ads/");
    // The scan itself filters by the resolved provider.
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("WHERE provider = ?"));
  });

  it("excludes broader-scope and cursor-page v2 keys in v2 mode", async () => {
    const { db } = mockDb();
    rows = [
      scanRow(v2Key("meta_library_browser", "nykaa.com", "broader", "all")),
      scanRow(v2Key("meta_library_browser", "nykaa.com", "exact", "all", "after:2"), {
        cursor: "after:2",
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "v2"));
    expect(body).not.toContain("/ads/");
  });

  it("excludes customer-token-scoped keys (loader derives the unscoped key)", async () => {
    const { db } = mockDb();
    const scopedKey = `${legacyFingerprintKey("meta_library_browser", "nykaa.com", "all")}:customer_meta:abcd1234`;
    rows = [scanRow(scopedKey)];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).not.toContain("/ads/");
    expect(getDiscoveryCacheEntry).toHaveBeenCalledWith(
      expect.anything(),
      legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"),
    );
  });

  it("excludes malformed JSON rows without breaking the rest of the scan", async () => {
    const { db } = mockDb();
    const amazonKey = legacyFingerprintKey("meta_library_browser", "amazon.in", "all");
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [
      scanRow(nykaaKey, { payload_json: "{not valid json" }),
      scanRow(amazonKey, {
        payload_json: JSON.stringify({
          ads: [{ ...baseAd, metaAdId: "meta-amazon-1", landingPageUrl: "https://www.amazon.in/deals" }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "shadow"));
    expect(body).toContain("<url><loc>https://0509.io/ads/amazon.in</loc></url>");
    expect(body).not.toContain("/ads/nykaa.com");
  });

  it("excludes malformed candidate domains (bad v2 key domain and bad destinations)", async () => {
    const { db } = mockDb();
    rows = [
      scanRow(`search-v2:domain:bad..domain:exact:meta_library_browser:all:page-1`),
      scanRow(legacyFingerprintKey("meta_library_browser", "good.example", "all"), {
        payload_json: JSON.stringify({
          ads: [{ ...baseAd, landingPageUrl: "https://nykaa/" }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "v2"));
    expect(body).not.toContain("/ads/bad..domain");
    expect(body).not.toContain("/ads/nykaa");
  });

  it("dedupes rows across country fallbacks and orders entries deterministically", async () => {
    const { db } = mockDb();
    const nykaaAll = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    const nykaaUs = legacyFingerprintKey("meta_library_browser", "nykaa.com", "United States");
    const amazonKey = legacyFingerprintKey("meta_library_browser", "amazon.in", "all");
    rows = [
      scanRow(nykaaAll),
      scanRow(nykaaUs, { country: "United States" }),
      scanRow(amazonKey, {
        payload_json: JSON.stringify({
          ads: [{ ...baseAd, metaAdId: "meta-amazon-1", landingPageUrl: "https://www.amazon.in/deals" }],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      }),
    ];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect((body.match(/ads\/nykaa\.com/g) ?? []).length).toBe(1);
    expect((body.match(/ads\/amazon\.in/g) ?? []).length).toBe(1);
    // Sorted dynamic block after the static block: amazon.in before nykaa.com.
    expect(body.indexOf("/ads/amazon.in")).toBeGreaterThan(body.indexOf("/terms</loc>"));
    expect(body.indexOf("/ads/nykaa.com")).toBeGreaterThan(body.indexOf("/ads/amazon.in"));
  });
});

describe("static sitemap fallback (D1 must never take the sitemap down)", () => {
  it("returns the unchanged static sitemap without a DB binding", async () => {
    const body = await sitemapBody(makeEnv({}, "shadow"));

    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
    expect(body).toContain("<url><loc>https://0509.io/</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/terms</loc></url>");
  });

  it("returns the static sitemap when the cache table is missing (scan error)", async () => {
    const all = vi.fn().mockRejectedValue(new Error("no such table: discovery_cache_entry"));
    const bind = vi.fn(() => ({ all }));
    const db = { prepare: vi.fn(() => ({ bind })) } as never;

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
  });

  it("returns the static sitemap when a point read fails mid-generation", async () => {
    const { db } = mockDb();
    const nykaaKey = legacyFingerprintKey("meta_library_browser", "nykaa.com", "all");
    rows = [scanRow(nykaaKey)];
    getDiscoveryCacheEntry.mockRejectedValue(new Error("D1 unavailable"));

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
  });

  it("returns the static sitemap when only demo discovery is configured", async () => {
    const { db } = mockDb();
    provider = "demo";
    rows = [scanRow(legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"))];

    const body = await sitemapBody(makeEnv(db, "shadow"));

    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
  });

  it('returns the static sitemap when the emergency noindex brake ("0") is set', async () => {
    const { db } = mockDb();
    rows = [scanRow(legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"))];
    const env = { DB: db, SEARCH_ROLLOUT_MODE: "shadow", PUBLIC_BRAND_PAGES_INDEXABLE: "0" } as never;

    const body = await sitemapBody(env);

    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
  });

  it('indexes normally when the flag is explicitly "1"', async () => {
    const { db } = mockDb();
    rows = [scanRow(legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"))];
    const env = { DB: db, SEARCH_ROLLOUT_MODE: "shadow", PUBLIC_BRAND_PAGES_INDEXABLE: "1" } as never;

    const body = await sitemapBody(env);

    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
  });
});

describe("candidate extraction unit rules", () => {
  it("parses only well-formed search-v2 exact domain keys", async () => {
    const { candidateDomainFromCacheKey } = await import("~/lib/brand-page-sitemap.server");
    expect(candidateDomainFromCacheKey("search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1", "meta_library_browser")).toBe("nykaa.com");
    expect(candidateDomainFromCacheKey("search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1", "meta_library_browser")).toBeNull();
    expect(candidateDomainFromCacheKey("search-v2:domain:nykaa.com:exact:meta_library_browser:all:after:2", "meta_library_browser")).toBeNull();
    expect(candidateDomainFromCacheKey("search-v2:domain:nykaa.com:exact:meta_api:all:page-1", "meta_library_browser")).toBeNull();
    expect(candidateDomainFromCacheKey("meta_library_browser:fnv1a-123:all:page-1", "meta_library_browser")).toBeNull();
    expect(candidateDomainFromCacheKey("search-v2:domain:nykaa.com:exact:meta_library_browser:all", "meta_library_browser")).toBeNull();
  });

  it("extracts only http(s) landing-page hosts from valid payload JSON", async () => {
    const { adDestinationHostnames } = await import("~/lib/brand-page-sitemap.server");

    expect(adDestinationHostnames("{not json")).toEqual([]);
    expect(adDestinationHostnames(JSON.stringify({ nextCursor: null }))).toEqual([]);
    expect(
      adDestinationHostnames(
        JSON.stringify({
          ads: [
            { landingPageUrl: "https://www.nykaa.com/sale" },
            { landingPageUrl: "http://amazon.in/deals" },
            { landingPageUrl: "javascript:alert(1)" },
            { landingPageUrl: "https://" },
            { landingPageUrl: "https://nykaa/" },
            {},
            null,
          ],
        }),
      ),
    ).toEqual(["nykaa.com", "amazon.in"]);
  });
});

// --- Worker GET/HEAD /sitemap.xml response path -----------------------------
// The worker's static imports are mocked (as in retention-schedule.test.ts);
// the SEO/sitemap modules, primary-domain redirect, and security headers stay
// REAL so the actual GET/HEAD response path is exercised.

vi.mock("react-router", () => ({
  createContext: vi.fn(() => ({})),
  createRequestHandler: vi.fn(() => vi.fn()),
  RouterContextProvider: class {},
}));
vi.mock("~/lib/cron-failure-alert.server", () => ({
  reportScheduledTaskFailure: vi.fn(),
}));
vi.mock("~/lib/digest-orchestration.server", () => ({
  resumePendingDigestScheduleJobsDetailed: vi.fn(),
}));
vi.mock("~/lib/monitoring.server", () => ({
  flushDeferredInstantAlerts: vi.fn(),
  runScheduledDiscoveryWarmup: vi.fn(),
  runScheduledMonitoring: vi.fn(),
  sendCustomerAtRiskAlert: vi.fn(),
  sendWeeklyBusinessNumbers: vi.fn(),
}));
vi.mock("~/lib/monthly-recap.server", () => ({
  sendMonthlyCustomerRecaps: vi.fn(),
}));
vi.mock("~/lib/public-markdown", () => ({
  isPublicMarkdownPage: vi.fn(() => false),
  LLMS_TEXT: "",
  PUBLIC_MARKDOWN: "",
  wantsPublicMarkdown: vi.fn(() => false),
}));
vi.mock("~/lib/rate-limit.server", () => ({
  enforceRequestRateLimit: vi.fn(),
}));
vi.mock("~/lib/release-scheduled-observation.server", () => ({
  observeScheduledTask: vi.fn(),
}));
vi.mock("~/lib/retention.server", () => ({
  runRetentionSweep: vi.fn(),
}));
vi.mock("~/lib/scheduled-observation-health.server", () => ({
  sendScheduledObservationGapAlert: vi.fn(),
  SCHEDULED_OBSERVATION_GAP_CHECK_CRON: "",
}));
vi.mock("../workers/delivery-recovery", () => ({
  scheduleBillingLifecycleEmailRecovery: vi.fn(),
}));
vi.mock("../workers/digest-schedule-recovery", () => ({
  scheduleDigestScheduleExhaustionRecovery: vi.fn(),
}));
vi.mock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
vi.mock("../workers/schedule", () => ({
  resolveOperationalRiskAlertIdempotencyKey: vi.fn(),
  resolveScheduledTask: vi.fn(),
  WEEKLY_DIGEST_CRON: "",
}));

describe("Worker GET/HEAD /sitemap.xml response path", () => {
  async function fetchSitemap(method: "GET" | "HEAD", env: unknown) {
    const { default: worker } = await import("../workers/app");
    return worker.fetch(
      new Request("http://0509.io/sitemap.xml", { method }) as never,
      env as never,
      { waitUntil: vi.fn() } as never,
    ) as Promise<Response>;
  }

  it("serves the dynamic sitemap on GET with 200, application/xml, and the dynamic entry", async () => {
    const { db } = mockDb();
    rows = [scanRow(legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"))];

    const response = await fetchSitemap("GET", makeEnv(db, "shadow"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.text();
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/terms</loc></url>");
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
  });

  it("serves the static sitemap on GET with 200 when D1 is unavailable", async () => {
    const response = await fetchSitemap("GET", makeEnv({}, "shadow"));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(buildSitemapXml([]));
    expect(body).not.toContain("/ads/");
  });

  it("serves HEAD with an empty body, 200, and the same content type", async () => {
    const { db } = mockDb();
    rows = [scanRow(legacyFingerprintKey("meta_library_browser", "nykaa.com", "all"))];

    const response = await fetchSitemap("HEAD", makeEnv(db, "shadow"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe("");
  });

  it("serves HEAD with 200 even when the cache scan fails", async () => {
    const all = vi.fn().mockRejectedValue(new Error("no such table: discovery_cache_entry"));
    const bind = vi.fn(() => ({ all }));
    const db = { prepare: vi.fn(() => ({ bind })) } as never;

    const response = await fetchSitemap("HEAD", makeEnv(db, "shadow"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe("");
  });
});
