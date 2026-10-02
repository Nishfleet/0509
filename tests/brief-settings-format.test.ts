import { describe, expect, it } from "vitest";

import { formatPausedSince, hourLabel } from "../app/lib/brief-settings";

describe("formatPausedSince", () => {
  it("formats the paused instant as a weekday and day in the given zone", () => {
    expect(formatPausedSince("2026-10-02T23:30:00Z", "UTC")).toBe("Friday 2 October");
  });

  it("shifts the day and weekday for a zone ahead of UTC", () => {
    expect(formatPausedSince("2026-10-02T23:30:00Z", "Asia/Kolkata")).toBe("Saturday 3 October");
  });

  it("names the date unknown instead of throwing when the stored instant is not a date", () => {
    expect(formatPausedSince("garbage", "UTC")).toBe("an unknown date");
  });
});

describe("hourLabel", () => {
  it("zero-pads a single-digit hour", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(9)).toBe("09:00");
  });

  it("leaves a two-digit hour unchanged", () => {
    expect(hourLabel(23)).toBe("23:00");
  });
});
