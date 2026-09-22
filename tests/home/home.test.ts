import { describe, expect, it } from "vitest";

import {
  briefDisagrees,
  formatMovement,
  formatScore,
  fourWeekSeries,
  suppressQuietWeek,
} from "../../app/lib/standing-present";

describe("home standing", () => {
  it("shows a dash for a zero score and a movement of new when there is no prior week", () => {
    expect(formatScore(0)).toBe("—");
    expect(formatScore(2.7)).toBe("2.7");
    expect(formatMovement(null)).toBe("new");
    expect(formatMovement(3)).toBe("+3");
  });

  it("leaves a missing week as a gap rather than a zero", () => {
    const chart = fourWeekSeries([
      { entityId: "a", name: "Self", weekStartAt: "2026-09-07T08:00:00.000Z", score: 4 },
      { entityId: "a", name: "Self", weekStartAt: "2026-09-21T08:00:00.000Z", score: 0 },
    ]);
    expect(chart.weeks).toEqual(["2026-09-07T08:00:00.000Z", "2026-09-21T08:00:00.000Z"]);
    expect(chart.series[0]?.scores).toEqual([4, 0]);
    const withGap = fourWeekSeries([
      { entityId: "a", name: "Self", weekStartAt: "2026-09-07T08:00:00.000Z", score: 4 },
      { entityId: "b", name: "Kindred", weekStartAt: "2026-09-21T08:00:00.000Z", score: 2 },
    ]);
    expect(withGap.series.find((line) => line.entityId === "a")?.scores).toEqual([4, null]);
    expect(withGap.series.find((line) => line.entityId === "b")?.scores).toEqual([null, 2]);
  });

  it("suppresses a quiet week when any source canary is zero", () => {
    expect(suppressQuietWeek([{ name: "Reddit", canary: 0, lastFetchedAt: "2026-09-20T00:00:00.000Z" }])).toBe(true);
    expect(suppressQuietWeek([{ name: "Reddit", canary: 3, lastFetchedAt: "2026-09-22T00:00:00.000Z" }])).toBe(false);
    expect(suppressQuietWeek([{ name: "Reddit", canary: null, lastFetchedAt: null }])).toBe(false);
  });

  it("notices when the brief ranks and the standing rows disagree", () => {
    expect(briefDisagrees([{ entityId: "a", rank: 1 }], [{ entityId: "a", rank: 2 }])).toBe(true);
    expect(briefDisagrees([{ entityId: "a", rank: 1 }], [{ entityId: "a", rank: 1 }])).toBe(false);
  });
});
