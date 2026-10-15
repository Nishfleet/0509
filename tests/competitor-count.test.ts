import { describe, expect, it } from "vitest";

import { competitorCountLine } from "../app/lib/competitor-count";

describe("competitorCountLine", () => {
  it("shows how many of the plan's competitors are on", () => {
    expect(competitorCountLine(3, 5)).toBe("Watching 3 of 5 competitors on your plan.");
  });

  it("says the plan is full at the cap", () => {
    expect(competitorCountLine(5, 5)).toBe("Watching 5 of 5 competitors. Your plan is full.");
  });
});
