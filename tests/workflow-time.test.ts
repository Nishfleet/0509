import { describe, expect, it } from "vitest";

import { plannedAt } from "../app/lib/workflow-time";

describe("plannedAt", () => {
  it("prefers the scheduled time over the instance timestamp", () => {
    expect(plannedAt(new Date("2026-09-21T00:00:00.000Z"), Date.UTC(2026, 8, 21, 2, 0, 0))).toBe(
      "2026-09-21T02:00:00.000Z",
    );
  });

  it("falls back to the instance timestamp when scheduled time is undefined", () => {
    expect(plannedAt(new Date("2026-09-22T05:09:30.250Z"), undefined)).toBe("2026-09-22T05:09:30.250Z");
  });

  it("uses a scheduled time of 0 as given instead of treating it as missing", () => {
    expect(plannedAt(new Date("2026-09-22T05:09:30.250Z"), 0)).toBe("1970-01-01T00:00:00.000Z");
  });
});
