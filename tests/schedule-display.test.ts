import { describe, expect, it } from "vitest";

import { formatNextScanLabel, nextScheduledScanAt } from "~/lib/schedule-display";

describe("free-plan schedule display", () => {
  it("does not manufacture a recurring scan slot for free", () => {
    const now = new Date("2026-06-10T01:00:00.000Z");

    expect(nextScheduledScanAt("free", now)).toBeNull();
    expect(formatNextScanLabel("free", now)).toContain("activation-only");
    expect(formatNextScanLabel("free", now)).toContain("paid plans include recurring monitoring");
  });
});
