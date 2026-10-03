import { describe, expect, it } from "vitest";

import { daysBefore } from "../app/lib/site-changes.server";

describe("the instant a window opens", () => {
  it("subtracts whole days from the given instant", () => {
    expect(daysBefore(new Date("2026-10-03T12:00:00.000Z"), 7)).toBe("2026-09-26T12:00:00.000Z");
  });

  it("returns the same instant when the span is zero days", () => {
    expect(daysBefore(new Date("2026-10-03T12:00:00.000Z"), 0)).toBe("2026-10-03T12:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(daysBefore(new Date("2026-03-02T12:00:00.000Z"), 2)).toBe("2026-02-28T12:00:00.000Z");
  });

  it("subtracts a fraction of a day", () => {
    expect(daysBefore(new Date("2026-10-03T18:30:00.000Z"), 0.5)).toBe("2026-10-03T06:30:00.000Z");
  });
});
