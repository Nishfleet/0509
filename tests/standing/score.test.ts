import { describe, expect, it } from "vitest";

import {
  D3_QUESTION_ID,
  D6_QUESTION_ID,
  rankWeek,
  scoreByEntity,
  weightsAsOf,
  type BucketCount,
  type Reliability,
  type ScoreBucket,
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

  it("keeps the latest row when the input is not already sorted", () => {
    const rows: readonly WeightRow[] = [
      { key: "mention_matters", weight: 50, effective_from: "2026-09-28T00:00:00.000Z" },
      { key: "mention_matters", weight: 3, effective_from: "2026-09-14T00:00:00.000Z" },
      { key: "mention_matters", weight: 100, effective_from: "2026-09-07T00:00:00.000Z" },
    ];
    expect(weightsAsOf(rows, "2026-09-21T00:00:00.000Z").get("mention_matters")).toBe(3);
  });

  it("keeps a row whose effective_from equals the week", () => {
    const rows: readonly WeightRow[] = [
      { key: "mention_matters", weight: 3, effective_from: "2026-09-14T00:00:00.000Z" },
      { key: "mention_matters", weight: 7, effective_from: "2026-09-21T00:00:00.000Z" },
    ];
    expect(weightsAsOf(rows, "2026-09-21T00:00:00.000Z").get("mention_matters")).toBe(7);
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
      new Error("scoring_weight has no row for ad_copy_change"),
    );
  });
});

describe("public contract", () => {
  it("names the D3 change question and the D6 mention question", () => {
    expect(D3_QUESTION_ID).toBe("noteworthy_change");
    expect(D6_QUESTION_ID).toBe("mention_matters");
  });

  it("accepts a count for every scored bucket and reliability", () => {
    const buckets: readonly ScoreBucket[] = [
      "mention_matters",
      "mention_normal",
      "site_change_noteworthy",
      "ad_new_creative",
      "ad_copy_change",
      "hiring_new_role",
    ];
    const reliabilities: readonly Reliability[] = [
      "official_api",
      "rss",
      "scraped_page",
      "best_effort",
    ];
    const counts: readonly BucketCount[] = buckets.map((bucket, index) => ({
      entity_id: "a",
      bucket,
      reliability: reliabilities[index % reliabilities.length],
      n: 1,
    }));
    expect(counts).toHaveLength(buckets.length);
    expect(counts.map((count) => count.bucket)).toEqual([...buckets]);
  });
});

describe("rankWeek (0509#4004)", () => {
  it("ranks by score, breaks ties by last week's rank, and computes movement", () => {
    const ranked = rankWeek(
      [
        { entity_id: "a", score: 3 },
        { entity_id: "b", score: 5 },
        { entity_id: "c", score: 3 },
        { entity_id: "d", score: 0 },
      ],
      new Map([
        ["a", 4],
        ["b", 2],
        ["c", 1],
      ]),
    );
    expect(ranked).toEqual([
      { entity_id: "b", rank: 1, movement: 1 },
      { entity_id: "c", rank: 2, movement: -1 },
      { entity_id: "a", rank: 3, movement: 1 },
      { entity_id: "d", rank: 4, movement: null },
    ]);
  });

  it("puts a brand with no last-week rank after ranked ties, then orders by id", () => {
    const ranked = rankWeek(
      [
        { entity_id: "z", score: 1 },
        { entity_id: "new", score: 1 },
        { entity_id: "old", score: 1 },
      ],
      new Map([["old", 3]]),
    );
    expect(ranked.map((row) => row.entity_id)).toEqual(["old", "new", "z"]);
    expect(ranked.map((row) => row.movement)).toEqual([2, null, null]);
  });
});
