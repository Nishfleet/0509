import { describe, expect, it } from "vitest";

import { daysAgoLabel } from "../../app/lib/delivery-alert";

const NOW = new Date("2026-10-02T09:00:00.000Z");

describe("daysAgoLabel (0509#6616)", () => {
  it("reads the same instant as today", () => {
    expect(daysAgoLabel("2026-10-02T09:00:00.000Z", NOW)).toBe("today");
  });

  it("reads one day back as yesterday", () => {
    expect(daysAgoLabel("2026-10-01T09:00:00.000Z", NOW)).toBe("yesterday");
  });

  it("reads three days back as 3 days ago", () => {
    expect(daysAgoLabel("2026-09-29T09:00:00.000Z", NOW)).toBe("3 days ago");
  });

  it("clamps a future timestamp to today", () => {
    expect(daysAgoLabel("2026-10-02T09:05:00.000Z", NOW)).toBe("today");
  });

  it("returns date unknown for an unparseable timestamp without throwing", () => {
    expect(() => daysAgoLabel("not a date", NOW)).not.toThrow();
    expect(daysAgoLabel("not a date", NOW)).toBe("date unknown");
  });

  it("returns date unknown for an empty timestamp without throwing", () => {
    expect(() => daysAgoLabel("", NOW)).not.toThrow();
    expect(daysAgoLabel("", NOW)).toBe("date unknown");
  });
});
