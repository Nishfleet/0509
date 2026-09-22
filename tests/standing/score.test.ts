import { describe, expect, it } from "vitest";

import {
  STANDING_UPSERT_SQL,
  briefError,
  contributionKey,
  currentWeekStart,
  freezeRanks,
  needsCatchUp,
  nextRolloverInstant,
  scoreSignals,
  weightsAsOf,
  type SignalInput,
  type WeightRow,
} from "../../workers/standing/score";

const WEEK = "2026-09-21T08:00:00.000Z";
const END = "2026-09-28T08:00:00.000Z";

const SEEDED: WeightRow[] = [
  { key: "mention_matters", weight: 3, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "mention_normal", weight: 1, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "site_change_noteworthy", weight: 4, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "ad_new_creative", weight: 2, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "ad_copy_change", weight: 3, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "hiring_new_role", weight: 1, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "reliability_official_api", weight: 1, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "reliability_rss", weight: 0.9, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "reliability_scraped_page", weight: 0.6, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "reliability_best_effort", weight: 0.5, effectiveFrom: "2026-09-22T00:00:00.000Z" },
  { key: "weights_version", weight: 1, effectiveFrom: "2026-09-22T00:00:00.000Z" },
];

function signal(partial: Partial<SignalInput> & Pick<SignalInput, "id" | "kind">): SignalInput {
  return {
    aspect: null,
    publishedAt: null,
    observedAt: "2026-09-22T12:00:00.000Z",
    reliability: "rss",
    d3p: null,
    d5p: null,
    d6p: null,
    ...partial,
  };
}

describe("standing score", () => {
  it("reads the weight effective on that week and ignores a later one", () => {
    const rows = [...SEEDED, { key: "mention_matters", weight: 9, effectiveFrom: "2026-10-01T00:00:00.000Z" }];
    const early = weightsAsOf(rows, "2026-09-21T08:00:00.000Z");
    expect(early.get("mention_matters")).toBeUndefined();
    const during = weightsAsOf(rows, "2026-09-22T00:00:00.000Z");
    expect(during.get("mention_matters")).toBe(3);
    const after = weightsAsOf(rows, "2026-10-02T00:00:00.000Z");
    expect(after.get("mention_matters")).toBe(9);
  });

  it("sums weight times reliability and shows the arithmetic", () => {
    const weights = weightsAsOf(SEEDED, "2026-09-22T00:00:00.000Z");
    const signals = [
      signal({ id: "m", kind: "mention", d6p: 0.95, reliability: "rss" }),
      signal({ id: "n", kind: "mention", d5p: 0.95, d6p: 0.4, reliability: "rss" }),
      signal({ id: "c", kind: "change", d3p: 0.91, reliability: "official_api" }),
      signal({ id: "copy", kind: "ad", aspect: "offer", reliability: "scraped_page" }),
      signal({
        id: "new",
        kind: "ad",
        publishedAt: "2026-09-22T01:00:00.000Z",
        reliability: "best_effort",
      }),
      signal({ id: "hire", kind: "hiring", reliability: "rss" }),
      signal({ id: "drop", kind: "mention", d5p: 0.05, d6p: 0.99, reliability: "rss" }),
    ];
    expect(scoreSignals(signals, weights, WEEK, END)).toBeCloseTo(3 * 0.9 + 1 * 0.9 + 4 * 1 + 3 * 0.6 + 2 * 0.5 + 1 * 0.9);
  });

  it("does not count an ad published outside the week as a new creative", () => {
    expect(
      contributionKey(
        signal({
          id: "old",
          kind: "ad",
          publishedAt: "2026-09-01T00:00:00.000Z",
        }),
        WEEK,
        END,
      ),
    ).toBeNull();
  });

  it("freezes rank with movement = previous rank - this rank, and null when there is no prior row", () => {
    const frozen = freezeRanks([
      { entityId: "a", score: 10, previousRank: 3 },
      { entityId: "b", score: 10, previousRank: 1 },
      { entityId: "c", score: 4, previousRank: null },
      { entityId: "d", score: 1, previousRank: 4 },
    ]);
    expect(frozen.map((row) => [row.entityId, row.rank, row.movement])).toEqual([
      ["b", 1, 0],
      ["a", 2, 1],
      ["c", 3, null],
      ["d", 4, 0],
    ]);
  });

  it("anchors the week on the workspace zone and stores a UTC instant", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    expect(nextRolloverInstant(now, "UTC", 1, 8)).toBe("2026-09-28T08:00:00.000Z");
    expect(currentWeekStart(now, "UTC", 1, 8)).toBe("2026-09-21T08:00:00.000Z");
    expect(nextRolloverInstant(now, "UTC", 1, 8)).toMatch(/Z$/);
  });

  it("treats a missing week or a gap longer than eight days as a catch-up", () => {
    expect(needsCatchUp(null, WEEK)).toBe(true);
    expect(needsCatchUp("2026-09-07T08:00:00.000Z", WEEK)).toBe(true);
    expect(needsCatchUp("2026-09-14T08:00:00.000Z", WEEK)).toBe(false);
    expect(needsCatchUp(WEEK, WEEK)).toBe(false);
  });

  it("rejects a bad brief and accepts Monday 08:00 UTC", () => {
    expect(briefError("UTC", 1, 8)).toBeNull();
    expect(briefError("Not/AZone", 1, 8)).toMatch(/IANA/);
    expect(briefError("UTC", 7, 8)).toMatch(/Weekday/);
  });

  it("leaves rank and movement alone on the nightly upsert", () => {
    expect(STANDING_UPSERT_SQL).toMatch(/rank IS NULL/);
    expect(STANDING_UPSERT_SQL).not.toMatch(/rank = excluded/);
    expect(STANDING_UPSERT_SQL).not.toMatch(/movement = excluded/);
  });
});
