import { describe, expect, it } from "vitest";

import { blindSources, type SourceTick } from "../../app/lib/observability/pipeline-health";

const tick = (overrides: Partial<SourceTick> & { itemCount: number }): SourceTick => ({
  sourceId: "src_a",
  sourceKey: "reddit.mentions",
  kind: "mentions",
  platform: "reddit",
  watchId: "watch_a",
  fetchedAt: "2026-09-22T00:00:00.000Z",
  ...overrides,
});

describe("blindSources", () => {
  it("flags one watch with two ticks at 0 as blind, taking lastGoodAt from the map", () => {
    const ticks: SourceTick[] = [
      tick({ itemCount: 0, fetchedAt: "2026-09-22T00:00:00.000Z" }),
      tick({ itemCount: 0, fetchedAt: "2026-09-21T00:00:00.000Z" }),
    ];
    const lastGood = new Map([["src_a", "2026-09-20T12:00:00.000Z"]]);
    const blind = blindSources(ticks, lastGood);
    expect(blind).toEqual([
      {
        sourceId: "src_a",
        sourceKey: "reddit.mentions",
        name: "Reddit mentions",
        lastGoodAt: "2026-09-20T12:00:00.000Z",
      },
    ]);
  });

  it("does not flag a watch whose latest tick is 0 but previous is 3", () => {
    const ticks: SourceTick[] = [
      tick({ itemCount: 0, fetchedAt: "2026-09-22T00:00:00.000Z" }),
      tick({ itemCount: 3, fetchedAt: "2026-09-21T00:00:00.000Z" }),
    ];
    expect(blindSources(ticks, new Map())).toEqual([]);
  });

  it("does not flag a watch with only one tick at 0", () => {
    const ticks: SourceTick[] = [
      tick({ itemCount: 0, fetchedAt: "2026-09-22T00:00:00.000Z" }),
    ];
    expect(blindSources(ticks, new Map())).toEqual([]);
  });

  it("does not flag a source when one watch is 0/0 and another is 0/5", () => {
    const ticks: SourceTick[] = [
      tick({ itemCount: 0, watchId: "watch_a", fetchedAt: "2026-09-22T00:00:00.000Z" }),
      tick({ itemCount: 0, watchId: "watch_a", fetchedAt: "2026-09-21T00:00:00.000Z" }),
      tick({ itemCount: 0, watchId: "watch_b", fetchedAt: "2026-09-22T00:00:00.000Z" }),
      tick({ itemCount: 5, watchId: "watch_b", fetchedAt: "2026-09-21T00:00:00.000Z" }),
    ];
    expect(blindSources(ticks, new Map())).toEqual([]);
  });

  it("ignores a third older tick of 7 when a watch's latest two are 0", () => {
    const ticks: SourceTick[] = [
      tick({ itemCount: 0, fetchedAt: "2026-09-22T00:00:00.000Z" }),
      tick({ itemCount: 0, fetchedAt: "2026-09-21T00:00:00.000Z" }),
      tick({ itemCount: 7, fetchedAt: "2026-09-20T00:00:00.000Z" }),
    ];
    const blind = blindSources(ticks, new Map());
    expect(blind).toHaveLength(1);
    expect(blind[0]?.sourceId).toBe("src_a");
  });

  it("sorts by sourceKey and leaves the input array unchanged", () => {
    const alpha: SourceTick = tick({
      sourceId: "src_b",
      sourceKey: "apple.mentions",
      platform: "apple",
      itemCount: 0,
      fetchedAt: "2026-09-22T00:00:00.000Z",
    });
    const bravo: SourceTick = tick({
      sourceId: "src_a",
      sourceKey: "reddit.mentions",
      platform: "reddit",
      itemCount: 0,
      fetchedAt: "2026-09-22T00:00:00.000Z",
    });
    const secondForAlpha: SourceTick = tick({
      sourceId: "src_b",
      sourceKey: "apple.mentions",
      platform: "apple",
      itemCount: 0,
      fetchedAt: "2026-09-21T00:00:00.000Z",
    });
    const secondForBravo: SourceTick = tick({
      sourceId: "src_a",
      sourceKey: "reddit.mentions",
      platform: "reddit",
      itemCount: 0,
      fetchedAt: "2026-09-21T00:00:00.000Z",
    });
    const input = [alpha, bravo, secondForAlpha, secondForBravo];
    const snapshot = input.slice();
    const blind = blindSources(input, new Map());
    expect(blind.map((s) => s.sourceKey)).toEqual(["apple.mentions", "reddit.mentions"]);
    expect(input).toEqual(snapshot);
  });
});
