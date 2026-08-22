import { describe, expect, it } from "vitest";

import {
  formatCaptureStampLabel,
  formatShortUtcDate,
  isDateOnlyIsoDate,
} from "~/lib/capture-date-label";

/**
 * Public proof stamps must never print a midnight "12:00 AM" clock for
 * date-only Ad Library captures (`YYYY-MM-DD` parses as UTC midnight).
 */

describe("isDateOnlyIsoDate", () => {
  it("detects bare calendar dates and rejects timestamps", () => {
    expect(isDateOnlyIsoDate("2026-08-01")).toBe(true);
    expect(isDateOnlyIsoDate(" 2026-08-01 ")).toBe(true);
    expect(isDateOnlyIsoDate("2026-08-01T00:00:00.000Z")).toBe(false);
    expect(isDateOnlyIsoDate("2026-08-20T14:27:13.848Z")).toBe(false);
    expect(isDateOnlyIsoDate("")).toBe(false);
    expect(isDateOnlyIsoDate(null)).toBe(false);
    expect(isDateOnlyIsoDate(undefined)).toBe(false);
    expect(isDateOnlyIsoDate("not a date")).toBe(false);
  });
});

describe("formatCaptureStampLabel", () => {
  it("renders a date-only capture as its calendar date, not a midnight clock", () => {
    const label = formatCaptureStampLabel("2026-08-01");
    expect(label).toBe("Aug 1");
    expect(label).not.toMatch(/AM|PM|:/);
  });

  it("keeps a time-of-day clock for full timestamps", () => {
    // Host-zone clock formatting is pre-existing behavior; what must hold is
    // that a full timestamp renders as a clock, never as a bare date.
    const label = formatCaptureStampLabel("2026-08-20T14:27:00.000Z");
    expect(label).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("returns null for unusable input so callers own the fallback copy", () => {
    expect(formatCaptureStampLabel("recently-ish")).toBeNull();
    expect(formatCaptureStampLabel("")).toBeNull();
    expect(formatCaptureStampLabel(null)).toBeNull();
    expect(formatCaptureStampLabel(undefined)).toBeNull();
  });

  it("keeps a date-only capture on its calendar day regardless of host zone", () => {
    // "2026-01-31" parses as UTC midnight — an unpinned local formatter could
    // shift it to Jan 30 or Feb 1; the pinned one must not.
    expect(formatShortUtcDate(new Date("2026-01-31"))).toBe("Jan 31");
  });
});
