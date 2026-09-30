import { describe, expect, it } from "vitest";

import { plannedAt } from "../../app/lib/workflow-time";

describe("plannedAt", () => {
  it("prefers the cron's scheduled time over the instance creation stamp", () => {
    expect(plannedAt(new Date("2026-09-28T00:30:52.000Z"), Date.UTC(2026, 8, 28, 2))).toBe("2026-09-28T02:00:00.000Z");
  });

  it("falls back to the instance creation stamp for a manual instance", () => {
    expect(plannedAt(new Date("2026-09-28T00:30:52.000Z"), undefined)).toBe("2026-09-28T00:30:52.000Z");
  });
});
