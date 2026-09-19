import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

const GREEN_SIGNALS = {
  monitoring: { recentSuccessfulRuns: 1, latestSucceededAt: "2026-06-06T12:35:06.079Z" },
  proof: { recentSuccessfulCaptures: 1, latestSucceededAt: "2026-06-06T12:35:05.500Z" },
  digestDelivery: { recentAttempts: 1, recentSent: 1, latestAttemptAt: "2026-06-06T12:35:06.795Z" },
  emailDelivery: { recentAttempts: 1, recentSent: 1, latestAttemptAt: "2026-06-06T12:35:06.795Z" },
  slackDelivery: {
    configuredTargets: 1,
    usableTargets: 1,
    latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
    recentAttempts: 1,
    recentSent: 1,
    latestAttemptAt: "2026-06-06T12:36:00.000Z",
  },
  whatsappDelivery: {
    providerConfigured: false,
    customerReady: false,
    webhookConfigured: false,
    configuredTargets: 0,
    usableTargets: 0,
    latestTargetSuccessAt: null,
    recentAttempts: 0,
    recentSent: 0,
    latestAttemptAt: null,
  },
};

function mockHappyPath() {
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({
      CANARY_BYPASS_TOKEN: "secret-token",
      DB: {},
    })),
  }));
  vi.doMock("~/lib/meta-ads-readiness.server", () => ({
    getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({ ok: true, blockers: [] }),
  }));
}

function canaryRequest() {
  return new Request("https://0509.io/api/launch-readiness", {
    headers: {
      "x-0509-canary-token": "secret-token",
    },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/ga-customer-surface");
  vi.doUnmock("~/lib/meta-ads-readiness.server");
  vi.doUnmock("~/lib/error-report.server");
});

describe("launch readiness route failure path (issue #3392)", () => {
  it("answers an honest 503 instead of a bare 500 when the signals query throws", async () => {
    const reportError = vi.fn().mockResolvedValue({ written: true, reason: "written" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHappyPath();
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi
        .fn()
        .mockRejectedValue(new Error("D1_ERROR: malformed JSON")),
    }));
    vi.doMock("~/lib/error-report.server", () => ({ reportError }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: canaryRequest(),
    } as never);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      blocker: "launch_readiness_signals_failed",
      blockers: ["launch_readiness_signals_failed"],
      signals: null,
      metaAdsBeta: null,
    });
    expect(typeof (body as { detail?: unknown }).detail).toBe("string");
    expect((body as { detail: string }).detail).toContain("D1_ERROR");
    expect((body as { reason?: string }).reason).toMatch(/^[a-z0-9._-]{1,128}$/);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ DB: {} }),
      expect.objectContaining({
        route: "api.launch-readiness",
        reasonCode: "launch_readiness_signals_failed",
      }),
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it("answers the same honest 503 when the Meta ads readiness leg throws", async () => {
    mockHappyPath();
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue(GREEN_SIGNALS),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi
        .fn()
        .mockRejectedValue(new Error("D1_ERROR: network connection lost")),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: canaryRequest(),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "launch_readiness_signals_failed",
      blockers: ["launch_readiness_signals_failed"],
    });
  });

  it("re-throws Response objects so framework semantics survive the catch", async () => {
    mockHappyPath();
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi
        .fn()
        .mockRejectedValue(new Response("gateway timeout", { status: 504 })),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const thrown = await loader({
      context: createContext(),
      request: canaryRequest(),
    } as never).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(504);
  });

  it("still answers the honest 503 when the error sink itself fails", async () => {
    mockHappyPath();
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockRejectedValue(new Error("D1_ERROR")),
    }));
    vi.doMock("~/lib/error-report.server", () => ({
      reportError: vi.fn().mockRejectedValue(new Error("sink write failed")),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: canaryRequest(),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "launch_readiness_signals_failed",
      blockers: ["launch_readiness_signals_failed"],
    });
  });
});
