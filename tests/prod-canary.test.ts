import { describe, expect, it, vi } from "vitest";

import {
  checkHealthEndpoint,
  formatProductionCanaryReport,
  runProductionCanary,
} from "../scripts/prod-canary.lib.mjs";

const EXPECTED_WORKER_VERSION_ID = "worker-version-123";
const EXPECTED_SEARCH_ROLLOUT_MODE = "v2";

function current0509Result(status: "ok" | "empty", overrides = {}) {
  return {
    provider: "current_0509" as const,
    query: "nykaa",
    country: "India",
    mode: "advertiser" as const,
    status,
    latencyMs: 10,
    httpStatus: 200,
    siteStatus: null,
    matchCount: status === "ok" ? 3 : 0,
    loginWall: false,
    rateLimited: false,
    blockedLikely: false,
    degraded: false,
    sourceLabel: "Live Ad Library capture",
    url: "https://0509.io/search?query=nykaa",
    note: null,
    ...overrides,
  };
}

function createHealthyCanaryFetchImpl() {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("/api/launch-readiness")) {
      return Response.json({
        ok: true,
        blockers: [],
        signals: {},
        metaAdsBeta: {
          ok: true,
          samples: 24,
          sampleTarget: 20,
          successRate: 1,
          blockers: [],
        },
      });
    }

    return Response.json({
      status: "ok",
      app: "0509",
      releaseIdentity: {
        workerVersionId: "worker-version-123",
        tag: "release-2026-07-15",
        timestamp: "2026-07-15T10:00:00.000Z",
        searchRolloutMode: "v2",
      },
    });
  });
}

