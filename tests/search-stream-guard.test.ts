import { describe, expect, it, vi } from "vitest";

import {
  STREAM_CANARY_DOMAINS,
  STREAM_P95_CEILING_MS,
  STREAM_VERIFIED_SHARE_FLOOR,
  SEARCH_STREAM_CANARY_USER_AGENT,
  evaluateStreamTermination,
  formatStreamSummary,
  runSearchStreamCanary,
} from "../scripts/search-stream-canary.mjs";

import { BET2_DOMAINS, summarizeResults } from "../scripts/bet2-live-verification.mjs";

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
  resultSource: string | null;
  cacheStatus: string | null;
  emptyReason: string | null;
  headline: string;
}>) {
  // `??` swallows an explicit `null`, so respect a present key for the
  // nullable fields (firstCardAtMs / status / emptyReason) and only fall back
  // to the default when the caller omitted the key entirely.
  const opt = <T>(key: keyof typeof overrides, fallback: T): T =>
    key in overrides ? (overrides[key] as T) : fallback;
  return {
    domain: overrides.domain ?? "a.com",
    url: `https://0509.io/search?website=${overrides.domain ?? "a.com"}`,
    outcome: overrides.outcome ?? "verified",
    status: opt("status", 200),
    polls: 1,
    firstCardAtMs: opt("firstCardAtMs", 1000),
    elapsedMs: 1500,
    tierCounts: overrides.tierCounts ?? { verified: 3, likely: 0, unmatched: 0 },
    rowCount: overrides.rowCount ?? 3,
    headline: overrides.headline ?? "3 verified ads linked to a.com",
    isWarming: overrides.isWarming ?? false,
    isDeadEnd: overrides.isDeadEnd ?? false,
    resultSource: overrides.resultSource ?? "meta_library_browser",
    cacheStatus: overrides.cacheStatus ?? "hit",
    emptyReason: opt("emptyReason", null as string | null),
    tierBadgePresent: true,
  };
}

describe("search-stream-canary.constants", () => {
  it("uses the 25 mixed BET 2 domains as the streaming cohort", () => {
    expect(STREAM_CANARY_DOMAINS).toEqual([...BET2_DOMAINS]);
    expect(STREAM_CANARY_DOMAINS).toHaveLength(25);
  });

  it("pins the issue #1858 thresholds", () => {
    expect(STREAM_P95_CEILING_MS).toBe(5_000);
    expect(STREAM_VERIFIED_SHARE_FLOOR).toBe(0.8);
  });

  it("carries its own user-agent so prod logs distinguish it from bet2", () => {
    expect(SEARCH_STREAM_CANARY_USER_AGENT).toBe("0509-search-stream-canary/1.0");
  });
});

