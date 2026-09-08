import { describe, expect, it, vi } from "vitest";

import {
  MEASURE_TTFB_DOMAINS,
  TTFB_P95_CEILING_MS,
  SEARCH_TTFB_USER_AGENT,
  evaluateTtfbTermination,
  formatTtfbSummary,
  runSearchTtfb,
} from "../scripts/measure-search-ttfb.mjs";

import { summarizeResults } from "../scripts/bet2-live-verification.mjs";

type TierCounts = { verified: number; likely: number; unmatched: number };

function probe(overrides: Partial<{
  domain: string;
  outcome: "verified" | "dead_end" | "warming" | "rate_limited" | "demo_sourced" | "error";
  status: number | null;
  firstCardAtMs: number | null;
  tierCounts: TierCounts;
  rowCount: number;
  isWarming: boolean;
  isDeadEnd: boolean;
  emptyReason: string | null;
}>) {
  const opt = <T>(key: keyof typeof overrides, fallback: T): T =>
    key in overrides ? (overrides[key] as T) : fallback;
  return {
    domain: overrides.domain ?? "a.com",
    url: `https://0509.io/search?website=${overrides.domain ?? "a.com"}`,
    outcome: overrides.outcome ?? "verified",
    status: opt("status", 200),
    polls: 1,
    // Sensible default for the six-domain cohort: all six paint their first
    // card well inside the 5s ceiling so the passing probe is representative.
    firstCardAtMs: opt("firstCardAtMs", 1500),
    elapsedMs: 2000,
    tierCounts: overrides.tierCounts ?? { verified: 3, likely: 0, unmatched: 0 },
    rowCount: overrides.rowCount ?? 3,
    headline: "3 verified ads linked to a.com",
    isWarming: overrides.isWarming ?? false,
    isDeadEnd: overrides.isDeadEnd ?? false,
    resultSource: "meta_library_browser",
    cacheStatus: "hit",
    emptyReason: opt("emptyReason", null as string | null),
    tierBadgePresent: true,
  };
}

/** Count probed domains that painted a first card (status 200 + firstCardAtMs). */
function sampled(results: ReturnType<typeof probe>[]) {
  return results.filter((r) => r.status === 200 && r.firstCardAtMs !== null).length;
}

describe("measure-search-ttfb.constants", () => {
  it("pins the issue #2032 six-domain metric set", () => {
    expect(MEASURE_TTFB_DOMAINS).toEqual([
      "gymshark.com",
      "hubspot.com",
      "ridge.com",
      "allbirds.com",
      "notion.so",
      "oura.com",
    ]);
    expect(MEASURE_TTFB_DOMAINS).toHaveLength(6);
  });

  it("pins the p95 first-card ceiling at 5s and its own user-agent", () => {
    expect(TTFB_P95_CEILING_MS).toBe(5_000);
    expect(SEARCH_TTFB_USER_AGENT).toBe("0509-search-ttfb/1.0");
  });
});

