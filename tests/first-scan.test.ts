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
  it("targets tonight's 04:00 UTC scan when it hasn't run yet", () => {
    const now = new Date("2026-06-10T01:00:00.000Z"); // Wednesday, before 04:00
    expect(nextScheduledScanAt("starter", now).toISOString()).toBe("2026-06-10T04:00:00.000Z");
  });

  it("rolls to tomorrow once today's scan has passed", () => {
    const now = new Date("2026-06-10T09:00:00.000Z");
    expect(nextScheduledScanAt("starter", now).toISOString()).toBe("2026-06-11T04:00:00.000Z");
  });

  it("targets the next Monday for scout plans", () => {
    const now = new Date("2026-06-10T09:00:00.000Z"); // Wednesday
    const next = nextScheduledScanAt("scout", now);
    expect(next.toISOString()).toBe("2026-06-15T04:00:00.000Z");
    expect(next.getUTCDay()).toBe(1);
  });

  it("formats the label in IST", () => {
    const label = formatNextScanLabel("starter", new Date("2026-06-10T01:00:00.000Z"));
    expect(label).toContain("9:30");
    expect(label).toContain("IST");
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

    const queued = queueFirstWatchlistScan(
      {} as never,
      { waitUntil } as never,
      watchlist as never,
    );

    expect(queued).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // the queued promise must swallow scan failures (scheduled scan retries)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("does nothing for already-scanned watchlists or when ctx is missing", async () => {
    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    const waitUntil = vi.fn();

    expect(
      queueFirstWatchlistScan(
        {} as never,
        { waitUntil } as never,
        { ...watchlist, lastScannedAt: "2026-06-09T04:00:00.000Z" } as never,
      ),
    ).toBe(false);
    expect(queueFirstWatchlistScan({} as never, undefined, watchlist as never)).toBe(false);
    expect(queueFirstWatchlistScan({} as never, { waitUntil } as never, null)).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
