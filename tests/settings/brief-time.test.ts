import { describe, expect, it } from "vitest";

import { nextBriefAt } from "../../app/lib/brief-schedule";
import { formatBriefAt, parseBriefSchedule, WEEKDAYS } from "../../app/lib/brief-settings";

describe("parseBriefSchedule", () => {
  it("accepts a day, an hour and a real time zone", () => {
    expect(parseBriefSchedule({ weekday: "1", hour: "8", timezone: "Europe/London" })).toEqual({
      timezone: "Europe/London",
      weekday: 1,
      hour: 8,
    });
  });

  it.each([
    { weekday: "7", hour: "8", timezone: "Europe/London" },
    { weekday: "1", hour: "24", timezone: "Europe/London" },
    { weekday: "1", hour: "8.5", timezone: "Europe/London" },
    { weekday: "", hour: "8", timezone: "Europe/London" },
    { weekday: "1", hour: "8", timezone: "Mars/Olympus" },
    { weekday: "1", hour: "8", timezone: "" },
    { weekday: null, hour: "8", timezone: "Europe/London" },
  ])("returns null for %o", (input) => {
    expect(parseBriefSchedule(input)).toBeNull();
  });
});

describe("formatBriefAt", () => {
  it("renders an instant in the named IANA zone", () => {
    expect(formatBriefAt(new Date("2026-10-05T07:00:00Z"), "Europe/London")).toBe(
      "Monday 5 October 2026, 08:00 Europe/London",
    );
  });

  it("renders the next brief of a schedule", () => {
    const next = nextBriefAt(
      { timezone: "America/New_York", weekday: 1, hour: 8 },
      new Date("2026-09-24T12:00:00Z"),
    );
    expect(formatBriefAt(next, "America/New_York")).toBe(
      "Monday 28 September 2026, 08:00 America/New_York",
    );
  });
});

describe("WEEKDAYS", () => {
  it("starts on Sunday and covers the week", () => {
    expect(WEEKDAYS[0]).toBe("Sunday");
    expect(WEEKDAYS.length).toBe(7);
  });
});
