import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP-21 heartbeat auto-degrade: after 3 consecutive daily all-quiet heartbeat
 * digests, further daily heartbeats stay silent until a period with events
 * resets the derived streak. Weekly heartbeats are unaffected.
 */

const PERIOD_END = "2026-07-15T04:00:00.000Z"; // Wednesday — clear of the Monday firewall.
const DAY_MS = 24 * 60 * 60 * 1000;

function digestHistoryEntry(index: number, options: { items?: unknown[] } = {}) {
  const periodEnd = new Date(Date.parse(PERIOD_END) - (index + 1) * DAY_MS);
  const periodStart = new Date(periodEnd.getTime() - DAY_MS);
  return {
    id: `digest-history-${index}`,
    userId: "user-1",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    summary: { totalEvents: options.items?.length ?? 0 },
    createdAt: periodEnd.toISOString(),
    items: options.items ?? [],
    delivery: { status: "sent" },
  };
}

function quietDailyHistory(count: number) {
  return Array.from({ length: count }, (_, index) => digestHistoryEntry(index));
}

function movementItem() {
  return {
    id: "item-1",
    watchlistId: "watch-1",
    watchlistName: "boAt watch",
    eventType: "landing_page_offer_changed",
    title: "Landing page offer changed",
    summary: "Offer changed.",
    metadata: { eventId: "event-1" },
  };
}

function dataServerMock(overrides: Record<string, unknown> = {}) {
  let digestScheduleJobs: Array<Record<string, unknown>> = [];
  return {
    addDigestItem: vi.fn(),
    claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
    clearDigestItems: vi.fn(),
    completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    createDigestRun: vi
      .fn()
      .mockResolvedValue({ digestRunId: "digest-new", created: true }),
    getDigest: vi.fn().mockResolvedValue(null),
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getSuccessfulRunStatsForUserBetween: vi
      .fn()
      .mockResolvedValue({ runs: 4, watchlistsChecked: 1, adsSeen: 20 }),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
    listWatchlists: vi
      .fn()
      .mockResolvedValue([{ id: "watch-1", name: "boAt watch" }]),
    updateDigestRunSummary: vi.fn(),
    upsertDigestDelivery: vi.fn(),
    enqueueDigestScheduleJobs: vi.fn().mockImplementation(
      async (
        _env: unknown,
        input: { cadence: "daily" | "weekly"; periodStart: string; periodEnd: string },
      ) => {
        digestScheduleJobs = [
          {
            id: "digest-job-user-1",
            userId: "user-1",
            userEmail: "owner@example.com",
            userName: "Owner",
            cadence: input.cadence,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            attemptCount: 0,
          },
        ];
        return 1;
      },
    ),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi
      .fn()
      .mockImplementation(async () => digestScheduleJobs),
    claimDigestScheduleJob: vi.fn().mockImplementation(
      async (_env: unknown, input: { jobId: string }) =>
        digestScheduleJobs.find((job) => job.id === input.jobId) ?? null,
    ),
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

async function runCycle(
  data: ReturnType<typeof dataServerMock>,
  deliverWeeklyDigest: ReturnType<typeof vi.fn>,
  cadence: "daily" | "weekly",
) {
  vi.doMock("~/lib/auth.server", () => ({}));
  vi.doMock("~/lib/data.server", () => data);
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWeeklyDigest,
    deliverScanTroubleNotice: vi.fn(),
  }));
  vi.doMock("~/lib/plan.server", () => planServerMock());

  const { runDigestDeliveryCycle } = await import(
    "~/lib/digest-orchestration.server"
  );
  return runDigestDeliveryCycle({ DB: {} } as never, {
    cadence,
    periodEnd: PERIOD_END,
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("WP-21 daily heartbeat auto-degrade", () => {
  it("stays silent on the 4th consecutive quiet day — no digest run, no email", async () => {
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(quietDailyHistory(3)),
    });
    const deliverWeeklyDigest = vi.fn();

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    expect(result).toBe(0);
    expect(data.listDigests).toHaveBeenCalledWith(expect.anything(), "user-1", 3);
    expect(data.createDigestRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });

  it("keeps sending daily heartbeats while the quiet streak is under 3", async () => {
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(quietDailyHistory(2)),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    expect(result).toBe(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          runs: 4,
          watchlistsChecked: 1,
          adsSeen: 20,
          // Zero-noise triage: the period is truthfully all-quiet.
          triage: expect.objectContaining({ status: "all_quiet" }),
        }),
        items: [],
      }),
    );
  });

  it("resumes daily heartbeats after a period with events resets the streak", async () => {
    const data = dataServerMock({
      listDigests: vi
        .fn()
        .mockResolvedValue([
          digestHistoryEntry(0, { items: [movementItem()] }),
          digestHistoryEntry(1),
          digestHistoryEntry(2),
        ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    expect(result).toBe(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          runs: 4,
          watchlistsChecked: 1,
          adsSeen: 20,
          triage: expect.objectContaining({ status: "all_quiet" }),
        }),
      }),
    );
  });

  it("leaves weekly heartbeats unaffected by a daily quiet streak", async () => {
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(quietDailyHistory(3)),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "weekly");

    expect(result).toBe(1);
    // Brief-as-retention-loop (lane 1, 2026-08-14): the email surface now
    // looks up the previous digest on file to populate the retention
    // delta field, so listDigests is called exactly once for the retention
    // frame — the daily quiet-streak lookup is still gated to the daily
    // cadence path.
    expect(data.listDigests).toHaveBeenCalledTimes(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          runs: 4,
          watchlistsChecked: 1,
          adsSeen: 20,
          triage: expect.objectContaining({ status: "all_quiet" }),
        }),
        previousBriefItemCount: 0,
        hasPreviousBrief: true,
      }),
    );
  });
});
