import { describe, expect, it } from "vitest";

import { alertDayGroup, groupByDay, localDay, startOfLocalDay } from "../../app/lib/alert-day";

const UTC_NOW = new Date("2026-09-24T10:00:00Z");
const NEW_YORK_NOW = new Date("2026-09-24T03:00:00Z");

describe("an alert, put in its day group by the workspace clock", () => {
  it("puts today's alert in New, even one from before the reading hour in UTC", () => {
    expect(alertDayGroup("2026-09-24T01:00:00Z", UTC_NOW, "UTC")).toBe("Today");
  });

  it("puts yesterday's alert in Yesterday, down to the minute", () => {
    expect(alertDayGroup("2026-09-23T23:59:00Z", UTC_NOW, "UTC")).toBe("Yesterday");
  });

  it("puts an older alert in Earlier", () => {
    expect(alertDayGroup("2026-09-22T12:00:00Z", UTC_NOW, "UTC")).toBe("Earlier");
  });

  it("treats a timestamp in the future as New", () => {
    expect(alertDayGroup("2026-09-25T00:00:00Z", UTC_NOW, "UTC")).toBe("Today");
  });

  it("reads the day group in the workspace's timezone, not the reader's", () => {
    expect(alertDayGroup("2026-09-23T12:00:00Z", NEW_YORK_NOW, "America/New_York")).toBe("Today");
    expect(alertDayGroup("2026-09-23T02:00:00Z", NEW_YORK_NOW, "America/New_York")).toBe("Yesterday");
  });

  it("puts an unreadable time in Earlier instead of crashing", () => {
    expect(alertDayGroup("garbage", UTC_NOW, "UTC")).toBe("Earlier");
  });
});

describe("the workspace calendar day for the change-alert cap", () => {
  it("starts the Kolkata day at 18:30Z, not at UTC midnight", () => {
    const eveningUtc = new Date("2026-10-05T19:00:00.000Z");
    expect(localDay(eveningUtc, "Asia/Kolkata")).toBe("2026-10-06");
    expect(startOfLocalDay(eveningUtc, "Asia/Kolkata").toISOString()).toBe("2026-10-05T18:30:00.000Z");
    expect(localDay(eveningUtc, "UTC")).toBe("2026-10-05");
    expect(startOfLocalDay(eveningUtc, "UTC").toISOString()).toBe("2026-10-05T00:00:00.000Z");
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
      { group: "Today", items: [ITEMS[3], ITEMS[2]] },
      { group: "Earlier", items: [ITEMS[1], ITEMS[0]] },
    ]);
  });

  it("leaves the list it was given in the order it came in", () => {
    groupByDay(ITEMS, UTC_NOW, "UTC");
    expect(ITEMS.map((item) => item.id)).toEqual(["earliest", "middling", "second-newest", "newest"]);
  });

  it("keeps one unreadable time in Earlier and the readable ones in their group", () => {
    const valid = { id: "valid", at: "2026-09-24T08:00:00Z" };
    const bad = { id: "bad", at: "garbage" };
    expect(groupByDay([bad, valid], UTC_NOW, "UTC")).toEqual([
      { group: "Today", items: [valid] },
      { group: "Earlier", items: [bad] },
    ]);
  });

  it("keeps a stable order when several times cannot be read", () => {
    const first = { id: "first", at: "garbage" };
    const second = { id: "second", at: "nonsense" };
    expect(groupByDay([first, second], UTC_NOW, "UTC")).toEqual([{ group: "Earlier", items: [first, second] }]);
  });
});
