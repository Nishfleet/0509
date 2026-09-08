import { describe, expect, it } from "vitest";

import {
  GENUINE_NO_ADS,
  KNOWN_ALIAS_GAPS,
  evaluateSneakerResale,
  loadSeedList,
  probeBrand,
  runCanary,
} from "../scripts/canary-sneaker-resale-recall.mjs";

function htmlForRows(rows: Array<{ tier: "verified" | "likely" | "unmatched"; summary: string }>, headline: string): string {
  const rowMarkup = rows
    .map((row) => {
      const say = row.tier === "verified"
        ? row.summary
        : `${row.tier.charAt(0).toUpperCase()}${row.tier.slice(1)} — ${row.summary}`;
      return `<div class="f9-wk-row has-trail"><span class="f9-wk-say">${say}</span></div>`;
    })
    .join("");
  return `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">${headline}</h2>${rowMarkup}</section></body></html>`;
}

function warmingHtml(): string {
  return `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="miss"><h2 class="f9-wk-sec-title">Search in progress</h2></section></body></html>`;
}

function mockFetchResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("sneaker.resale.recall.canary", () => {
  it("loads 25 seed-list brands with domain + brand", async () => {
    const seeds = await loadSeedList();
    expect(seeds).toHaveLength(25);
    expect(seeds.map((s) => s.domain)).toContain("goat.com");
    expect(seeds.map((s) => s.domain)).toContain("sneakerping.com");
    expect(seeds.find((s) => s.domain === "nike.com")?.brand).toBe("Nike");
  });

  it("probeBrand parses verified/likely/unmatched rows and marks covered", async () => {
    const fetchImpl = async () =>
      mockFetchResponse(
        htmlForRows(
          [
            { tier: "verified", summary: "Nike Air Max" },
            { tier: "likely", summary: "Nike Japan" },
            { tier: "unmatched", summary: "Reseller" },
          ],
          "2 verified ads linked to the brand",
        ),
      );
    const probe = await probeBrand({
      brand: "Nike",
      domain: "nike.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      rateLimiter: undefined,
    });
    expect(probe.status).toBe(200);
    expect(probe.rowCount).toBe(3);
    expect(probe.tierCounts).toEqual({ verified: 1, likely: 1, unmatched: 1 });
    expect(probe.category).toBe("covered");
  });

  it("treats a warming page (0 rows) as warming, not a dead-end, and retries once", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return mockFetchResponse(warmingHtml());
      return mockFetchResponse(
        htmlForRows([{ tier: "verified", summary: "ASICS Gel" }], "1 verified ad"),
      );
    };
    const probe = await probeBrand({
      brand: "ASICS",
      domain: "asics.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: async () => {},
      rateLimiter: undefined,
    });
    expect(calls).toBe(2);
    expect(probe.category).toBe("covered");
  });

  it("classifies a warmed 0-row probe as a dead-end failure by default", async () => {
    const fetchImpl = async () => mockFetchResponse("<html></html>");
    const probe = await probeBrand({
      brand: "Zappos",
      domain: "zappos.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      rateLimiter: undefined,
    });
    expect(probe.category).toBe("dead_end");
  });

  it("classifies a warmed 0-row probe for a genuine-no-ads brand as no-coverage (not a failure)", async () => {
    const fetchImpl = async () => mockFetchResponse("<html></html>");
    const probe = await probeBrand({
      brand: "SneakerPing",
      domain: "sneakerping.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      rateLimiter: undefined,
    });
    expect(probe.category).toBe("no_coverage");
    expect(GENUINE_NO_ADS.has("sneakerping.com")).toBe(true);
  });

  it("classifies blanket-unmatched for a known alias gap as a warning, not a failure", async () => {
    const fetchImpl = async () =>
      mockFetchResponse(
        htmlForRows(
          [
            { tier: "unmatched", summary: "GOAT resale listing" },
          ],
          "1 ad found",
        ),
      );
    const probe = await probeBrand({
      brand: "GOAT",
      domain: "goat.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      rateLimiter: undefined,
    });
    expect(probe.category).toBe("known_gap");
    expect(KNOWN_ALIAS_GAPS.get("goat.com")).toMatch(/^Nishfleet\/0509#\d+$/);
  });

  it("classifies blanket-unmatched for an unknown domain as a failure", async () => {
    const fetchImpl = async () =>
      mockFetchResponse(
        htmlForRows([{ tier: "unmatched", summary: "Random reseller" }], "1 ad found"),
      );
    const probe = await probeBrand({
      brand: "Finish Line",
      domain: "finishline.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      rateLimiter: undefined,
    });
    expect(probe.category).toBe("blanket_unmatched");
  });

  it("evaluateSneakerResale passes when every expected-coverage brand is covered", () => {
    const results = [
      { domain: "nike.com", brand: "Nike", category: "covered" },
      { domain: "adidas.com", brand: "adidas", category: "covered" },
    ];
    const verdict = evaluateSneakerResale(results as never);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("evaluateSneakerResale fails on a dead-end or blanket-unmatched regression", () => {
    const results = [
      { domain: "nike.com", brand: "Nike", category: "covered" },
      { domain: "zappos.com", brand: "Zappos", category: "dead_end" },
      { domain: "finishline.com", brand: "Finish Line", category: "blanket_unmatched" },
    ];
    const verdict = evaluateSneakerResale(results as never);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.domain)).toEqual(["zappos.com", "finishline.com"]);
  });

  it("evaluateSneakerResale keeps known alias gaps and no-coverage out of failures but reports them", () => {
    const results = [
      { domain: "goat.com", brand: "GOAT", category: "known_gap" },
      { domain: "sneakerping.com", brand: "SneakerPing", category: "no_coverage" },
    ];
    const verdict = evaluateSneakerResale(results as never);
    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.knownGaps.map((g) => g.probe.domain)).toEqual(["goat.com"]);
    expect(verdict.noCoverage.map((p) => p.domain)).toEqual(["sneakerping.com"]);
  });

  it("runCanary threads a real seed list and paces with the rate limiter", async () => {
    const seedList = [
      { domain: "nike.com", brand: "Nike" },
      { domain: "goat.com", brand: "GOAT" },
      { domain: "sneakerping.com", brand: "SneakerPing" },
    ];
    const fetchImpl = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const u = typeof _input === "string" ? new URL(_input) : _input instanceof URL ? _input : new URL(_input.url);
      const q = u.searchParams.get("q") ?? "";
      if (q === "Nike") {
        return mockFetchResponse(htmlForRows([{ tier: "verified", summary: "Nike" }], "1 verified ad"));
      }
      if (q === "GOAT") {
        return mockFetchResponse(htmlForRows([{ tier: "unmatched", summary: "GOAT" }], "1 ad found"));
      }
      return mockFetchResponse("<html></html>");
    };
    const { results, verdict } = await runCanary({
      baseUrl: "https://0509.io",
      seedList,
      fetchImpl,
      sleepImpl: async () => {},
      pacingEnabled: false,
    });
    expect(results).toHaveLength(3);
    expect(verdict.pass).toBe(true);
    expect(verdict.covered.map((p) => p.domain)).toEqual(["nike.com"]);
  });
});