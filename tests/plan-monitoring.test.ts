import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runWeeklyDigests", () => {
  it("skips digest generation for free-plan users", async () => {
    const listWatchlists = vi.fn().mockResolvedValue([
      {
        id: "watch-1",
        name: "boAt watch",
      },
    ]);

    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEventsBetween: vi.fn().mockResolvedValue([]),
      listWatchlists,
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    const result = await runWeeklyDigests({
      DB: {
        prepare() {
          return {
            async all<T>() {
              return {
                results: [
                  {
                    id: "user-1",
                    email: "owner@example.com",
                    name: "Owner",
                  },
                ] as T[],
              };
            },
            bind() {
              return {
                async all<T>() {
                  return {
                    results: [
                      {
                        id: "user-1",
                        email: "owner@example.com",
                        name: "Owner",
                      },
                    ] as T[],
                  };
                },
              };
            },
          };
        },
      },
    } as never);

    expect(result).toBe(0);
    expect(listWatchlists).not.toHaveBeenCalled();
  });
});
