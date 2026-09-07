import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BET2_DOMAINS,
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_SPACING_MS,
  SEARCH_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW_MS,
  SECTION_1_8_RERUN,
  createPacedFetch,
  evaluateTermination,
  evaluateSection18Rerun,
  formatProbeLine,
  formatSummary,
  parseRetryAfterMs,
  parseSearchResponseHtml,
  percentile95,
  probeDomain,
  runLiveVerification,
  summarizeResults,
} from "../scripts/bet2-live-verification.mjs";

function htmlForRows(rows: Array<{ tier: "verified" | "likely" | "unmatched"; advertiser: string; summary: string }>): string {
  const rowMarkup = rows
    .map((row) => {
      const say = row.tier === "verified"
        ? row.summary
        : `${row.tier.charAt(0).toUpperCase()}${row.tier.slice(1)} — ${row.summary}`;
      return `<div class="f9-wk-row has-trail"><span class="f9-wk-say">${say}</span></div>`;
    })
    .join("");
  const verifiedCount = rows.filter((row) => row.tier === "verified").length;
  const headline = verifiedCount > 0
    ? `${verifiedCount} verified ads linked to test-domain.com`
    : "No verified ads for test-domain.com — 0 likely matches, 0 unmatched candidates";
  return `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">${headline}</h2>${rowMarkup}</section></body></html>`;
}

function mockFetchResponse(
  body: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  const headers = new Headers(options.headers ?? { "content-type": "text/html" });
  return new Response(body, { status: options.status ?? 200, headers });
}

describe("parseSearchResponseHtml", () => {
  it("counts verified rows from row count minus tier-prefixed rows", () => {
    const html = htmlForRows([
      { tier: "verified", advertiser: "Nykaa", summary: "Festive glow" },
      { tier: "verified", advertiser: "Nykaa", summary: "Summer sale" },
      { tier: "likely", advertiser: "Allbirds", summary: "Wool runners" },
      { tier: "unmatched", advertiser: "Foo", summary: "Some other ad" },
    ]);
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.rowCount).toBe(4);
    expect(parsed.tierCounts.verified).toBe(2);
    expect(parsed.tierCounts.likely).toBe(1);
    expect(parsed.tierCounts.unmatched).toBe(1);
  });

  it("detects warming from the Search in progress heading", () => {
    const html = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="miss"><h2 class="f9-wk-sec-title">Search in progress</h2></section></body></html>`;
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.isWarming).toBe(true);
    expect(parsed.rowCount).toBe(0);
    expect(parsed.cacheStatus).toBe("miss");
    expect(parsed.resultSource).toBe("meta_library_browser");
  });

  it("detects warming from the Checking this competitor heading", () => {
    const html = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="miss"><h2 class="f9-wk-sec-title">Checking this competitor</h2></section></body></html>`;
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.isWarming).toBe(true);
  });

  it("marks an empty response with no rows and no warming as a dead-end candidate", () => {
    const html = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">No verified ads found for test-domain.com</h2></section></body></html>`;
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.rowCount).toBe(0);
    expect(parsed.isWarming).toBe(false);
  });

  it("detects demo-sourced responses (local server without a provider binding)", () => {
    const html = `<html><body><section class="f9-results-panel" data-f9-result-source="demo" data-f9-result-cache-status="none"><h2 class="f9-wk-sec-title">1 verified ad linked to nykaa.com</h2></section></body></html>`;
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.resultSource).toBe("demo");
    expect(parsed.cacheStatus).toBe("none");
  });

  it("locates the first row index in the byte stream for first-card timing", () => {
    const html = `<html><body>some preamble<div class="f9-wk-row"><span class="f9-wk-say">Verified — summary</span></div></body></html>`;
    const parsed = parseSearchResponseHtml(html);
    expect(parsed.firstRowIndex).toBeGreaterThan(0);
    // The row anchor matches `f9-wk-row` followed by a legal CSS-attribute
    // terminator (space, quote, or `>`), so accept any of them here.
    const anchor = html.substring(parsed.firstRowIndex, parsed.firstRowIndex + 18);
    expect(anchor).toContain("f9-wk-row");
    expect(/f9-wk-row[ ">\s]/.test(anchor)).toBe(true);
  });
});

