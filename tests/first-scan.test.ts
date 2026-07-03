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