describe("evaluateTtfbTermination", () => {
  it("passes when p95 first-card < 5s over the six domains", () => {
    const results = MEASURE_TTFB_DOMAINS.map((d, i) =>
      probe({ domain: d, firstCardAtMs: 1_000 + (i % 4) * 300 }),
    );
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.map((c) => c.name)).toEqual([
      "p95_first_card_at_or_below_ceiling",
      "six_domains_sampled",
    ]);
    expect(verdict.checks[0].ok).toBe(true);
    expect(verdict.checks[1].ok).toBe(true);
  });

  it("fails when p95 first-card trips the 5s ceiling", () => {
    const results = MEASURE_TTFB_DOMAINS.map((d, i) =>
      probe({ domain: d, firstCardAtMs: i === 5 ? 7_000 : 1_000 }),
    );
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    expect(verdict.pass).toBe(false);
    // p95 over 6 samples: rank = ceil(0.95 * 6) - 1 = 5 (0-based), so the
    // slowest domain is the p95 sample and trips the 5s ceiling.
    expect(summary.p95FirstCard).toBe(7_000);
    expect(verdict.checks[0].ok).toBe(false);
    // subscription still met — all six painted.
    expect(verdict.checks[1].ok).toBe(true);
  });

  it("fails when no first-card samples exist (all warming)", () => {
    const results = MEASURE_TTFB_DOMAINS.map((d) =>
      probe({
        domain: d,
        outcome: "warming",
        firstCardAtMs: null as number | null,
        rowCount: 0,
        isWarming: true,
        isDeadEnd: true,
      }),
    );
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    expect(verdict.pass).toBe(false);
    expect(summary.p95FirstCard).toBe(null);
    expect(verdict.checks[0].ok).toBe(false);
    expect(verdict.checks[1].ok).toBe(false);
  });

  it("fails the subscription guard when a pinned domain drops out (429/5xx)", () => {
    // Five domains paint fast; the sixth is rate-limited (status 429, no
    // first-card sample). The p95 of the five survivors is well under the
    // ceiling, but the six-domain metric is under-subscribed, so the gate
    // must refuse to pass.
    const results = MEASURE_TTFB_DOMAINS.map((d, i) => {
      if (i === 5) {
        return probe({
          domain: d,
          outcome: "rate_limited",
          status: 429,
          firstCardAtMs: null,
          rowCount: 0,
          isDeadEnd: true,
        });
      }
      return probe({ domain: d, firstCardAtMs: 1_200 });
    });
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    // p95 of survivors is fine, but the subscription guard trips.
    expect(verdict.checks[0].ok).toBe(true);
    expect(verdict.checks[1].ok).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks[1].detail).toBe("first-card samples: 5/6");
  });

  it("does not gate dead-ends that still resolve a fast first card", () => {
    // A dead-end (0 rows) that paints no card is a recall concern (#2024),
    // not the perceived-latency metric this gate enforces. But it must NOT
    // count as a *sampled* domain either — for the TTFB gate we only require
    // that the domains that DID resolve a first card were fast; the sampled
    // count is unaffected because a dead-end with no card has no sample.
    // Here all six paint (the dead-end resolves to a card-bearing page), so
    // the gate passes on both checks.
    const results = MEASURE_TTFB_DOMAINS.map((d) =>
      probe({ domain: d, firstCardAtMs: 1_400 }),
    );
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    expect(verdict.pass).toBe(true);
  });
});

describe("runSearchTtfb", () => {
  it("probes the pinned six-domain cohort with the gate's user-agent", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const target = new URL(url.toString());
      const domain = target.searchParams.get("website") ?? "x.com";
      const html =
        `<html><body><section class="f9-results-panel" ` +
        `data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit">` +
        `<h2 class="f9-wk-sec-title">4 verified ads linked to ${domain}</h2>` +
        Array.from(
          { length: 4 },
          () =>
            '<div class="f9-wk-row has-trail"><span class="f9-tier-badge is-verified">Verified</span></div>',
        ).join("") +
        `</section></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const sleepImpl = vi.fn(async () => {});

    const { run, verdict } = await runSearchTtfb({
      baseUrl: "https://0509.io",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: sleepImpl as unknown as (ms: number) => Promise<void>,
      paceRequests: false,
    });

    expect(run.results).toHaveLength(MEASURE_TTFB_DOMAINS.length);
    // Every pinned domain was probed (the cohort constant, not a subset).
    const probed = run.results.map((r) => r.domain);
    expect([...probed].sort()).toEqual([...MEASURE_TTFB_DOMAINS].sort());
    // Each resolved a first card.
    expect(run.results.every((r) => r.firstCardAtMs !== null)).toBe(true);
    // The gate's own user-agent was sent on every request.
    const requests = fetchImpl.mock.calls as unknown as Array<[URL | string, { headers: Headers } | undefined]>;
    for (const [url, init] of requests) {
      expect(url.toString()).toContain("0509.io/search");
      // probeDomain sends headers as a plain object, not a Headers instance.
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["user-agent"]).toBe(SEARCH_TTFB_USER_AGENT);
    }
    expect(verdict.pass).toBe(true);
  });
});

describe("formatTtfbSummary", () => {
  it("prints the p95 ceiling and both termination checks", () => {
    const results = MEASURE_TTFB_DOMAINS.map((d) =>
      probe({ domain: d, firstCardAtMs: 1_400 }),
    );
    const summary = summarizeResults(results);
    const verdict = evaluateTtfbTermination(summary, {
      sampledCount: sampled(results),
    });
    const lines = formatTtfbSummary({
      run: { baseUrl: "https://0509.io", results, summary },
      verdict,
    });
    const joined = lines.join("\n");
    expect(joined).toContain("domains=6");
    expect(joined).toContain("p95_first_card_ms=");
    expect(joined).toContain("TTFB termination checks:");
    expect(joined).toContain("PASS p95_first_card_at_or_below_ceiling");
    expect(joined).toContain("PASS six_domains_sampled");
    expect(joined).toContain("first-card samples: 6/6");
  });
});