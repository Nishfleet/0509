import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistRecord } from "~/lib/types";

const scheduleWatchlistFanoutMock = vi.fn();
const reconcileOrchestratedWatchlistRunsMock = vi.fn();
const collectMonitoringOrchestrationMetricsMock = vi.fn();
const resolveMonitoringFanoutModeMock = vi.fn();
const isWatchlistEligibleForScheduledScanMock = vi.fn();
const claimOrchestratedWatchlistRunMock = vi.fn();
const ensureOrchestratedWatchlistRunMock = vi.fn();
const finishOrchestratedWatchlistRunMock = vi.fn();
const markOrchestratedRunCancelledMock = vi.fn();
const renewMonitoringConcurrencySlotMock = vi.fn();
const renewOrchestratedWatchlistRunLeaseMock = vi.fn();

vi.mock("~/lib/monitoring-fanout.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/monitoring-fanout.server")>();
  return {
    ...actual,
    claimOrchestratedWatchlistRun: claimOrchestratedWatchlistRunMock,
    ensureOrchestratedWatchlistRun: ensureOrchestratedWatchlistRunMock,
    finishOrchestratedWatchlistRun: finishOrchestratedWatchlistRunMock,
    scheduleWatchlistFanout: scheduleWatchlistFanoutMock,
    reconcileOrchestratedWatchlistRuns: reconcileOrchestratedWatchlistRunsMock,
    collectMonitoringOrchestrationMetrics: collectMonitoringOrchestrationMetricsMock,
    resolveMonitoringFanoutMode: resolveMonitoringFanoutModeMock,
    isWatchlistEligibleForScheduledScan: isWatchlistEligibleForScheduledScanMock,
    isFanoutEnabledForWorkspace: vi.fn(() => true),
    hasOrchestratedRunBlockingInlineScan: vi.fn().mockResolvedValue(false),
    markOrchestratedRunCancelled: markOrchestratedRunCancelledMock,
    renewMonitoringConcurrencySlot: renewMonitoringConcurrencySlotMock,
    renewOrchestratedWatchlistRunLease: renewOrchestratedWatchlistRunLeaseMock,
  };
});

vi.doMock("~/lib/plan.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/plan.server")>();
  return {
    ...actual,
    getUserPlan: vi.fn().mockResolvedValue("agency"),
  };
});

