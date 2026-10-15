import { describe, expect, it } from "vitest";

import { capForNight, MAX_FEED_FINDS_PER_NIGHT, MAX_FEED_READS_PER_NIGHT } from "../../app/lib/feeds/nightly-cap";

const DAY = 86_400_000;
const items = Array.from({ length: 10 }, (_, index) => index);

describe("capForNight", () => {
  it("keeps everything at or under the cap", () => {
    expect(capForNight(items, 10, new Date(0))).toEqual({ kept: items, dropped: 0 });
    expect(capForNight([], 3, new Date(0))).toEqual({ kept: [], dropped: 0 });
  });

  it("keeps exactly the cap and reports what it dropped", () => {
    const result = capForNight(items, 4, new Date(0));

    expect(result.kept).toHaveLength(4);
    expect(result.dropped).toBe(6);
  });

  it("is the same list for the same day and starts elsewhere the next day", () => {
    const monday = capForNight(items, 4, new Date(5 * DAY));

    expect(capForNight(items, 4, new Date(5 * DAY + 3_600_000))).toEqual(monday);
    expect(capForNight(items, 4, new Date(6 * DAY)).kept).not.toEqual(monday.kept);
  });

  it("visits every item within a few nights, so none starves", () => {
    const seen = new Set<number>();
    for (let day = 0; day < 5; day += 1) {
      for (const item of capForNight(items, 4, new Date(day * DAY)).kept) seen.add(item);
    }

    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });

  it("keeps the two caps, plus the four fixed steps, under 10,000 Workflow steps", () => {
    expect(MAX_FEED_FINDS_PER_NIGHT + MAX_FEED_READS_PER_NIGHT + 4).toBeLessThan(10_000);
  });
});
