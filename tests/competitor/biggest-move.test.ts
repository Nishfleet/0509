import { describe, expect, it } from "vitest";

import {
  biggestMoveView,
  pickBiggestMove,
  quietWeekSentence,
  type BiggestMove,
  type ScoredSignal,
} from "../../app/lib/biggest-move";
import { weightsAsOf, type WeightRow } from "../../app/lib/standing-score";

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

const WEIGHTS = weightsAsOf(V1_ROWS, WEEK);

function signal(overrides: Partial<ScoredSignal> & { id: string }): ScoredSignal {
  return {
    kind: "mention",
    bucket: "mention_matters",
    reliability: "official_api",
    platform: "web",
    title: null,
    summary: null,
    url: null,
    observedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("pickBiggestMove", () => {
  it("returns null for empty input", () => {
    expect(pickBiggestMove([], WEIGHTS)).toBeNull();
  });

  it("picks the signal with the highest points", () => {
    const mention = signal({
      id: "sig-mention",
      kind: "mention",
      bucket: "mention_matters",
      reliability: "rss",
    });
    const change = signal({
      id: "sig-change",
      kind: "change",
      bucket: "site_change_noteworthy",
      reliability: "scraped_page",
    });

    const move = pickBiggestMove([change, mention], WEIGHTS);

    expect(move?.signal.id).toBe("sig-mention");
    expect(move?.points).toBeCloseTo(2.7);
  });

  it("breaks a points tie on the later observedAt", () => {
    const older = signal({
      id: "sig-older",
      bucket: "mention_matters",
      observedAt: "2026-09-18T10:00:00.000Z",
    });
    const newer = signal({
      id: "sig-newer",
      bucket: "ad_copy_change",
      observedAt: "2026-09-21T10:00:00.000Z",
    });

    const move = pickBiggestMove([older, newer], WEIGHTS);

    expect(move?.signal.id).toBe("sig-newer");
    expect(move?.points).toBe(3);
  });

  it("breaks a full tie on the greater id", () => {
    const low = signal({ id: "sig-a", bucket: "mention_matters" });
    const high = signal({ id: "sig-b", bucket: "ad_copy_change" });

    const move = pickBiggestMove([low, high], WEIGHTS);

    expect(move?.signal.id).toBe("sig-b");
    expect(move?.points).toBe(3);
  });

  it("throws when the bucket has no weight row", () => {
    const rows = V1_ROWS.filter((row) => row.key !== "hiring_new_role");
    const weights = weightsAsOf(rows, WEEK);

    expect(() =>
      pickBiggestMove([signal({ id: "sig-hire", bucket: "hiring_new_role" })], weights),
    ).toThrow(/scoring_weight has no row/);
  });
});

describe("biggestMoveView", () => {
  const move: BiggestMove = {
    signal: signal({
      id: "sig-ad",
      kind: "ad",
      bucket: "ad_copy_change",
      reliability: "official_api",
      platform: "meta",
      summary: "Fresh copy on the winter sale",
      url: "https://example.com/ad/1",
      observedAt: "2026-09-24T00:00:00.000Z",
    }),
    weight: 3,
    multiplier: 1,
    points: 3,
  };
  const now = new Date("2026-09-26T00:00:00.000Z");

  it("words the pick with its bucket label, weight and multiplier", () => {
    const view = biggestMoveView(move, now);

    expect(view.read).toBe(
      "Ad copy or offer changes: 3 × 1 = 3 points, the most of anything this brand did this week.",
    );
    expect(view.source).toBe("Ad library · meta");
    expect(view.id).toBe("sig-ad");
    expect(view.kind).toBe("ad");
    expect(view.url).toBe("https://example.com/ad/1");
    expect(view.when).toBe("2 days ago");
  });

  it("falls back to the summary, then to the source label, for the title", () => {
    expect(biggestMoveView(move, now).title).toBe("Fresh copy on the winter sale");
    expect(
      biggestMoveView(
        { ...move, signal: { ...move.signal, summary: null } },
        now,
      ).title,
    ).toBe("Ad library");
  });
});

describe("quietWeekSentence", () => {
  it("names the checked sources and the last check time", () => {
    expect(quietWeekSentence(["Website", "Ad library"], "2026-09-24 02:10 UTC")).toBe(
      "Nothing scored for this brand in the last 7 days. We checked Website and Ad library, last at 2026-09-24 02:10 UTC.",
    );
  });

  it("says the first read lands tonight when the brand was never checked", () => {
    expect(quietWeekSentence([], null)).toBe(
      "Nothing scored for this brand in the last 7 days. We watch its website; the first read lands tonight at 02:00 UTC.",
    );
  });
});
