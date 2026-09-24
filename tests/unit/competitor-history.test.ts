import { describe, expect, it } from "vitest";

import { historyAnchor } from "../../app/lib/competitor-history";

const NOW = new Date("2026-09-24T12:00:00.000Z");

describe("historyAnchor", () => {
  it("returns now when the brand is on", () => {
    expect(historyAnchor("on", "2026-06-01T08:00:00.000Z", NOW)).toEqual(NOW);
  });

  it("returns now when the brand is off but has no state_changed_at", () => {
    expect(historyAnchor("off", null, NOW)).toEqual(NOW);
  });

  it("returns the pause instant when the brand is off and pause is in the past", () => {
    const result = historyAnchor("off", "2026-06-01T08:00:00.000Z", NOW);
    expect(result.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });

  it("returns now when a future pause is given (clock skew guard)", () => {
    expect(historyAnchor("off", "2026-09-25T08:00:00.000Z", NOW)).toEqual(NOW);
  });
});
