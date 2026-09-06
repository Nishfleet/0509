/**
 * Dynamic brand-page sitemap tests (app/lib/brand-page-sitemap.server.ts).
 *
 * The sitemap may list /ads/:domain only when the cache-only brand-page
 * loader would render that page indexable RIGHT NOW under the current
 * environment. These tests use the real module graph against a real SQLite
 * D1 (the same migrations that ship) so the bounded SELECT, the payload
 * gates, and the exact loader-key confirmation are all exercised end to end.
 * The only stand-ins are a fake BROWSER binding (which must never be called)
 * and, for the Worker fetch path, the usual worker-side module mocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadBrandPageCacheSnapshot } from "~/lib/brand-page.server";
import {
  loadIndexableBrandPageDomains,
  publicSitemapFile,
  SITEMAP_CRAWLER_COUNTRIES,
  SITEMAP_DISCOVERY_ROW_LIMIT,
  SITEMAP_MAX_BRAND_DOMAINS,
} from "~/lib/brand-page-sitemap.server";
import { applyWebsiteSearchFallback, normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER = "meta_library_browser";

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

function applyDiscoveryMigrations(harness: ReturnType<typeof createSqliteD1>) {
  applyMigration(harness.sqlite, "migrations/0008_commercial_ad_ingestion_replacement.sql");
  applyMigration(harness.sqlite, "migrations/0009_discovery_query_leases.sql");
}

function ad(overrides: Record<string, unknown> = {}) {
  return {
    metaAdId: "meta-1",
    advertiser: "Nykaa",
    body: "body",
    previewHeadline: "headline",
    previewSubhead: "subhead",
    hook: "hook",
    offer: "offer",
    cta: "cta",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nykaa.com/offer",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function payload(ads: unknown[]) {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
  };
}

function v2Key(domain: string, country = "all", scope: "exact" | "broader" = "exact", cursor = "page-1") {
  const intent = parseSearchInputFromWebsiteField(domain);
  return buildSearchV2CacheKey({ provider: PROVIDER, intent, scope, country, cursor });
}

function legacyKey(domain: string, country = "all") {
  const website = normalizeCompetitorWebsiteInput(domain);
  const parsed = applyWebsiteSearchFallback(
    parseSearchParams(new URLSearchParams(), { country }),
    website,
  );
  const query = normalizeSavedQuery(parsed.mode, parsed.filters);
  return buildDiscoveryCacheKey({
    provider: PROVIDER,
    fingerprint: fingerprintSavedQuery(query),
    country: query.filters.country || "all",
  });
}

function seedEntry(
  harness: ReturnType<typeof createSqliteD1>,
  input: {
    cacheKey: string;
    provider?: string;
    routeContext?: string;
    cursor?: string | null;
    country?: string;
    payload?: unknown;
    /** Insert payload_json verbatim (for malformed JSON cases). */
    payloadJson?: string;
    fetchedAt?: string;
  },
) {
  const fetchedAt = input.fetchedAt ?? isoAgo(2 * 60 * 60 * 1000);
  harness.sqlite
    .prepare(
      `INSERT INTO discovery_cache_entry (
        cache_key, provider, route_context, query_fingerprint, country, cursor,
        payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.cacheKey,
      input.provider ?? PROVIDER,
      input.routeContext ?? "public_search",
      "fp-test",
      input.country ?? "all",
      input.cursor ?? null,
      input.payloadJson ?? JSON.stringify(input.payload ?? payload([ad()])),
      fetchedAt,
      new Date(Date.now() + 60_000).toISOString(),
      null,
      fetchedAt,
      fetchedAt,
    );
}

const browserFetch = vi.fn(() =>
  Promise.reject(new Error("Browser Rendering must never be invoked by the sitemap")),
);

/**
 * Env whose provider resolves to meta_library_browser (BROWSER binding) with
 * the given rollout mode; optionally wraps the D1 prepare path to record
 * exact-key point reads (`WHERE cache_key = ?` bindings).
 */
function makeEnv(
  harness: ReturnType<typeof createSqliteD1>,
  overrides: Record<string, unknown> = {},
  keyReads?: string[],
) {
  const db = keyReads
    ? {
        ...harness.db,
        prepare(sql: string) {
          const statement = harness.db.prepare(sql);
          return {
            bind(...bindings: unknown[]) {
              if (sql.includes("WHERE cache_key = ?")) {
                keyReads.push(String(bindings[0] ?? ""));
              }
              return statement.bind(...bindings);
            },
          };
        },
      }
    : harness.db;
  return {
    DB: db,
    BROWSER: { fetch: browserFetch },
    SEARCH_ROLLOUT_MODE: "v2",
    ...overrides,
  } as never;
}

let fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

beforeEach(() => {
  fixtures = [];
  browserFetch.mockClear();
  // Fresh module registry so the Worker fetch tests below can apply their
  // doMock set before importing ../workers/app.
  vi.resetModules();
});

afterEach(() => {
  for (const fixture of fixtures) {
    fixture.close();
  }
  fixtures = [];
});

function createHarness() {
  const harness = createSqliteD1();
  fixtures.push(harness);
  applyDiscoveryMigrations(harness);
  return harness;
}

describe("loadIndexableBrandPageDomains", () => {
  it("includes a domain whose exact loader key exists and is fresh (v2 mode, crawler fallback)", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual(["nykaa.com"]);
  });

  it("confirms through the exact cache key the brand-page loader would read", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });
    seedEntry(harness, { cacheKey: v2Key("myntra.com", "United States") });

    const loaderReads: string[] = [];
    const env = makeEnv(harness, {}, loaderReads);
    const snapshot = await loadBrandPageCacheSnapshot(env, {
      domain: "nykaa.com",
      visitorCountry: "all",
      now,
    });
    expect(snapshot?.freshForIndexing).toBe(true);

    const sitemapReads: string[] = [];
    const sitemapEnv = makeEnv(harness, {}, sitemapReads);
    const domains = await loadIndexableBrandPageDomains(sitemapEnv, now);

    expect(domains).toEqual(["myntra.com", "nykaa.com"]);
    // The sitemap must read the SAME keys the loader would, in the loader's
    // country order ("all", then "United States"), short-circuiting at the
    // first hit exactly like the loader:
    //  - nykaa.com resolves on "all", so that key is read (same key the
    //    loader read first);
    //  - myntra.com misses "all" and hits "United States", so both of its
    //    fallback keys are read.
    expect(sitemapReads).toContain(v2Key("nykaa.com"));
    expect(sitemapReads).toContain(loaderReads[0] ?? "");
    expect(sitemapReads).toContain(v2Key("myntra.com"));
    expect(sitemapReads).toContain(v2Key("myntra.com", "United States"));
  });

  it("serves the LEGACY key in shadow mode (checked-in rollout mode), never the search-v2 key", async () => {
    const harness = createHarness();
    const now = new Date();
    // The serving loader reads the legacy fingerprint key under shadow mode.
    seedEntry(harness, { cacheKey: legacyKey("nykaa.com") });
    // A v2-only domain has no legacy row, so the loader would render its
    // honest shell — it must NOT be sitemapped.
    seedEntry(harness, { cacheKey: v2Key("myntra.com") });

    const domains = await loadIndexableBrandPageDomains(
      makeEnv(harness, { SEARCH_ROLLOUT_MODE: "shadow" }),
      now,
    );

    expect(domains).toEqual(["nykaa.com"]);
  });

  it("serves the LEGACY key in legacy mode and the v2 key only in v2 mode", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: legacyKey("nykaa.com") });
    seedEntry(harness, { cacheKey: v2Key("zara.com") });

    const legacyDomains = await loadIndexableBrandPageDomains(
      makeEnv(harness, { SEARCH_ROLLOUT_MODE: "legacy" }),
      now,
    );
    expect(legacyDomains).toEqual(["nykaa.com"]);

    const v2Domains = await loadIndexableBrandPageDomains(
      makeEnv(harness, { SEARCH_ROLLOUT_MODE: "v2" }),
      now,
    );
    expect(v2Domains).toEqual(["zara.com"]);
  });

  it("includes a domain discovered from cached ad destinations when its own loader key exists", async () => {
    const harness = createHarness();
    const now = new Date();
    // A keyword row contains the brand's landing page, but indexability is
    // only proven by the domain's OWN loader-key row — which does exist here.
    seedEntry(harness, {
      cacheKey: `${PROVIDER}:fp-keyword-row:all:page-1`,
      payload: payload([ad({ landingPageUrl: "https://www.nykaa.com/offer" })]),
    });
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual(["nykaa.com"]);
  });

  it("never infers indexability from an unrelated keyword row whose loader key is absent", async () => {
    const harness = createHarness();
    const now = new Date();
    // The row advertises nykaa.com in a destination but no nykaa.com page
    // key exists — the loader would render the shell, so no sitemap entry.
    seedEntry(harness, {
      cacheKey: `${PROVIDER}:fp-keyword-row:all:page-1`,
      payload: payload([ad({ landingPageUrl: "https://www.nykaa.com/offer" })]),
    });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual([]);
  });

  it("never leaks customer-token-scoped cache keys into the sitemap", async () => {
    const harness = createHarness();
    const now = new Date();
    // A customer-owned Meta API search wrote a token-scoped key; the loader
    // derives the unscoped key, so the page would not render for crawlers.
    seedEntry(harness, {
      cacheKey: `${legacyKey("nykaa.com")}:customer_meta:0123456789abcdef`,
      payload: payload([ad()]),
    });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual([]);
  });

  it("excludes demo provider, demo payloads, zero ads, and demo-only ads", async () => {
    const harness = createHarness();
    const now = new Date();
    const env = makeEnv(harness);

    // Demo provider (no BROWSER binding): nothing is read, nothing listed.
    expect(await loadIndexableBrandPageDomains({ DB: harness.db } as never, now)).toEqual([]);

    seedEntry(harness, {
      cacheKey: v2Key("demo.com"),
      payload: { ads: [ad()], nextCursor: null, source: "demo", provider: "demo", cacheStatus: "hit" },
    });
    seedEntry(harness, { cacheKey: v2Key("empty.com"), payload: payload([]) });
    seedEntry(harness, {
      cacheKey: v2Key("demo-ads.com"),
      payload: payload([ad({ source: "demo" })]),
    });

    expect(await loadIndexableBrandPageDomains(env, now)).toEqual([]);
  });

  it("excludes stale, future, malformed-JSON, wrong-route, wrong-provider, and cursor-page rows", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("stale.com"), fetchedAt: isoAgo(8 * DAY_MS) });
    seedEntry(harness, { cacheKey: v2Key("future.com"), fetchedAt: isoAgo(-60 * 60 * 1000) });
    seedEntry(harness, { cacheKey: v2Key("broken.com"), payloadJson: "{not-json" });
    seedEntry(harness, {
      cacheKey: v2Key("scan.com"),
      routeContext: "watchlist_scan",
    });
    seedEntry(harness, {
      cacheKey: v2Key("wrong-provider.com").replace(PROVIDER, "meta_api"),
      provider: "meta_api",
      payload: payload([ad()]),
    });
    seedEntry(harness, {
      cacheKey: `${v2Key("page-two.com")}:after:2`.replace(":page-1", ":page-2"),
      cursor: "after:2",
    });
    seedEntry(harness, {
      cacheKey: v2Key("page-two-key.com"),
      cursor: "after:2",
    });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual([]);
  });

  it("rejects broader-scope search-v2 keys and malformed candidate domains", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("broader.com", "all", "broader") });
    seedEntry(harness, {
      cacheKey: `${PROVIDER}:fp:all:page-1`,
      payload: payload([ad({ landingPageUrl: "https://notadomain" })]),
    });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual([]);
  });

  it("deduplicates domains across rows and countries and returns deterministic sorted order", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("zara.com") });
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });
    seedEntry(harness, { cacheKey: v2Key("nykaa.com", "United States") });
    seedEntry(harness, { cacheKey: v2Key("amazon.in") });

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains).toEqual(["amazon.in", "nykaa.com", "zara.com"]);
  });

  it("respects the emergency PUBLIC_BRAND_PAGES_INDEXABLE='0' brake", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    const domains = await loadIndexableBrandPageDomains(
      makeEnv(harness, { PUBLIC_BRAND_PAGES_INDEXABLE: "0" }),
      now,
    );

    expect(domains).toEqual([]);
  });

  it("stays indexable when the flag is explicitly '1'", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    const domains = await loadIndexableBrandPageDomains(
      makeEnv(harness, { PUBLIC_BRAND_PAGES_INDEXABLE: "1" }),
      now,
    );

    expect(domains).toEqual(["nykaa.com"]);
  });

  it("caps the enumeration and confirmation to bounded sizes", async () => {
    const harness = createHarness();
    const now = new Date();
    // More fresh rows than the enumeration limit, all with their own v2 keys.
    for (let index = 0; index < SITEMAP_DISCOVERY_ROW_LIMIT + 50; index += 1) {
      const domain = `d${String(index).padStart(3, "0")}.com`;
      seedEntry(harness, {
        cacheKey: v2Key(domain),
        fetchedAt: isoAgo(index * 60_000),
      });
    }

    const domains = await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(domains.length).toBeLessThanOrEqual(SITEMAP_MAX_BRAND_DOMAINS);
    expect([...domains].sort()).toEqual(domains);
  });

  it("never invokes the browser binding or any live provider work", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    await loadIndexableBrandPageDomains(makeEnv(harness), now);

    expect(browserFetch).not.toHaveBeenCalled();
  });

  it("returns [] when D1 is missing or the cache table/query fails", async () => {
    const now = new Date();
    expect(await loadIndexableBrandPageDomains({} as never, now)).toEqual([]);

    // Missing table: real D1 shape, no migration applied. (afterEach closes
    // this harness — no explicit close here to avoid a double close.)
    const bare = createSqliteD1();
    fixtures.push(bare);
    expect(await loadIndexableBrandPageDomains(makeEnv(bare), now)).toEqual([]);

    // Query error: DB binding that throws on any statement.
    const brokenDb = {
      prepare() {
        throw new Error("simulated D1 failure");
      },
    };
    expect(await loadIndexableBrandPageDomains({ DB: brokenDb } as never, now)).toEqual([]);
  });

  it("uses the loader's crawler-visible country fallback (all, then United States)", () => {
    expect(SITEMAP_CRAWLER_COUNTRIES).toEqual(["all", "United States"]);
  });
});

describe("publicSitemapFile", () => {
  it("keeps every static URL and appends canonical /ads/<domain> entries once each", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });
    seedEntry(harness, { cacheKey: v2Key("zara.com") });
    seedEntry(harness, { cacheKey: v2Key("nykaa.com", "United States") });

    const file = await publicSitemapFile(makeEnv(harness), now);

    expect(file?.contentType).toContain("application/xml");
    expect(file?.cacheControl).toBe("public, max-age=3600");
    const body = file?.body ?? "";
    for (const url of [
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
    ]) {
      expect(body).toContain(`<url><loc>${url}</loc></url>`);
    }
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/ads/zara.com</loc></url>");
    expect(body.match(/https:\/\/0509\.io\/ads\/nykaa\.com/g)).toHaveLength(1);
    expect(body.match(/<url><loc>/g)).toHaveLength(13 + 2);
  });

  it("returns the unchanged static sitemap when no domain is indexable", async () => {
    const harness = createHarness();
    const now = new Date();
    seedEntry(harness, {
      cacheKey: `${PROVIDER}:fp-keyword-row:all:page-1`,
      payload: payload([ad({ landingPageUrl: "https://www.nykaa.com/offer" })]),
    });

    const file = await publicSitemapFile(makeEnv(harness), now);

    expect(file?.body).not.toContain("/ads/");
    expect(file?.body).toContain("<url><loc>https://0509.io/terms</loc></url>");
  });

  it("falls back to the static sitemap on missing DB, missing table, and query errors", async () => {
    const now = new Date();
    const staticBody = (await import("~/lib/seo")).publicSeoFileForPathname("/sitemap.xml")?.body;

    const noDb = await publicSitemapFile({} as never, now);
    expect(noDb?.body).toBe(staticBody);
    expect(noDb?.body).not.toContain("/ads/");

    const bare = createSqliteD1();
    fixtures.push(bare);
    const missingTable = await publicSitemapFile(makeEnv(bare), now);
    expect(missingTable?.body).toBe(staticBody);

    const brokenDb = { prepare: () => Promise.reject(new Error("boom")) };
    const queryError = await publicSitemapFile({ DB: brokenDb } as never, now);
    expect(queryError?.body).toBe(staticBody);
  });
});

/**
 * Worker GET/HEAD response path for /sitemap.xml (workers/app.ts). Loads the
 * real worker with the usual scheduled-side module mocks (mirroring
 * tests/worker-scheduled-handler.test.ts) so the fetch branch runs against
 * the real seo + brand-page-sitemap module graph and a real SQLite D1.
 */
describe("Worker GET/HEAD /sitemap.xml", () => {
  const WORKER_MOCK_PATHS = [
    "../app/lib/monitoring.server",
    "../app/lib/cron-failure-alert.server",
    "../app/lib/monthly-recap.server",
    "../app/lib/scheduled-observation-health.server",
    "../app/lib/release-scheduled-observation.server",
    "../app/lib/monitoring-fanout.server",
    "../app/lib/presence-service.server",
    "../app/lib/retention.server",
    "../workers/delivery-recovery",
    "../workers/digest-schedule-recovery",
    "../workers/schedule",
    "../workers/primary-domain",
    "../workers/security-headers",
    "../workers/monitoring-workflow",
    "../app/lib/rate-limit.server",
  ];

  afterEach(() => {
    for (const path of WORKER_MOCK_PATHS) {
      vi.doUnmock(path);
    }
  });

  async function loadWorker() {
    vi.doMock("../app/lib/monitoring.server", () => ({
      flushDeferredInstantAlerts: vi.fn().mockResolvedValue({ groups: 0 }),
      runScheduledDiscoveryWarmup: vi.fn().mockResolvedValue({}),
      runScheduledMonitoring: vi
        .fn()
        .mockResolvedValue({ skippedForBudget: 0, dispatchFailures: 0 }),
      sendCustomerAtRiskAlert: vi.fn().mockResolvedValue({ sent: false }),
      sendWeeklyBusinessNumbers: vi.fn().mockResolvedValue({ sent: false }),
    }));
    vi.doMock("../app/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));
    vi.doMock("../app/lib/monthly-recap.server", () => ({
      sendMonthlyCustomerRecaps: vi.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
    }));
    vi.doMock("../app/lib/scheduled-observation-health.server", () => ({
      SCHEDULED_OBSERVATION_GAP_CHECK_CRON: "13 * * * *",
      sendScheduledObservationGapAlert: vi
        .fn()
        .mockResolvedValue({ sent: false, reason: "healthy", health: [] }),
    }));
    vi.doMock("../app/lib/release-scheduled-observation.server", () => ({
      observeScheduledTask: vi.fn(
        (_env: unknown, _ctx: unknown, _input: unknown, taskPromise: Promise<unknown>) =>
          taskPromise,
      ),
    }));
    vi.doMock("../app/lib/monitoring-fanout.server", () => ({
      reconcileOrchestratedWatchlistRuns: vi.fn().mockResolvedValue({
        redispatched: 0,
        recovered: 0,
        cancelled: 0,
        redispatchFailures: 0,
        firstScans: {},
      }),
      resolveMonitoringFanoutMode: vi.fn().mockReturnValue("fanout"),
      resolveMonitoringOrchestrationLeaseMs: vi.fn().mockReturnValue(60_000),
    }));
    vi.doMock("../app/lib/presence-service.server", () => ({
      runPresencePollingBatch: vi.fn().mockResolvedValue({ results: [] }),
    }));
    vi.doMock("../app/lib/retention.server", () => ({
      runRetentionSweep: vi.fn().mockResolvedValue({ deleted: {} }),
    }));
    vi.doMock("../workers/delivery-recovery", () => ({
      scheduleBillingLifecycleEmailRecovery: vi.fn(),
    }));
    vi.doMock("../workers/digest-schedule-recovery", () => ({
      scheduleDigestScheduleExhaustionRecovery: vi.fn(),
    }));
    vi.doMock("../workers/schedule", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../workers/schedule")>()),
      resolveScheduledTask: vi.fn(() => ({ kind: "monitoring" as const })),
    }));
    vi.doMock("../workers/primary-domain", () => ({
      primaryDomainRedirect: vi.fn().mockReturnValue(null),
    }));
    vi.doMock("../workers/security-headers", () => ({
      withSecurityHeaders: vi.fn((response: Response) => response),
    }));
    vi.doMock("../workers/monitoring-workflow", () => ({
      MonitoringWorkflow: class MonitoringWorkflow {},
    }));
    vi.doMock("../app/lib/rate-limit.server", () => ({
      enforceRequestRateLimit: vi.fn().mockResolvedValue(null),
    }));

    const worker = (await import("../workers/app")) as unknown as {
      default: {
        fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
      };
    };
    return worker.default;
  }

  it("GET serves the static 13 URLs plus indexable /ads entries with HTTP 200", async () => {
    const harness = createHarness();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });
    seedEntry(harness, { cacheKey: v2Key("zara.com") });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://0509.io/sitemap.xml"),
      makeEnv(harness),
      { waitUntil: vi.fn() } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.text();
    expect(body).toContain("<url><loc>https://0509.io/terms</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/ads/nykaa.com</loc></url>");
    expect(body).toContain("<url><loc>https://0509.io/ads/zara.com</loc></url>");
    expect(body.match(/<url><loc>/g)).toHaveLength(13 + 2);
  });

  it("HEAD returns HTTP 200 with the XML content type and an empty body", async () => {
    const harness = createHarness();
    seedEntry(harness, { cacheKey: v2Key("nykaa.com") });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://0509.io/sitemap.xml", { method: "HEAD" }),
      makeEnv(harness),
      { waitUntil: vi.fn() } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe("");
  });

  it("GET without D1 or provider bindings still serves the unchanged static sitemap with HTTP 200", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://0509.io/sitemap.xml"),
      {} as never,
      { waitUntil: vi.fn() } as never,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("<url><loc>https://0509.io/terms</loc></url>");
    expect(body).not.toContain("/ads/");
  });
});