describe("production canary", () => {
  it("checks the public health endpoint without caching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
        releaseIdentity: {
          workerVersionId: EXPECTED_WORKER_VERSION_ID,
          searchRolloutMode: "v2",
        },
      }),
    });

    const health = await checkHealthEndpoint({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      fetchImpl,
    });

    expect(health).toMatchObject({
      ok: true,
      status: 200,
      app: "0509",
      expectedApp: "0509",
      url: "https://0509.io/api/health",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://0509.io/api/health",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          "user-agent": "0509-prod-canary/1.0",
        }),
      }),
    );
  });

  it("fails closed instead of following a redirect to another health alias", async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.redirect === "manual") {
        return new Response(null, {
          status: 308,
          headers: { location: "https://0509.io/api/health" },
        });
      }
      return Response.json({
        status: "ok",
        app: "0509",
        releaseIdentity: {
          workerVersionId: EXPECTED_WORKER_VERSION_ID,
          searchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
        },
      });
    });

    const health = await checkHealthEndpoint({
      baseUrl: "https://www.0509.io",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      fetchImpl,
    });

    expect(health).toMatchObject({
      ok: false,
      status: 308,
      message: "Health endpoint returned 308.",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.0509.io/api/health",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("fails when the health endpoint belongs to the wrong app", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "other-worker",
      }),
    });

    const health = await checkHealthEndpoint({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      fetchImpl,
    });

    expect(health).toMatchObject({
      ok: false,
      status: 200,
      app: "other-worker",
      expectedApp: "0509",
    });
    expect(health.message).toContain("app mismatch");
  });

  it("fails closed when the expected Worker version is absent", async () => {
    const health = await checkHealthEndpoint({
      baseUrl: "https://0509.io",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          app: "0509",
          releaseIdentity: {
            workerVersionId: EXPECTED_WORKER_VERSION_ID,
            searchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
          },
        }),
      }),
    });

    expect(health.ok).toBe(false);
    expect(health.message).toContain("Missing expected Worker version ID");
  });

  it.each([
    [
      "wrong version",
      { workerVersionId: "other-worker", searchRolloutMode: "v2" },
      "Worker version mismatch",
    ],
    [
      "missing version",
      { workerVersionId: null, searchRolloutMode: "v2" },
      "missing the Worker version ID",
    ],
    [
      "wrong mode",
      { workerVersionId: EXPECTED_WORKER_VERSION_ID, searchRolloutMode: "shadow" },
      "rollout mode mismatch",
    ],
    [
      "missing mode",
      { workerVersionId: EXPECTED_WORKER_VERSION_ID, searchRolloutMode: null },
      "missing the search rollout mode",
    ],
  ])(
    "fails closed for %s release evidence",
    async (_label, releaseIdentity, message) => {
      const health = await checkHealthEndpoint({
        baseUrl: "https://0509.io",
        expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
        expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ status: "ok", app: "0509", releaseIdentity }),
        }),
      });

      expect(health.ok).toBe(false);
      expect(health.message).toContain(message);
    },
  );

  it("waits for every production hostname to converge on the deployed release", async () => {
    let requestCount = 0;
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/api/launch-readiness")) {
        return Response.json({
          ok: true,
          blockers: [],
          signals: {},
          metaAdsBeta: {
            ok: true,
            samples: 24,
            sampleTarget: 20,
            successRate: 1,
            blockers: [],
          },
        });
      }
      requestCount += 1;
      return Response.json({
        status: "ok",
        app: "0509",
        releaseIdentity: {
          workerVersionId:
            requestCount === 2 ? "other-worker" : EXPECTED_WORKER_VERSION_ID,
          searchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
        },
      });
    });

    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const report = await runProductionCanary({
      queries: ["nykaa"],
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      fetchImpl,
      benchmarkImpl: vi.fn().mockResolvedValue([current0509Result("ok")]),
      canaryBypassToken: "secret-token",
      healthConvergenceTimeoutMs: 1,
      healthConvergenceIntervalMs: 0,
      sleepImpl,
    });

    expect(report.passed).toBe(true);
    expect(report.healthChecks).toHaveLength(3);
    expect(report.healthChecks.every((check) => check.ok)).toBe(true);
    expect(sleepImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when a production hostname never converges", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/api/launch-readiness")) {
        return Response.json({
          ok: true,
          blockers: [],
          signals: {},
          metaAdsBeta: { ok: true, samples: 24, sampleTarget: 20, successRate: 1, blockers: [] },
        });
      }
      return Response.json({
        status: "ok",
        app: "0509",
        releaseIdentity: {
          workerVersionId: url.includes("api.0509.io") ? "other-worker" : EXPECTED_WORKER_VERSION_ID,
          searchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
        },
      });
    });

    const report = await runProductionCanary({
      queries: ["nykaa"],
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      fetchImpl,
      benchmarkImpl: vi.fn().mockResolvedValue([current0509Result("ok")]),
      canaryBypassToken: "secret-token",
      healthConvergenceTimeoutMs: 1,
      healthConvergenceIntervalMs: 0,
      sleepImpl: vi.fn().mockResolvedValue(undefined),
    });

    expect(report.passed).toBe(false);
    expect(report.healthChecks[2].message).toContain("Worker version mismatch");
  });

  it("does not expose canary secrets in release evidence or formatted output", async () => {
    const secret = "SUPER_SECRET_CANARY_TOKEN";
    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      queries: ["nykaa"],
      fetchImpl: createHealthyCanaryFetchImpl(),
      benchmarkImpl: vi.fn().mockResolvedValue([current0509Result("ok")]),
      canaryBypassToken: secret,
    });

    expect(JSON.stringify(report)).not.toContain(secret);
    expect(formatProductionCanaryReport(report)).not.toContain(secret);
  });

  it("does not echo invalid expected or actual release scalars", async () => {
    const invalidExpected = "expected\n" + "x".repeat(140);
    const invalidActual = "actual\nSECRET_RELEASE_ID";
    const health = await checkHealthEndpoint({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: invalidExpected,
      expectedSearchRolloutMode: "shadow\nSECRET_MODE",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          app: "0509",
          releaseIdentity: {
            workerVersionId: invalidActual,
            tag: "tag\nSECRET_TAG",
            timestamp: "2026-07-15T10:00:00Z\nSECRET_TIME",
            searchRolloutMode: "shadow\nSECRET_MODE",
          },
        }),
      }),
    });

    expect(health.ok).toBe(false);
    expect(health.message).toContain("Missing expected Worker version ID");
    expect(JSON.stringify(health)).not.toContain("SECRET");
    expect(
      formatProductionCanaryReport({
        ...{
          health,
          healthChecks: [health],
          expectedWorkerVersionId: null,
          expectedSearchRolloutMode: null,
        },
        freshLiveBypass: { required: false },
        launchReadiness: null,
        metaAdsBeta: { beta: false },
        blockingFailures: [],
      } as unknown as Awaited<ReturnType<typeof runProductionCanary>>),
    ).not.toContain("SECRET");
  });

  it("classifies current 0509 search failures as Meta ads beta needing proof", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi
      .fn()
      .mockResolvedValue([current0509Result("empty")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(false);
    expect(report.freshLiveBypass).toMatchObject({
      configured: true,
      proved: false,
      message:
        "Private current_0509 fresh-live probe did not return live ad proof.",
    });
    expect(report.blockingFailures).toHaveLength(1);
    expect(report.metaAdsBeta).toMatchObject({
      beta: true,
      strict: false,
      status: "needs_proof",
    });
    expect(formatProductionCanaryReport(report)).toContain(
      "meta ads beta: needs proof",
    );
    expect(formatProductionCanaryReport(report)).toContain(
      "fresh-live bypass: failed (Private current_0509 fresh-live probe did not return live ad proof.)",
    );
  });

  it("can still run Meta ads as a strict provider gate when explicitly requested", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi
      .fn()
      .mockResolvedValue([current0509Result("empty")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
      metaAdsStrict: true,
    });

    expect(report.passed).toBe(false);
    expect(formatProductionCanaryReport(report)).toContain(
      "meta ads strict gate: failed",
    );
  });

  it("checks every production health hostname by default", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      queries: ["nykaa"],
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(true);
    expect(report.healthChecks.map((check) => check.url)).toEqual([
      "https://0509.io/api/health",
      "https://www.0509.io/api/health",
      "https://api.0509.io/api/health",
    ]);
    expect(formatProductionCanaryReport(report)).toContain(
      "https://www.0509.io/api/health",
    );
    expect(formatProductionCanaryReport(report)).toContain(
      "https://api.0509.io/api/health",
    );
    expect(benchmarkImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        forceLive: true,
        timeoutMs: 60_000,
      }),
    );
  });

  it("keeps custom base-url canaries scoped to that hostname", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://preview.example.com",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(true);
    expect(report.healthChecks.map((check) => check.url)).toEqual([
      "https://preview.example.com/api/health",
    ]);
  });

  it("passes when core health, ops readiness, and fresh-live bypass pass", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      expectedWorkerVersionId: EXPECTED_WORKER_VERSION_ID,
      expectedSearchRolloutMode: EXPECTED_SEARCH_ROLLOUT_MODE,
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(true);
    expect(formatProductionCanaryReport(report)).toContain("meta ads beta: ok");
    expect(formatProductionCanaryReport(report)).toContain(
      "fresh-live bypass: ok",
    );
  });

  it("fails when the readiness endpoint says Meta ads beta is below the bar", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/api/launch-readiness")) {
        return Response.json({
          ok: true,
          blockers: [],
          signals: {},
          metaAdsBeta: {
            ok: false,
            samples: 633,
            sampleTarget: 20,
            successRate: 0.9447,
            blockers: ["success_rate_below_95_percent", "recent_live_failures"],
          },
        });
      }

      return Response.json({
        status: "ok",
        app: "0509",
      });
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(false);
    expect(report.metaAdsBeta?.status).toBe("needs_proof");
    const formatted = formatProductionCanaryReport(report);
    expect(formatted).toContain(
      "meta ads beta: needs proof (633/20 samples, 94% success)",
    );
    expect(formatted).not.toContain("meta ads probe:");
  });

  it("fails when the fresh-live bypass token is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
        releaseIdentity: {
          workerVersionId: "worker-version-123",
          searchRolloutMode: "v2",
        },
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "",
    });

    expect(report.passed).toBe(false);
    expect(report.freshLiveBypass).toMatchObject({
      required: true,
      configured: false,
      proved: false,
    });
    expect(formatProductionCanaryReport(report)).toContain(
      "fresh-live bypass: failed",
    );
  });

  it("fails the fresh-live bypass when the private probe is redirected to sign in", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi.fn().mockResolvedValue([
      current0509Result("empty", {
        httpStatus: 302,
        loginWall: true,
        blockedLikely: true,
        note: "Private current_0509 probe was redirected to sign in.",
      }),
    ]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(false);
    expect(report.freshLiveBypass).toMatchObject({
      required: true,
      configured: true,
      proved: false,
      message: "Private current_0509 probe was redirected to sign in.",
    });
    expect(formatProductionCanaryReport(report)).toContain(
      "fresh-live bypass: failed (Private current_0509 probe was redirected to sign in.)",
    );
  });

  it("passes the canary bypass token into fresh-live search probes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(benchmarkImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        forceLive: true,
        canaryBypassToken: "secret-token",
        timeoutMs: 60_000,
      }),
    );
  });

  it("allows the fresh-live search timeout to be tuned for production checks", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      searchTimeoutMs: 90_000,
    });

    expect(benchmarkImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        forceLive: true,
        timeoutMs: 90_000,
      }),
    );
  });

  it("marks cached or degraded rendered evidence as Meta ads beta needing proof", async () => {
    const fetchImpl = createHealthyCanaryFetchImpl();
    const benchmarkImpl = vi.fn().mockResolvedValue([
      current0509Result("ok", {
        degraded: true,
        sourceLabel: "Cached live results",
      }),
    ]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.io",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(1);
    expect(report.freshLiveBypass).toMatchObject({
      configured: true,
      proved: false,
      message:
        "Private current_0509 fresh-live probe did not return live ad proof.",
    });
    expect(report.metaAdsBeta?.status).toBe("needs_proof");
    expect(formatProductionCanaryReport(report)).toContain(
      "Cached live results",
    );
  });
});