beforeEach(() => {
  vi.resetModules();
  scheduleWatchlistFanoutMock.mockClear();
  reconcileOrchestratedWatchlistRunsMock.mockClear();
  collectMonitoringOrchestrationMetricsMock.mockClear();
  resolveMonitoringFanoutModeMock.mockClear();
  isWatchlistEligibleForScheduledScanMock.mockClear();
  claimOrchestratedWatchlistRunMock.mockClear();
  ensureOrchestratedWatchlistRunMock.mockClear();
  finishOrchestratedWatchlistRunMock.mockClear();
  markOrchestratedRunCancelledMock.mockClear();
  renewMonitoringConcurrencySlotMock.mockClear();
  renewOrchestratedWatchlistRunLeaseMock.mockClear();
  isWatchlistEligibleForScheduledScanMock.mockResolvedValue({
    eligible: true,
    plan: "agency",
  });
  claimOrchestratedWatchlistRunMock.mockResolvedValue({
    claimed: true,
    processingToken: "processing-token",
  });
  ensureOrchestratedWatchlistRunMock.mockResolvedValue({
    runId: "inline-run",
    created: true,
  });
  finishOrchestratedWatchlistRunMock.mockResolvedValue(true);
  markOrchestratedRunCancelledMock.mockResolvedValue(undefined);
  renewMonitoringConcurrencySlotMock.mockResolvedValue(true);
  renewOrchestratedWatchlistRunLeaseMock.mockResolvedValue(true);
  reconcileOrchestratedWatchlistRunsMock.mockResolvedValue({
    recovered: 0,
    cancelled: 0,
    redispatched: 0,
  });
  collectMonitoringOrchestrationMetricsMock.mockResolvedValue({
    eligible: 0,
    queued: 0,
    dispatched: 0,
    running: 0,
    succeeded: 0,
    retrying: 0,
    failed: 0,
    delayed: 0,
    duplicatesPrevented: 0,
    oldestQueuedAgeMs: null,
  });
  resolveMonitoringFanoutModeMock.mockReturnValue("fanout");
  scheduleWatchlistFanoutMock.mockResolvedValue({
    eligible: 2,
    queued: 2,
    duplicates: 0,
    dispatchFailures: 0,
    shadowOnly: 0,
    inlineFallback: false,
  });
});
afterEach(() => {
  vi.doUnmock("~/lib/discovery-panel.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

const activeWatchlists: WatchlistRecord[] = [
  {
    id: "watch-1",
    userId: "user-1",
    name: "adspy watch",
    targetType: "advertiser",
    targetId: "adspy",
    targetFingerprint: "fp-adspy",
    targetLabel: "adspy",
    targetCountry: null,
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
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

function mockMonitoringDependencies(input: {
  provider: "meta_api" | "meta_library_browser";
  watchlists?: WatchlistRecord[];
  workflowCreate?: ReturnType<typeof vi.fn>;
  searchResponse?: Record<string, unknown>;
  billingInfo?: Record<string, unknown>;
  workflowWatchlist?: WatchlistRecord | null;
  /** When false, the real panel warmup runs against the mocked ad-source. */
  mockPanelWarmup?: boolean;
}) {
  const createWatchlistRun = vi
    .fn()
    .mockResolvedValueOnce("run-1")
    .mockResolvedValueOnce("run-2")
    .mockResolvedValue("run-extra");
  const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
  const getRecentSuccessfulRuns = vi.fn().mockResolvedValue([]);
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
  const hasFreshDiscoveryCacheEntry = vi
    .fn()
    .mockResolvedValue(input.mockPanelWarmup === false ? false : true);

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
    hasFreshDiscoveryCacheEntry,
  }));
  if (input.mockPanelWarmup === false) {
    vi.doUnmock("~/lib/discovery-panel.server");
  } else {
    vi.doMock("~/lib/discovery-panel.server", () => ({
      warmDiscoveryEvalPanel: vi.fn().mockResolvedValue({
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      }),
    }));
  }
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
    recordWatchlistCapacitySkip: vi.fn().mockResolvedValue("run-skip"),
    getDigestByPeriod: vi.fn(),
    getDigest: vi.fn().mockResolvedValue(null),
    getUserPlanBillingInfo: vi.fn().mockResolvedValue(
      input.billingInfo ?? {
        plan: "agency",
        dodoStatus: "active",
        dodoProductId: "prod-agency",
        dodoPlanChangeProductId: null,
        billingInterval: "monthly",
        dodoSubscriptionId: "sub-agency",
        dodoCustomerId: "cus-agency",
        dodoNextBillingAt: "2026-08-01T00:00:00.000Z",
        planUpdatedAt: "2026-07-01T00:00:00.000Z",
      },
    ),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns,
    getSavedQuery: vi.fn(),
    getUserDeliveryProfile: vi.fn().mockResolvedValue(null),
    getWatchlist: vi.fn().mockResolvedValue(input.workflowWatchlist ?? null),
    hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: unknown[]) => ads),
    listActiveWatchlists: vi.fn().mockResolvedValue(input.watchlists ?? activeWatchlists),
    listObservationsForRun: vi.fn().mockResolvedValue([]),
    listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchEventsForRun: vi.fn().mockResolvedValue([]),
    listAdsByIds: vi.fn().mockResolvedValue([]),
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
    getRecentSuccessfulRuns,
    recordWatchlistCapacitySkip: vi.fn().mockResolvedValue("run-skip"),
    searchAdsViaSourceResolver,
  };
}

