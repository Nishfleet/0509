import { describe, expect, it, vi } from "vitest";

import {
  checkHealthEndpoint,
  formatProductionCanaryReport,
  runProductionCanary,
} from "../scripts/prod-canary.lib.mjs";

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
    url: "https://0509.in/search?query=nykaa",
    note: null,
    ...overrides,
  };
}

describe("production canary", () => {
  it("checks the public health endpoint without caching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });

    const health = await checkHealthEndpoint({
      baseUrl: "https://0509.in",
      fetchImpl,
    });

    expect(health).toMatchObject({
      ok: true,
      status: 200,
      app: "0509",
      expectedApp: "0509",
      url: "https://0509.in/api/health",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://0509.in/api/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "0509-prod-canary/1.0",
        }),
      }),
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
      baseUrl: "https://0509.in",
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

  it("fails when current 0509 search returns a blocking empty result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("empty")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(1);
    expect(formatProductionCanaryReport(report)).toContain("search: failed");
  });

  it("checks every production health hostname by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(true);
    expect(report.healthChecks.map((check) => check.url)).toEqual([
      "https://0509.in/api/health",
      "https://www.0509.in/api/health",
      "https://api.0509.in/api/health",
    ]);
    expect(formatProductionCanaryReport(report)).toContain("https://www.0509.in/api/health");
    expect(formatProductionCanaryReport(report)).toContain("https://api.0509.in/api/health");
    expect(benchmarkImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        forceLive: true,
      }),
    );
  });

  it("keeps custom base-url canaries scoped to that hostname", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://preview.example.com",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(true);
    expect(report.healthChecks.map((check) => check.url)).toEqual([
      "https://preview.example.com/api/health",
    ]);
  });

  it("passes only when health and current 0509 search both pass", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([current0509Result("ok")]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(true);
    expect(formatProductionCanaryReport(report)).toContain("search: ok");
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
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
      canaryBypassToken: "secret-token",
    });

    expect(benchmarkImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        forceLive: true,
        canaryBypassToken: "secret-token",
      }),
    );
  });

  it("fails cached or degraded rendered evidence even when the public route returns results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockResolvedValue([
      current0509Result("ok", {
        degraded: true,
        sourceLabel: "Cached live results",
      }),
    ]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(1);
    expect(formatProductionCanaryReport(report)).toContain("Cached live results");
  });
});