describe("summarizeResults", () => {
  it("counts dead-ends, verified domains, and p95 of first-card timings", () => {
    const samples = [
      {
        domain: "a.com",
        url: "https://0509.io/search?website=a.com",
        outcome: "verified" as const,
        status: 200,
        polls: 1,
        firstCardAtMs: 800,
        elapsedMs: 1500,
        tierCounts: { verified: 5, likely: 0, unmatched: 0 },
        rowCount: 5,
        headline: "5 verified ads linked to a.com",
        isWarming: false,
        isDeadEnd: false,
        resultSource: "meta_library_browser",
        cacheStatus: "hit",
        emptyReason: null,
      },
      {
        domain: "b.com",
        url: "https://0509.io/search?website=b.com",
        outcome: "verified" as const,
        status: 200,
        polls: 1,
        firstCardAtMs: 1200,
        elapsedMs: 1800,
        tierCounts: { verified: 2, likely: 1, unmatched: 0 },
        rowCount: 3,
        headline: "2 verified ads linked to b.com",
        isWarming: false,
        isDeadEnd: false,
        resultSource: "meta_library_browser",
        cacheStatus: "hit",
        emptyReason: null,
      },
      {
        domain: "c.com",
        url: "https://0509.io/search?website=c.com",
        outcome: "dead_end" as const,
        status: 200,
        polls: 1,
        firstCardAtMs: 2000,
        elapsedMs: 2200,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        rowCount: 0,
        headline: "No verified ads found for c.com",
        isWarming: false,
        isDeadEnd: true,
        resultSource: "meta_library_browser",
        cacheStatus: "hit",
        emptyReason: "no_results",
      },
    ];
    const summary = summarizeResults(samples);
    expect(summary.total).toBe(3);
    expect(summary.deadEnds).toBe(1);
    expect(summary.verifiedDomains).toBe(2);
    expect(summary.verifiedShare).toBeCloseTo(2 / 3, 4);
    // p95 of [800, 1200, 2000] with ceil(0.95 * 3) - 1 = 2 → sample 3 → 2000
    expect(summary.p95FirstCard).toBe(2000);
    expect(summary.errorDomains).toBe(0);
  });
});

