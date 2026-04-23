import { describe, expect, it, vi } from "vitest";

import {
  checkHealthEndpoint,
  formatProductionCanaryReport,
  runProductionCanary,
} from "../scripts/prod-canary.lib.mjs";

function current0509Result(status: "ok" | "empty") {
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
});
