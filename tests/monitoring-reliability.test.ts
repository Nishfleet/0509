import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

function buildWatchlist(index: number, label: string): WatchlistRecord {
  return {
    id: `watch-${index}`,
    userId: "user-1",
    name: `${label} watch`,
    targetType: "advertiser",
    targetId: label,
    targetFingerprint: `fp-${label}`,
    targetLabel: label,
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

function buildConfirmedEvent(watchlistId: string): WatchEventRecord {
  return {
    id: `event-${watchlistId}`,
    watchlistId,
    runId: "run-1",
    eventType: "ad_new",
    status: "confirmed",
    importanceScore: 90,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "New ad detected",
    summary: "A new ad appeared.",
    metadata: {},
    confirmedAt: "2026-06-10T04:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-06-10T04:00:00.000Z",
    createdAt: "2026-06-10T04:00:00.000Z",
  } as WatchEventRecord;
}

const PLAN_LIMITS_FIXTURE = {
  free: { digests: false, digestCadence: "none" },
  scout: { digests: true, digestCadence: "weekly" },
  starter: { digests: true, digestCadence: "daily_and_weekly" },
  agency: { digests: true, digestCadence: "daily_and_weekly" },
};

function alertDetail(
  outcome:
    | "provider_accepted"
    | "definitive_terminal_failure"
    | "pending_provider_unknown"
    | "quiet_deferral"
    | "intentional_dedupe" = "provider_accepted",
  claimedByThisRun = true,
  providerAttemptedByThisRun =
    claimedByThisRun && outcome !== "quiet_deferral" && outcome !== "intentional_dedupe",
) {
  return {
    status: outcome === "provider_accepted" ? "sent" : "failed",
    outcome,
    claimedByThisRun,
    providerAttemptedByThisRun,
    duplicate: !claimedByThisRun,
    source: claimedByThisRun ? "current_claim" : "durable_attempt",
  };
}

function mockReliabilityDependencies(input: {
  watchlists: WatchlistRecord[];
  failingTargetLabel?: string;
  digestUsers?: Array<{ id: string; email: string; name: string }>;
  listWatchlistsImpl?: ReturnType<typeof vi.fn>;
  listWatchEventsBetweenImpl?: ReturnType<typeof vi.fn>;
  retryableDigestRuns?: Array<Record<string, unknown>>;
  retryableInstantAttempts?: Array<Record<string, unknown>>;
  runStats?: { runs: number; watchlistsChecked: number; adsSeen: number };
  observationsForRun?: Array<Record<string, unknown>>;
  getDigestImpl?: ReturnType<typeof vi.fn>;
  deliverAlertsImpl?: ReturnType<typeof vi.fn>;
}) {
  const createWatchlistRun = vi.fn(
    async (_env: unknown, watchlistId: string) => `run-${watchlistId}`,
  );
  const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
  const searchAdsViaSourceResolver = vi.fn(
    async (_env: unknown, query: { filters?: { query?: string } }) => {
      if (input.failingTargetLabel && query.filters?.query === input.failingTargetLabel) {
        throw new Error("scan blew up");
      }
      return {
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
        discoveryStatus: "healthy",
        discoverySummary: null,
        discoveryFailureClass: null,
      };
    },
  );
  const deliverWeeklyDigest = vi.fn().mockResolvedValue({
    attempts: 1,
    channels: ["email"],
    details: [
      {
        channel: "email",
        status: "sent",
        targetValue: "owner@example.com",
        providerMessageId: "msg-1",
        errorMessage: null,
        deliveredAt: "2026-06-11T04:00:00.000Z",
      },
    ],
  });
  const listWatchlists =
    input.listWatchlistsImpl ?? vi.fn().mockResolvedValue(input.watchlists);
  const listWatchEventsBetween =
    input.listWatchEventsBetweenImpl ??
    vi.fn(async (_env: unknown, watchlistId: string) => [buildConfirmedEvent(watchlistId)]);
  const logMetaIntegrationStatus = vi.fn().mockResolvedValue(undefined);
  const getDigest = input.getDigestImpl ?? vi.fn().mockResolvedValue(null);
  const listRetryableDigestRuns = vi
    .fn()
    .mockResolvedValue(input.retryableDigestRuns ?? []);
  const createWatchEvent = vi.fn(async () => `event-${Math.floor(1e6 * 0.5)}`);
	const createDigestRun = vi.fn().mockResolvedValue({
		digestRunId: "digest-run-current",
		created: true,
	});
  let digestScheduleJobs: Array<{
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    cadence: "daily" | "weekly";
    periodStart: string;
    periodEnd: string;
    attemptCount: number;
  }> = [];

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
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    searchAdsViaSourceResolver,
  }));
  vi.doMock("~/lib/plan.server", () => ({
    PLAN_LIMITS: PLAN_LIMITS_FIXTURE,
    getUserPlan: vi.fn(async () => "starter"),
  }));
  vi.doMock("~/lib/data.server", () => ({
    addDigestItem: vi.fn(),
		claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
    clearDigestItems: vi.fn(),
		completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(),
    createDigestRun,
    createEventCandidate: vi.fn(),
    createProofCapture: vi.fn(),
    createWatchEvent,
    createWatchlistRun,
    finishWatchlistRun,
    recordWatchlistCapacitySkip: vi.fn().mockResolvedValue("run-skip"),
    getDigest,
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
    getSavedQuery: vi.fn(),
    getSuccessfulRunStatsForUserBetween: vi
      .fn()
      .mockResolvedValue(input.runStats ?? { runs: 0, watchlistsChecked: 0, adsSeen: 0 }),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({ name: "Owner", email: "owner@example.com" }),
    getUserPlanBillingInfo: vi.fn().mockResolvedValue({
      plan: "starter",
      dodoStatus: "active",
      dodoProductId: "prod-starter",
      dodoPlanChangeProductId: null,
      billingInterval: "monthly",
      dodoSubscriptionId: "sub-starter",
      dodoCustomerId: "cus-starter",
      dodoNextBillingAt: "2026-08-01T00:00:00.000Z",
      planUpdatedAt: "2026-07-01T00:00:00.000Z",
    }),
    getWatchlist: vi.fn(async (_env: unknown, watchlistId: string) =>
      input.watchlists.find((candidate) => candidate.id === watchlistId) ?? null,
    ),
    hydrateAdsWithPersistedCreatives: vi.fn(async (_env: unknown, ads: unknown[]) => ads),
    listActiveWatchlists: vi.fn().mockResolvedValue(input.watchlists),
    listObservationsForRun: vi.fn(async (_env: unknown, runId: string) =>
      runId.startsWith("run-") ? (input.observationsForRun ?? []) : [],
    ),
    listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listRetryableDigestRuns,
    enqueueDigestScheduleJobs: vi.fn().mockImplementation(
      async (
        _env: unknown,
        schedule: { cadence: "daily" | "weekly"; periodStart: string; periodEnd: string },
      ) => {
        digestScheduleJobs = (input.digestUsers ?? []).map((user) => ({
          id: `digest-job:${schedule.cadence}:${schedule.periodEnd}:${user.id}`,
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          cadence: schedule.cadence,
          periodStart: schedule.periodStart,
          periodEnd: schedule.periodEnd,
          attemptCount: 0,
        }));
        return digestScheduleJobs.length;
      },
    ),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockImplementation(async () => digestScheduleJobs),
    claimDigestScheduleJob: vi.fn().mockImplementation(
      async (_env: unknown, claim: { jobId: string }) =>
        digestScheduleJobs.find((job) => job.id === claim.jobId) ?? null,
    ),
    completeDigestScheduleJob: vi.fn().mockImplementation(
      async (_env: unknown, completion: { jobId: string }) => {
        digestScheduleJobs = digestScheduleJobs.filter((job) => job.id !== completion.jobId);
        return true;
      },
    ),
    failDigestScheduleJob: vi.fn().mockResolvedValue(true),
    listRetryableInstantAttempts: vi.fn().mockResolvedValue(input.retryableInstantAttempts ?? []),
    listWatchEventsByIds: vi.fn(async (_env: unknown, watchlistId: string, eventIds: string[]) =>
      eventIds.map(() => buildConfirmedEvent(watchlistId)),
    ),
    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchEventsForRun: vi.fn().mockResolvedValue([]),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween,
    listWatchlists,
    logMetaIntegrationStatus,
    touchWatchlistScanned: vi.fn().mockResolvedValue(undefined),
    updateDeliveryAttemptResult: vi.fn(),
    upsertAd: vi.fn(),
    upsertProofTarget: vi.fn(),
  }));
  const deliverWatchlistAlerts = input.deliverAlertsImpl ??
    vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [alertDetail()],
    });
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWatchlistAlerts,
    deliverWeeklyDigest,
  }));
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
  }));

  const env = {
    BROWSER: { fetch: vi.fn() },
    DB: {
      prepare: vi.fn(() => ({
        all: vi.fn(async () => ({ results: input.digestUsers ?? [] })),
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({ success: true })),
        })),
      })),
    },
  };

  return {
    env,
    createWatchEvent,
    createWatchlistRun,
    finishWatchlistRun,
    searchAdsViaSourceResolver,
    deliverWatchlistAlerts,
    deliverWeeklyDigest,
    logMetaIntegrationStatus,
    listWatchlists,
    listRetryableDigestRuns,
    listRetryableInstantAttempts: vi.fn().mockResolvedValue(input.retryableInstantAttempts ?? []),
    listWatchEventsByIds: vi.fn(async (_env: unknown, watchlistId: string, eventIds: string[]) =>
      eventIds.map(() => buildConfirmedEvent(watchlistId)),
    ),
    getDigest,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("scheduled monitoring error isolation", () => {
  it("continues scanning remaining watchlists and still runs digests when one scan throws", async () => {
    const watchlists = [buildWatchlist(1, "adspy"), buildWatchlist(2, "bigspy")];
    const mocks = mockReliabilityDependencies({
      watchlists,
      failingTargetLabel: "adspy",
      digestUsers: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    // both watchlists attempted; the second succeeded despite the first failing
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(2);
    const finishStatuses = mocks.finishWatchlistRun.mock.calls.map(
      (call) => (call[2] as { status: string }).status,
    );
    expect(finishStatuses).toContain("failed");
    expect(finishStatuses).toContain("succeeded");

    // digests still ran after the failure
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(result.digests).toBe(1);
    expect(result.inlineRuns).toBe(1);
    expect(result.inlineFailures).toBe(1);
  });

  it("runs digests before the scan loop so a mid-scan kill cannot lose the day's digests", async () => {
    const watchlists = [buildWatchlist(1, "adspy")];
    const callOrder: string[] = [];
    const mocks = mockReliabilityDependencies({
      watchlists,
      digestUsers: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    });

    mocks.deliverWeeklyDigest.mockImplementation(async () => {
      callOrder.push("digest");
      return {
        attempts: 1,
        channels: ["email"],
        details: [{ status: "sent" }],
      };
    });
    mocks.createWatchlistRun.mockImplementation(async (_env: unknown, watchlistId: string) => {
      callOrder.push("scan");
      return `run-${watchlistId}`;
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.digests).toBe(1);
    expect(result.inlineRuns).toBe(1);
    expect(callOrder[0]).toBe("digest");
    expect(callOrder).toContain("scan");
  });

  it("skips scans entirely when includeScans is false but still delivers digests", async () => {
    const watchlists = [buildWatchlist(1, "adspy"), buildWatchlist(2, "bigspy")];
    const mocks = mockReliabilityDependencies({
      watchlists,
      digestUsers: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeScans: false,
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-15T05:00:00.000Z"),
    });

    expect(result.digests).toBe(1);
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
    expect(result.inlineRuns).toBe(0);
  });

  it("stops starting new scans once the time budget is exhausted and reports the skipped count", async () => {
    const watchlists = [
      buildWatchlist(1, "adspy"),
      buildWatchlist(2, "bigspy"),
      buildWatchlist(3, "poweradspy"),
    ];
    const mocks = mockReliabilityDependencies({ watchlists });

    const realNow = Date.now;
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow.call(Date) + elapsed);
    // First scan consumes the whole budget; the remaining two must be skipped,
    // not silently killed by the runtime wall limit.
    mocks.createWatchlistRun.mockImplementation(async (_env: unknown, watchlistId: string) => {
      elapsed += 13 * 60 * 1000;
      return `run-${watchlistId}`;
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: realNow.call(Date),
    });

    expect(result.inlineRuns).toBe(1);
    expect(result.skippedForBudget).toBe(2);
    expect(mocks.createWatchlistRun).toHaveBeenCalledTimes(1);
  });

  it("does not let one user's digest failure abort other users' digests", async () => {
    const listWatchlists = vi.fn(async (_env: unknown, userId: string) => {
      if (userId === "user-1") {
        throw new Error("digest assembly failed for user-1");
      }
      return [
        {
          ...buildWatchlist(9, "okbrand"),
          userId,
        },
      ];
    });
    const mocks = mockReliabilityDependencies({
      watchlists: [],
      digestUsers: [
        { id: "user-1", email: "first@example.com", name: "First" },
        { id: "user-2", email: "second@example.com", name: "Second" },
      ],
      listWatchlistsImpl: listWatchlists,
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-2" }),
    );
    expect(result.digests).toBe(1);
  });
});

describe("digest retry sweep", () => {
  it("redelivers recent digest runs whose delivery failed", async () => {
    const failedDigest = {
      id: "digest-old-1",
      userId: "user-7",
      userEmail: "seven@example.com",
      userName: "Seven",
      periodStart: "2026-06-09T04:00:00.000Z",
      periodEnd: "2026-06-10T04:00:00.000Z",
    };
    const getDigest = vi.fn().mockResolvedValue({
      id: "digest-old-1",
      userId: "user-7",
      periodStart: "2026-06-09T04:00:00.000Z",
      periodEnd: "2026-06-10T04:00:00.000Z",
			summary: {
				totalEvents: 1,
				watchlists: 1,
				digestItemSetProvenance: "atomic-v2",
			},
      createdAt: "2026-06-10T04:00:00.000Z",
      items: [
        {
          id: "item-1",
          digestRunId: "digest-old-1",
          watchlistId: "watch-7",
          watchlistName: "brand seven watch",
          eventType: "ad_new",
          title: "New ad detected",
          summary: "A new ad appeared.",
		  metadata: { eventId: "event-1" },
          createdAt: "2026-06-10T04:00:00.000Z",
        },
      ],
      delivery: {
        id: "delivery-1",
        digestRunId: "digest-old-1",
        provider: "cloudflare_email",
        status: "failed",
        recipientEmail: "seven@example.com",
        externalMessageId: null,
        errorMessage: "Cloudflare Email send failed: network timeout.",
        deliveredAt: null,
      },
    });
    const mocks = mockReliabilityDependencies({
      watchlists: [],
      digestUsers: [],
      retryableDigestRuns: [failedDigest],
      getDigestImpl: getDigest,
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "daily",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(mocks.listRetryableDigestRuns).toHaveBeenCalled();
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-7",
        digestRunId: "digest-old-1",
        periodStart: "2026-06-09T04:00:00.000Z",
        periodEnd: "2026-06-10T04:00:00.000Z",
        items: [
          expect.objectContaining({
            watchlistId: "watch-7",
            title: "New ad detected",
          }),
        ],
      }),
    );
    expect(result.digests).toBe(1);
  });

  it("retries all-quiet heartbeat digests with reconstructed scan stats", async () => {
    const failedDigest = {
      id: "digest-quiet-1",
      userId: "user-9",
      userEmail: "nine@example.com",
      userName: "Nine",
      periodStart: "2026-06-09T04:00:00.000Z",
      periodEnd: "2026-06-10T04:00:00.000Z",
    };
    const getDigest = vi.fn().mockResolvedValue({
      id: "digest-quiet-1",
      userId: "user-9",
      periodStart: "2026-06-09T04:00:00.000Z",
      periodEnd: "2026-06-10T04:00:00.000Z",
			summary: {
				totalEvents: 0,
				watchlists: 1,
				digestItemSetProvenance: "atomic-v2",
			},
      createdAt: "2026-06-10T04:00:00.000Z",
      items: [],
      delivery: {
        id: "delivery-quiet-1",
        digestRunId: "digest-quiet-1",
        provider: "cloudflare_email",
        status: "failed",
        recipientEmail: "nine@example.com",
        externalMessageId: null,
        errorMessage: "Cloudflare Email send failed: network timeout.",
        deliveredAt: null,
      },
    });
    const mocks = mockReliabilityDependencies({
      watchlists: [],
      digestUsers: [],
      retryableDigestRuns: [failedDigest],
      getDigestImpl: getDigest,
      runStats: { runs: 5, watchlistsChecked: 2, adsSeen: 44 },
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "daily",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-9",
        digestRunId: "digest-quiet-1",
        items: [],
        heartbeat: { runs: 5, watchlistsChecked: 2, adsSeen: 44 },
      }),
    );
    expect(result.digests).toBe(1);
  });

  it("skips retrying digests for users whose plan no longer includes digests", async () => {
    const failedDigest = {
      id: "digest-old-2",
      userId: "user-8",
      userEmail: "eight@example.com",
      userName: "Eight",
      periodStart: "2026-06-09T04:00:00.000Z",
      periodEnd: "2026-06-10T04:00:00.000Z",
    };
    const mocks = mockReliabilityDependencies({
      watchlists: [],
      digestUsers: [],
      retryableDigestRuns: [failedDigest],
    });
    const { getUserPlan } = await import("~/lib/plan.server");
    (getUserPlan as ReturnType<typeof vi.fn>).mockResolvedValue("free");

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(mocks.deliverWeeklyDigest).not.toHaveBeenCalled();
    expect(result.digests).toBe(0);
  });
});

describe("instant alert flush", () => {
  it("re-delivers deferred or failed instant alerts grouped by watchlist", async () => {
    const watchlists = [buildWatchlist(1, "adspy")];
    const mocks = mockReliabilityDependencies({
      watchlists,
      retryableInstantAttempts: [
        {
          id: "attempt-1",
          watchlistId: "watch-1",
          eventIds: ["event-a", "event-b"],
          status: "skipped_due_to_quiet_hours",
        },
        {
          id: "attempt-2",
          watchlistId: "watch-1",
          eventIds: ["event-b"],
          status: "failed",
        },
      ],
    });

    const { flushDeferredInstantAlerts } = await import("~/lib/monitoring.server");
    const result = await flushDeferredInstantAlerts(mocks.env as never);

    expect(result.groups).toBe(1);
    expect(mocks.deliverWatchlistAlerts).toHaveBeenCalledTimes(1);
    const call = mocks.deliverWatchlistAlerts.mock.calls[0]?.[1] as {
      watchlist: { id: string };
      events: unknown[];
      lane: string;
    };
    expect(call.watchlist.id).toBe("watch-1");
    // event ids deduped across the two pending attempts
    expect(call.events).toHaveLength(2);
    expect(call.lane).toBe("customer");
  });

  it("skips watchlists that are gone or paused", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [],
      retryableInstantAttempts: [
        {
          id: "attempt-1",
          watchlistId: "watch-missing",
          eventIds: ["event-a"],
          status: "failed",
        },
      ],
    });

    const { flushDeferredInstantAlerts } = await import("~/lib/monitoring.server");
    const result = await flushDeferredInstantAlerts(mocks.env as never);

    expect(result.groups).toBe(0);
    expect(mocks.deliverWatchlistAlerts).not.toHaveBeenCalled();
  });

  it("reports caught per-group delivery failures in its aggregate result", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      retryableInstantAttempts: [{
        id: "attempt-1",
        watchlistId: "watch-1",
        eventIds: ["event-a"],
        status: "failed",
      }],
      deliverAlertsImpl: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { flushDeferredInstantAlerts } = await import("~/lib/monitoring.server");
    const result = await flushDeferredInstantAlerts(mocks.env as never);

    expect(result).toEqual({ groups: 0, attempts: 0, failures: 1 });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("reports resolved provider failures in its aggregate result", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      retryableInstantAttempts: [{
        id: "attempt-1",
        watchlistId: "watch-1",
        eventIds: ["event-a"],
        status: "failed",
      }],
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [alertDetail("definitive_terminal_failure")],
      }),
    });

    const { flushDeferredInstantAlerts } = await import("~/lib/monitoring.server");
    const result = await flushDeferredInstantAlerts(mocks.env as never);

    expect(result).toEqual({ groups: 1, attempts: 1, failures: 1 });
  });

  it("fails closed when a resolved provider summary omits attempt details", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      retryableInstantAttempts: [{
        id: "attempt-1",
        watchlistId: "watch-1",
        eventIds: ["event-a"],
        status: "failed",
      }],
      deliverAlertsImpl: vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] }),
    });

    const { flushDeferredInstantAlerts } = await import("~/lib/monitoring.server");
    expect(await flushDeferredInstantAlerts(mocks.env as never))
      .toEqual({ groups: 1, attempts: 0, failures: 1 });
  });
});

