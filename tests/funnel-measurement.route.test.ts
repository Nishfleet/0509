import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data/funnel-derived-metrics.server");
});

describe("funnel measurement operator readout route", () => {
  it("is token-gated and returns 404 without the canary token", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data/funnel-derived-metrics.server", () => ({
      getFunnelDailyDerivedMetrics: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/api.funnel-measurement");
    await expect(
      loader({
        context: createContext({ CANARY_BYPASS_TOKEN: "secret-token", DB: {} }),
        request: new Request("http://localhost/api/funnel-measurement"),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reports only read-only daily aggregate counts with the gate truth", async () => {
    const derived = [
      { day: "2026-08-06", signupCompletions: 3, firstWatchlists: 2, firstProofs: 1 },
      { day: "2026-08-07", signupCompletions: 5, firstWatchlists: 4, firstProofs: 2 },
    ];
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
        FUNNEL_MEASUREMENT_ENABLED: "1",
      })),
    }));
    const getFunnelDailyDerivedMetrics = vi.fn().mockResolvedValue(derived);
    vi.doMock("~/lib/data/funnel-derived-metrics.server", () => ({
      getFunnelDailyDerivedMetrics,
    }));

    const { loader } = await import("~/routes/api.funnel-measurement");
    const response = await loader({
      context: createContext({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
        FUNNEL_MEASUREMENT_ENABLED: "1",
      }),
      request: new Request("http://localhost/api/funnel-measurement?days=7", {
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.ok).toBe(true);
    expect(body.collection).toBe("enabled");
    expect(getFunnelDailyDerivedMetrics).toHaveBeenCalledWith(expect.anything(), 7);
    expect(body.dailyDerivedMetrics).toEqual(derived);
    expect(body.gates).toEqual({
      legalReview: "not_passed",
      retentionPeriod: "unset",
      ownerApproval: "not_granted",
    });
    expect(JSON.stringify(body)).not.toMatch(/(email|userId|visitor|secret)/i);
  });

  it("clamps the days window to the bounded 1..30 range", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    const getFunnelDailyDerivedMetrics = vi.fn().mockResolvedValue([]);
    vi.doMock("~/lib/data/funnel-derived-metrics.server", () => ({
      getFunnelDailyDerivedMetrics,
    }));

    const { loader } = await import("~/routes/api.funnel-measurement");
    for (const [input, expected] of [
      ["999", 30],
      ["0", 1],
      ["-5", 1],
      ["garbage", 14],
      [null, 14],
      ["3.9", 3],
    ] as const) {
      const query = input === null ? "" : `?days=${input}`;
      await loader({
        context: createContext({ CANARY_BYPASS_TOKEN: "secret-token", DB: {} }),
        request: new Request(`http://localhost/api/funnel-measurement${query}`, {
          headers: { "x-0509-canary-token": "secret-token" },
        }),
      } as never);
      expect(getFunnelDailyDerivedMetrics).toHaveBeenLastCalledWith(expect.anything(), expected);
    }
  });

  it("reports a disabled collection state when the gate is not set", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data/funnel-derived-metrics.server", () => ({
      getFunnelDailyDerivedMetrics: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/api.funnel-measurement");
    const response = await loader({
      context: createContext({ CANARY_BYPASS_TOKEN: "secret-token", DB: {} }),
      request: new Request("http://localhost/api/funnel-measurement", {
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.collection).toBe("disabled");
    expect(body.anonymousEvents).toEqual({
      storage: "structured_json_logs",
      queryableInRuntime: false,
    });
  });
});
