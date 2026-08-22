import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Brief-as-retention-loop (lane 1): retried digest deliveries must carry the
 * same four retention inputs (previous-brief count, next-scan expiry) as
 * first sends. A retry that drops them renders a false "first brief on file"
 * baseline and the explicit-unavailable expiry on an email the customer
 * already saw once — exactly the quiet-week silence the retention loop
 * exists to prevent.
 */

const PERIOD_END = "2026-07-15T04:00:00.000Z";
const PERIOD_START = "2026-07-08T04:00:00.000Z";
const RETRY_DIGEST_ID = "digest-retry-1";

function retryCandidate() {
  return {
    id: RETRY_DIGEST_ID,
    userId: "user-1",
    userName: "Priya",
    userEmail: "priya@example.com",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    attemptCount: 1,
  };
}

function retriedQuietDigest() {
  return {
    id: RETRY_DIGEST_ID,
    userId: "user-1",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    summary: {
      digestItemSetProvenance: "atomic-v2",
      totalEvents: 0,
    },
    createdAt: PERIOD_END,
    items: [],
    delivery: null,
  };
}

function previousBriefWithItems(count: number) {
  const olderPeriodEnd = "2026-07-08T04:00:00.000Z";
  return {
    id: "digest-previous-1",
    userId: "user-1",
    periodStart: "2026-07-01T04:00:00.000Z",
    periodEnd: olderPeriodEnd,
    summary: {},
    createdAt: olderPeriodEnd,
    items: Array.from({ length: count }, (_, index) => ({
      id: `prev-item-${index}`,
      digestRunId: "digest-previous-1",
      watchlistId: "watch-1",
      watchlistName: "Nykaa",
      eventType: "ad_new",
      title: "Nykaa launched a new ad",
      summary: "New ad detected.",
      metadata: { eventId: `event-${index}` },
      createdAt: olderPeriodEnd,
    })),
    delivery: { status: "sent" },
  };
}

function dataServerMock(overrides: Record<string, unknown> = {}) {
  return {
    addDigestItem: vi.fn(),
    claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
    clearDigestItems: vi.fn(),
    completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    createDigestRun: vi
      .fn()
      .mockResolvedValue({ digestRunId: "digest-new", created: true }),
    getDigest: vi.fn().mockImplementation(async (_env: unknown, id: string) =>
      id === RETRY_DIGEST_ID ? retriedQuietDigest() : null,
    ),
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getSuccessfulRunStatsForUserBetween: vi
      .fn()
      .mockResolvedValue({ runs: 4, watchlistsChecked: 1, adsSeen: 20 }),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([previousBriefWithItems(3)]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([retryCandidate()]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
    listWatchlists: vi.fn().mockResolvedValue([]),
    updateDigestRunSummary: vi.fn(),
    upsertDigestDelivery: vi.fn(),
    enqueueDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue([]),
    claimDigestScheduleJob: vi.fn().mockResolvedValue(null),
    completeDigestScheduleJob: vi.fn().mockResolvedValue(true),
    failDigestScheduleJob: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function planServerMock() {
  return {
    getUserPlan: vi.fn().mockResolvedValue("agency"),
    PLAN_LIMITS: {
      free: { digests: false, digestCadence: "none" },
      scout: { digests: true, digestCadence: "weekly" },
      starter: { digests: true, digestCadence: "weekly" },
      agency: { digests: true, digestCadence: "daily_and_weekly" },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("retried digest deliveries keep the retention loop intact", () => {
  it("passes the same retention inputs to a retried all-quiet brief as a first send", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
      deliverScanTroubleNotice: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => planServerMock());

    const { runDigestDeliveryCycleDetailed } = await import(
      "~/lib/digest-orchestration.server"
    );
    const result = await runDigestDeliveryCycleDetailed(
      { DB: {} } as never,
      { cadence: "weekly", periodEnd: PERIOD_END },
    );

    // The only delivery in this cycle is the retry: no schedule jobs are
    // queued, so every deliverWeeklyDigest call is the retry path.
    expect(result.sent).toBe(1);
    expect(data.listRetryableDigestRuns).toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: RETRY_DIGEST_ID,
        heartbeat: expect.objectContaining({
          runs: 4,
          watchlistsChecked: 1,
          adsSeen: 20,
        }),
        previousBriefItemCount: 3,
        hasPreviousBrief: true,
        nextScanAt: expect.any(String),
        nextScanLabel: expect.any(String),
      }),
    );
    const input = deliverWeeklyDigest.mock.calls[0][1] as {
      nextScanAt: string;
    };
    expect(Number.isFinite(Date.parse(input.nextScanAt))).toBe(true);
  });
});