describe("percentile95", () => {
  it("returns null for empty input", () => {
    expect(percentile95([])).toBeNull();
  });

  it("returns the largest value when sample size is 1", () => {
    expect(percentile95([42])).toBe(42);
  });

  it("computes the p95 ceiling for a small sample", () => {
    // sorted: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    // rank = ceil(0.95 * 10) - 1 = ceil(9.5) - 1 = 10 - 1 = 9 → 100
    expect(percentile95([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(100);
  });

  it("clamps when the sample is too small to reach p95", () => {
    expect(percentile95([100, 200, 300])).toBe(300);
  });
});

describe("evaluateTermination", () => {
  it("passes when all criteria are met", () => {
    const summary = {
      total: 25,
      deadEnds: 0,
      verifiedDomains: 22,
      verifiedShare: 22 / 25,
      p95FirstCard: 4_500,
      warmingDomains: 0,
      errorDomains: 0,
      rateLimitedDomains: 0,
      totalRowCount: 100,
    };
    const verdict = evaluateTermination(summary);
    expect(verdict.pass).toBe(true);
    for (const check of verdict.checks) {
      expect(check.ok).toBe(true);
    }
  });

  it("fails when there are dead-ends", () => {
    const summary = {
      total: 25,
      deadEnds: 1,
      verifiedDomains: 22,
      verifiedShare: 22 / 25,
      p95FirstCard: 4_500,
      warmingDomains: 0,
      errorDomains: 0,
      rateLimitedDomains: 0,
      totalRowCount: 95,
    };
    const verdict = evaluateTermination(summary);
    const zeroDeadEnds = verdict.checks.find((c) => c.name === "zero_dead_ends");
    expect(zeroDeadEnds?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails when verified share is below 80%", () => {
    const summary = {
      total: 25,
      deadEnds: 0,
      verifiedDomains: 18,
      verifiedShare: 18 / 25,
      p95FirstCard: 4_000,
      warmingDomains: 0,
      errorDomains: 0,
      rateLimitedDomains: 0,
      totalRowCount: 80,
    };
    const verdict = evaluateTermination(summary);
    const verifiedCheck = verdict.checks.find(
      (c) => c.name === "verified_share_at_or_above_floor",
    );
    expect(verifiedCheck?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails when p95 first-card is above 5s", () => {
    const summary = {
      total: 25,
      deadEnds: 0,
      verifiedDomains: 22,
      verifiedShare: 22 / 25,
      p95FirstCard: 5_500,
      warmingDomains: 0,
      errorDomains: 0,
      rateLimitedDomains: 0,
      totalRowCount: 80,
    };
    const verdict = evaluateTermination(summary);
    const p95 = verdict.checks.find((c) => c.name === "p95_first_card_at_or_below_ceiling");
    expect(p95?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails when any probe was served from the demo source", () => {
    const summary = {
      total: 25,
      deadEnds: 0,
      verifiedDomains: 22,
      verifiedShare: 22 / 25,
      p95FirstCard: 4_000,
      warmingDomains: 0,
      errorDomains: 0,
      rateLimitedDomains: 0,
      demoSourcedDomains: 1,
      totalRowCount: 80,
    };
    const verdict = evaluateTermination(summary);
    const demo = verdict.checks.find((c) => c.name === "no_demo_sourced_probes");
    expect(demo?.ok).toBe(false);
    expect(verdict.pass).toBe(false);
  });
});

describe("evaluateSection18Rerun", () => {
  it("passes when allbirds, notion, and oura each have at least one row", () => {
    const results = [
      { domain: "allbirds.com", rowCount: 17 },
      { domain: "notion.so", rowCount: 4 },
      { domain: "oura.com", rowCount: 2 },
    ];
    const verdict = evaluateSection18Rerun(results as never);
    expect(verdict.pass).toBe(true);
  });

  it("fails when one of the originally-dead-end brands is empty", () => {
    const results = [
      { domain: "allbirds.com", rowCount: 17 },
      { domain: "notion.so", rowCount: 0 },
      { domain: "oura.com", rowCount: 2 },
    ];
    const verdict = evaluateSection18Rerun(results as never);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks[0]?.detail).toContain("notion.so");
  });
});

describe("probeDomain with mock fetch", () => {
  it("records tier counts and elapsed time for a verified response", async () => {
    const html = htmlForRows([
      { tier: "verified", advertiser: "A", summary: "X" },
      { tier: "verified", advertiser: "A", summary: "Y" },
      { tier: "verified", advertiser: "A", summary: "Z" },
    ]);
    const fetchMock = (async () => mockFetchResponse(html)) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "example.com",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {
        // no-op: warming poll never fires for a non-warming response
      },
      // Frozen clock: wall-clock <50ms flakes when the full suite is under load.
      nowImpl: () => 1_000,
    });
    expect(result.status).toBe(200);
    expect(result.outcome).toBe("verified");
    expect(result.tierCounts.verified).toBe(3);
    expect(result.rowCount).toBe(3);
    expect(result.firstCardAtMs).toBe(0);
  });

  it("does not add the HTML byte offset of the first row to first-card time", async () => {
    const preamble = "x".repeat(20_000);
    const html = `${preamble}<div class="f9-wk-row"><span class="f9-wk-say">Sample</span></div>`;
    const fetchMock = (async () => mockFetchResponse(html)) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "offset.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      nowImpl: () => 1_000,
    });
    expect(result.rowCount).toBe(1);
    expect(result.firstCardAtMs).toBe(0);
  });

  it("returns a populated warming page as the first card without extra polls", async () => {
    const warmingWithRows = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="partial"><h2 class="f9-wk-sec-title">Search in progress</h2><div class="f9-wk-row"><span class="f9-wk-say">First card</span></div></section></body></html>`;
    let callCount = 0;
    const fetchMock = (async () => {
      callCount += 1;
      return mockFetchResponse(warmingWithRows);
    }) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "partial.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {
        throw new Error("warming poll should not fire when rows already exist");
      },
    });
    expect(callCount).toBe(1);
    expect(result.outcome).toBe("verified");
    expect(result.rowCount).toBe(1);
    expect(result.isDeadEnd).toBe(false);
  });

  it("records outcome=warming when the first response has no rows and the budget exhausts", async () => {
    const warmingHtml = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="miss"><h2 class="f9-wk-sec-title">Search in progress</h2></section></body></html>`;
    let callCount = 0;
    const fetchMock = (async () => {
      callCount += 1;
      return mockFetchResponse(warmingHtml);
    }) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "warming.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {
        // pretend 60s passed each poll
      },
      warmingBudgetMs: 0, // immediately exhaust so the test is fast
      warmingPollIntervalMs: 1,
    });
    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(result.outcome).toBe("warming");
    expect(result.isWarming).toBe(true);
    expect(result.rowCount).toBe(0);
  });

  it("records outcome=rate_limited on a 429 response", async () => {
    const fetchMock = (async () =>
      mockFetchResponse(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "30" },
      })) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "rate.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      max429Retries: 0,
    });
    expect(result.outcome).toBe("rate_limited");
    expect(result.status).toBe(429);
    expect(result.retryAfter).toBe("30");
  });

  it("retries a 429 and returns the later success", async () => {
    const html = htmlForRows([
      { tier: "verified", advertiser: "A", summary: "X" },
    ]);
    let calls = 0;
    const waits: number[] = [];
    const fetchMock = (async () => {
      calls += 1;
      if (calls === 1) {
        return mockFetchResponse("slow down", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return mockFetchResponse(html);
    }) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "retry.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      nowImpl: () => 1_000,
    });
    expect(calls).toBe(2);
    expect(waits).toEqual([2_000]);
    expect(result.outcome).toBe("verified");
    expect(result.rowCount).toBe(1);
  });

  it("does not count 429 backoff in first-card time", async () => {
    const html = htmlForRows([
      { tier: "verified", advertiser: "A", summary: "X" },
    ]);
    let now = 0;
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      if (calls === 1) {
        return mockFetchResponse("slow down", {
          status: 429,
          headers: { "retry-after": "5" },
        });
      }
      return mockFetchResponse(html);
    }) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "retry-timing.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
    });
    expect(calls).toBe(2);
    expect(result.outcome).toBe("verified");
    expect(result.firstCardAtMs).toBe(0);
  });

  it("does not count beforeRequest queue time in first-card time", async () => {
    const html = htmlForRows([
      { tier: "verified", advertiser: "A", summary: "X" },
    ]);
    let now = 0;
    const fetchMock = (async () => mockFetchResponse(html)) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "queued.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      nowImpl: () => now,
      beforeRequest: async () => {
        now += 40_000;
      },
    });
    expect(result.outcome).toBe("verified");
    expect(result.firstCardAtMs).toBe(0);
  });

  it("counts warming-poll wait in first-card time", async () => {
    const warmingHtml = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="miss"><h2 class="f9-wk-sec-title">Search in progress</h2></section></body></html>`;
    const readyHtml = htmlForRows([
      { tier: "verified", advertiser: "A", summary: "X" },
    ]);
    let now = 0;
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return mockFetchResponse(calls === 1 ? warmingHtml : readyHtml);
    }) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "warming-then-ready.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
      warmingBudgetMs: 60_000,
      warmingPollIntervalMs: 35_000,
    });
    expect(calls).toBe(2);
    expect(result.outcome).toBe("verified");
    expect(result.firstCardAtMs).toBe(35_000);
  });

  it("records outcome=demo_sourced when the panel data source is demo", async () => {
    const demoHtml = `<html><body><section class="f9-results-panel" data-f9-result-source="demo" data-f9-result-cache-status="none"><h2 class="f9-wk-sec-title">1 verified ad linked to nykaa.com</h2><div class="f9-wk-row"><span class="f9-wk-say">Festive sale</span></div></section></body></html>`;
    const fetchMock = (async () => mockFetchResponse(demoHtml)) as unknown as typeof fetch;
    const result = await probeDomain({
      domain: "demo.example",
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
    });
    expect(result.outcome).toBe("demo_sourced");
    expect(result.resultSource).toBe("demo");
  });
});

describe("runLiveVerification", () => {
  it("paces probes with requestSpacingMs and respects the configured order", async () => {
    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      return mockFetchResponse(
        `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">1 verified ad linked to ${new URL(url).searchParams.get("website")}</h2><div class="f9-wk-row"><span class="f9-wk-say">Sample</span></div></section></body></html>`,
      );
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const sleepMock = async (ms: number) => {
      waits.push(ms);
    };
    await runLiveVerification({
      domains: ["a.com", "b.com", "c.com"],
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: sleepMock,
      requestSpacingMs: 100,
    });
    expect(calls.length).toBe(3);
    expect(calls[0]).toContain("website=a.com");
    expect(calls[1]).toContain("website=b.com");
    expect(calls[2]).toContain("website=c.com");
    // Each domain should have triggered a pacing wait of 100ms (no warming
    // happened, so each probe takes <100ms and the full 100ms waits).
    expect(waits.length).toBe(3);
  });

  it("reuses a caller-supplied fetch when paceRequests is false", async () => {
    let calls = 0;
    const fetchMock = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = typeof input === "string" ? input : input.toString();
      return mockFetchResponse(
        `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">1 verified ad linked to ${new URL(url).searchParams.get("website")}</h2><div class="f9-wk-row"><span class="f9-wk-say">Sample</span></div></section></body></html>`,
      );
    }) as unknown as typeof fetch;
    const first = await runLiveVerification({
      domains: ["a.com"],
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      requestSpacingMs: 0,
      paceRequests: false,
    });
    const second = await runLiveVerification({
      domains: ["b.com"],
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      requestSpacingMs: 0,
      paceRequests: false,
    });
    expect(calls).toBe(2);
    expect(first.results[0]?.domain).toBe("a.com");
    expect(second.results[0]?.domain).toBe("b.com");
  });

  it("invokes onResult after each probe with 1-based index and total", async () => {
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return mockFetchResponse(
        `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">1 verified ad linked to ${new URL(url).searchParams.get("website")}</h2><div class="f9-wk-row"><span class="f9-wk-say">Sample</span></div></section></body></html>`,
      );
    }) as unknown as typeof fetch;
    const seen: Array<{ domain: string; index: number; total: number }> = [];
    await runLiveVerification({
      domains: ["a.com", "b.com"],
      baseUrl: "https://example.test",
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      requestSpacingMs: 0,
      onResult: (probe, index, total) => {
        seen.push({ domain: probe.domain, index, total });
      },
    });
    expect(seen).toEqual([
      { domain: "a.com", index: 1, total: 2 },
      { domain: "b.com", index: 2, total: 2 },
    ]);
  });
});

