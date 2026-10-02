import { describe, expect, it } from "vitest";

import { weightOf } from "../app/lib/standing-score";

const WEIGHTS: ReadonlyMap<string, number> = new Map([
  ["mention_matters", 3],
  ["reliability_rss", 0.9],
  ["ad_copy_change", 0],
]);

describe("weightOf", () => {
  it("returns the weight for a key the map holds", () => {
    expect(weightOf(WEIGHTS, "mention_matters")).toBe(3);
    expect(weightOf(WEIGHTS, "reliability_rss")).toBe(0.9);
  });

  it("returns 0 when the key is mapped to 0", () => {
    expect(weightOf(WEIGHTS, "ad_copy_change")).toBe(0);
  });

  it("throws for an absent key, naming the row and the key", () => {
    expect(() => weightOf(WEIGHTS, "site_change_noteworthy")).toThrowError(
      "scoring_weight has no row for site_change_noteworthy",
    );
  });

  it("names the missing key it was asked for", () => {
    expect(() => weightOf(new Map<string, number>(), "hiring_new_role")).toThrowError(
      /^scoring_weight has no row for hiring_new_role$/,
    );
  });
});
