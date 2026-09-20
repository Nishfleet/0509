import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fail-closed pins for the weekly digest catch-up (issue #2734). Both reads
 * the catch-up leans on — the candidates read and the filed-week dedupe
 * read — must fail closed exactly like the window gate's candidates read:
 * a throw (or a missing helper in a strict mock) yields no catch-up enqueue,
 * never an unverified one. Mirrors the strict-mock precedent in
 * `tests/visual-diff-alert-payloads.test.ts`: the barrel is replaced with a
 * truncating mock and the cycle is imported fresh per test.
 */

function dataServerMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    // Reads the pre-enqueue retry sweep and the catch-up gate touch.
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    listDigestScheduleJobTimezones: vi
      .fn()
      .mockResolvedValue([{ userId: "user-1", timezone: "UTC" }]),
    // Recorded so an enqueue carries observable period tuples.
    enqueueDigestScheduleJobs: vi
      .fn()
      .mockImplementation(
        async (
          _env: unknown,
          input: {
            cadence: "daily" | "weekly";
            periodStart: string;
            periodEnd: string;
          },
        ) => {
          enqueues.push({
            cadence: input.cadence,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          });
          return 0;
        },
      ),
    // Drain surface the cycle consults even with nothing filed.
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue([]),
    claimDigestScheduleJob: vi.fn().mockResolvedValue(null),
    listDigestScheduleJobsAwaitingAlert: vi.fn().mockResolvedValue([]),
    claimDigestScheduleJobExhaustionAlert: vi.fn().mockResolvedValue(null),
    settleDigestScheduleJobExhaustionAlert: vi.fn().mockResolvedValue(true),
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

const enqueues: Array<Record<string, unknown>> = [];

async function runCycle(
  data: Record<string, unknown>,
): Promise<{ attempted: number; sent: number; failed: number }> {
  enqueues.length = 0;
  vi.doMock("~/lib/auth.server", () => ({}));
  vi.doMock("~/lib/data.server", () => data);
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWeeklyDigest: vi.fn().mockResolvedValue({ attempts: 0, channels: [] }),
    deliverScanTroubleNotice: vi.fn(),
  }));
  vi.doMock("~/lib/plan.server", () => planServerMock());

  const { runDigestDeliveryCycleDetailed } = await import(
    "~/lib/digest-orchestration.server"
  );
  // Monday 09:00 UTC: past every UTC workspace's 05:00-08:00 brief window,
  // so the catch-up resolver (not the live gate) owns every candidate.
  return runDigestDeliveryCycleDetailed({ DB: {} } as never, {
    cadence: "weekly",
    periodEnd: "2026-07-13T09:00:00.000Z",
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("weekly digest catch-up fail-closed reads (issue #2734)", () => {
  it("files nothing when the candidates read throws", async () => {
    const data = dataServerMock({
      listDigestScheduleJobTimezones: vi
        .fn()
        .mockRejectedValue(new Error("d1 down")),
    });

    const result = await runCycle(data);

    // Still the on-time-attempt (empty gate list) for the cycle period only;
    // no catch-up tuple may appear.
    expect(result).toEqual({ attempted: 0, sent: 0, failed: 0 });
    expect(enqueues.map((enqueue) => enqueue.periodEnd)).toEqual([
      "2026-07-13T09:00:00.000Z",
    ]);
  });

  it("files nothing when the catch-up dedupe read throws", async () => {
    const data = dataServerMock({
      // Candidates resolve (so the resolver has a missed workspace to work
      // with) but the week-span existence read fails.
      listDigestScheduleJobPeriodEnds: vi
        .fn()
        .mockRejectedValue(new Error("d1 down")),
    });

    const result = await runCycle(data);

    // The catch-up had user-1 (UTC Monday past 08:00, tick 06:00z) to file
    // under; the failed dedupe read must suppress that enqueue entirely.
    expect(result).toEqual({ attempted: 0, sent: 0, failed: 0 });
    expect(enqueues.map((enqueue) => enqueue.periodEnd)).toEqual([
      "2026-07-13T09:00:00.000Z",
    ]);
  });
});