describe("all-quiet heartbeat digests", () => {
  it("sends an all-quiet digest when the period had successful scans but no events", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      digestUsers: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
      listWatchEventsBetweenImpl: vi.fn().mockResolvedValue([]),
      runStats: { runs: 7, watchlistsChecked: 1, adsSeen: 84 },
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeScans: false,
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-15T05:00:00.000Z"),
    });

    expect(result.digests).toBe(1);
    expect(mocks.deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    const call = mocks.deliverWeeklyDigest.mock.calls[0]?.[1] as {
      items: unknown[];
      heartbeat: { runs: number; adsSeen: number } | null;
    };
    expect(call.items).toHaveLength(0);
    expect(call.heartbeat).toMatchObject({ runs: 7, adsSeen: 84 });
  });

  it("stays silent when there were neither events nor successful scans", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      digestUsers: [{ id: "user-1", email: "owner@example.com", name: "Owner" }],
      listWatchEventsBetweenImpl: vi.fn().mockResolvedValue([]),
      runStats: { runs: 0, watchlistsChecked: 0, adsSeen: 0 },
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeScans: false,
      includeDigests: true,
      digestCadence: "weekly",
      scheduledTime: Date.parse("2026-06-15T05:00:00.000Z"),
    });

    expect(result.digests).toBe(0);
    expect(mocks.deliverWeeklyDigest).not.toHaveBeenCalled();
  });
});

