import { describe, expect, it } from "vitest";

import {
  MEASURE_TTFB_DOMAINS,
  TTFB_P95_CEILING_MS,
  SEARCH_TTFB_USER_AGENT,
  evaluateTtfbTermination,
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
    const probes = MEASURE_TTFB_DOMAINS.map((d, i) =>
      probe({ domain: d, firstCardAtMs: 1_000 + (i % 4) * 300 }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateTtfbTermination(summary);
    expect(verdict.pass).toBe(true);
    expect(verdict.check.name).toBe("p95_first_card_at_or_below_ceiling");
    expect(verdict.check.ok).toBe(true);
  });

  it("fails when p95 first-card trips the 5s ceiling", () => {
    const probes = MEASURE_TTFB_DOMAINS.map((d, i) =>
      probe({ domain: d, firstCardAtMs: i === 5 ? 7_000 : 1_000 }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateTtfbTermination(summary);
    expect(verdict.pass).toBe(false);
    // p95 over 6 samples: rank = ceil(0.95 * 6) - 1 = 5 (0-based), so the
    // slowest domain is the p95 sample and trips the 5s ceiling.
    expect(summary.p95FirstCard).toBe(7_000);
    expect(verdict.check.ok).toBe(false);
  });

  it("fails when no first-card samples exist (all warming)", () => {
    const probes = MEASURE_TTFB_DOMAINS.map((d) =>
      probe({
        domain: d,
        outcome: "warming",
        firstCardAtMs: null as number | null,
        rowCount: 0,
        isWarming: true,
        isDeadEnd: true,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateTtfbTermination(summary);
    expect(verdict.pass).toBe(false);
    expect(summary.p95FirstCard).toBe(null);
    expect(verdict.check.ok).toBe(false);
  });

  it("does not gate dead-ends or verified share (those belong to #2024/#1858)", () => {
    // A dead-end (0 rows) that still paints no card but has fast samples on
    // the others must NOT fail the TTFB gate on a recall criterion — this gate
    // is measured only on the first-card-paint metric the issue names.
    const probes = MEASURE_TTFB_DOMAINS.map((d, i) =>
      probe({
        domain: d,
        outcome: i === 0 ? "dead_end" : "verified",
        firstCardAtMs: i === 0 ? null : 1_200,
        rowCount: i === 0 ? 0 : 3,
        isDeadEnd: i === 0,
      }),
    );
    const summary = summarizeResults(probes);
    const verdict = evaluateTtfbTermination(summary);
    expect(verdict.pass).toBe(true);
  });
});