function createFanoutDbMock() {
  const statement = {
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => statement),
      ...statement,
    })),
    batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]),
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
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("runScheduledMonitoring scheduled runtime selection", () => {
  it("warms discovery cache for active watchlists without creating watchlist runs", async () => {
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
      attempted: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      1,
      env,
      expect.objectContaining({
        mode: "advertiser",
      }),
      null,
      {
        purpose: "scheduled_warmup",
        // Warmup passes the resolved owner plan tier and (when a scheduled
        // ExecutionContext is supplied) the real context for telemetry
        // waitUntil completion; without a caller context this stays null.
        planTier: "agency",
        executionContext: null,
      },
    );
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
  });

  it("warms the 12-brand public-search panel on the same scheduled pass", async () => {
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      mockPanelWarmup: false,
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
      attempted: 14,
      succeeded: 14,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(14);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({ query: "allbirds" }),
      }),
      null,
      expect.objectContaining({
        purpose: "public_search_warmup",
        cacheKeyOverride: expect.stringContaining("search-v2:domain:allbirds.com:exact:"),
      }),
    );
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
      attempted: 2,
      succeeded: 0,
      failed: 0,
      skipped: 2,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
  });

  it("skips scheduled warmup when a paid plan label has no active subscription", async () => {
    isWatchlistEligibleForScheduledScanMock.mockResolvedValue({
      eligible: false,
      reason: "subscription_required",
    });
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      billingInfo: {
        plan: "starter",
        dodoStatus: "payment.succeeded",
        dodoProductId: "prod-starter",
        dodoPlanChangeProductId: null,
        billingInterval: "monthly",
        dodoSubscriptionId: null,
        dodoCustomerId: null,
        dodoNextBillingAt: null,
        planUpdatedAt: "2026-07-01T00:00:00.000Z",
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
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 2,
    });
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
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
      attempted: 5,
      succeeded: 5,
      failed: 0,
      skipped: 2,
    });
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(5);
  });

  it("queues browser-backed scheduled scans through workflow fan-out", async () => {
    const workflowCreate = vi.fn().mockResolvedValue({ id: "queued" });
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      workflowCreate,
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 4 * * *",
      scheduledTime: Date.parse("2026-04-21T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      queued: 2,
      duplicates: 0,
      inlineRuns: 0,
      digests: 0,
    });
    expect(scheduleWatchlistFanoutMock).toHaveBeenCalledTimes(1);
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
  });

  it("skips scheduled scans when a paid plan label has no active subscription", async () => {
    isWatchlistEligibleForScheduledScanMock.mockResolvedValue({
      eligible: false,
      reason: "subscription_required",
    });
    const workflowCreate = vi.fn().mockResolvedValue({ id: "queued" });
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      workflowCreate,
      billingInfo: {
        plan: "starter",
        dodoStatus: "payment.succeeded",
        dodoProductId: "prod-starter",
        dodoPlanChangeProductId: null,
        billingInterval: "monthly",
        dodoSubscriptionId: null,
        dodoCustomerId: null,
        dodoNextBillingAt: null,
        planUpdatedAt: "2026-07-01T00:00:00.000Z",
      },
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-07-03T15:00:00.000Z"),
    });

    expect(result).toMatchObject({
      queued: 0,
      inlineRuns: 0,
      skippedForBilling: 2,
      digests: 0,
    });
    expect(scheduleWatchlistFanoutMock).not.toHaveBeenCalled();
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
  });

  it("cancels already-queued workflow scans when billing becomes ineligible before execution", async () => {
    isWatchlistEligibleForScheduledScanMock.mockResolvedValueOnce({
      eligible: false,
      reason: "subscription_required",
    });
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      workflowWatchlist: activeWatchlists[0],
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { runWatchlistWorkflowJob } = await import("~/lib/monitoring.server");

    const result = await runWatchlistWorkflowJob(env as never, {
      kind: "scheduled_scan",
      watchlistId: "watch-1",
      triggerType: "scheduled",
      executionKey: "watchlist-run:scheduled:watch-1:0-4:2026-07-03T15-00-00-000Z",
      workflowInstanceId: "monitor-v1-test",
      proofCaptureRequestKeyPrefix: "proof:watch-1",
      queuedAt: "2026-07-03T15:00:00.000Z",
      runId: "run-1",
      scheduledSlot: "2026-07-03T15:00:00.000Z",
      cron: "0 */3 * * *",
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "subscription_required",
      watchlistId: "watch-1",
    });
    expect(markOrchestratedRunCancelledMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        runId: "run-1",
        reason: "subscription_required",
      }),
    );
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
    expect(renewOrchestratedWatchlistRunLeaseMock).not.toHaveBeenCalled();
  });

  it("preflights billing-ineligible workflow scans before orchestration claim", async () => {
    isWatchlistEligibleForScheduledScanMock.mockResolvedValueOnce({
      eligible: false,
      reason: "subscription_required",
    });
    mockMonitoringDependencies({
      provider: "meta_library_browser",
      workflowWatchlist: activeWatchlists[0],
    });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { preflightWatchlistWorkflowJob } = await import("~/lib/monitoring.server");

    const result = await preflightWatchlistWorkflowJob(env as never, {
      kind: "scheduled_scan",
      watchlistId: "watch-1",
      triggerType: "scheduled",
      executionKey: "watchlist-run:scheduled:watch-1:0-4:2026-07-03T15-00-00-000Z",
      workflowInstanceId: "monitor-v1-test",
      proofCaptureRequestKeyPrefix: "proof:watch-1",
      queuedAt: "2026-07-03T15:00:00.000Z",
      runId: "run-1",
      scheduledSlot: "2026-07-03T15:00:00.000Z",
      cron: "0 */3 * * *",
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "subscription_required",
      watchlistId: "watch-1",
    });
    expect(markOrchestratedRunCancelledMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        runId: "run-1",
        reason: "subscription_required",
      }),
    );
    expect(claimOrchestratedWatchlistRunMock).not.toHaveBeenCalled();
    expect(renewMonitoringConcurrencySlotMock).not.toHaveBeenCalled();
    expect(renewOrchestratedWatchlistRunLeaseMock).not.toHaveBeenCalled();
  });

  it("runs browser-backed scheduled scans inline only in rollback mode", async () => {
    resolveMonitoringFanoutModeMock.mockImplementation(() => "inline");

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
      MONITORING_FANOUT_MODE: "inline",
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
    });

    expect(result).toMatchObject({
      queued: 0,
      duplicates: 0,
      digests: 0,
    });
    expect(scheduleWatchlistFanoutMock).not.toHaveBeenCalled();
    expect(workflowCreate).not.toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(2);
    expect(mocks.searchAdsViaSourceResolver.mock.calls[0]?.[3]).toMatchObject({
      purpose: "watchlist_scan",
      forceLive: true,
      // agency plan → every_3h cadence window (WP-36 shared cache reuse)
      acceptCacheYoungerThanMs: 3 * 60 * 60 * 1000,
    });
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledTimes(2);
    expect(mocks.createWatchlistRun.mock.calls[0]?.[2]).toBe("scheduled");
    expect(mocks.createWatchlistRun.mock.calls[1]?.[2]).toBe("scheduled");
    expect(result.inlineRuns).toBe(2);
  });

  it("does not replay a completed inline scheduled slot", async () => {
    resolveMonitoringFanoutModeMock.mockImplementation(() => "inline");

    const scheduledTime = Date.parse("2026-07-01T03:00:00.000Z");
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      watchlists: [
        {
          ...activeWatchlists[0],
          lastScannedAt: "2026-07-01T03:00:01.000Z",
        },
      ],
    });
    mocks.getRecentSuccessfulRuns.mockResolvedValue([]);

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: {},
      MONITORING_FANOUT_MODE: "inline",
    };
    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const firstResult = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime,
    });
    mocks.getRecentSuccessfulRuns.mockResolvedValue([
      {
        id: "run-1",
        triggerType: "scheduled",
        startedAt: "2026-07-01T03:00:01.000Z",
      },
    ]);
    const replayResult = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime,
    });

    expect(firstResult.inlineRuns).toBe(1);
    expect(replayResult.inlineRuns).toBe(0);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(1);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledTimes(1);
  });

  it("atomically claims an inline scheduled slot before provider work", async () => {
    resolveMonitoringFanoutModeMock.mockImplementation(() => "inline");
    const mocks = mockMonitoringDependencies({
      provider: "meta_library_browser",
      watchlists: [activeWatchlists[0]],
    });
    ensureOrchestratedWatchlistRunMock
      .mockResolvedValueOnce({ runId: "inline-run", created: true })
      .mockResolvedValueOnce({ runId: "inline-run", created: false });
    claimOrchestratedWatchlistRunMock
      .mockResolvedValueOnce({
        claimed: true,
        processingToken: "inline-processing-token",
      })
      .mockResolvedValueOnce({ claimed: false });

    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_FANOUT_MODE: "inline",
    };
    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const firstResult = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-07-01T03:00:00.000Z"),
    });
    const replayResult = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-07-01T03:00:00.000Z"),
    });

    expect(firstResult.inlineRuns).toBe(1);
    expect(replayResult.inlineRuns).toBe(0);
    expect(mocks.searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
    expect(finishOrchestratedWatchlistRunMock).toHaveBeenCalledTimes(1);
  });

  it("records dispatch failures in fan-out mode without inline browser fallback", async () => {
    scheduleWatchlistFanoutMock.mockResolvedValueOnce({
      eligible: 2,
      queued: 2,
      duplicates: 0,
      dispatchFailures: 1,
      shadowOnly: 0,
      inlineFallback: false,
    });

    const workflowCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("workflow create failed"))
      .mockResolvedValueOnce({ id: "queued-watch-2" });
    const mocks = mockMonitoringDependencies({
      provider: "meta_api",
      workflowCreate,
    });

    const env = {
      DB: createFanoutDbMock(),
      META_AD_LIBRARY_TOKEN: "token",
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const result = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 4 * * *",
      scheduledTime: Date.parse("2026-04-21T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      queued: 2,
      duplicates: 0,
      inlineRuns: 0,
      skippedForBudget: 0,
      dispatchFailures: 1,
      digests: 0,
    });
    expect(scheduleWatchlistFanoutMock).toHaveBeenCalledTimes(1);
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
  });

  it("keeps agency priority slots on 3h ticks and defers overflow to 6h (WP-37)", async () => {
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("agency"),
      PLAN_LIMITS: {},
    }));

    const watchlists: WatchlistRecord[] = Array.from({ length: 27 }, (_, index) => ({
      id: `watch-${String(index + 1).padStart(2, "0")}`,
      userId: "agency-user",
      name: `Competitor ${index + 1}`,
      targetType: "advertiser" as const,
      targetId: `target-${index + 1}`,
      targetFingerprint: `fp-${index + 1}`,
      targetLabel: `target-${index + 1}`,
      targetCountry: null,
      isActive: true,
      lastScannedAt: null,
      createdAt: `2026-03-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));

    const { filterWatchlistsByPriorityScanSlots } = await import("~/lib/monitoring.server");

    const threeHour = await filterWatchlistsByPriorityScanSlots(
      {} as never,
      watchlists,
      Date.parse("2026-07-03T03:00:00.000Z"),
    );
    expect(threeHour).toHaveLength(25);
    expect(threeHour.map((w) => w.id)).toEqual(
      watchlists.slice(0, 25).map((w) => w.id),
    );

    const sixHour = await filterWatchlistsByPriorityScanSlots(
      {} as never,
      watchlists,
      Date.parse("2026-07-03T06:00:00.000Z"),
    );
    expect(sixHour).toHaveLength(27);
  });

  it("skips a workspace instead of widening cadence when its plan cannot be read", async () => {
    const planFailure = new Error("D1 plan lookup failed");
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockRejectedValue(planFailure),
      PLAN_LIMITS: {},
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const watchlists: WatchlistRecord[] = Array.from({ length: 27 }, (_, index) => ({
      id: `watch-${String(index + 1).padStart(2, "0")}`,
      userId: "agency-user",
      name: `Competitor ${index + 1}`,
      targetType: "advertiser" as const,
      targetId: `target-${index + 1}`,
      targetFingerprint: `fp-${index + 1}`,
      targetLabel: `target-${index + 1}`,
      targetCountry: null,
      isActive: true,
      lastScannedAt: null,
      createdAt: `2026-03-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const { filterWatchlistsByPriorityScanSlots } = await import("~/lib/monitoring.server");

    const eligible = await filterWatchlistsByPriorityScanSlots(
      {} as never,
      watchlists,
      Date.parse("2026-07-01T03:00:00.000Z"),
    );

    expect(eligible).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[monitoring] Plan lookup failed; scheduled scans were skipped for the workspace.",
      {
        workspaceUserId: "agency-user",
        watchlistCount: 27,
        error: planFailure,
      },
    );
  });

  it("fails the scheduled task after preserving work for readable workspaces", async () => {
    const planFailure = new Error("D1 plan lookup failed");
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn()
        .mockRejectedValueOnce(planFailure)
        .mockResolvedValue("agency"),
      PLAN_LIMITS: {},
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readableWatchlist = {
      ...activeWatchlists[1],
      userId: "user-2",
    };
    mockMonitoringDependencies({
      provider: "meta_library_browser",
      watchlists: [activeWatchlists[0], readableWatchlist],
    });
    scheduleWatchlistFanoutMock.mockResolvedValueOnce({
      eligible: 1,
      queued: 1,
      duplicates: 0,
      dispatchFailures: 0,
      shadowOnly: 0,
      inlineFallback: false,
    });
    const env = {
      BROWSER: {
        fetch: vi.fn(),
      },
      DB: createFanoutDbMock(),
      MONITORING_WORKFLOW: {
        create: vi.fn(),
      },
      MONITORING_FANOUT_MODE: "fanout",
    };
    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    await expect(
      runScheduledMonitoring(env as never, {
        includeDigests: false,
        cron: "0 */3 * * *",
        scheduledTime: Date.parse("2026-07-01T03:00:00.000Z"),
      }),
    ).rejects.toThrow(
      "Scheduled monitoring skipped 1 workspace(s) because plan lookup failed.",
    );
    expect(scheduleWatchlistFanoutMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        watchlists: [readableWatchlist],
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[monitoring] Plan lookup failed; scheduled scans were skipped for the workspace.",
      expect.objectContaining({
        workspaceUserId: "user-1",
        error: planFailure,
      }),
    );
  });

  it("skips a workspace when its plan lookup returns no value", async () => {
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue(null),
      PLAN_LIMITS: {},
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const watchlist: WatchlistRecord = {
      id: "watch-null-plan",
      userId: "unknown-plan-user",
      name: "Unknown plan watch",
      targetType: "advertiser",
      targetId: "unknown-plan",
      targetFingerprint: "fp-unknown-plan",
      targetLabel: "Unknown plan",
      targetCountry: null,
      isActive: true,
      lastScannedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const { filterWatchlistsByPriorityScanSlots } = await import("~/lib/monitoring.server");

    await expect(
      filterWatchlistsByPriorityScanSlots(
        {} as never,
        [watchlist],
        Date.parse("2026-07-01T03:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[monitoring] Plan lookup failed; scheduled scans were skipped for the workspace.",
      {
        workspaceUserId: "unknown-plan-user",
        watchlistCount: 1,
        error: expect.objectContaining({
          message: "Plan lookup returned no value.",
        }),
      },
    );
  });
});
