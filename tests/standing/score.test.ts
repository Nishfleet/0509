import { describe, expect, it } from "vitest";

import {
  scoreByEntity,
  weightsAsOf,
  type BucketCount,
  type WeightRow,
} from "../../workers/standing/score";

const MENTION_ROWS: readonly WeightRow[] = [
  { key: "mention_matters", weight: 100, effective_from: "2026-09-07T00:00:00.000Z" },
  { key: "mention_matters", weight: 3, effective_from: "2026-09-14T00:00:00.000Z" },
  { key: "mention_matters", weight: 50, effective_from: "2026-09-28T00:00:00.000Z" },
];

const V1_WEIGHTS = new Map<string, number>([
  ["mention_matters", 3],
  ["mention_normal", 1],
  ["site_change_noteworthy", 4],
  ["ad_new_creative", 2],
  ["ad_copy_change", 3],
  ["hiring_new_role", 1],
  ["reliability_official_api", 1],
  ["reliability_rss", 0.9],
  ["reliability_scraped_page", 0.6],
  ["reliability_best_effort", 0.5],
]);

describe("weightsAsOf", () => {
  it("keeps the latest effective_from not after the week", () => {
    expect(weightsAsOf(MENTION_ROWS, "2026-09-21T00:00:00.000Z").get("mention_matters")).toBe(3);
  });

  it("omits a key whose only row is after the week", () => {
    const rows: readonly WeightRow[] = [
      { key: "ad_copy_change", weight: 3, effective_from: "2026-09-28T00:00:00.000Z" },
    ];
    expect(weightsAsOf(rows, "2026-09-21T00:00:00.000Z").has("ad_copy_change")).toBe(false);
  });

  it("does not mutate the input rows", () => {
    const rows: WeightRow[] = [
      { key: "mention_matters", weight: 50, effective_from: "2026-09-28T00:00:00.000Z" },
      { key: "mention_matters", weight: 100, effective_from: "2026-09-07T00:00:00.000Z" },
      { key: "mention_matters", weight: 3, effective_from: "2026-09-14T00:00:00.000Z" },
    ];
    const before = structuredClone(rows);
    weightsAsOf(rows, "2026-09-21T00:00:00.000Z");
    expect(rows).toEqual(before);
  });
});

describe("scoreByEntity", () => {
  it("sums n times the bucket weight times the reliability weight", () => {
    const counts: readonly BucketCount[] = [
      { entity_id: "a", bucket: "mention_matters", reliability: "official_api", n: 2 },
      { entity_id: "a", bucket: "hiring_new_role", reliability: "rss", n: 1 },
      { entity_id: "b", bucket: "site_change_noteworthy", reliability: "scraped_page", n: 1 },
    ];
    const scores = scoreByEntity(counts, V1_WEIGHTS);
    expect(scores.get("a")).toBeCloseTo(6.9);
    expect(scores.get("b")).toBeCloseTo(2.4);
  });

  it("throws when a bucket has no weight row", () => {
    const counts: readonly BucketCount[] = [
      { entity_id: "a", bucket: "ad_copy_change", reliability: "official_api", n: 1 },
    ];
    const weights = new Map(V1_WEIGHTS);
    weights.delete("ad_copy_change");
    expect(() => scoreByEntity(counts, weights)).toThrowError(
      "scoring_weight has no row for ad_copy_change",
    );
  });
});
