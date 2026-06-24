import { describe, expect, it } from "vitest";

import {
  addSubscriptionMonthsUtc,
  clampAnniversaryUtcDay,
  computeSubscriptionPeriodBounds,
} from "~/lib/evidence-usage-period.server";

describe("subscription-anchored entitlement periods", () => {
  it("anchors mid-month signup to the subscription day", () => {
    const anchor = "2026-06-23T10:00:00.000Z";
    const bounds = computeSubscriptionPeriodBounds(anchor, new Date("2026-07-10T12:00:00.000Z"));
    expect(bounds.periodStart).toBe("2026-06-23T10:00:00.000Z");
    expect(bounds.periodEnd).toBe("2026-07-23T10:00:00.000Z");
  });

  it("does not reset on July 1 for a June 30 anchor", () => {
    const anchor = "2026-06-30T00:00:00.000Z";
    const bounds = computeSubscriptionPeriodBounds(anchor, new Date("2026-07-01T12:00:00.000Z"));
    expect(bounds.periodStart).toBe("2026-06-30T00:00:00.000Z");
    expect(bounds.periodEnd).toBe("2026-07-30T00:00:00.000Z");
  });

  it("clamps January 31 to February's last day and returns to the 31st in March", () => {
    const anchor = new Date("2026-01-31T00:00:00.000Z");
    const febEnd = addSubscriptionMonthsUtc(anchor, 1);
    expect(febEnd.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    const marEnd = addSubscriptionMonthsUtc(anchor, 2);
    expect(marEnd.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(clampAnniversaryUtcDay(2024, 1, 31)).toBe(29);
  });

  it("creates monthly buckets for annual plans", () => {
    const anchor = "2026-01-15T00:00:00.000Z";
    const month3 = computeSubscriptionPeriodBounds(anchor, new Date("2026-03-20T00:00:00.000Z"));
    expect(month3.periodStart).toBe("2026-03-15T00:00:00.000Z");
    expect(month3.periodEnd).toBe("2026-04-15T00:00:00.000Z");
    const month1 = computeSubscriptionPeriodBounds(anchor, new Date("2026-01-20T00:00:00.000Z"));
    expect(month1.periodStart).toBe("2026-01-15T00:00:00.000Z");
  });
});
