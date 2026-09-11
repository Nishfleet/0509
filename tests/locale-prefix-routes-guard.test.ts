import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  LOCALE_PREFIXES,
  formatReport,
  probeUrl,
  runCanary,
} from "../scripts/canary-locale-prefix-routes.lib.mjs";

/**
 * Canary test for the retired buyer-surface locale cluster (issue #2962,
 * orchestrator Branch B). The old #1501 canary probed every locale buyer
 * path for a 200; the cluster is now deleted, so the canary instead probes
 * every one of those URLs for a 301 to the EN pathname (query preserved),
 * verifies the translated sneaker-resale cluster still serves 200 under the
 * de/ja/pt-br prefixes, and verifies robots.txt dropped the empty fr/es
 * `Sitemap:` lines. Fail closed: any non-301 location mismatch is a failure.
 */
describe("canary-locale-prefix-routes (issue #2962)", () => {
  function healthyFetch() {
    return vi.fn().mockImplementation((input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      // /<locale>/sneaker-resale for the translated locales serves 200.
      for (const loc of ["de", "ja", "pt-br"]) {
        if (url.endsWith(`/${loc}/sneaker-resale`)) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
      }
      // Everything else in the probed surface is a 301 to the EN path.
      const after = url.replace(/^https?:\/\/[^/]+/, "");
      return Promise.resolve(new Response(null, { status: 301, headers: { location: enForProbeUrl(after) } }));
    }) as unknown as typeof fetch;
  }
  function enForProbeUrl(after: string): string {
    const stripped = after.replace(/^\/(de|ja|pt-br|fr|es)/, "");
    return stripped === "" ? "/" : stripped;
  }

  it("builds the redirect-probe URL set (buyer routes x 5 locales + sneaker-resale x translated locales)", () => {
    const baseUrl = "https://0509.io";
    expect(probeUrl(baseUrl, "de", "/pricing")).toBe("https://0509.io/de/pricing");
    expect(probeUrl(baseUrl, "pt-br", "/sneaker-resale")).toBe("https://0509.io/pt-br/sneaker-resale");
    expect(probeUrl(baseUrl, "es", "/ads/stockx.com")).toBe("https://0509.io/es/ads/stockx.com");
  });

  it("passes when every locale buyer path 301s to its EN pathname and the translated sneaker pages serve 200", async () => {
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl: healthyFetch(),
    });
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails closed when any probe is not a redirect to the right EN path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as unknown as typeof fetch;
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(report.passed).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
  });

  it("fails closed when a translated sneaker-resale page stops serving 200", async () => {
    const fetchImpl = vi.fn().mockImplementation((input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith("/de/sneaker-resale")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const after = String(input).replace(/^https?:\/\/[^/]+/, "");
      const stripped = after.replace(/^\/(de|ja|pt-br|fr|es)/, "");
      return Promise.resolve(
        new Response(null, { status: 301, headers: { location: stripped === "" ? "/" : stripped } }),
      );
    }) as unknown as typeof fetch;
    const report = await runCanary({
      baseUrl: "https://0509.io",
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(report.passed).toBe(false);
    expect(report.failures[0]).toMatchObject({ locale: "de", route: "/sneaker-resale", status: 404 });
  });

  it("covers exactly 5 legacy locale prefixes", () => {
    expect(LOCALE_PREFIXES).toEqual(["de", "ja", "pt-br", "fr", "es"]);
    expect(readFileSync("scripts/canary-locale-prefix-routes.lib.mjs", "utf8")).toContain('sneaker-resale');
  });

  it("formats a human-readable report with the failing URL surfaced first", () => {
    const report = {
      passed: false,
      generatedAt: "2026-09-01T00:00:00.000Z",
      baseUrl: "https://0509.io",
      probes: [
        { locale: "de", route: "/pricing", url: "https://0509.io/de/pricing", status: 200, ok: false },
      ],
      failures: [
        { locale: "de", route: "/pricing", url: "https://0509.io/de/pricing", status: 200, ok: false },
      ],
    };
    const text = formatReport(report);
    expect(text).toContain("result: FAILED");
    expect(text).toContain("/de/pricing -> 200");
    expect(text).toContain("first failing probe:");
  });
});
