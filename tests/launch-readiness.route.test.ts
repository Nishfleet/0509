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
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-ads-readiness.server");
});

describe("launch readiness route", () => {
  it("blocks launch readiness when Meta ads beta is below the reliability bar", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: false,
        label: "Beta: needs proof",
        blockers: ["success_rate_below_95_percent", "recent_live_failures"],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.in/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "meta_ads_beta:success_rate_below_95_percent",
        "meta_ads_beta:recent_live_failures",
      ],
      metaAdsBeta: {
        ok: false,
      },
    });
  });
});
