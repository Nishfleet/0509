import { describe, expect, it } from "vitest";

import { shortUtc } from "../app/lib/short-utc";

describe("shortUtc", () => {
  it("formats a UTC timestamp without seconds", () => {
    expect(shortUtc("2026-09-23T04:52:00.000Z")).toBe("2026-09-23 04:52 UTC");
  });

  it("normalizes an offset timestamp to UTC", () => {
    expect(shortUtc("2026-09-23T06:02:00+02:00")).toBe("2026-09-23 04:02 UTC");
  });

  it("leaves an invalid timestamp unchanged", () => {
    expect(shortUtc("not a date")).toBe("not a date");
  });
});