describe("evaluateStreamTermination", () => {
  it("passes when p95 < 5s, 0 dead-ends, and verified share >= 0.8", () => {
    const probes = Array.from({ length: 25 }, (_, i) =>
      probe({
        domain: `d${i}.com`,
        firstCardAtMs: 1200 + (i % 5) * 100,
        tierCounts: { verified: 4, likely: 1, unmatched: 0 },
        rowCount: 5,
        isDeadEnd: false,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    expect(verdict.pass).toBe(true);
    expect(verdict.metrics.dead_end_count).toBe(0);
    expect(verdict.metrics.verified_share).toBe(1);
    expect(verdict.metrics.p95_first_card_ms).not.toBe(null);
    expect(verdict.metrics.p95_first_card_ms! <= STREAM_P95_CEILING_MS).toBe(true);
    expect(verdict.checks.map((c) => c.name)).toEqual([
      "p95_first_card_at_or_below_ceiling",
      "zero_dead_ends",
      "verified_share_at_or_above_floor",
    ]);
  });

  it("fails when p95 first-card exceeds the 5s ceiling", () => {
    const probes = Array.from({ length: 25 }, (_, i) =>
      probe({
        domain: `d${i}.com`,
        // p95 of 25 samples: rank = ceil(0.95 * 25) - 1 = 23 (0-based). With
        // 23 fast (1000ms) and 2 slow (6000ms), sorted = [1000×23, 6000×2],
        // index 23 = 6000 → p95 trips the 5s ceiling.
        firstCardAtMs: i >= 23 ? 6_000 : 1_000,
        tierCounts: { verified: 4, likely: 0, unmatched: 0 },
        rowCount: 4,
        isDeadEnd: false,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    expect(verdict.pass).toBe(false);
    expect(verdict.metrics.p95_first_card_ms).toBe(6_000);
    const p95Check = verdict.checks.find((c) => c.name === "p95_first_card_at_or_below_ceiling");
    expect(p95Check?.ok).toBe(false);
  });

  it("fails when a recognizable brand dead-ends (rowCount 0)", () => {
    const probes = [
      ...Array.from({ length: 24 }, (_, i) =>
        probe({ domain: `d${i}.com`, tierCounts: { verified: 4, likely: 0, unmatched: 0 }, rowCount: 4 }),
      ),
      probe({
        domain: "deadend.com",
        outcome: "dead_end",
        firstCardAtMs: 18_000,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        rowCount: 0,
        isDeadEnd: true,
        emptyReason: "no_results",
        headline: "No verified ads found for deadend.com",
      }),
    ];
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    expect(verdict.pass).toBe(false);
    expect(verdict.metrics.dead_end_count).toBe(1);
    const deadEndCheck = verdict.checks.find((c) => c.name === "zero_dead_ends");
    expect(deadEndCheck?.ok).toBe(false);
  });

  it("fails when verified share drops below the 0.8 floor", () => {
    // 19 verified of 25 = 0.76 < 0.8
    const probes = [
      ...Array.from({ length: 19 }, (_, i) =>
        probe({ domain: `v${i}.com`, tierCounts: { verified: 3, likely: 0, unmatched: 0 }, rowCount: 3 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        probe({
          domain: `u${i}.com`,
          tierCounts: { verified: 0, likely: 2, unmatched: 1 },
          rowCount: 3,
        }),
      ),
    ];
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    expect(verdict.pass).toBe(false);
    expect(verdict.metrics.verified_share).toBeCloseTo(19 / 25, 4);
    const shareCheck = verdict.checks.find((c) => c.name === "verified_share_at_or_above_floor");
    expect(shareCheck?.ok).toBe(false);
  });

  it("fails when no first-card samples exist (every probe warming or errored)", () => {
    const probes = Array.from({ length: 25 }, (_, i) =>
      probe({
        domain: `w${i}.com`,
        outcome: "warming",
        firstCardAtMs: null,
        status: 200,
        tierCounts: { verified: 0, likely: 0, unmatched: 0 },
        rowCount: 0,
        isWarming: true,
        isDeadEnd: false,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    expect(verdict.metrics.p95_first_card_ms).toBe(null);
    const p95Check = verdict.checks.find((c) => c.name === "p95_first_card_at_or_below_ceiling");
    expect(p95Check?.ok).toBe(false);
  });

  it("surfaces demo-sourced probes as a non-verdict warning, not a failure", () => {
    const probes = [
      ...Array.from({ length: 24 }, (_, i) =>
        probe({ domain: `d${i}.com`, tierCounts: { verified: 4, likely: 0, unmatched: 0 }, rowCount: 4 }),
      ),
      probe({
        domain: "demo.com",
        outcome: "demo_sourced",
        tierCounts: { verified: 0, likely: 0, unmatched: 2 },
        rowCount: 2,
        isDeadEnd: false,
        resultSource: "demo",
      }),
    ];
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    // The streaming contract (p95 / dead-ends / verified share) still holds:
    // demo rows paint and are not a dead-end. The demo probe is a warning.
    expect(verdict.pass).toBe(true);
    const demoWarning = verdict.warnings.find((w) => w.name === "no_demo_sourced_probes");
    expect(demoWarning?.ok).toBe(false);
  });
});

describe("runSearchStreamCanary", () => {
  it("probes the cohort via runLiveVerification and returns a streaming verdict", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const target = new URL(url.toString());
      const domain = target.searchParams.get("website") ?? "x.com";
      const isDeadEnd = domain === "deadend.com";
      const rowCount = isDeadEnd ? 0 : 4;
      const rowMarkup = isDeadEnd
        ? ""
        : Array.from(
            { length: rowCount },
            () =>
              '<div class="f9-wk-row has-trail"><span class="f9-tier-badge is-verified">Verified</span></div>',
          ).join("");
      const headline = isDeadEnd
        ? "No verified ads found for deadend.com"
        : `${rowCount} verified ads linked to ${domain}`;
      const emptyReasonAttr = isDeadEnd
        ? ' data-f9-result-empty-reason="no_results"'
        : "";
      const html = `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"${emptyReasonAttr}><h2 class="f9-wk-sec-title">${headline}</h2>${rowMarkup}</section></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const sleepImpl = vi.fn(async () => {});

    const { run, verdict } = await runSearchStreamCanary({
      domains: ["a.com", "b.com", "deadend.com"],
      baseUrl: "https://0509.io",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: sleepImpl as unknown as (ms: number) => Promise<void>,
      paceRequests: false,
    });

    expect(run.results).toHaveLength(3);
    expect(verdict.metrics.dead_end_count).toBe(1);
    expect(verdict.pass).toBe(false);
    expect(verdict.metrics.total_domains).toBe(3);
  });
});

describe("formatStreamSummary", () => {
  it("prints the three named metrics from the issue #1858 verify block", () => {
    const probes = Array.from({ length: 25 }, (_, i) =>
      probe({
        domain: `d${i}.com`,
        firstCardAtMs: 900 + (i % 4) * 50,
        tierCounts: { verified: 5, likely: 0, unmatched: 0 },
        rowCount: 5,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateStreamTermination(summary);
    const lines = formatStreamSummary({
      run: { baseUrl: "https://0509.io", results: probes, summary },
      verdict,
    });
    const joined = lines.join("\n");
    expect(joined).toContain("p95_first_card_ms=");
    expect(joined).toContain("dead_end_count=0");
    expect(joined).toContain("verified_share=");
    expect(joined).toContain("Streaming termination checks:");
    expect(joined).toContain("PASS p95_first_card_at_or_below_ceiling");
    expect(joined).toContain("PASS zero_dead_ends");
    expect(joined).toContain("PASS verified_share_at_or_above_floor");
  });
});
