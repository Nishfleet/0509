import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  deriveBrandPageLoaderCacheKey,
} from "~/lib/brand-page.server";
import {
  BRAND_SITEMAP_MAX_ROWS,
  buildPublicSitemapFile,
  loadIndexableBrandPageDomains,
} from "~/lib/brand-page-sitemap.server";
import { applyWebsiteSearchFallback, normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { buildSearchV2CacheKey, buildSearchV2SavedQuery } from "~/lib/search-v2.server";
import { publicSeoFileForPathname } from "~/lib/seo";
import { createSqliteD1, applyMigration } from "./helpers/sqlite-d1";

// ---------------------------------------------------------------------------
// Worker import surface (fetch path only): the scheduled-side modules are
// stubbed exactly like the existing worker tests so importing workers/app
// never runs real cron work. The sitemap modules (seo, brand-page-sitemap)
// stay REAL — the GET/HEAD response path under test is the real one.
// ---------------------------------------------------------------------------
vi.mock("react-router", () => ({
  createContext: vi.fn(() => ({})),
  createRequestHandler: vi.fn(() => vi.fn()),
  RouterContextProvider: class {},
}));
vi.mock("~/lib/cron-failure-alert.server", () => ({
  reportScheduledTaskFailure: vi.fn(),
}));
vi.mock("~/lib/retention.server", () => ({ runRetentionSweep: vi.fn() }));
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
vi.mock("~/lib/monitoring-fanout.server", () => ({
  reconcileOrchestratedWatchlistRuns: vi.fn(),
  resolveMonitoringFanoutMode: vi.fn(() => "inline"),
  resolveMonitoringOrchestrationLeaseMs: vi.fn(() => 30_000),
}));
vi.mock("~/lib/presence-service.server", () => ({
  runPresencePollingBatch: vi.fn(),
}));
vi.mock("~/lib/public-markdown", () => ({
  isPublicMarkdownPage: vi.fn(() => false),
  LLMS_TEXT: "",
  PUBLIC_MARKDOWN: "",
  wantsPublicMarkdown: vi.fn(() => false),
}));
vi.mock("~/lib/rate-limit.server", () => ({ enforceRequestRateLimit: vi.fn() }));
vi.mock("../workers/delivery-recovery", () => ({
  scheduleBillingLifecycleEmailRecovery: vi.fn(),
}));
vi.mock("../workers/digest-schedule-recovery", () => ({
  scheduleDigestScheduleExhaustionRecovery: vi.fn(),
}));
vi.mock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
vi.mock("../workers/primary-domain", () => ({ primaryDomainRedirect: vi.fn(() => null) }));
vi.mock("../workers/security-headers", () => ({
  withSecurityHeaders: vi.fn((response: Response) => response),
}));

// ---------------------------------------------------------------------------
// Fixtures: real sqlite D1 (migrations 0008 + 0009 define discovery_cache_entry)
// ---------------------------------------------------------------------------

// Real "now" at test start: buildPublicSitemapFile reads the live clock, so
// seeded rows must be relative to it (never a fixed past date, which the real
// clock could already have passed — or be in the future of).
const NOW = new Date();
const HOUR_MS = 60 * 60 * 1000;

/** Loose env overrides: accepts test doubles (sqlite D1, partial bindings). */
type EnvOverrides = { [K in keyof AppEnv]?: AppEnv[K] | unknown };

function createEnv(overrides: EnvOverrides = {}): AppEnv {
  return {
    SEARCH_ROLLOUT_MODE: "shadow",
    BROWSERLESS_TOKEN: "test-browserless-token",
    ...overrides,
  } as AppEnv;
}

function createCacheDb() {
  const helper = createSqliteD1();
  applyMigration(helper.sqlite, "migrations/0008_commercial_ad_ingestion_replacement.sql");
  applyMigration(helper.sqlite, "migrations/0009_discovery_query_leases.sql");
  return helper;
}

function seedCacheEntry(
  sqlite: DatabaseSync,
  input: {
    cacheKey: string;
    provider: string;
    routeContext: string;
    country: string;
    cursor?: string | null;
    payload: unknown;
    fetchedAt: string;
  },
) {
  sqlite
    .prepare(
      `
        INSERT INTO discovery_cache_entry (
          cache_key, provider, route_context, query_fingerprint, country, cursor,
          payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.cacheKey,
      input.provider,
      input.routeContext,
      "test-fingerprint",
      input.country,
      input.cursor ?? null,
      JSON.stringify(input.payload),
      input.fetchedAt,
      new Date(Date.parse(input.fetchedAt) + HOUR_MS).toISOString(),
      null,
      input.fetchedAt,
      input.fetchedAt,
    );
}

function ad(metaAdId: string, landingPageUrl: string | null): Record<string, unknown> {
  return {
    metaAdId,
    advertiser: "Brand Page",
    body: "ad body",
    previewHeadline: "headline",
    previewSubhead: "",
    hook: "",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "en",
    destinationType: "website",
    landingPageUrl,
    adSnapshotUrl: null,
    countries: [],
    platforms: ["facebook"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
  };
}

function payload(ads: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "meta_library_browser",
    provider: "meta_library_browser",
    ads,
    nextCursor: null,
    ...extra,
  };
}

/** The key the /search execution path (searchAdsViaSourceResolver) writes in legacy/shadow mode. */
function legacyExecutionCacheKey(provider: string, domain: string, country: string): string {
  const website = normalizeCompetitorWebsiteInput(domain);
  const parsed = parseSearchParams(new URLSearchParams(), { country });
  const fallback = applyWebsiteSearchFallback(parsed, website);
  const query = normalizeSavedQuery(fallback.mode, fallback.filters);
  return buildDiscoveryCacheKey({
    provider,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || ALL_COUNTRIES_VALUE,
  });
}

/** The key the /search execution path writes for a domain query in v2 mode. */
function v2ExecutionCacheKey(provider: string, domain: string, country: string): string {
  const intent = parseSearchInputFromWebsiteField(domain);
  const parsed = parseSearchParams(new URLSearchParams(), { country });
  const v2Query = buildSearchV2SavedQuery(intent, "exact", parsed.filters);
  return buildSearchV2CacheKey({
    provider,
    intent,
    scope: "exact",
    country: v2Query.filters.country || ALL_COUNTRIES_VALUE,
  });
}

function seededNykaaEnv(overrides: Partial<AppEnv> = {}) {
  const helper = createCacheDb();
  const provider = "meta_library_browser";
  seedCacheEntry(helper.sqlite, {
    cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
    provider,
    routeContext: "public_search",
    country: "all",
    payload: payload([
      ad("ad-1", "https://www.nykaa.com/"),
      ad("ad-2", "https://nykaa.com/offers"),
    ]),
    fetchedAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
  });
  return { helper, env: createEnv({ DB: helper.db, ...overrides }) };
}

// ---------------------------------------------------------------------------
// Inclusion + exact-key parity
// ---------------------------------------------------------------------------

describe("dynamic brand sitemap: inclusion and exact-key parity", () => {
  it("includes a fresh legacy-key domain in shadow mode (the live /ads/nykaa.com shape)", async () => {
    const { helper, env } = seededNykaaEnv();
    try {
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toEqual(["nykaa.com"]);

      const file = await buildPublicSitemapFile(env);
      expect(file.body).toContain("https://0509.io/ads/nykaa.com");
      expect(file.body).toContain("https://0509.io/help");
      expect(file.body).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    } finally {
      helper.close();
    }
  });

  it("proves exact loader-key parity across shadow, legacy, and v2 modes", async () => {
    const provider = "meta_library_browser";
    const legacyKey = legacyExecutionCacheKey(provider, "nykaa.com", "all");
    const v2Key = v2ExecutionCacheKey(provider, "nykaa.com", "all");

    for (const mode of ["shadow", "legacy"] as const) {
      const env = createEnv({ SEARCH_ROLLOUT_MODE: mode });
      expect(deriveBrandPageLoaderCacheKey(env, provider, "nykaa.com", "all")).toBe(legacyKey);
      expect(deriveBrandPageLoaderCacheKey(env, provider, "nykaa.com", "all")).not.toBe(v2Key);
    }

    const v2Env = createEnv({ SEARCH_ROLLOUT_MODE: "v2" });
    expect(deriveBrandPageLoaderCacheKey(v2Env, provider, "nykaa.com", "all")).toBe(v2Key);
    expect(deriveBrandPageLoaderCacheKey(v2Env, provider, "nykaa.com", "all")).not.toBe(legacyKey);
  });

  it("serves the legacy key in shadow mode (checked-in rollout mode) and ignores v2 rows", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    const now = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      // nykaa.com only exists under the legacy key → included in shadow.
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: now,
      });
      // zomato.com only exists under the v2 shadow-comparison key → NOT included.
      seedCacheEntry(helper.sqlite, {
        cacheKey: v2ExecutionCacheKey(provider, "zomato.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-2", "https://zomato.com/")]),
        fetchedAt: now,
      });

      const env = createEnv({ DB: helper.db, SEARCH_ROLLOUT_MODE: "shadow" });
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toEqual(["nykaa.com"]);
    } finally {
      helper.close();
    }
  });

  it("reads the v2 domain key in v2 mode and ignores legacy fingerprint rows", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    const now = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      seedCacheEntry(helper.sqlite, {
        cacheKey: v2ExecutionCacheKey(provider, "swiggy.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-1", "https://swiggy.com/")]),
        fetchedAt: now,
      });
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "zomato.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-2", "https://zomato.com/")]),
        fetchedAt: now,
      });

      const env = createEnv({ DB: helper.db, SEARCH_ROLLOUT_MODE: "v2" });
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toEqual(["swiggy.com"]);
    } finally {
      helper.close();
    }
  });

  it("accepts the United States country fallback and rejects country-only rows", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    const now = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      // myntra.com exists only for "United States" — the loader's second
      // crawler-visible fallback → included.
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "myntra.com", "United States"),
        provider,
        routeContext: "public_search",
        country: "United States",
        payload: payload([ad("ad-1", "https://myntra.com/")]),
        fetchedAt: now,
      });
      // meesho.com exists only for "India" — no crawler-visible fallback key → excluded.
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "meesho.com", "India"),
        provider,
        routeContext: "public_search",
        country: "India",
        payload: payload([ad("ad-2", "https://meesho.com/")]),
        fetchedAt: now,
      });

      const env = createEnv({ DB: helper.db });
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toEqual(["myntra.com"]);
    } finally {
      helper.close();
    }
  });

  it("works for the meta_api provider too", async () => {
    const helper = createCacheDb();
    const provider = "meta_api";
    const now = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: {
          source: "meta_api",
          provider,
          ads: [{ ...ad("ad-1", "https://nykaa.com/"), source: "meta_api" }],
          nextCursor: null,
        },
        fetchedAt: now,
      });
      const env = createEnv({
        DB: helper.db,
        BROWSERLESS_TOKEN: "",
        META_AD_LIBRARY_TOKEN: "test-token",
        ALLOW_PLATFORM_META_API_FALLBACK: "1",
      });
      expect(resolveCommercialDiscoveryProvider(env)).toBe("meta_api");
      expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual(["nykaa.com"]);
    } finally {
      helper.close();
    }
  });

  it("deduplicates candidates across rows and returns deterministic sorted order", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    const nowIso = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      // nykaa.com appears in three rows (two countries, one duplicate ad) and
      // zomato.com in one; input order is deliberately non-sorted.
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "United States"),
        provider,
        routeContext: "public_search",
        country: "United States",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: nowIso,
      });
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-2", "https://www.nykaa.com/")]),
        fetchedAt: nowIso,
      });
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "zomato.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-3", "https://zomato.com/")]),
        fetchedAt: nowIso,
      });

      const env = createEnv({ DB: helper.db });
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toEqual(["nykaa.com", "zomato.com"]);
    } finally {
      helper.close();
    }
  });

  it("bounds the D1 scan: rows beyond BRAND_SITEMAP_MAX_ROWS are never considered", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    try {
      // Seed MAX_ROWS + 1 fresh rows; the oldest (brand1000.com) is past the LIMIT.
      for (let i = 0; i <= BRAND_SITEMAP_MAX_ROWS; i += 1) {
        const domain = `brand${i}.com`;
        seedCacheEntry(helper.sqlite, {
          cacheKey: legacyExecutionCacheKey(provider, domain, "all"),
          provider,
          routeContext: "public_search",
          country: "all",
          payload: payload([ad(`ad-${i}`, `https://${domain}/`)]),
          fetchedAt: new Date(NOW.getTime() - i * 60_000).toISOString(),
        });
      }

      const env = createEnv({ DB: helper.db });
      const domains = await loadIndexableBrandPageDomains(env, NOW);
      expect(domains).toContain("brand0.com");
      expect(domains).toContain("brand999.com");
      expect(domains).not.toContain("brand1000.com");
      expect(domains).toHaveLength(BRAND_SITEMAP_MAX_ROWS);
    } finally {
      helper.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

describe("dynamic brand sitemap: exclusions", () => {
  async function domainsForRows(
    rows: Array<
      Partial<Parameters<typeof seedCacheEntry>[1]> &
        Pick<Parameters<typeof seedCacheEntry>[1], "cacheKey" | "payload">
    >,
    envOverrides: Partial<AppEnv> = {},
  ) {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    const fresh = new Date(NOW.getTime() - 3 * HOUR_MS).toISOString();
    try {
      for (const row of rows) {
        seedCacheEntry(helper.sqlite, {
          provider,
          routeContext: "public_search",
          country: "all",
          fetchedAt: fresh,
          ...row,
        });
      }
      return await loadIndexableBrandPageDomains(createEnv({ DB: helper.db, ...envOverrides }), NOW);
    } finally {
      helper.close();
    }
  }

  it("excludes stale rows older than BRAND_PAGE_FRESH_FOR_INDEXING_MS", async () => {
    const provider = "meta_library_browser";
    const stale = new Date(
      NOW.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS - 60 * 60 * 1000,
    ).toISOString();
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: stale,
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes future fetched_at rows", async () => {
    const provider = "meta_library_browser";
    const future = new Date(NOW.getTime() + 2 * HOUR_MS).toISOString();
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: future,
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes unparseable payload JSON", async () => {
    const provider = "meta_library_browser";
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: "{not-json",
        fetchedAt: new Date(NOW.getTime() - HOUR_MS).toISOString(),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes zero-ad rows", async () => {
    const provider = "meta_library_browser";
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([]),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes rows whose only ads are demo-sourced", async () => {
    const provider = "meta_library_browser";
    const demoAd = { ...ad("ad-1", "https://nykaa.com/"), source: "demo" };
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([demoAd]),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes demo payload sources and demo payload providers", async () => {
    const provider = "meta_library_browser";
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([ad("ad-1", "https://nykaa.com/")], { source: "demo" }),
      },
      {
        cacheKey: legacyExecutionCacheKey(provider, "zomato.com", "all"),
        payload: payload([ad("ad-2", "https://zomato.com/")], { provider: "demo" }),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes watchlist_scan and scheduled_warmup route contexts", async () => {
    const provider = "meta_library_browser";
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        routeContext: "watchlist_scan",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
      },
      {
        cacheKey: legacyExecutionCacheKey(provider, "zomato.com", "all"),
        routeContext: "scheduled_warmup",
        payload: payload([ad("ad-2", "https://zomato.com/")]),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes cursor/page-2 keys", async () => {
    const provider = "meta_library_browser";
    const domains = await domainsForRows([
      {
        cacheKey: buildDiscoveryCacheKey({
          provider,
          fingerprint: fingerprintSavedQuery(
            normalizeSavedQuery(
              "advertiser",
              { query: "nykaa", country: "all", platform: "all", creativeType: "all", status: "all", firstSeenFrom: "", lastSeenFrom: "" },
            ),
          ),
          country: "all",
          cursor: "page-2",
        }),
        cursor: "page-2",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("never leaks customer-token-scoped keys into the sitemap", async () => {
    const provider = "meta_library_browser";
    const baseKey = legacyExecutionCacheKey(provider, "nykaa.com", "all");
    const domains = await domainsForRows([
      {
        // Shape produced by scopeDiscoveryCacheKeyForCustomerToken.
        cacheKey: `${baseKey}:customer_meta:0123456789abcdef`,
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
      },
    ]);
    expect(domains).toEqual([]);

    // The sitemap body must not contain the domain either.
    const helper = createCacheDb();
    try {
      seedCacheEntry(helper.sqlite, {
        cacheKey: `${baseKey}:customer_meta:0123456789abcdef`,
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: new Date(NOW.getTime() - HOUR_MS).toISOString(),
      });
      const env = createEnv({ DB: helper.db });
      const file = await buildPublicSitemapFile(env);
      expect(file.body).not.toContain("/ads/nykaa.com");
    } finally {
      helper.close();
    }
  });

  it("excludes broader-scope v2 keys", async () => {
    const provider = "meta_library_browser";
    const intent = parseSearchInputFromWebsiteField("swiggy.com");
    const broaderKey = buildSearchV2CacheKey({
      provider,
      intent,
      scope: "broader",
      country: "all",
    });
    const domains = await domainsForRows(
      [
        {
          cacheKey: broaderKey,
          payload: payload([ad("ad-1", "https://swiggy.com/")]),
        },
      ],
      { SEARCH_ROLLOUT_MODE: "v2" },
    );
    expect(domains).toEqual([]);
  });

  it("does not infer indexability from an unrelated keyword row containing a destination URL", async () => {
    const provider = "meta_library_browser";
    const keywordKey = buildDiscoveryCacheKey({
      provider,
      fingerprint: "text:beauty products",
      country: "all",
    });
    const domains = await domainsForRows([
      {
        cacheKey: keywordKey,
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
      },
    ]);
    expect(domains).toEqual([]);
  });

  it("excludes malformed candidate domains (single-label, IP, over-length)", async () => {
    const provider = "meta_library_browser";
    const overLengthHost = `${"a".repeat(90)}.com`;
    const domains = await domainsForRows([
      {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        payload: payload([
          ad("ad-1", "https://localhost/"),
          ad("ad-2", "https://192.168.0.1/"),
          ad("ad-3", `https://${overLengthHost}/`),
          ad("ad-4", "not-a-url"),
          // One valid destination keeps the row usable; only nykaa.com may pass.
          ad("ad-5", "https://nykaa.com/"),
        ]),
      },
    ]);
    expect(domains).toEqual(["nykaa.com"]);
  });
});

// ---------------------------------------------------------------------------
// Static fallback
// ---------------------------------------------------------------------------

describe("dynamic brand sitemap: static fallback", () => {
  const staticBody = publicSeoFileForPathname("/sitemap.xml")?.body;

  it("returns the unchanged static sitemap without a DB binding", async () => {
    const env = createEnv({});
    expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual([]);
    const file = await buildPublicSitemapFile(env);
    expect(file.body).toBe(staticBody);
    expect(file.body).not.toContain("/ads/");
  });

  it("returns the unchanged static sitemap for a demo-only provider", async () => {
    const helper = createCacheDb();
    const provider = "meta_library_browser";
    try {
      seedCacheEntry(helper.sqlite, {
        cacheKey: legacyExecutionCacheKey(provider, "nykaa.com", "all"),
        provider,
        routeContext: "public_search",
        country: "all",
        payload: payload([ad("ad-1", "https://nykaa.com/")]),
        fetchedAt: new Date(NOW.getTime() - HOUR_MS).toISOString(),
      });
      const env = createEnv({ DB: helper.db, BROWSERLESS_TOKEN: "" });
      expect(resolveCommercialDiscoveryProvider(env)).toBe("demo");
      expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual([]);
      const file = await buildPublicSitemapFile(env);
      expect(file.body).toBe(staticBody);
      expect(file.body).not.toContain("/ads/nykaa.com");
    } finally {
      helper.close();
    }
  });

  it("returns the unchanged static sitemap under the emergency noindex flag", async () => {
    const { helper, env } = seededNykaaEnv({ PUBLIC_BRAND_PAGES_INDEXABLE: "0" });
    try {
      expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual([]);
      const file = await buildPublicSitemapFile(env);
      expect(file.body).toBe(staticBody);
      expect(file.body).not.toContain("/ads/nykaa.com");
    } finally {
      helper.close();
    }
  });

  it("returns the unchanged static sitemap when the cache table is missing", async () => {
    const helper = createSqliteD1();
    try {
      const env = createEnv({ DB: helper.db });
      expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual([]);
      const file = await buildPublicSitemapFile(env);
      expect(file.body).toBe(staticBody);
      expect(file.body).not.toContain("/ads/");
    } finally {
      helper.close();
    }
  });

  it("returns the unchanged static sitemap when the cache table is dropped mid-flight", async () => {
    const { helper, env } = seededNykaaEnv();
    try {
      helper.sqlite.exec("DROP TABLE discovery_cache_entry");
      expect(await loadIndexableBrandPageDomains(env, NOW)).toEqual([]);
      const file = await buildPublicSitemapFile(env);
      expect(file.body).toBe(staticBody);
    } finally {
      helper.close();
    }
  });
});

// ---------------------------------------------------------------------------
// No provider calls
// ---------------------------------------------------------------------------

describe("dynamic brand sitemap: zero provider calls", () => {
  it("never performs network provider calls while building the sitemap", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const { helper, env } = seededNykaaEnv();
      try {
        const file = await buildPublicSitemapFile(env);
        expect(file.body).toContain("/ads/nykaa.com");
      } finally {
        helper.close();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Worker GET/HEAD response path
// ---------------------------------------------------------------------------

describe("Worker GET/HEAD response path for /sitemap.xml", () => {
  it("GET /sitemap.xml serves static + dynamic entries with the XML content type", async () => {
    const { helper, env } = seededNykaaEnv();
    try {
      const { default: worker } = await import("../workers/app");
      const response = await worker.fetch(
        new Request("https://0509.io/sitemap.xml") as never,
        env as never,
        { waitUntil: () => undefined } as never,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/xml");
      expect(response.headers.get("cache-control")).toContain("public, max-age=3600");
      const body = await response.text();
      expect(body).toContain("https://0509.io/help");
      expect(body).toContain("https://0509.io/ads/nykaa.com");
    } finally {
      helper.close();
    }
  });

  it("HEAD /sitemap.xml returns headers with an empty body", async () => {
    const { helper, env } = seededNykaaEnv();
    try {
      const { default: worker } = await import("../workers/app");
      const response = await worker.fetch(
        new Request("https://0509.io/sitemap.xml", { method: "HEAD" }) as never,
        env as never,
        { waitUntil: () => undefined } as never,
      );

      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      expect(response.headers.get("content-type")).toContain("application/xml");
    } finally {
      helper.close();
    }
  });

  it("GET /sitemap.xml without a DB serves the unchanged static sitemap with 200", async () => {
    const { default: worker } = await import("../workers/app");
    const env = createEnv({});
    const response = await worker.fetch(
      new Request("https://0509.io/sitemap.xml") as never,
      env as never,
      { waitUntil: () => undefined } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.text();
    expect(body).toContain("https://0509.io/help");
    expect(body).not.toContain("/ads/");
  });

  it("other public SEO files still serve through the static path", async () => {
    const { default: worker } = await import("../workers/app");
    const response = await worker.fetch(
      new Request("https://0509.io/robots.txt") as never,
      createEnv({}) as never,
      { waitUntil: () => undefined } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("Disallow: /app/");
  });
});
