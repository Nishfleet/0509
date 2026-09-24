import { describe, expect, it } from "vitest";

import { hourLabel, nextBriefLine, parseScheduleForm } from "../../app/lib/brief-settings";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("the brief schedule form", () => {
  it("accepts a day, an hour and a real time zone", () => {
    expect(parseScheduleForm(form({ weekday: "3", hour: "7", timezone: "Europe/London" }))).toEqual({
      weekday: 3,
      hour: 7,
      timezone: "Europe/London",
    });
  });

  it.each([
    { weekday: "7", hour: "8", timezone: "UTC" },
    { weekday: "-1", hour: "8", timezone: "UTC" },
    { weekday: "1", hour: "24", timezone: "UTC" },
    { weekday: "1", hour: "8.5", timezone: "UTC" },
    { weekday: "1", hour: "8", timezone: "Mars/Olympus" },
    { weekday: "1", hour: "8", timezone: "" },
  ])("refuses %o rather than saving a schedule the rollover cannot run", (values) => {
    expect(parseScheduleForm(form(values))).toBeNull();
  });

  it("refuses a missing field", () => {
    expect(parseScheduleForm(form({ weekday: "1", hour: "8" }))).toBeNull();
  });

  it("labels hours on the 24-hour clock", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(8)).toBe("08:00");
    expect(hourLabel(23)).toBe("23:00");
  });

  it("names the next brief in the workspace's own zone", () => {
    const at = new Date("2026-09-28T07:00:00.000Z");
    expect(nextBriefLine(at, "Europe/London")).toBe("Next one: Monday 28 September at 08:00");
  });
});
