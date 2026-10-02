import { afterEach, describe, expect, it, vi } from "vitest";

import { createTimings } from "../app/lib/server-timing.server";

// createTimings reads the clock through performance.now() at a fixed, small set
// of points: once for `started`, then a begin and an end per measure, then once
// per header() for the total. Each test scripts exactly those readings, so the
// asserted header is exact and no test waits on real time.
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

  it("records each measure in call order and appends the total last, rounded to whole ms", async () => {
    // started=0, a 0->10, b 10->15, header at 20.
    scriptedClock([0, 0, 10, 10, 15, 20]);

    const timings = createTimings();
    await timings.measure("a", Promise.resolve(1));
    await timings.measure("b", Promise.resolve(2));

    expect(timings.header()).toEqual({ "Server-Timing": "a;dur=10, b;dur=5, total;dur=20" });
  });

  it("records a rejected measure in the header and rethrows the original error", async () => {
    // started=0, x 50->65, header at 70.
    scriptedClock([0, 50, 65, 70]);

    const timings = createTimings();
    const boom = new Error("boom");

    // The finally must record x before the rejection propagates, and the
    // rejection must reach the caller rather than be swallowed.
    await expect(timings.measure("x", Promise.reject(boom))).rejects.toBe(boom);
    expect(timings.header()).toEqual({ "Server-Timing": "x;dur=15, total;dur=70" });
  });

  it("emits only the total when nothing was measured", () => {
    // started=0, header at 7.
    scriptedClock([0, 7]);

    const timings = createTimings();

    expect(timings.header()).toEqual({ "Server-Timing": "total;dur=7" });
  });

  it("returns the resolved value unchanged", async () => {
    // started=0, m 0->1.
    scriptedClock([0, 0, 1]);

    const timings = createTimings();
    const value = { loaded: true };

    await expect(timings.measure("m", Promise.resolve(value))).resolves.toBe(value);
  });
});
