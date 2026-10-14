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
});
