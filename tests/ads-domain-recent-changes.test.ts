/**
 * Issue #2112 — public /ads/:domain pages show last-7-day watch_event proof
 * (event type + change mark + capture date) when any watchlist tracks the
 * advertiser's domain. No user data, no watchlist names, no owner identifiers.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { BrandRecentWatchChange } from "~/lib/brand-page-recent-changes.server";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const TWO_DAYS_AGO = "2026-09-07T10:00:00.000Z";
const EIGHT_DAYS_AGO = "2026-09-01T10:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

let currentData: BrandPageLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({
        children,
        to,
        ...props
      }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

function recentChange(
  overrides: Partial<BrandRecentWatchChange> = {},
): BrandRecentWatchChange {
  return {
    eventType: "landing_page_offer_changed",
    eventTypeLabel: "Offer changed",
    changeMark: { from: "$120", to: "$99" },
    capturedAt: TWO_DAYS_AGO,
    capturedOn: "7 Sept 2026",
    ...overrides,
  };
}

function pageData(
  overrides: Partial<BrandPageLoaderData> = {},
): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: [],
    verifiedLinkedAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-09-08T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 1,
    verifiedLinkCount: 1,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser: null,
    aggression: null,
    observationDays: 21,
    changeEvents: [],
    offerTimelineEntries: [],
    timelineIndexable: false,
    adLibraryCountry: "India",
    relatedBrands: [],
    noindex: false,
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    ...overrides,
  };
}

async function render(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

describe("/ads/:domain — last-7d watch_event proof (issue #2112)", () => {
  it("renders event type, change mark, and capture date when events are present", async () => {
    const markup = await render(
      pageData({ recentWatchChanges: [recentChange()] }),
    );

    expect(markup).toContain('data-testid="ads-recent-changes"');
    expect(markup).toContain("Changed in the last 7 days");
    expect(markup).toContain("Offer changed");
    expect(markup).toContain("$120");
    expect(markup).toContain("$99");
    expect(markup).toContain("7 Sept 2026");
  });

  it("renders nothing and does not error when no watchlist tracks the domain", async () => {
    const markup = await render(pageData({ recentWatchChanges: [] }));

    expect(markup).not.toContain('data-testid="ads-recent-changes"');
    expect(markup).not.toContain("Changed in the last 7 days");
  });

  it("does not render watchlist names, owner identifiers, or event titles", async () => {
    const markup = await render(
      pageData({
        recentWatchChanges: [recentChange()],
      }),
    );

    expect(markup).not.toContain("Acme Agency Nike tracker");
    expect(markup).not.toContain("owner@example.com");
    expect(markup).not.toContain("user-secret-1");
    expect(markup).not.toContain("watch-secret-1");
  });
});

describe("loadRecentWatchChangesForDomain (issue #2112)", () => {
  let harness: ReturnType<typeof createSqliteD1>;

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0007_proof_first_change_alerts.sql");

    harness.sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .run(
        "user-secret-1",
        "Owner",
        "owner@example.com",
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );
  });

  afterEach(() => {
    harness.close();
  });

  function seedWatchlist(input: {
    id: string;
    name: string;
    targetId: string;
    targetLabel: string;
  }) {
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.id,
        "user-secret-1",
        input.name,
        input.targetId,
        `fp-${input.id}`,
        input.targetLabel,
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );
  }

  function seedRun(id: string, watchlistId: string) {
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES (?, ?, 'scheduled', 'succeeded', '{}', ?, ?, ?, ?)`,
      )
      .run(id, watchlistId, TWO_DAYS_AGO, TWO_DAYS_AGO, TWO_DAYS_AGO, TWO_DAYS_AGO);
  }

  function seedEvent(input: {
    id: string;
    watchlistId: string;
    runId: string;
    eventType: string;
    createdAt: string;
    metadata: Record<string, unknown>;
    title?: string;
    status?: string;
  }) {
    harness.sqlite
      .prepare(
        `INSERT INTO watch_event (
           id, watchlist_id, run_id, event_type, status, title, summary, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.watchlistId,
        input.runId,
        input.eventType,
        input.status ?? "confirmed",
        input.title ?? "Secret event title with owner@example.com",
        "Secret summary",
        JSON.stringify(input.metadata),
        input.createdAt,
      );
  }

  it("returns last-7d events for a watchlist that tracks the advertiser domain", async () => {
    seedWatchlist({
      id: "watch-secret-1",
      name: "Acme Agency Nike tracker",
      targetId: "https://nike.com",
      targetLabel: "Nike",
    });
    seedRun("run-1", "watch-secret-1");
    seedEvent({
      id: "evt-1",
      watchlistId: "watch-secret-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      createdAt: TWO_DAYS_AGO,
      metadata: { from: "$120", to: "$99", ownerEmail: "owner@example.com" },
    });
    seedEvent({
      id: "evt-old",
      watchlistId: "watch-secret-1",
      runId: "run-1",
      eventType: "landing_page_cta_changed",
      createdAt: EIGHT_DAYS_AGO,
      metadata: { from: "Shop", to: "Buy" },
    });

    const { loadRecentWatchChangesForDomain } = await import(
      "~/lib/brand-page-recent-changes.server"
    );
    const rows = await loadRecentWatchChangesForDomain(
      { DB: harness.db } as never,
      "nike.com",
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      eventType: "landing_page_offer_changed",
      eventTypeLabel: "Offer changed",
      changeMark: { from: "$120", to: "$99" },
      capturedAt: TWO_DAYS_AGO,
      capturedOn: "7 Sept 2026",
    });
    expect(JSON.stringify(rows)).not.toContain("Acme Agency");
    expect(JSON.stringify(rows)).not.toContain("owner@example.com");
    expect(JSON.stringify(rows)).not.toContain("user-secret-1");
    expect(JSON.stringify(rows)).not.toContain("watch-secret-1");
    expect(JSON.stringify(rows)).not.toContain("Secret event title");
  });

  it("returns nothing when no watchlist tracks the domain", async () => {
    seedWatchlist({
      id: "watch-adidas",
      name: "Adidas tracker",
      targetId: "https://adidas.com",
      targetLabel: "Adidas",
    });
    seedRun("run-adidas", "watch-adidas");
    seedEvent({
      id: "evt-adidas",
      watchlistId: "watch-adidas",
      runId: "run-adidas",
      eventType: "landing_page_offer_changed",
      createdAt: TWO_DAYS_AGO,
      metadata: { from: "$80", to: "$70" },
    });

    const { loadRecentWatchChangesForDomain } = await import(
      "~/lib/brand-page-recent-changes.server"
    );
    const rows = await loadRecentWatchChangesForDomain(
      { DB: harness.db } as never,
      "nike.com",
      NOW,
    );

    expect(rows).toEqual([]);
  });

  it("returns nothing when the env has no D1 binding", async () => {
    const { loadRecentWatchChangesForDomain } = await import(
      "~/lib/brand-page-recent-changes.server"
    );
    const rows = await loadRecentWatchChangesForDomain({} as never, "nike.com", NOW);
    expect(rows).toEqual([]);
  });
});

describe("/ads/:domain loader wires last-7d watch events (issue #2112)", () => {
  let harness: ReturnType<typeof createSqliteD1>;

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0007_proof_first_change_alerts.sql");
    harness.sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .run(
        "user-secret-1",
        "Owner",
        "owner@example.com",
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );
  });

  afterEach(() => {
    harness.close();
  });

  function installCacheMocks() {
    const entry = {
      cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fnv1a-test",
      country: "all",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "meta-nike-1",
            advertiser: "Nike",
            body: "Run.",
            previewHeadline: "Run.",
            previewSubhead: "",
            hook: "Shop",
            offer: "",
            cta: "Shop",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://www.nike.com/launch",
            advertiserPageId: "111",
            adSnapshotUrl: "https://cdn.example.com/meta-nike-1.png",
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
              reason: "Landing page matches nike.com",
              matchedDomain: "nike.com",
            },
          },
        ],
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
    const env = { DB: harness.db };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(entry),
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
    vi.doMock("~/lib/offer-timeline.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/offer-timeline.server")>(
        "~/lib/offer-timeline.server",
      );
      return {
        ...actual,
        loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
        loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
      };
    });
    return env;
  }

  it("loads last-7d watch_event rows onto the public page when a watchlist tracks the domain", async () => {
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        "watch-secret-1",
        "user-secret-1",
        "Acme Agency Nike tracker",
        "https://nike.com",
        "fp-1",
        "Nike",
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES (?, ?, 'scheduled', 'succeeded', '{}', ?, ?, ?, ?)`,
      )
      .run(
        "run-1",
        "watch-secret-1",
        TWO_DAYS_AGO,
        TWO_DAYS_AGO,
        TWO_DAYS_AGO,
        TWO_DAYS_AGO,
      );
    harness.sqlite
      .prepare(
        `INSERT INTO watch_event (
           id, watchlist_id, run_id, event_type, status, title, summary, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
      )
      .run(
        "evt-1",
        "watch-secret-1",
        "run-1",
        "landing_page_offer_changed",
        "Secret event title",
        "Secret summary",
        JSON.stringify({ from: "$120", to: "$99" }),
        TWO_DAYS_AGO,
      );

    const env = installCacheMocks();
    const { loader } = await import("~/routes/ads.$domain");
    const result = (await loader({
      context: { cloudflare: { env } },
      params: { domain: "nike.com" },
      request: new Request("http://localhost/ads/nike.com"),
    } as never)) as BrandPageLoaderData;

    expect(result.recentWatchChanges).toEqual([
      {
        eventType: "landing_page_offer_changed",
        eventTypeLabel: "Offer changed",
        changeMark: { from: "$120", to: "$99" },
        capturedAt: TWO_DAYS_AGO,
        capturedOn: "7 Sept 2026",
      },
    ]);
  });

  it("loads an empty list (no throw) when no watchlist tracks the domain", async () => {
    const env = installCacheMocks();
    const { loader } = await import("~/routes/ads.$domain");
    const result = (await loader({
      context: { cloudflare: { env } },
      params: { domain: "nike.com" },
      request: new Request("http://localhost/ads/nike.com"),
    } as never)) as BrandPageLoaderData;

    expect(result.recentWatchChanges).toEqual([]);
  });
});
