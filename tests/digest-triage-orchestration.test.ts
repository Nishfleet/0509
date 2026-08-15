import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyWatchPeriodTriage,
  triageToDigestSummary,
} from "~/lib/watch-event-evaluator.server";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
} from "~/lib/types";

/**
 * Zero-noise triage through digest orchestration (2026-08-06, sealed packet
 * acceptance): the five fixtures run through the digest delivery cycle and
 * the truthful classification reaches the persisted digest summary AND the
 * email renderer's heartbeat. Failed/pending periods never become all quiet.
 */

const PERIOD_END = "2026-07-15T04:00:00.000Z";
const PERIOD_START = "2026-07-08T04:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(overrides: Partial<EventCandidateRecord> = {}): EventCandidateRecord {
  return {
    id: "candidate-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "suppressed",
    importanceScore: 72,
    adId: "ad-1",
    proofTargetId: "target-1",
    title: "Landing page offer changed",
    summary: "Offer changed.",
    metadata: {},
    proofRequired: true,
    skipReason: null,
    dedupeReason: "proof_duplicate",
    detectedAt: "2026-07-10T00:00:00.000Z",
    lastEvaluatedAt: "2026-07-10T00:00:00.000Z",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function proofCapture(overrides: Partial<ProofCaptureRecord> = {}): ProofCaptureRecord {
  return {
    id: "proof-1",
    proofTargetId: "target-1",
    status: "failed",
    skipReason: null,
    failureCode: "proof_capture_failed",
    failureReason: "Landing-page proof capture failed.",
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
    extractedFields: {},
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-07-10T00:00:00.000Z",
    succeededAt: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function quietDailyHistory(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const periodEnd = new Date(Date.parse(PERIOD_END) - (index + 1) * DAY_MS);
    const periodStart = new Date(periodEnd.getTime() - DAY_MS);
    return {
      id: `digest-history-${index}`,
      userId: "user-1",
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      summary: { totalEvents: 0 },
      createdAt: periodEnd.toISOString(),
      items: [],
      delivery: { status: "sent" },
    };
  });
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
      .mockResolvedValue({ runs: 4, watchlistsChecked: 1, adsSeen: 20, noChangeRuns: 4 }),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
    listWatchlists: vi
      .fn()
      .mockResolvedValue([
        {
          id: "watch-1",
          name: "boAt watch",
          lastScannedAt: "2026-07-10T04:00:00.000Z",
        },
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
  // periodStart is derived from the cadence lookback inside the cycle; the
  // fixture period start is used only for candidate/assertion alignment.
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

describe("zero-noise triage through digest orchestration", () => {
  it("persists and delivers an all-quiet record for an unchanged page", async () => {
    const data = dataServerMock();
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest);

    expect(result).toBe(1);
    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("all_quiet");
    expect(summary.triage?.checkedAt).toBe("2026-07-10T04:00:00.000Z");
    expect(summary.triage?.noActionLine).toBe(
      "No action needed — nothing new to act on.",
    );
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

  it("delivers a routine-only triage with its suppression reason", async () => {
    const data = dataServerMock({
      listEventCandidates: vi.fn().mockResolvedValue([candidate()]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const createArgs = data.createDigestRun.mock.calls[0] as unknown[];
    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("routine_only");
    expect(summary.triage?.suppressedChanges).toBe(1);
    expect(summary.triage?.suppressionReasons).toEqual([
      "Repeat of a change already reported this period",
    ]);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          triage: expect.objectContaining({ status: "routine_only" }),
        }),
      }),
    );
  });

  it("delivers a provider-timeout period as evidence-failed, never all quiet", async () => {
    const data = dataServerMock({
      listRecentProofCapturesForWatchlist: vi
        .fn()
        .mockResolvedValue([proofCapture()]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("evidence_failed");
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          triage: expect.objectContaining({ status: "evidence_failed" }),
        }),
      }),
    );
  });

  it("delivers a proof-pending period as evidence-pending, never all quiet", async () => {
    const data = dataServerMock({
      listEventCandidates: vi
        .fn()
        .mockResolvedValue([candidate({ status: "proof_pending" })]),
      listRecentProofCapturesForWatchlist: vi
        .fn()
        .mockResolvedValue([proofCapture({ status: "pending" })]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    await runCycle(data, deliverWeeklyDigest);

    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("evidence_pending");
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          triage: expect.objectContaining({ status: "evidence_pending" }),
        }),
      }),
    );
  });

  it("breaks the daily quiet streak on a routine-only day", async () => {
    const routineOnlyTriage = classifyWatchPeriodTriage({
      events: [],
      candidates: [candidate()],
      proofCaptures: [],
      successfulRuns: 4,
      lastSuccessfulCheckAt: "2026-07-12T04:00:00.000Z",
    });
    const history = [
      { index: 0, triage: routineOnlyTriage },
      { index: 1, triage: null },
      { index: 2, triage: null },
    ].map((entry) => {
      const periodEnd = new Date(Date.parse(PERIOD_END) - (entry.index + 1) * DAY_MS);
      const periodStart = new Date(periodEnd.getTime() - DAY_MS);
      return {
        id: `digest-history-${entry.index}`,
        userId: "user-1",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        summary: entry.triage
          ? { totalEvents: 0, ...triageToDigestSummary(entry.triage) }
          : { totalEvents: 0 },
        createdAt: periodEnd.toISOString(),
        items: [],
        delivery: { status: "sent" },
      };
    });
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(history),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    // The routine-only day is a finding, not a quiet day: the streak must not
    // silence today's heartbeat.
    expect(result).toBe(1);
    expect(deliverWeeklyDigest).toHaveBeenCalled();
  });

  it("regression: delivers and persists an evidence-failed day even after 3 quiet days", async () => {
    // WP-21 streak is satisfied by history, but the current period is not
    // all-quiet: the failed proof must be classified, persisted, and
    // delivered — never auto-silenced and never silently lost.
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(quietDailyHistory(3)),
      listRecentProofCapturesForWatchlist: vi
        .fn()
        .mockResolvedValue([
          proofCapture({ attemptedAt: "2026-07-14T12:00:00.000Z" }),
        ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    expect(result).toBe(1);
    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("evidence_failed");
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          triage: expect.objectContaining({ status: "evidence_failed" }),
        }),
      }),
    );
  });

  it("regression: delivers and persists a routine-only day even after 3 quiet days", async () => {
    const data = dataServerMock({
      listDigests: vi.fn().mockResolvedValue(quietDailyHistory(3)),
      listEventCandidates: vi
        .fn()
        .mockResolvedValue([
          candidate({ detectedAt: "2026-07-14T12:00:00.000Z" }),
        ]),
    });
    const deliverWeeklyDigest = vi
      .fn()
      .mockResolvedValue({ attempts: 1, channels: ["email"] });

    const result = await runCycle(data, deliverWeeklyDigest, "daily");

    expect(result).toBe(1);
    const summary = digestRunSummaryFromCreateArgs(data);
    expect(summary.triage?.status).toBe("routine_only");
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          triage: expect.objectContaining({ status: "routine_only" }),
        }),
      }),
    );
  });
});

interface DigestTriageSummaryShape {
  triage?: {
    status?: string;
    checkedAt?: string | null;
    noActionLine?: string | null;
    suppressedChanges?: number;
    suppressionReasons?: string[];
  };
}

function digestRunSummaryFromCreateArgs(
  data: ReturnType<typeof dataServerMock>,
): DigestTriageSummaryShape {
  const createArgs = data.createDigestRun.mock.calls[0] as unknown[];
  return (createArgs[4] ?? {}) as DigestTriageSummaryShape;
}
