import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchEventRecord } from "~/lib/types";

/**
 * Visual diff alert payloads (2026-08-17): the alert payloads half of
 * "Before/after VISUAL diffs on change events". The watchlist-events half
 * shipped in PR #715 (commit `feb1d460`); this suite covers the write side
 * that wires the stored proof-capture screenshot pair into alert metadata
 * so the existing digest-email renderers and the instant-alert
 * `renderEventDiffHtml` can pick it up.
 */

function watchEvent(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 92,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: "candidate-1",
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      from: "Starting at ₹499",
      to: "Starting at ₹799",
      sourceUrl: "https://example.com/offer",
    },
    confirmedAt: "2026-08-10T04:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-08-10T04:00:00.000Z",
    createdAt: "2026-08-10T04:00:00.000Z",
    ...overrides,
  };
}

const SAMPLE_KEY_PREVIOUS =
  "landing-pages/2026-08-09/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpeg";
const SAMPLE_KEY_CURRENT =
  "landing-pages/2026-08-10/11111111-2222-3333-4444-555555555555.jpeg";

function dataServerMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
      .mockResolvedValue({ runs: 4, watchlistsChecked: 1, adsSeen: 20, noChangeRuns: 4 }),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([watchEvent()]),
    listWatchlists: vi.fn().mockResolvedValue([
      { id: "watch-1", name: "boAt watch", lastScannedAt: "2026-08-10T04:00:00.000Z" },
    ]),
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
    listDigestScheduleJobsAwaitingAlert: vi.fn().mockResolvedValue([]),
    claimDigestScheduleJobExhaustionAlert: vi.fn().mockResolvedValue(null),
    settleDigestScheduleJobExhaustionAlert: vi.fn().mockResolvedValue(true),
    listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
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
  data: Record<string, unknown>,
  deliverWeeklyDigest: ReturnType<typeof vi.fn>,
  cadence: "daily" | "weekly" = "weekly",
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
  return runDigestDeliveryCycle(
    { DB: {}, APP_ORIGIN: "https://0509.io" } as never,
    {
      cadence,
      periodEnd: "2026-08-15T04:00:00.000Z",
    },
  );
}

function firstDeliveredItem(
  deliverWeeklyDigest: ReturnType<typeof vi.fn>,
): { metadata?: Record<string, unknown> } {
  const calls = deliverWeeklyDigest.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const args = calls[0] as [
    unknown,
    { items: Array<{ metadata?: Record<string, unknown> }> },
  ];
  return args[1].items[0];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("digest orchestration screenshot-pair wiring", () => {
  it("attaches before/after screenshot URLs to the digest item metadata when both captures are stored", async () => {
    const data = dataServerMock({
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([
        {
          eventId: "event-1",
          current: {
            id: "proof-current",
            status: "succeeded",
            screenshotArtifactKey: SAMPLE_KEY_CURRENT,
          },
          previous: {
            id: "proof-previous",
            status: "succeeded",
            screenshotArtifactKey: SAMPLE_KEY_PREVIOUS,
          },
        },
      ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const item = firstDeliveredItem(deliverWeeklyDigest);
    expect(item.metadata?.beforeCreativeImageUrl).toBe(
      `https://0509.io/artifacts/proof/${encodeURIComponent(SAMPLE_KEY_PREVIOUS)}`,
    );
    expect(item.metadata?.afterCreativeImageUrl).toBe(
      `https://0509.io/artifacts/proof/${encodeURIComponent(SAMPLE_KEY_CURRENT)}`,
    );
  });

  it("does not write the pair when only one side has a screenshot on file", async () => {
    const data = dataServerMock({
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([
        {
          eventId: "event-1",
          current: {
            id: "proof-current",
            status: "succeeded",
            screenshotArtifactKey: SAMPLE_KEY_CURRENT,
          },
          previous: {
            id: "proof-previous",
            status: "succeeded",
            screenshotArtifactKey: null,
          },
        },
      ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const item = firstDeliveredItem(deliverWeeklyDigest);
    expect(item.metadata?.beforeCreativeImageUrl).toBeUndefined();
    expect(item.metadata?.afterCreativeImageUrl).toBeUndefined();
  });

  it("does not write the pair when no previous capture exists", async () => {
    const data = dataServerMock({
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([
        {
          eventId: "event-1",
          current: {
            id: "proof-current",
            status: "succeeded",
            screenshotArtifactKey: SAMPLE_KEY_CURRENT,
          },
          previous: null,
        },
      ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const item = firstDeliveredItem(deliverWeeklyDigest);
    expect(item.metadata?.beforeCreativeImageUrl).toBeUndefined();
    expect(item.metadata?.afterCreativeImageUrl).toBeUndefined();
  });

  it("degrades to no pair when the lookup helper is missing (test adapter)", async () => {
    // Helper omitted entirely — mirrors a test adapter or a release where
    // the data-server surface hasn't been deployed yet. The helper must
    // never crash the digest run.
    const data = dataServerMock();
    delete (data as { listProofCapturePairsForEventIds?: unknown })
      .listProofCapturePairsForEventIds;
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const item = firstDeliveredItem(deliverWeeklyDigest);
    expect(item.metadata?.beforeCreativeImageUrl).toBeUndefined();
    expect(item.metadata?.afterCreativeImageUrl).toBeUndefined();
  });
});
