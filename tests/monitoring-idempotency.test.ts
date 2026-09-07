import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistRecord } from "~/lib/types";

const activeWatchlists: WatchlistRecord[] = [
  {
    id: "watch-1",
    userId: "user-1",
    name: "boAt watch",
    targetType: "advertiser",
    targetId: "boat",
    targetFingerprint: "fp-boat",
    targetLabel: "boAt",
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "watch-2",
    userId: "user-2",
    name: "Nykaa watch",
    targetType: "advertiser",
    targetId: "nykaa",
    targetFingerprint: "fp-nykaa",
    targetLabel: "Nykaa",
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

const activeBillingInfo = {
  plan: "starter",
  dodoStatus: "active",
  dodoProductId: "prod-starter",
  dodoPlanChangeProductId: null,
  billingInterval: "monthly",
  dodoSubscriptionId: "sub-starter",
  dodoCustomerId: "cus-starter",
  dodoNextBillingAt: "2026-08-01T00:00:00.000Z",
  planUpdatedAt: "2026-07-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runScheduledMonitoring workflow idempotency", () => {
  it("reuses deterministic workflow ids and treats duplicate cron creates as no-ops", async () => {
    const scheduleWatchlistFanout = vi.fn()
      .mockResolvedValueOnce({
        eligible: 2,
        queued: 2,
        duplicates: 0,
        dispatchFailures: 0,
        shadowOnly: 0,
        inlineFallback: false,
      })
      .mockResolvedValueOnce({
        eligible: 2,
        queued: 0,
        duplicates: 2,
        dispatchFailures: 0,
        shadowOnly: 0,
        inlineFallback: false,
      });
    const reconcileOrchestratedWatchlistRuns = vi.fn().mockResolvedValue({
      recovered: 0,
      cancelled: 0,
      redispatched: 0,
    });
    const collectMonitoringOrchestrationMetrics = vi.fn().mockResolvedValue({
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

    vi.doMock("~/lib/monitoring-fanout.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/monitoring-fanout.server")>();
      return {
        ...actual,
        scheduleWatchlistFanout,
        reconcileOrchestratedWatchlistRuns,
        collectMonitoringOrchestrationMetrics,
        resolveMonitoringFanoutMode: vi.fn(() => "fanout" as const),
        isFanoutEnabledForWorkspace: vi.fn(() => true),
        hasOrchestratedRunBlockingInlineScan: vi.fn().mockResolvedValue(false),
      };
    });

    const listActiveWatchlists = vi.fn().mockResolvedValue(activeWatchlists);

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
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
      getDigest: vi.fn().mockResolvedValue(null),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue(activeBillingInfo),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists,
      listObservationsForRun: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const seenIds = new Set<string>();
    const workflowCreate = vi.fn(
      async (input?: { id?: string; params?: Record<string, unknown> }) => {
        if (!input?.id) {
          throw new Error("Workflow id is required for scheduled monitoring.");
        }

        if (seenIds.has(input.id)) {
          throw new Error(`Workflow instance ${input.id} already exists.`);
        }

        seenIds.add(input.id);
        return { id: input.id };
      },
    );

    const env = {
      DB: {},
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
      MONITORING_FANOUT_MODE: "fanout",
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const first = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 5 * * MON",
      scheduledTime: Date.parse("2026-04-20T05:00:00.000Z"),
    });
    const second = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 5 * * MON",
      scheduledTime: Date.parse("2026-04-20T05:00:00.000Z"),
    });

    expect(first).toMatchObject({
      queued: 2,
      duplicates: 0,
      inlineRuns: 0,
      digests: 0,
    });
    expect(second).toMatchObject({
      queued: 0,
      duplicates: 2,
      inlineRuns: 0,
      digests: 0,
    });
    expect(scheduleWatchlistFanout).toHaveBeenCalledTimes(2);
    expect(listActiveWatchlists).toHaveBeenNthCalledWith(1, expect.anything(), { includeScout: false, includeFree: false });
    expect(listActiveWatchlists).toHaveBeenNthCalledWith(2, expect.anything(), { includeScout: false, includeFree: false });
  });

  it("includes Scout watchlists only on six-hour regular scan slots", async () => {
    const scheduleWatchlistFanout = vi.fn().mockResolvedValue({
      eligible: 0,
      queued: 0,
      duplicates: 0,
      dispatchFailures: 0,
      shadowOnly: 0,
      inlineFallback: false,
    });
    vi.doMock("~/lib/monitoring-fanout.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/monitoring-fanout.server")>();
      return {
        ...actual,
        scheduleWatchlistFanout,
        reconcileOrchestratedWatchlistRuns: vi.fn().mockResolvedValue({
          recovered: 0,
          cancelled: 0,
          redispatched: 0,
        }),
        collectMonitoringOrchestrationMetrics: vi.fn().mockResolvedValue({
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
        }),
        resolveMonitoringFanoutMode: vi.fn(() => "fanout" as const),
        isFanoutEnabledForWorkspace: vi.fn(() => true),
        hasOrchestratedRunBlockingInlineScan: vi.fn().mockResolvedValue(false),
      };
    });

    const listActiveWatchlists = vi.fn().mockResolvedValue([]);

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
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
      getDigest: vi.fn().mockResolvedValue(null),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue(activeBillingInfo),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists,
      listObservationsForRun: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const env = {
      DB: {
        prepare() {
          return {
            async all<T>() {
              return { results: [] as T[] };
            },
          };
        },
      },
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-04-20T03:00:00.000Z"),
    });
    await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-04-20T06:00:00.000Z"),
    });
    await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 */3 * * *",
      scheduledTime: Date.parse("2026-04-20T09:00:00.000Z"),
    });

    // 2026-04-20 is a Monday: the 03:00 tick is the free weekly slot, the
    // 06:00 tick is the Scout six-hour slot, and 09:00 includes neither.
    expect(listActiveWatchlists).toHaveBeenNthCalledWith(1, expect.anything(), { includeScout: false, includeFree: true });
    expect(listActiveWatchlists).toHaveBeenNthCalledWith(2, expect.anything(), { includeScout: true, includeFree: false });
    expect(listActiveWatchlists).toHaveBeenNthCalledWith(3, expect.anything(), { includeScout: false, includeFree: false });
  });

  it("builds stable proof-capture request keys from the same watch event inputs", async () => {
    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
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
      getDigest: vi.fn().mockResolvedValue(null),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue(activeBillingInfo),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listObservationsForRun: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { buildProofCaptureRequestIdempotencyKey } = await import("~/lib/monitoring.server");

    const baseline = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });
    const duplicate = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });
    const changed = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-2",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });

    expect(duplicate).toBe(baseline);
    expect(changed).not.toBe(baseline);
  });
});
