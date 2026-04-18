import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

const baseAd: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Flat 30% off",
  previewHeadline: "Glow sale",
  previewSubhead: "Weekend only",
  hook: "Glow sale",
  offer: "Flat 30% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://example.com/new-url",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "demo",
  analysisFields: [],
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: "obs-1",
    ad_id: "meta-nykaa-1",
    watchlist_run_id: "run-1",
    landing_page_snapshot_id: null,
    landing_page_url: "https://example.com/new-url",
    normalized_headline_hash: null,
    raw_headline: null,
    seen_at: "2026-03-28T00:00:00.000Z",
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runWeeklyDigests", () => {
  it("skips digest generation for free-plan users", async () => {
    const listWatchlists = vi.fn().mockResolvedValue([
      {
        id: "watch-1",
        name: "boAt watch",
      },
    ]);

    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEventsBetween: vi.fn().mockResolvedValue([]),
      listWatchlists,
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    const result = await runWeeklyDigests({
      DB: {
        prepare() {
          return {
            async all<T>() {
              return {
                results: [
                  {
                    id: "user-1",
                    email: "owner@example.com",
                    name: "Owner",
                  },
                ] as T[],
              };
            },
            bind() {
              return {
                async all<T>() {
                  return {
                    results: [
                      {
                        id: "user-1",
                        email: "owner@example.com",
                        name: "Owner",
                      },
                    ] as T[],
                  };
                },
              };
            },
          };
        },
      },
    } as never);

    expect(result).toBe(0);
    expect(listWatchlists).not.toHaveBeenCalled();
  });
});

describe("runWatchlistManual cheap scan path", () => {
  it("stores scan-side observations without forcing landing-page capture", async () => {
    const createAdObservation = vi.fn();
    const createLandingPageSnapshot = vi.fn();
    const createWatchEvent = vi.fn();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    const listObservationsForRun = vi.fn(async (_env: unknown, runId: string) => {
      if (runId === "run-1") {
        return [
          observation({
            landing_page_url: "https://example.com/new-url",
            normalized_headline_hash: null,
            raw_headline: null,
          }),
        ];
      }

      if (runId === "run-0") {
        return [
          observation({
            watchlist_run_id: "run-0",
            landing_page_url: "https://example.com/old-url",
            normalized_headline_hash: "hash-a",
            raw_headline: "Old headline",
          }),
        ];
      }

      return [];
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation,
      createDigestRun: vi.fn(),
      createLandingPageSnapshot,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listObservationsForRun,
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn().mockResolvedValue({
        ads: [baseAd],
        nextCursor: null,
        source: "demo",
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual({ META_AD_LIBRARY_TOKEN: "token" } as never, watchlist);

    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
    expect(createLandingPageSnapshot).not.toHaveBeenCalled();

    expect(createAdObservation.mock.calls[0]?.[1]).toMatchObject({
      adId: "meta-nykaa-1",
      landingPageSnapshotId: null,
      landingPageUrl: "https://example.com/new-url",
      isActive: true,
      metadata: {
        advertiser: "Nykaa",
      },
    });

    expect(createWatchEvent.mock.calls.map((call) => call[1].eventType)).toEqual([
      "landing_page_url_changed",
    ]);
  });
});
