import { describe, expect, it } from "vitest";

import { alertDayGroup, groupByDay } from "../../app/lib/alert-day";

const UTC_NOW = new Date("2026-09-24T10:00:00Z");
const NEW_YORK_NOW = new Date("2026-09-24T03:00:00Z");

describe("an alert, put in its day group by the workspace clock", () => {
  it("puts today's alert in New, even one from before the reading hour in UTC", () => {
    expect(alertDayGroup("2026-09-24T01:00:00Z", UTC_NOW, "UTC")).toBe("New");
  });

  it("puts yesterday's alert in Yesterday, down to the minute", () => {
    expect(alertDayGroup("2026-09-23T23:59:00Z", UTC_NOW, "UTC")).toBe("Yesterday");
  });

  it("puts an older alert in Earlier", () => {
    expect(alertDayGroup("2026-09-22T12:00:00Z", UTC_NOW, "UTC")).toBe("Earlier");
  });

  it("treats a timestamp in the future as New", () => {
    expect(alertDayGroup("2026-09-25T00:00:00Z", UTC_NOW, "UTC")).toBe("New");
  });

  it("reads the day group in the workspace's timezone, not the reader's", () => {
    expect(alertDayGroup("2026-09-23T12:00:00Z", NEW_YORK_NOW, "America/New_York")).toBe("New");
    expect(alertDayGroup("2026-09-23T02:00:00Z", NEW_YORK_NOW, "America/New_York")).toBe("Yesterday");
  });
});

describe("alerts, grouped by the day a customer reads them", () => {
  const ITEMS = [
    { id: "earliest", at: "2026-09-22T09:00:00Z" },
    { id: "middling", at: "2026-09-22T15:00:00Z" },
    { id: "second-newest", at: "2026-09-24T05:00:00Z" },
    { id: "newest", at: "2026-09-24T08:00:00Z" },
  ];

  it("returns the groups in reading order, each newest first, and drops the empty ones", () => {
    expect(groupByDay(ITEMS, UTC_NOW, "UTC")).toEqual([
      { group: "New", items: [ITEMS[3], ITEMS[2]] },
      { group: "Earlier", items: [ITEMS[1], ITEMS[0]] },
    ]);
  });

  it("leaves the list it was given in the order it came in", () => {
    groupByDay(ITEMS, UTC_NOW, "UTC");
    expect(ITEMS.map((item) => item.id)).toEqual(["earliest", "middling", "second-newest", "newest"]);
  });
});