describe("first-scan baseline event", () => {
  it("records one baseline event instead of an ad_new flood on the first scan", async () => {
    const observations = Array.from({ length: 3 }, (_, index) => ({
      id: `obs-${index}`,
      ad_id: `ad-${index}`,
      landing_page_url: null,
      metadata_json: "{}",
    }));
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: observations,
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    // one event for the whole baseline, not three ad_new events
    expect(mocks.createWatchEvent).toHaveBeenCalledTimes(1);
    const draft = (mocks.createWatchEvent.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(String(draft.title)).toContain("Baseline captured: 3 active ads");
    expect((draft.metadata as Record<string, unknown>).kind).toBe("baseline");
  });

  it("marks the run failed and records honest counts when an alert attempt fails", async () => {
    const observations = [{
      id: "obs-1",
      ad_id: "ad-1",
      landing_page_url: null,
      metadata_json: "{}",
    }];
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: observations,
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [alertDetail("definitive_terminal_failure")],
      }),
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(mocks.deliverWatchlistAlerts).toHaveBeenCalledTimes(1);
    expect(result.inlineFailures).toBe(1);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-watch-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "alert_delivery_failed",
        summary: expect.objectContaining({
          sendsTriggered: 0,
          sendAttempts: 1,
          sendFailures: 1,
        }),
      }),
    );
  });

  it("keeps the run successful when an alert is intentionally deferred by quiet hours", async () => {
    const observations = [{
      id: "obs-1",
      ad_id: "ad-1",
      landing_page_url: null,
      metadata_json: "{}",
    }];
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: observations,
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [alertDetail("quiet_deferral")],
      }),
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.inlineFailures).toBe(0);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-watch-1",
      expect.objectContaining({
        status: "succeeded",
        errorCode: null,
        summary: expect.objectContaining({
          sendsTriggered: 0,
          sendAttempts: 0,
          sendFailures: 0,
          sendDeferrals: 1,
        }),
      }),
    );
  });

  it("treats a durable accepted duplicate as logically successful without current-run counters", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: [{
        id: "obs-1",
        ad_id: "ad-1",
        landing_page_url: null,
        metadata_json: "{}",
      }],
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [alertDetail("provider_accepted", false)],
      }),
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.inlineFailures).toBe(0);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-watch-1",
      expect.objectContaining({
        status: "succeeded",
        summary: expect.objectContaining({
          sendsTriggered: 0,
          sendAttempts: 0,
          sendFailures: 0,
          sendDeferrals: 0,
        }),
      }),
    );
  });

  it("treats intentional dedupe as successful without current-run counters or private detail persistence", async () => {
    const privateRecipient = "private-recipient@example.com";
    const privateProviderId = "provider-message-private";
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: [{
        id: "obs-1",
        ad_id: "ad-1",
        landing_page_url: null,
        metadata_json: "{}",
      }],
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [{
          ...alertDetail("intentional_dedupe", false),
          targetValue: privateRecipient,
          providerMessageId: privateProviderId,
        }],
      }),
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.inlineFailures).toBe(0);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-watch-1",
      expect.objectContaining({
        status: "succeeded",
        summary: expect.objectContaining({
          sendsTriggered: 0,
          sendAttempts: 0,
          sendFailures: 0,
          sendDeferrals: 0,
        }),
      }),
    );
    expect(JSON.stringify(mocks.finishWatchlistRun.mock.calls)).not.toContain(privateRecipient);
    expect(JSON.stringify(mocks.finishWatchlistRun.mock.calls)).not.toContain(privateProviderId);
    expect(JSON.stringify(mocks.logMetaIntegrationStatus.mock.calls)).not.toContain(privateRecipient);
    expect(JSON.stringify(mocks.logMetaIntegrationStatus.mock.calls)).not.toContain(privateProviderId);
  });

  it.each([
    ["definitive_terminal_failure", "alert_delivery_failed"],
    ["pending_provider_unknown", "alert_delivery_pending_provider_unknown"],
  ] as const)(
    "persists a durable duplicate %s as non-success without current-run counters",
    async (outcome, errorCode) => {
      const mocks = mockReliabilityDependencies({
        watchlists: [buildWatchlist(1, "adspy")],
        observationsForRun: [{
          id: "obs-1",
          ad_id: "ad-1",
          landing_page_url: null,
          metadata_json: "{}",
        }],
        deliverAlertsImpl: vi.fn().mockResolvedValue({
          attempts: 1,
          channels: ["email"],
          details: [alertDetail(outcome, false)],
        }),
      });

      const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
      const result = await runScheduledMonitoring(mocks.env as never, {
        includeDigests: false,
        scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
      });

      expect(result.inlineFailures).toBe(1);
      expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
        expect.anything(),
        "run-watch-1",
        expect.objectContaining({
          status: "failed",
          errorCode,
          summary: expect.objectContaining({
            sendsTriggered: 0,
            sendAttempts: 0,
            sendFailures: 0,
            sendDeferrals: 0,
          }),
        }),
      );
    },
  );

  it.each(["email", "whatsapp", "slack"] as const)(
    "counts a %s provider attempt lost at finalization without owning its durable failure",
    async (channel) => {
      const mocks = mockReliabilityDependencies({
        watchlists: [buildWatchlist(1, "adspy")],
        observationsForRun: [{
          id: "obs-1",
          ad_id: "ad-1",
          landing_page_url: null,
          metadata_json: "{}",
        }],
        deliverAlertsImpl: vi.fn().mockResolvedValue({
          attempts: 1,
          channels: [channel],
          details: [{
            ...alertDetail("definitive_terminal_failure", false, true),
            channel,
          }],
        }),
      });

      const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
      const result = await runScheduledMonitoring(mocks.env as never, {
        includeDigests: false,
        scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
      });

      expect(result.inlineFailures).toBe(1);
      expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
        expect.anything(),
        "run-watch-1",
        expect.objectContaining({
          status: "failed",
          errorCode: "alert_delivery_failed",
          summary: expect.objectContaining({
            sendsTriggered: 0,
            sendAttempts: 1,
            sendFailures: 0,
            sendDeferrals: 0,
          }),
        }),
      );
    },
  );

  it.each([
    ["missing", undefined],
    ["cardinality-mismatched", []],
    ["malformed", [{}]],
  ] as const)("fails closed when alert details are %s", async (_label, details) => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
      observationsForRun: [{
        id: "obs-1",
        ad_id: "ad-1",
        landing_page_url: null,
        metadata_json: "{}",
      }],
      deliverAlertsImpl: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        ...(details === undefined ? {} : { details }),
      }),
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.inlineFailures).toBe(1);
    expect(mocks.finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-watch-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "alert_delivery_outcome_invalid",
      }),
    );
  });
});

