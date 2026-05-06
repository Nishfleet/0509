import { describe, expect, it, vi } from "vitest";

import {
  checkHealthEndpoint,
  formatProductionCanaryReport,
  runProductionCanary,
} from "../scripts/prod-canary.lib.mjs";

type Current0509Result = {
  provider: "current_0509";
  query: string;
  country: string;
  mode: "advertiser" | "keyword";
  status: "ok" | "empty";
  latencyMs: number;
  httpStatus: number;
  siteStatus: null;
  matchCount: number;
  loginWall: boolean;
  rateLimited: boolean;
  blockedLikely: boolean;
  degraded: boolean;
  sourceLabel: string;
  url: string;
  note: string | null;
};

function current0509Result(
  status: "ok" | "empty",
  overrides: Partial<Current0509Result> = {},
) {
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
      mode: "advertiser",
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(1);
    expect(formatProductionCanaryReport(report)).toContain("search: failed");
  });

  it("checks advertiser and keyword launch search modes by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        app: "0509",
      }),
    });
    const benchmarkImpl = vi.fn().mockImplementation(({ mode }) =>
      Promise.resolve([
        current0509Result(mode === "keyword" ? "empty" : "ok", {
          mode,
        }),
      ]),
    );

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.modes).toEqual(["advertiser", "keyword"]);
    expect(benchmarkImpl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mode: "advertiser",
        freshLive: true,
      }),
    );
    expect(benchmarkImpl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mode: "keyword",
        freshLive: true,
      }),
    );
    expect(formatProductionCanaryReport(report)).toContain(
      "search: failed for nykaa / keyword (empty)",
    );
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
      mode: "advertiser",
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(true);
    expect(formatProductionCanaryReport(report)).toContain("search: ok");
  });

  it("fails when rendered search is cached-degraded instead of fresh live capture", async () => {
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
        loginWall: true,
        matchCount: 7,
        sourceLabel: "Cached live results",
        note: "0509 rendered its degraded commercial discovery state.",
      }),
    ]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["nykaa"],
      mode: "advertiser",
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(0);
    expect(report.degradedWarnings).toHaveLength(1);
    expect(report.liveSourceFailures).toHaveLength(1);
    expect(formatProductionCanaryReport(report)).toContain(
      "search: failed fresh-live check for nykaa / advertiser (Cached live results, degraded, login wall, 7 ads)",
    );
  });

  it("fails cached live results even when the rendered page omits the degraded banner", async () => {
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
        query: "adflex",
        mode: "keyword",
        degraded: false,
        matchCount: 11,
        sourceLabel: "Cached live results",
        note: "Source: Cached live results",
      }),
    ]);

    const report = await runProductionCanary({
      baseUrl: "https://0509.in",
      queries: ["adflex"],
      mode: "keyword",
      fetchImpl,
      benchmarkImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingFailures).toHaveLength(0);
    expect(report.degradedWarnings).toHaveLength(0);
    expect(report.liveSourceFailures).toHaveLength(1);
    expect(formatProductionCanaryReport(report)).toContain(
      "search: failed fresh-live check for adflex / keyword (Cached live results, 11 ads)",
    );
  });
});
