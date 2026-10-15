import { afterEach, describe, expect, it, vi } from "vitest";

import { createTimings } from "../app/lib/server-timing.server";

function scriptedClock(readings: readonly number[]): void {
  let i = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    const next = readings[i++];
    if (next === undefined) throw new Error(`performance.now() called ${i} times, script has ${readings.length}`);
    return next;
  });
}

describe("createTimings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records each measure in order and appends the total last", async () => {
    scriptedClock([0, 0, 10, 10, 15, 20]);

    const timings = createTimings();
    await timings.measure("a", Promise.resolve(1));
    await timings.measure("b", Promise.resolve(2));

    expect(timings.header()).toEqual({ "Server-Timing": "a;dur=10, b;dur=5, total;dur=20" });
  });

  it("appends an entry when the measure settles, not when it is called", async () => {
    scriptedClock([0, 0, 1, 5, 25, 30]);

    let releaseSlow!: (value: number) => void;
    let releaseFast!: (value: number) => void;
    const slow = new Promise<number>((resolve) => (releaseSlow = resolve));
    const fast = new Promise<number>((resolve) => (releaseFast = resolve));

    const timings = createTimings();
    const measuredSlow = timings.measure("slow", slow);
    const measuredFast = timings.measure("fast", fast);

    releaseFast(2);
    await measuredFast;
    releaseSlow(1);
    await measuredSlow;

    expect(timings.header()).toEqual({ "Server-Timing": "fast;dur=4, slow;dur=25, total;dur=30" });
  });

  it("rounds a fractional duration to whole milliseconds with toFixed(0)", async () => {
    scriptedClock([0, 100, 110.6, 200, 210.4, 220]);

    const timings = createTimings();
    await timings.measure("r", Promise.resolve(1));
    await timings.measure("s", Promise.resolve(2));

    expect(timings.header()).toEqual({ "Server-Timing": "r;dur=11, s;dur=10, total;dur=220" });
  });

  it("records a rejected measure in the header and rethrows the original error", async () => {
    scriptedClock([0, 50, 65, 70]);

    const timings = createTimings();
    const boom = new Error("boom");

    await expect(timings.measure("x", Promise.reject(boom))).rejects.toBe(boom);
    expect(timings.header()).toEqual({ "Server-Timing": "x;dur=15, total;dur=70" });
  });

  it("emits only the total when nothing was measured", () => {
    scriptedClock([0, 7]);

    const timings = createTimings();

    expect(timings.header()).toEqual({ "Server-Timing": "total;dur=7" });
  });

  it("returns the resolved value unchanged", async () => {
    scriptedClock([0, 0, 1]);

    const timings = createTimings();
    const value = { loaded: true };

    await expect(timings.measure("m", Promise.resolve(value))).resolves.toBe(value);
  });
});
