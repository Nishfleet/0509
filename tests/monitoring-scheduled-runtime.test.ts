import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistRecord } from "~/lib/types";

const activeWatchlists: WatchlistRecord[] = [
  {
    id: "watch-1",
    userId: "user-1",
    name: "adspy watch",
    targetType: "advertiser",
    targetId: "adspy",
    targetFingerprint: "fp-adspy",
    targetLabel: "adspy",
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "watch-2",
    userId: "user-1",
    name: "bigspy watch",
    targetType: "advertiser",
    targetId: "bigspy",
    targetFingerprint: "fp-bigspy",
    targetLabel: "bigspy",
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockMonitoringDependencies(input: {
  provider: "meta_api" | "meta_library_browser";
  watchlists?: WatchlistRecord[];
  workflowCreate?: ReturnType<typeof vi.fn>;
  searchResponse?: Record<string, unknown>;
}) {
  const createWatchlistRun = vi
    .fn()
    .mockResolvedValueOnce("run-1")
    .mockResolvedValueOnce("run-2")
    .mockResolvedValue("run-extra");
  const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
  const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
    ads: [],
    nextCursor: null,
    source: input.provider,
    provider: input.provider,
    cacheStatus: "miss",
    discoveryStatus: "healthy",
    discoverySummary: null,
    discoveryFailureClass: null,
    ...input.searchResponse,
  });

  vi.doMock("~/lib/analysis.server", () => ({
    buildAnalysisFields: vi.fn(() => []),
  }));
  vi.doMock("~/lib/creative-text.server", () => ({
    captureCreativeText: vi.fn(),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
      failureClass = "browser_launch_failed" as const;
    },
    resolveCommercialDiscoveryProvider: vi.fn(() => input.provider),
    searchAdsViaSourceResolver,
  }));
  vi.doMock("~/lib/data.server", () => ({
    addDigestItem: vi.fn(),
    clearDigestItems: vi.fn(),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(),
    createDigestRun: vi.fn(),
    createEventCandidate: vi.fn(),
    createProofCapture: vi.fn(),
    createWatchEvent: vi.fn(),
    createWatchlistRun,
    finishWatchlistRun,
    getDigestByPeriod: vi.fn(),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
    getSavedQuery: vi.fn(),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(null),
    getWatchlist: vi.fn(),
    hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: unknown[]) => ads),
    listActiveWatchlists: vi.fn().mockResolvedValue(input.watchlists ?? activeWatchlists),
    listObservationsForRun: vi.fn().mockResolvedValue([]),
    listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
    listWatchlists: vi.fn().mockResolvedValue([]),
    logMetaIntegrationStatus: vi.fn().mockResolvedValue(undefined),
    touchWatchlistScanned: vi.fn().mockResolvedValue(undefined),
    upsertAd: vi.fn(),
    upsertProofTarget: vi.fn(),
  }));
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWatchlistAlerts: vi.fn().mockResolvedValue({ attempts: 0, channels: [] }),
  }));
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
  }));

  return {
    createWatchlistRun,
    finishWatchlistRun,
    searchAdsViaSourceResolver,
  };
}

