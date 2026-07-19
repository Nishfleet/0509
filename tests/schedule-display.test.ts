import { describe, expect, it } from "vitest";

import { formatNextScanLabel, nextScheduledScanAt } from "~/lib/schedule-display";

describe("free-plan schedule display", () => {
  it("points free at the next Monday 03:00 UTC weekly check", () => {
    const now = new Date("2026-06-10T01:00:00.000Z"); // a Wednesday

    const next = nextScheduledScanAt("free", now);
    expect(next.toISOString()).toBe("2026-06-15T03:00:00.000Z");
    expect(next.getUTCDay()).toBe(1);
    expect(formatNextScanLabel("free", now)).toContain("Mon");
  });

  it("skips to the following Monday when the weekly slot already passed today", () => {
    const mondayAfterSlot = new Date("2026-06-15T04:00:00.000Z");
    expect(nextScheduledScanAt("free", mondayAfterSlot).toISOString()).toBe(
      "2026-06-22T03:00:00.000Z",
    );
  });
});
