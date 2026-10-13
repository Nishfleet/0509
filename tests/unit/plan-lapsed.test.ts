import { describe, expect, it } from "vitest";

import { isPlanLapsed } from "../../app/lib/billing/entitlements";

const now = new Date("2026-10-13T12:00:00.000Z");

describe("isPlanLapsed", () => {
  it("is true for a cancelled or expired plan past its paid period", () => {
    expect(isPlanLapsed({ status: "cancelled", currentPeriodEnd: "2026-09-15T00:00:00.000Z" }, now)).toBe(true);
    expect(isPlanLapsed({ status: "expired", currentPeriodEnd: null }, now)).toBe(true);
  });

  it("is false while a cancelled plan is still paid up", () => {
    expect(isPlanLapsed({ status: "cancelled", currentPeriodEnd: "2026-10-20T00:00:00.000Z" }, now)).toBe(false);
  });

  it("is false for a running plan and for one that is merely on hold or failed", () => {
    for (const status of ["active", "trialing", "past_due", "on_hold", "failed", "none"]) {
      expect(isPlanLapsed({ status, currentPeriodEnd: "2026-09-15T00:00:00.000Z" }, now), status).toBe(false);
    }
  });
});
