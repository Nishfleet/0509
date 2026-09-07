import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORED_PARAGRAPH =
  "Stored paragraph from the original generation: boAt moved its landing page offer and nothing else changed across the watched competitors this week.";

function planServerMock() {
  return {
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    PLAN_LIMITS: {
      free: { digests: false, digestCadence: "none" },
      scout: { digests: true, digestCadence: "weekly" },
      starter: { digests: true, digestCadence: "weekly" },
      agency: { digests: true, digestCadence: "daily_and_weekly" },
    },
  };
}

function retryDataMock(digest: Record<string, unknown>) {
  return {
    enqueueDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue([]),
    claimDigestScheduleJob: vi.fn(),
    completeDigestScheduleJob: vi.fn(),
    failDigestScheduleJob: vi.fn(),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([{
      id: digest.id,
      userId: "user-1",
      userEmail: "owner@example.com",
      userName: "Owner",
      periodStart: "2026-04-13T05:00:00.000Z",
      periodEnd: "2026-04-20T05:00:00.000Z",
    }]),
    getDigest: vi.fn().mockResolvedValue(digest),
  };
}

function env() {
  return { DB: {} } as never;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("weekly digest retry snapshots", () => {
  it("replays the persisted paragraph without a second AI call", async () => {
    const data = retryDataMock({
      id: "digest-retry",
      userId: "user-1",
      periodStart: "2026-04-13T05:00:00.000Z",
      periodEnd: "2026-04-20T05:00:00.000Z",
      summary: {
        totalEvents: 1,
        totalEligibleEvents: 1,
        includedEvents: 1,
        omittedEvents: 0,
        watchlists: 1,
        digestItemSetProvenance: "atomic-v2",
        strategyParagraph: STORED_PARAGRAPH,
        strategyGeneratedAt: "2026-04-20T05:01:00.000Z",
      },
      createdAt: "2026-04-20T05:01:00.000Z",
      items: [{
        id: "item-1",
        digestRunId: "digest-retry",
        watchlistId: "watch-1",
        watchlistName: "boAt watch",
        eventType: "landing_page_offer_changed",
        title: "Landing page offer changed",
        summary: "Offer changed on the landing page.",
        metadata: {
          eventId: "event-retry-1",
          priorityScore: 79,
          sourceStatus: "proof_backed",
        },
        createdAt: "2026-04-19T00:00:00.000Z",
      }],
      delivery: null,
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock());

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    // Pin to the stored retry period so the 7-day retry window is not wall-clock-dependent.
    await expect(
      runWeeklyDigests(env(), { periodEnd: "2026-04-20T05:00:00.000Z" }),
    ).resolves.toBe(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-retry",
        strategyParagraph: STORED_PARAGRAPH,
      }),
    );
  });

  it("skips an unmarked same-count legacy row", async () => {
    const data = retryDataMock({
      id: "digest-retry-unmarked",
      userId: "user-1",
      periodStart: "2026-04-13T05:00:00.000Z",
      periodEnd: "2026-04-20T05:00:00.000Z",
      summary: { totalEvents: 1, watchlists: 1 },
      createdAt: "2026-04-20T05:01:00.000Z",
      items: [{
        id: "item-unmarked",
        digestRunId: "digest-retry-unmarked",
        watchlistId: "watch-1",
        watchlistName: "boAt watch",
        eventType: "landing_page_offer_changed",
        title: "Unmarked retry item",
        summary: "Count matches, identity remains unproven.",
        metadata: {},
        createdAt: "2026-04-19T00:00:00.000Z",
      }],
      delivery: null,
    });
    const deliverWeeklyDigest = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => data);
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/plan.server", () => planServerMock());

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");
    // Pin to the stored retry period so the 7-day retry window is not wall-clock-dependent.
    await expect(
      runWeeklyDigests(env(), { periodEnd: "2026-04-20T05:00:00.000Z" }),
    ).resolves.toBe(0);
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });
});