describe("format helpers", () => {
  it("formatProbeLine shows tier counts and first-card timing", () => {
    const line = formatProbeLine(
      {
        domain: "nykaa.com",
        url: "https://0509.io/search?website=nykaa.com",
        outcome: "verified",
        status: 200,
        polls: 1,
        firstCardAtMs: 1_234,
        elapsedMs: 1_800,
        tierCounts: { verified: 17, likely: 0, unmatched: 0 },
        rowCount: 17,
        headline: "17 verified ads linked to nykaa.com",
        isWarming: false,
        isDeadEnd: false,
        resultSource: "meta_library_browser",
        cacheStatus: "stale",
        emptyReason: null,
      },
      1,
      25,
    );
    expect(line).toContain("nykaa.com");
    expect(line).toContain("verified=17");
    expect(line).toContain("1234ms");
  });

  it("formatSummary aggregates runs and the rerun", () => {
    const run = {
      baseUrl: "https://0509.io",
      results: [],
      summary: {
        total: 25,
        deadEnds: 0,
        verifiedDomains: 22,
        verifiedShare: 22 / 25,
        p95FirstCard: 4_500,
        warmingDomains: 1,
        errorDomains: 0,
        rateLimitedDomains: 0,
        totalRowCount: 100,
      },
    };
    const rerun = {
      baseUrl: "https://0509.io",
      results: [
        {
          domain: "allbirds.com",
          url: "https://0509.io/search?website=allbirds.com",
          outcome: "verified" as const,
          status: 200,
          polls: 1,
          firstCardAtMs: 1500,
          elapsedMs: 1800,
          tierCounts: { verified: 0, likely: 17, unmatched: 0 },
          rowCount: 17,
          headline: "No verified ads for allbirds.com — 17 likely matches",
          isWarming: false,
          isDeadEnd: false,
          resultSource: "meta_library_browser",
          cacheStatus: "stale",
          emptyReason: null,
        },
      ],
      summary: {
        total: 1,
        deadEnds: 0,
        verifiedDomains: 0,
        verifiedShare: 0,
        p95FirstCard: 1500,
        warmingDomains: 0,
        errorDomains: 0,
        rateLimitedDomains: 0,
        totalRowCount: 17,
      },
    };
    const summary = formatSummary({ run, rerun });
    expect(summary).toContain("25-domain set");
    expect(summary).toContain("§1.8 six-domain rerun");
  });
});

