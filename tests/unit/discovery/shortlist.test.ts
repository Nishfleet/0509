import { describe, expect, it } from "vitest";

import { buildShortlist, scoreCandidates } from "../../../app/lib/discovery/shortlist";
import type { Candidate } from "../../../app/lib/discovery/types";

const ev = (generator: string, publisherDomain?: string) => ({
  sourceUrl: `https://${publisherDomain ?? "news.ycombinator.com"}/story/${Math.random()}`,
  excerpt: "mention",
  generator,
  ...(publisherDomain ? { publisherDomain } : {}),
});

const cand = (name: string, domain: string | undefined, evidence: ReturnType<typeof ev>[]): Candidate => ({
  name,
  ...(domain ? { domain } : {}),
  evidence,
});

describe("scoreCandidates", () => {
  it("dedupes by domain ahead of normalised name", () => {
    const rows = scoreCandidates([
      cand("Alphalete", "alphalete.com", [ev("hn")]),
      cand("Alphalete Athletics", "alphalete.com", [ev("news")]),
      cand("Alphalete Athletics", "www.alphalete.com", [ev("news")]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("alphalete.com");
    expect(rows[0]?.candidate.evidence).toHaveLength(3);
  });

  it("dedupes by exact normalised name when no domain exists", () => {
    const rows = scoreCandidates([
      cand("NVGTN", undefined, [ev("news")]),
      cand("nvgtn", undefined, [ev("news")]),
      cand("NVG TN", undefined, [ev("hn")]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.generatorCount).toBe(2);
  });

  it("counts independent generators and independent publishers", () => {
    const rows = scoreCandidates([
      cand("TALA", "tala.com", [
        ev("news", "gq.com"),
        ev("news", "vogue.com"),
        ev("hn"),
      ]),
    ]);
    expect(rows[0]?.generatorCount).toBe(2);
    expect(rows[0]?.publisherCount).toBe(3);
    expect(rows[0]?.evidenceCount).toBe(3);
  });

  it("orders by corroboration, not probability", () => {
    const rows = scoreCandidates([
      cand("OneGen", "one-gen.example", [ev("hn")]),
      cand("TwoGen", "two-gen.example", [ev("hn"), ev("news")]),
    ]);
    expect(rows.map((r) => r.domain)).toEqual(["two-gen.example", "one-gen.example"]);
  });
});

describe("buildShortlist", () => {
  it("caps at the limit", () => {
    const rows = buildShortlist(
      Array.from({ length: 30 }, (_, i) => cand(`Brand ${i}`, `b${i}.com`, [ev("news")])),
      20,
    );
    expect(rows.filter((r) => r.shortlisted)).toHaveLength(21);
    expect(rows.slice(0, 20).every((r) => r.shortlisted)).toBe(true);
  });

  it("guarantees one slot per generator for a unique candidate at evidence count 1", () => {
    const rows = buildShortlist(
      [
        ...Array.from({ length: 25 }, (_, i) => cand(`Big ${i}`, `big${i}.com`, [ev("news"), ev("hn")])),
        cand("LoudMixed", "loud-mixed.example", [ev("news"), ev("meta-ads")]),
        cand("Obscure", "obscure.example", [ev("meta-ads")]),
      ],
      20,
    );
    const obscure = rows.find((r) => r.domain === "obscure.example");
    expect(obscure?.evidenceCount).toBe(1);
    expect(obscure?.guaranteedVia).toBe("meta-ads");
    expect(obscure?.shortlisted).toBe(true);
    expect(rows.find((r) => r.domain === "loud-mixed.example")?.guaranteedVia).toBeNull();
  });
});
