import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatNextScanLabel, nextScheduledScanAt } from "~/lib/schedule-display";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("nextScheduledScanAt", () => {
  it("targets the next three-hour scan slot for Starter", () => {
    const now = new Date("2026-06-10T01:00:00.000Z");
    expect(nextScheduledScanAt("starter", now).toISOString()).toBe("2026-06-10T03:00:00.000Z");
  });

  it("rolls to the next three-hour slot once the current slot has passed", () => {
    const now = new Date("2026-06-10T09:00:00.000Z");
    expect(nextScheduledScanAt("starter", now).toISOString()).toBe("2026-06-10T12:00:00.000Z");
  });

  it("targets the next six-hour slot for Scout plans", () => {
    const now = new Date("2026-06-10T09:00:00.000Z");
    const next = nextScheduledScanAt("scout", now);
    expect(next.toISOString()).toBe("2026-06-10T12:00:00.000Z");
    expect(next.getUTCHours() % 6).toBe(0);
  });

  it("formats the label in UTC by default", () => {
    const label = formatNextScanLabel("starter", new Date("2026-06-10T01:00:00.000Z"));
    expect(label).toContain("3:00");
    expect(label).toContain("UTC");
  });

  it("formats the label in the workspace timezone when provided", () => {
    const label = formatNextScanLabel(
      "starter",
      new Date("2026-06-10T01:00:00.000Z"),
      "America/New_York",
    );
    expect(label).toContain("11:00");
    expect(label).toMatch(/EDT|GMT-4/);
  });
});

describe("queueFirstWatchlistScan", () => {
  const watchlist = {
    id: "watch-1",
    userId: "user-1",
    name: "Nykaa watch",
    targetType: "advertiser",
    targetId: "nykaa",
    targetFingerprint: "fp-1",
    targetLabel: "nykaa",
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  };

  it("schedules a background scan for a never-scanned watchlist", async () => {
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const waitUntil = vi.fn();

    const queued = await queueFirstWatchlistScan(
      {} as never,
      { waitUntil } as never,
      watchlist as never,
    );

    expect(queued).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // the queued promise must swallow scan failures (scheduled scan retries)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  describe("free-plan daily first-scan cap", () => {
    async function setupCapHarness({
      plan,
      recentRuns,
    }: {
      plan: string;
      recentRuns: number;
    }) {
      const getUserPlan = vi.fn().mockResolvedValue(plan);
      const countWatchlistRunsForUserSince = vi.fn().mockResolvedValue(recentRuns);
      // First data.server call inside runWatchlistManual -> runWatchlist. Used
      // as the observable "the scan was attempted" signal; returning true makes
      // runWatchlist bail out immediately so no real scan pipeline executes
      // (queueFirstWatchlistScan swallows that error by design).
      const hasInFlightWatchlistRun = vi.fn().mockResolvedValue(true);

      vi.doMock("~/lib/plan.server", async (importOriginal) => ({
        ...(await importOriginal<Record<string, unknown>>()),
        getUserPlan,
      }));
      vi.doMock("~/lib/data.server", async (importOriginal) => ({
        ...(await importOriginal<Record<string, unknown>>()),
        countWatchlistRunsForUserSince,
        hasInFlightWatchlistRun,
      }));

      const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
      return {
        queueFirstWatchlistScan,
        getUserPlan,
        countWatchlistRunsForUserSince,
        hasInFlightWatchlistRun,
      };
    }

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("skips the first scan for a free plan that already hit 3 runs in 24h", async () => {
      const harness = await setupCapHarness({ plan: "free", recentRuns: 3 });
      const waitUntil = vi.fn();

      const queued = await harness.queueFirstWatchlistScan(
        {} as never,
        { waitUntil } as never,
        watchlist as never,
      );

      expect(queued).toBe(true);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

      expect(harness.getUserPlan).toHaveBeenCalledWith(expect.anything(), "user-1");
      expect(harness.countWatchlistRunsForUserSince).toHaveBeenCalledTimes(1);
      const [, userId, sinceIso] = harness.countWatchlistRunsForUserSince.mock.calls[0];
      expect(userId).toBe("user-1");
      // the window is a rolling 24 hours
      const sinceAgeMs = Date.now() - new Date(sinceIso as string).getTime();
      expect(sinceAgeMs).toBeGreaterThan(23.9 * 60 * 60 * 1000);
      expect(sinceAgeMs).toBeLessThan(24.1 * 60 * 60 * 1000);
      // runWatchlistManual never ran
      expect(harness.hasInFlightWatchlistRun).not.toHaveBeenCalled();
    });

    it("runs the first scan for a free plan with no recent runs", async () => {
      const harness = await setupCapHarness({ plan: "free", recentRuns: 0 });
      const waitUntil = vi.fn();

      const queued = await harness.queueFirstWatchlistScan(
        {} as never,
        { waitUntil } as never,
        watchlist as never,
      );

      expect(queued).toBe(true);
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

      expect(harness.countWatchlistRunsForUserSince).toHaveBeenCalledTimes(1);
      // runWatchlistManual was reached (its in-flight guard fired)
      expect(harness.hasInFlightWatchlistRun).toHaveBeenCalledTimes(1);
    });

    it.each(["starter", "agency"])(
      "does not cap %s plans regardless of recent run volume",
      async (plan) => {
        const harness = await setupCapHarness({ plan, recentRuns: 50 });
        const waitUntil = vi.fn();

        const queued = await harness.queueFirstWatchlistScan(
          {} as never,
          { waitUntil } as never,
          watchlist as never,
        );

        expect(queued).toBe(true);
        await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

        // paid plans never consult the cap counter
        expect(harness.countWatchlistRunsForUserSince).not.toHaveBeenCalled();
        // and the scan is attempted
        expect(harness.hasInFlightWatchlistRun).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("does nothing for already-scanned watchlists or when ctx is missing", async () => {
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const waitUntil = vi.fn();

    expect(
      await queueFirstWatchlistScan(
        {} as never,
        { waitUntil } as never,
        { ...watchlist, lastScannedAt: "2026-06-09T04:00:00.000Z" } as never,
      ),
    ).toBe(false);
    await expect(queueFirstWatchlistScan({} as never, undefined, watchlist as never)).resolves.toBe(false);
    await expect(queueFirstWatchlistScan({} as never, { waitUntil } as never, null)).resolves.toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