describe("concurrent-scan guard", () => {
  it("refuses to start a scan while another run for the watchlist is in flight", async () => {
    const watchlist = buildWatchlist(1, "adspy");
    const mocks = mockReliabilityDependencies({ watchlists: [watchlist] });
    const data = await import("~/lib/data.server");
    vi.mocked(data.hasInFlightWatchlistRun).mockResolvedValue(true);

    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    await expect(runWatchlistManual(mocks.env as never, watchlist)).rejects.toThrow(
      /already running/,
    );
    // no second run row, no second browser scan
    expect(mocks.createWatchlistRun).not.toHaveBeenCalled();
    expect(mocks.searchAdsViaSourceResolver).not.toHaveBeenCalled();
  });
});

describe("stale-cache scan honesty", () => {
  it("records a failed run and detects nothing when discovery served stale cache", async () => {
    const mocks = mockReliabilityDependencies({
      watchlists: [buildWatchlist(1, "adspy")],
    });
    mocks.searchAdsViaSourceResolver.mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoverySummary: null,
      discoveryFailureClass: null,
    });

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(mocks.env as never, {
      includeDigests: false,
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(result.inlineFailures).toBe(1);
    // no fabricated events from days-old cached data
    expect(mocks.createWatchEvent).not.toHaveBeenCalled();
    const finishStatuses = mocks.finishWatchlistRun.mock.calls.map(
      (call) => (call[2] as { status: string }).status,
    );
    expect(finishStatuses).toContain("failed");
  });
});

describe("canonical URL diffing", () => {
  function observation(adId: string, url: string | null) {
    return {
      id: `obs-${adId}-${url ?? "none"}`,
      ad_id: adId,
      landing_page_url: url,
      metadata_json: "{}",
    };
  }

  it("ignores tracking-parameter churn but catches real destination changes", async () => {
    mockReliabilityDependencies({ watchlists: [] });
    const { diffWatchlistObservations } = await import("~/lib/monitoring.server");
    const watchlist = buildWatchlist(1, "adspy");

    const trackingOnly = diffWatchlistObservations(
      watchlist as never,
      [observation("ad-1", "https://example.com/sale?utm_content=v2&fbclid=abc")] as never,
      [observation("ad-1", "https://example.com/sale?utm_content=v1")] as never,
      [] as never,
    );
    expect(trackingOnly).toEqual([]);

    const realChange = diffWatchlistObservations(
      watchlist as never,
      [observation("ad-1", "https://example.com/new-landing")] as never,
      [observation("ad-1", "https://example.com/sale")] as never,
      [] as never,
    );
    expect(realChange).toEqual([
      expect.objectContaining({ eventType: "landing_page_url_changed" }),
    ]);
  });
});
