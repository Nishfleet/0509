import { describe, expect, it } from "vitest";

import {
  scoreByEntity,
  weightsAsOf,
  type BucketCount,
  type WeightRow,
} from "../../app/lib/standing-score";
import {
  howRanked,
  type HowRanked,
  type HowRankedBrand,
  type HowRankedLine,
  type HowRankedMultiplier,
  type HowRankedWeight,
} from "../../app/lib/how-ranked";

const V1_ROWS: readonly WeightRow[] = [
  { key: "mention_matters", weight: 3, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "mention_normal", weight: 1, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "site_change_noteworthy", weight: 4, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "ad_new_creative", weight: 2, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "ad_copy_change", weight: 3, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "hiring_new_role", weight: 1, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "reliability_official_api", weight: 1.0, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "reliability_rss", weight: 0.9, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "reliability_scraped_page", weight: 0.6, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "reliability_best_effort", weight: 0.5, effective_from: "2026-01-01T00:00:00.000Z" },
  { key: "weights_version", weight: 1, effective_from: "2026-01-01T00:00:00.000Z" },
];

const WEEK = "2026-09-14T07:00:00.000Z";

const COUNTS: readonly BucketCount[] = [
  { entity_id: "a", bucket: "mention_matters", reliability: "official_api", n: 2 },
  { entity_id: "a", bucket: "mention_normal", reliability: "scraped_page", n: 1 },
  { entity_id: "b", bucket: "site_change_noteworthy", reliability: "rss", n: 3 },
  { entity_id: "b", bucket: "ad_copy_change", reliability: "best_effort", n: 1 },
];

const BRANDS = [
  { entity_id: "a", name: "Alpha" },
  { entity_id: "b", name: "Beta" },
];

describe("howRanked", () => {
  it("lists every bucket weight and reliability multiplier in schema order with its label", () => {
    const result = howRanked({ weekStartAt: WEEK, weightRows: V1_ROWS, counts: COUNTS, brands: BRANDS });

    const weights: readonly HowRankedWeight[] = result.weights;
    expect(weights.map((entry) => [entry.key, entry.label, entry.weight])).toEqual([
      ["mention_matters", "Mentions that matter", 3],
      ["mention_normal", "Mentions", 1],
      ["site_change_noteworthy", "Noteworthy site changes", 4],
      ["ad_new_creative", "New ad creatives", 2],
      ["ad_copy_change", "Ad copy or offer changes", 3],
      ["hiring_new_role", "New roles", 1],
    ]);

    const multipliers: readonly HowRankedMultiplier[] = result.multipliers;
    expect(multipliers.map((entry) => [entry.reliability, entry.label, entry.value])).toEqual([
      ["official_api", "Official API", 1],
      ["rss", "RSS feed", 0.9],
      ["scraped_page", "Scraped page", 0.6],
      ["best_effort", "Best effort", 0.5],
    ]);
  });

  it("totals every brand the way scoreByEntity does", () => {
    const result: HowRanked = howRanked({
      weekStartAt: WEEK,
      weightRows: V1_ROWS,
      counts: COUNTS,
      brands: BRANDS,
    });
    const expected = scoreByEntity(COUNTS, weightsAsOf(V1_ROWS, WEEK));

    expect(result.brands).toHaveLength(2);
    for (const brand of result.brands) {
      expect(brand.total).toBeCloseTo(expected.get(brand.entityId) ?? 0);
    }
  });

  it("reads the weights in force at the week's start", () => {
    const rows: readonly WeightRow[] = [
      ...V1_ROWS,
      { key: "mention_matters", weight: 100, effective_from: "2026-09-21T07:00:00.000Z" },
    ];
    const past: HowRanked = howRanked({
      weekStartAt: "2026-09-14T07:00:00.000Z",
      weightRows: rows,
      counts: COUNTS,
      brands: BRANDS,
    });
    const current: HowRanked = howRanked({
      weekStartAt: "2026-09-21T07:00:00.000Z",
      weightRows: rows,
      counts: COUNTS,
      brands: BRANDS,
    });

    expect(past.weights.find((entry) => entry.key === "mention_matters")?.weight).toBe(3);
    expect(current.weights.find((entry) => entry.key === "mention_matters")?.weight).toBe(100);
  });

  it("gives a brand with no counts an empty line set and a zero total", () => {
    const result = howRanked({
      weekStartAt: WEEK,
      weightRows: V1_ROWS,
      counts: COUNTS,
      brands: [...BRANDS, { entity_id: "c", name: "Gamma" }],
    });

    const gamma: HowRankedBrand | undefined = result.brands.find(
      (brand) => brand.entityId === "c",
    );
    expect(gamma?.lines).toEqual([]);
    expect(gamma?.total).toBe(0);
  });

  it("orders the lines by bucket then reliability, whatever order the counts arrive in", () => {
    const counts: readonly BucketCount[] = [
      { entity_id: "a", bucket: "hiring_new_role", reliability: "official_api", n: 1 },
      { entity_id: "a", bucket: "mention_matters", reliability: "best_effort", n: 1 },
      { entity_id: "a", bucket: "mention_matters", reliability: "official_api", n: 2 },
      { entity_id: "a", bucket: "mention_normal", reliability: "rss", n: 1 },
    ];
    const result = howRanked({
      weekStartAt: WEEK,
      weightRows: V1_ROWS,
      counts,
      brands: [{ entity_id: "a", name: "Alpha" }],
    });

    const order: readonly (readonly [HowRankedLine["bucket"], HowRankedLine["reliability"]])[] = [
      ["mention_matters", "official_api"],
      ["mention_matters", "best_effort"],
      ["mention_normal", "rss"],
      ["hiring_new_role", "official_api"],
    ];
    expect(result.brands[0]?.lines.map((line) => [line.bucket, line.reliability])).toEqual(order);
  });
});
