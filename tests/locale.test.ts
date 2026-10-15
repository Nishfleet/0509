import { describe, expect, it } from "vitest";

import { APP_LOCALE } from "../app/lib/locale";

describe("one locale for dates, times and numbers", () => {
  it("abbreviates September one way for the whole app", () => {
    const format = (timeZone: string) =>
      new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "short", timeZone }).format(
        new Date("2026-09-14T12:00:00Z"),
      );
    expect(format("UTC")).toBe(format("Europe/London"));
    expect(format("UTC")).toMatch(/^14 Sept?$/);
  });

  it("prints the incident re-check time on the 24-hour clock, as the list times are", () => {
    const recheck = new Intl.DateTimeFormat(APP_LOCALE, {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date("2026-10-14T15:30:00Z"));
    expect(recheck).toBe("15:30 UTC");
  });
});
