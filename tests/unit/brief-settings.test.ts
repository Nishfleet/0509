import { describe, expect, it } from "vitest";

import { formatBriefAt, hourLabel, parseBriefSchedule } from "../../app/lib/brief-settings";

describe("the brief schedule form", () => {
  it("accepts a day, an hour and a real time zone", () => {
    expect(parseBriefSchedule({ weekday: 3, hour: 7, timezone: "Europe/London" })).toEqual({
      weekday: 3,
      hour: 7,
      timezone: "Europe/London",
    });
  });

  it.each([
    { weekday: 7, hour: 8, timezone: "UTC" },
    { weekday: -1, hour: 8, timezone: "UTC" },
    { weekday: 1, hour: 24, timezone: "UTC" },
    { weekday: 1, hour: 8.5, timezone: "UTC" },
    { weekday: "", hour: 8, timezone: "UTC" },
    { weekday: null, hour: 8, timezone: "UTC" },
    { weekday: 1, hour: 8, timezone: "Mars/Olympus" },
    { weekday: 1, hour: 8, timezone: "" },
  ])("refuses %o rather than saving a schedule the rollover cannot run", (values) => {
    expect(parseBriefSchedule(values)).toBeNull();
  });

  it("refuses a missing field", () => {
    expect(parseBriefSchedule({ weekday: 1, hour: 8, timezone: undefined })).toBeNull();
  });

  it("labels hours on the 24-hour clock", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(8)).toBe("08:00");
    expect(hourLabel(23)).toBe("23:00");
  });

  it("names the next brief in the workspace's own zone", () => {
    const at = new Date("2026-09-28T07:00:00.000Z");
    expect(formatBriefAt(at, "Europe/London")).toBe("Monday 28 September 2026, 08:00 Europe/London");
  });
});
