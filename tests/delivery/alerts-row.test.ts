import { describe, expect, it } from "vitest";

import { daysAgoLabel } from "../../app/lib/delivery-alert";

const NOW = new Date("2026-09-24T09:00:00.000Z");

describe("an alert row's time (0509#4378)", () => {
  it("reads as a relative day, never a raw timestamp", () => {
    expect(daysAgoLabel("2026-09-24T03:00:00.000Z", NOW)).toBe("today");
    expect(daysAgoLabel("2026-09-23T03:00:00.000Z", NOW)).toBe("yesterday");
    expect(daysAgoLabel("2026-09-20T03:00:00.000Z", NOW)).toBe("4 days ago");
  });

  it("never says a future day when clocks disagree", () => {
    expect(daysAgoLabel("2026-09-24T09:05:00.000Z", NOW)).toBe("today");
  });
});