function buildWatchlist(index: number): WatchlistRecord {
  return {
    id: `watch-${index}`,
    userId: "user-1",
    name: `watch ${index}`,
    targetType: "advertiser",
    targetId: `brand-${index}`,
    targetFingerprint: `fp-brand-${index}`,
    targetLabel: `brand-${index}`,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("runScheduledMonitoring scheduled runtime selection", () => {
  it("warms active watchlists and fills unused slots with priority public searches", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
    };

    const { runScheduledDiscoveryWarmup } = await import("~/lib/monitoring.server");

    const result = await runScheduledDiscoveryWarmup(env as never);

    expect(result).toMatchObject({
      attempted: 6,
      succeeded: 6,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(6);
    expect(mocks.searchAdsViaSourceResolver.mock.calls.map((call) => call[1].filters.query)).toEqual([
      "adspy",
      "bigspy",
      "adflex",
      "nykaa",
      "boat",
      "cod",
    ]);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      1,
      env,
      expect.objectContaining({
        mode: "advertiser",
      }),
      null,
      {
        purpose: "scheduled_warmup",
      },
    );
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      3,
      env,
      expect.objectContaining({
        mode: "keyword",
        filters: expect.objectContaining({
          query: "adflex",
          country: "India",
        }),
      }),
      null,
      {
        purpose: "scheduled_warmup",
      },
    );
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
  });

  it("treats cache-only warmup responses as skipped instead of refreshed", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      searchResponse: {
        cacheStatus: "stale",
        discoveryStatus: "cache_only",
        discoveryFailureClass: "rate_limited",
      },
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
    };

    const { runScheduledDiscoveryWarmup } = await import("~/lib/monitoring.server");

    const result = await runScheduledDiscoveryWarmup(env as never);

    expect(result).toMatchObject({
      attempted: 6,
      succeeded: 0,
      failed: 0,
      skipped: 6,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(6);
  });

  it("keeps the keyword canary query in the public warmup batch", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      watchlists: [],
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
    };

    const { runScheduledDiscoveryWarmup } = await import("~/lib/monitoring.server");

    const result = await runScheduledDiscoveryWarmup(env as never);

    expect(result).toMatchObject({
      attempted: 6,
      succeeded: 6,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(6);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      6,
      env,
      expect.objectContaining({
        mode: "keyword",
        filters: expect.objectContaining({
          query: "cod",
          country: "India",
        }),
      }),
      null,
      {
        purpose: "scheduled_warmup",
      },
    );
  });

  it("caps scheduled discovery warmups to a bounded batch", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      watchlists: Array.from({ length: 7 }, (_value, index) => buildWatchlist(index + 1)),
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
    };

    const { runScheduledDiscoveryWarmup } = await import("~/lib/monitoring.server");

    const result = await runScheduledDiscoveryWarmup(env as never);

    expect(result).toMatchObject({
      attempted: 6,
      succeeded: 6,
      failed: 0,
      skipped: 1,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(6);
  });

  it("runs browser-backed scheduled scans inline even when a workflow binding exists", async () => {
    const workflowCreate = vi.fn();
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      workflowCreate,
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
    });

    expect(result).toMatchObject({
      queued: 0,
      duplicates: 0,
      inlineRuns: 2,
      digests: 0,
    });
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.createWatchlistRun.mock.calls[0]?.[2]).toBe("scheduled");
    expect(mocks.createWatchlistRun.mock.calls[1]?.[2]).toBe("scheduled");
  });

  it("continues browser-backed inline scans after one watchlist fails", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
    });
    mocks.searchAdsViaSourceResolver
      .mockRejectedValueOnce(new Error("Browser discovery failed"))
      .mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
        discoveryStatus: "healthy",
        discoverySummary: null,
        discoveryFailureClass: null,
      });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
    });

    expect(result).toMatchObject({
      queued: 0,
      duplicates: 0,
      inlineRuns: 1,
      inlineFailures: 1,
      digests: 0,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.finishWatchlistRun.mock.calls[0]?.[2]).toMatchObject({
      status: "failed",
      errorMessage: "Browser discovery failed",
    });
    expect(mocks.finishWatchlistRun.mock.calls[1]?.[2]).toMatchObject({
      status: "succeeded",
    });
  });

  it("falls back to inline scans when workflow queueing fails", async () => {
    const workflowCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("workflow create failed"))
      .mockResolvedValueOnce({ id: "queued-watch-2" });
    const mocks = mockMonitoringDependencies({
      provider: "meta_api",
      workflowCreate,
    });

    const env = {
      DB: {},
      META_AD_LIBRARY_TOKEN: "token",
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 4 * * *",
      scheduledTime: Date.parse("2026-04-21T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      queued: 1,
      duplicates: 0,
      inlineRuns: 1,
      digests: 0,
    });
    expect(workflowCreate).toHaveBeenCalledTimes(2);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(1);
    expect(mocks.createWatchlistRun.mock.calls[0]?.[1]).toBe("watch-1");
    expect(mocks.createWatchlistRun.mock.calls[0]?.[2]).toBe("scheduled");
  });
});
