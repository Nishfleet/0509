import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failedDigest = {
  id: "digest-incomplete-1",
  userId: "user-10",
  userEmail: "ten@example.com",
  userName: "Ten",
  periodStart: "2026-06-09T04:00:00.000Z",
  periodEnd: "2026-06-10T04:00:00.000Z",
};

function createEnv() {
  return {
    DB: {
      prepare: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({ results: [] }),
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
      })),
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

describe("incomplete digest retry rows", () => {
  it("never turns an incomplete retry row into a false all-quiet heartbeat", async () => {
    const deliverWeeklyDigest = vi.fn();
    const getDigest = vi.fn().mockResolvedValue({
      id: failedDigest.id,
      userId: failedDigest.userId,
      periodStart: failedDigest.periodStart,
      periodEnd: failedDigest.periodEnd,
      summary: { totalEvents: 1, watchlists: 1 },
      createdAt: "2026-06-10T04:00:00.000Z",
      items: [],
      delivery: {
        id: "delivery-incomplete-1",
        digestRunId: failedDigest.id,
        provider: "cloudflare_email",
        status: "failed",
        recipientEmail: failedDigest.userEmail,
        externalMessageId: null,
        errorMessage: "The worker stopped before persisting the item.",
        deliveredAt: null,
      },
    });

    vi.doMock("~/lib/plan.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/plan.server")>()),
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/data.server")>()),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([failedDigest]),
      getDigest,
      listActiveWatchlists: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
      getDigestByPeriod: vi.fn().mockResolvedValue(null),
      getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
        runs: 5,
        watchlistsChecked: 2,
        adsSeen: 44,
      }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/ad-source.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/ad-source.server")>()),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
        discoveryStatus: "healthy",
        discoverySummary: null,
        discoveryFailureClass: null,
      }),
    }));

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const result = await runScheduledMonitoring(createEnv() as never, {
      includeScans: false,
      includeDigests: true,
      digestCadence: "daily",
      scheduledTime: Date.parse("2026-06-11T04:00:00.000Z"),
    });

    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
    expect(result.digests).toBe(0);
  });
});
