import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdsDomainRecentChange } from "~/lib/ads-domain-recent-changes.server";
import { summarizeDomainCaptureFailures } from "~/lib/offer-timeline.server";
import type { AdRecord } from "~/lib/types";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";

/**
 * Issue #2112 — public /ads/:domain "changed in the last 7 days" proof.
 *
 * Covers all three layers:
 *   1. loadAdsDomainRecentChanges — domain→watchlist matching, the last-7d
 *      window, and the safe projection (event type + change mark + capture
 *      date ONLY — no user data, no watchlist names, no owner identifiers).
 *   2. The route loader wiring — events load when a watchlist tracks the
 *      domain; an empty list (and no error) when none does; a read hiccup
 *      degrades to the hidden section instead of a 500.
 *   3. The render — events render when present; nothing renders when the
 *      list is empty.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function captureDateLabel(iso: string) {
  return CAPTURE_DATE_FORMATTER.format(new Date(iso));
}

// ---------------------------------------------------------------------------
// 1. Data layer — loadAdsDomainRecentChanges against a fake D1.
// ---------------------------------------------------------------------------

interface FakeQuery {
  sql: string;
  bindings: unknown[];
}

function fakeD1Env(tables: { watchlists?: unknown[]; events?: unknown[] }) {
  const queries: FakeQuery[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            queries.push({ sql, bindings });
            return {
              async all() {
                if (sql.includes("FROM watchlist")) {
                  return { results: tables.watchlists ?? [] };
                }
                if (sql.includes("FROM watch_event")) {
                  return { results: tables.events ?? [] };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
              },
            };
          },
        };
      },
    },
  };
  return { env, queries };
}

function watchlistRow(overrides: Partial<{ id: string; target_id: string }> = {}) {
  return {
    id: overrides.id ?? "wl-1",
    target_id: overrides.target_id ?? "https://nykaa.com",
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    watchlist_id: "wl-1",
    run_id: "run-1",
    event_type: "landing_page_offer_changed",
    status: "confirmed",
    importance_score: 75,
    ad_id: null,
    baseline_from_run_id: null,
    candidate_id: null,
    proof_capture_id: null,
    // The stored title/summary can embed the owner's watchlist name and other
    // account identifiers — they must NEVER reach the public projection.
    title: "Offer changed on Acme secret watch",
    summary: "Stored for owner user-12345's watchlist.",
    metadata_json: JSON.stringify({ from: "$68", to: "$52" }),
    confirmed_at: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    suppressed_at: null,
    invalidated_at: null,
    last_evaluated_at: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    created_at: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

describe("loadAdsDomainRecentChanges", () => {
  it("loads last-7d events for watchlists tracking the domain, projected to type + change mark + capture date only", async () => {
    const { env, queries } = fakeD1Env({
      watchlists: [
        watchlistRow({ id: "wl-1", target_id: "https://nykaa.com" }),
        watchlistRow({ id: "wl-2", target_id: "https://other-brand.com" }),
      ],
      events: [eventRow()],
    });
    const { loadAdsDomainRecentChanges } = await import(
      "~/lib/ads-domain-recent-changes.server"
    );
    const now = new Date("2026-09-09T12:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)

    const result = await loadAdsDomainRecentChanges(env as never, "nykaa.com", now);

    // The projection carries exactly event type + change mark + capture date.
    expect(result).toEqual([
      {
        eventType: "landing_page_offer_changed",
        changeMark: { from: "$68", to: "$52" },
        capturedAt: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
      },
    ]);
    expect(Object.keys(result[0]!).sort()).toEqual([
      "capturedAt",
      "changeMark",
      "eventType",
    ]);
    // No user data, no watchlist names, no owner identifiers — not even the
    // watchlist/run ids or the stored title/summary that embed them.
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "wl-1",
      "run-1",
      "user-12345",
      "Acme secret watch",
      "title",
      "summary",
      "watchlist",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // The event read is scoped to the matching watchlist only (wl-2 tracks
    // another domain) and to the last-7d window.
    const eventQuery = queries.find((q) => q.sql.includes("FROM watch_event"));
    expect(eventQuery).toBeDefined();
    expect(eventQuery!.bindings).toContain("wl-1");
    expect(eventQuery!.bindings).not.toContain("wl-2");
    expect(eventQuery!.bindings).toContain("2026-09-02T12:00:00.000Z"); // fixed-date: historical fixture (issue #3215 sweep)
    // The watchlist candidate read never selects the owner column.
    const watchlistQuery = queries.find((q) => q.sql.includes("FROM watchlist"));
    expect(watchlistQuery!.sql).not.toContain("user_id");
  });

  it("returns [] without touching watch_event when no watchlist tracks the domain", async () => {
    const { env, queries } = fakeD1Env({
      watchlists: [watchlistRow({ id: "wl-9", target_id: "https://other-brand.com" })],
      events: [eventRow()],
    });
    const { loadAdsDomainRecentChanges } = await import(
      "~/lib/ads-domain-recent-changes.server"
    );

    const result = await loadAdsDomainRecentChanges(env as never, "nykaa.com");

    expect(result).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("FROM watchlist");
  });

  it("matches the registrable domain behind a www host or a deeper target URL", async () => {
    const { env, queries } = fakeD1Env({
      watchlists: [
        watchlistRow({ id: "wl-www", target_id: "https://www.nykaa.com/sale" }),
      ],
      events: [],
    });
    const { loadAdsDomainRecentChanges } = await import(
      "~/lib/ads-domain-recent-changes.server"
    );

    const result = await loadAdsDomainRecentChanges(env as never, "nykaa.com");

    expect(result).toEqual([]);
    // The watch DID match the domain, so the event read ran scoped to it.
    const eventQuery = queries.find((q) => q.sql.includes("FROM watch_event"));
    expect(eventQuery).toBeDefined();
    expect(eventQuery!.bindings).toContain("wl-www");
  });

  it("never matches a query-only advertiser watchlist (no website URL) to a domain", async () => {
    const { env, queries } = fakeD1Env({
      watchlists: [watchlistRow({ id: "wl-q", target_id: "nykaa" })],
      events: [eventRow()],
    });
    const { loadAdsDomainRecentChanges } = await import(
      "~/lib/ads-domain-recent-changes.server"
    );

    const result = await loadAdsDomainRecentChanges(env as never, "nykaa.com");

    expect(result).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it("ships a null change mark when the event metadata carries no readable before/after token", async () => {
    const { env } = fakeD1Env({
      watchlists: [watchlistRow()],
      events: [
        eventRow({
          event_type: "ad_new",
          title: "New ad detected",
          metadata_json: JSON.stringify({ kind: "baseline", adsSeen: 3 }),
        }),
      ],
    });
    const { loadAdsDomainRecentChanges } = await import(
      "~/lib/ads-domain-recent-changes.server"
    );

    const result = await loadAdsDomainRecentChanges(env as never, "nykaa.com");

    expect(result).toEqual([
      {
        eventType: "ad_new",
        changeMark: null,
        capturedAt: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Route loader wiring — the /ads/:domain loader loads the rows.
// ---------------------------------------------------------------------------

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
  landingPageUrl: "https://www.nykaa.com/glow",
  advertiserPageId: "111",
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
  countries: ["all"],
  platforms: ["Instagram"],
  firstSeenAt: isoAgo(30 * DAY_MS),
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_library_browser",
  analysisFields: [],
  domainMatch: {
    level: "registrable_domain",
    reason: "Landing page matches nykaa.com",
    matchedDomain: "nykaa.com",
  },
};

function cacheEntry() {
  return {
    cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
    provider: "meta_library_browser",
    routeContext: "public_search",
    queryFingerprint: "fnv1a-test",
    country: "all",
    cursor: null,
    payload: {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    },
    fetchedAt: isoAgo(2 * 60 * 60 * 1000),
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: isoAgo(2 * 60 * 60 * 1000),
    updatedAt: isoAgo(2 * 60 * 60 * 1000),
  };
}

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

function installLoaderMocks(recentChanges: {
  loadAdsDomainRecentChanges: ReturnType<typeof vi.fn>;
}) {
  const env = { DB: {} };
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry: vi.fn().mockResolvedValue(cacheEntry()),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    searchAdsViaSourceResolver: vi.fn(),
    hasFreshDiscoveryCacheEntry: vi.fn(),
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser: vi.fn(),
  }));
  vi.doMock("~/lib/meta-api.server", () => ({
    searchAds: vi.fn(),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
    loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
    summarizeDomainCaptureFailures,
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));
  vi.doMock("~/lib/ads-domain-recent-changes.server", () => ({
    loadAdsDomainRecentChanges: recentChanges.loadAdsDomainRecentChanges,
  }));
  return env;
}

async function runLoader(domain: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/ads.$domain");
  return loader({
    context: createContext(env),
    params: { domain },
    request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
  } as never);
}

describe("/ads/:domain loader — recent watch changes (issue #2112)", () => {
  it("loads the domain's last-7d watch events when a watchlist tracks it", async () => {
    const changes: AdsDomainRecentChange[] = [
      {
        eventType: "landing_page_offer_changed",
        changeMark: { from: "$68", to: "$52" },
        capturedAt: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
      },
      {
        eventType: "ad_new",
        changeMark: null,
        capturedAt: "2026-09-07T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
      },
    ];
    const loadAdsDomainRecentChanges = vi.fn().mockResolvedValue(changes);
    const env = installLoaderMocks({ loadAdsDomainRecentChanges });

    const result = await runLoader("nykaa.com", env);

    expect(loadAdsDomainRecentChanges).toHaveBeenCalledTimes(1);
    // Called with the request env (E2E resolution spreads it, so compare the
    // carried DB binding) and the page's normalized domain.
    expect(loadAdsDomainRecentChanges.mock.calls[0]?.[0]).toMatchObject({ DB: env.DB });
    expect(loadAdsDomainRecentChanges.mock.calls[0]?.[1]).toBe("nykaa.com");
    expect(result.recentWatchChanges).toEqual(changes);
  });

  it("returns an empty list (and no error) when no watchlist tracks the domain", async () => {
    const loadAdsDomainRecentChanges = vi.fn().mockResolvedValue([]);
    const env = installLoaderMocks({ loadAdsDomainRecentChanges });

    const result = await runLoader("nykaa.com", env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.recentWatchChanges).toEqual([]);
  });

  it("hides the section instead of failing the page when the read hiccups", async () => {
    const loadAdsDomainRecentChanges = vi
      .fn()
      .mockRejectedValue(new Error("D1 transient"));
    const env = installLoaderMocks({ loadAdsDomainRecentChanges });

    const result = await runLoader("nykaa.com", env);

    expect(result.hasCachedAds).toBe(true);
    expect(result.recentWatchChanges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Render — events render when present; nothing renders when absent.
// ---------------------------------------------------------------------------

let currentData: BrandPageLoaderData;

function installRenderMocks() {
  mockReactRouter({
    loader: () => currentData,
    loaderData: () => undefined,
    location: () => ({ pathname: "/ads/nykaa.com" }),
  });
}

async function render(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

function populated(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nykaa.com",
    brandName: "Nykaa",
    hasCachedAds: true,
    ads: [baseAd],
    adCount: 1,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-09-09T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    freshForLiveClaim: false,
    brandOwnedAdCount: 1,
    verifiedLinkCount: 1,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser: {
      totalCount: 1,
      activeCount: 1,
      longestRunningDays: 30,
      longestRunningHook: "Glow like never before.",
      formats: ["image"],
    },
    aggression: null,
    observationDays: 2,
    changeEvents: [],
    offerTimelineEntries: [],
    timelineIndexable: false,
    adLibraryCountry: "all countries",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nykaa.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
    ...overrides,
  };
}

describe("/ads/:domain render — changed in the last 7 days (issue #2112)", () => {
  it("renders event type, change mark, and capture date when events are present", async () => {
    installRenderMocks();
    const markup = await render(
      populated({
        recentWatchChanges: [
          {
            eventType: "landing_page_offer_changed",
            changeMark: { from: "$68", to: "$52" },
            capturedAt: "2026-09-08T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
          },
          {
            eventType: "ad_new",
            changeMark: null,
            capturedAt: "2026-09-07T10:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
          },
        ],
      }),
    );

    expect(markup).toContain("Changed in the last 7 days");
    expect(markup).toContain('data-testid="ads-recent-watch-changes"');
    // Event type labels (never the raw tokens).
    expect(markup).toContain("Offer changed");
    expect(markup).toContain("New ad");
    expect(markup).not.toContain("landing_page_offer_changed");
    // The change mark renders as the struck-old / new-token diff.
    expect(markup).toContain("<s>$68</s>");
    expect(markup).toContain("<ins>$52</ins>");
    // Capture dates render for every event.
    expect(markup).toContain(`captured ${captureDateLabel("2026-09-08T10:00:00.000Z")}`); // fixed-date: historical fixture (issue #3215 sweep)
    expect(markup).toContain(`captured ${captureDateLabel("2026-09-07T10:00:00.000Z")}`); // fixed-date: historical fixture (issue #3215 sweep)
    // No user data, no watchlist names, no owner identifiers.
    expect(markup).not.toContain("wl-1");
    expect(markup).not.toContain("user-12345");
    expect(markup).not.toContain("Acme secret watch");
  });

  it("renders nothing (and no error) when no watchlist tracks the domain", async () => {
    installRenderMocks();
    const markup = await render(populated({ recentWatchChanges: [] }));

    expect(markup).not.toContain("Changed in the last 7 days");
    expect(markup).not.toContain("ads-recent-watch-changes");
    // The rest of the page still renders.
    expect(markup).toContain("All 1 ad, on the wall");
  });
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/ads-domain-recent-changes.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.restoreAllMocks();
  vi.resetModules();
});
