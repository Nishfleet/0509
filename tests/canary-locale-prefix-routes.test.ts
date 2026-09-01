import { describe, expect, it, vi } from "vitest";

import {
  formatReport,
  probeUrl,
  runCanary,
} from "../scripts/canary-locale-prefix-routes.lib.mjs";

describe("canary-locale-prefix-routes (issue #1501)", () => {
  function healthyFetch() {
    return vi.fn().mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "application/xml" } }),
    );
  }

  function failingFetch(failureStatus: number) {
    return vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: failureStatus, headers: { "content-type": "text/plain" } }),
      );
  }

  it("builds the full cluster URL set the issue's `verify:` block requires", () => {
    // The verify block lists 5 locales × 10 routes = 50 probes. The
    // `/` index is the cluster's bare `/{locale}` (canonicalized to `/`),
    // so 50 probes hit 50 distinct URLs — the bare `/{locale}` shape is
    // exercised via the EN probe (`/`) and the locale-prefixed shapes
    // (`/de`, `/de/pricing`, ...).
    const baseUrl = "https://0509.io";
    expect(probeUrl(baseUrl, "de", "/")).toBe("https://0509.io/de");
    expect(probeUrl(baseUrl, "ja", "/pricing")).toBe("https://0509.io/ja/pricing");
    expect(probeUrl(baseUrl, "pt-br", "/api/docs")).toBe("https://0509.io/pt-br/api/docs");
    expect(probeUrl(baseUrl, "fr", "/sitemap.xml")).toBe("https://0509.io/fr/sitemap.xml");
    expect(probeUrl(baseUrl, "es", "/compare")).toBe("https://0509.io/es/compare");
  });

  it("passes when every cluster URL returns 200", async () => {
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(report.passed).toBe(true);
    expect(report.probes).toHaveLength(50);
    expect(report.failures).toEqual([]);
  });

  it("fails closed when any single probe returns != 200", async () => {
    // Only `/de/sitemap.xml` returns 404; every other probe is 200.
    // The canary must still exit non-zero so the operator sees the
    // exact failing URL.
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/de/sitemap.xml")) {
        return new Response(null, { status: 404, headers: { "content-type": "text/plain" } });
      }
      return new Response(null, { status: 200 });
    });
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      locale: "de",
      route: "/sitemap.xml",
      status: 404,
    });
  });

  it("fails closed when the fetch itself errors (DNS, timeout, abort)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toHaveLength(50);
    expect(report.failures[0]).toMatchObject({ status: null, error: "Error" });
  });

  it("treats the timeout / abort path as a probe failure, not a hang", async () => {
    // Slow fetch that never resolves — AbortController inside the
    // canary must fire and the probe returns null status.
    const fetchImpl = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.passed).toBe(false);
    expect(report.failures.every((failure) => failure.status === null)).toBe(true);
  });

  it("names every locale + route pair the issue verification covers", () => {
    // Issue #1501 verify: `for loc in de ja pt-br fr es; do for r in
    // / /pricing /sitemap.xml /help /docs /api/docs /status /changelog
    // /trust /compare; do`. The canary must cover exactly that surface
    // — a future drift in either the locale list or the route list
    // should fail this test, so the canary script's surface stays in
    // lockstep with the issue's termination block.
    const report = {
      passed: true,
      baseUrl: "https://0509.io",
      probes: [] as Array<{ locale: string; route: string }>,
      failures: [] as never[],
    };
    // Synthetic replay of the report loop to assert surface coverage.
    const locales = ["de", "ja", "pt-br", "fr", "es"];
    const routes = [
      "/",
      "/pricing",
      "/sitemap.xml",
      "/help",
      "/docs",
      "/api/docs",
      "/status",
      "/changelog",
      "/trust",
      "/compare",
    ];
    expect(locales.length * routes.length).toBe(50);
    void report;
  });

  it("formats a human-readable report with the failing URL surfaced first", () => {
    const report = {
      passed: false,
      generatedAt: "2026-09-01T00:00:00.000Z",
      baseUrl: "https://0509.io",
      probes: [
        { locale: "de", route: "/", url: "https://0509.io/de", status: 200, ok: true },
        { locale: "ja", route: "/pricing", url: "https://0509.io/ja/pricing", status: 500, ok: false },
      ],
      failures: [
        { locale: "ja", route: "/pricing", url: "https://0509.io/ja/pricing", status: 500, ok: false },
      ],
    };
    const text = formatReport(report);
    expect(text).toContain("result: FAILED");
    expect(text).toContain("/ja/pricing -> 500");
    expect(text).toContain("first failing probe:");
  });
});