describe("module exports", () => {
  it("exports the BET 2 25-domain set as a 25-element array of mixed US/EU/IN DTC+B2B", () => {
    expect(BET2_DOMAINS.length).toBe(25);
    // Must include the §1.8 six-domain set (they appear inside the broader set).
    for (const d of ["gymshark.com", "hubspot.com", "mamaearth.com", "ridge.com", "allbirds.com", "notion.so", "oura.com"]) {
      expect(BET2_DOMAINS).toContain(d);
    }
  });

  it("exports the §1.8 six-domain set with all three originally-dead-end brands", () => {
    expect(SECTION_1_8_RERUN).toContain("allbirds.com");
    expect(SECTION_1_8_RERUN).toContain("notion.so");
    expect(SECTION_1_8_RERUN).toContain("oura.com");
    expect(SECTION_1_8_RERUN.length).toBe(7); // gymshark, hubspot, mamaearth, ridge, allbirds, notion, oura
    for (const d of SECTION_1_8_RERUN) {
      expect(BET2_DOMAINS).toContain(d);
    }
  });

  it("defaults to https://0509.io and lets the request window pace HTTP calls", () => {
    expect(DEFAULT_BASE_URL).toBe("https://0509.io");
    expect(DEFAULT_REQUEST_SPACING_MS).toBe(0);
    expect(SEARCH_RATE_LIMIT_MAX).toBe(20);
    expect(SEARCH_RATE_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("keeps npm run canary:bet2 pointing at the live verification script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["canary:bet2"]).toBe(
      "node scripts/bet2-live-verification.mjs --json",
    );
  });
});

describe("parseRetryAfterMs", () => {
  it("reads integer seconds", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("falls back when the header is missing", () => {
    expect(parseRetryAfterMs(null)).toBe(60_000);
  });

  it("caps at the public-search window", () => {
    expect(parseRetryAfterMs("9999")).toBe(SEARCH_RATE_LIMIT_WINDOW_MS);
  });
});

describe("createPacedFetch", () => {
  it("waits until a slot frees when the window is full", async () => {
    let now = 0;
    const waits: number[] = [];
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return mockFetchResponse("ok");
    }) as unknown as typeof fetch;
    const paced = createPacedFetch({
      fetchImpl: inner,
      nowImpl: () => now,
      sleepImpl: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      maxRequests: 2,
      windowMs: 1_000,
    });
    await paced("https://example.test/a");
    await paced("https://example.test/b");
    await paced("https://example.test/c");
    expect(calls).toBe(3);
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThanOrEqual(1_000);
  });
});
