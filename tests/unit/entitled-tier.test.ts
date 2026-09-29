import { describe, expect, it } from "vitest";

import { entitledTier } from "../../app/lib/billing/entitlements";

const NOW = new Date("2026-09-29T12:00:00Z");
const plan = (status: string, currentPeriodEnd: string | null) => ({ tier: "agency", status, currentPeriodEnd });

describe("entitledTier", () => {
  it.each(["trialing", "active", "past_due"])("keeps the paid tier while %s", (status) => {
    expect(entitledTier(plan(status, null), NOW)).toBe("agency");
  });

  it.each(["pending", "on_hold", "paused", "failed", "expired"])("falls back to scout while %s", (status) => {
    expect(entitledTier(plan(status, "2099-01-01T00:00:00Z"), NOW)).toBe("scout");
  });

  it("keeps a cancelled plan to the end of the paid period, then drops it", () => {
    expect(entitledTier(plan("cancelled", "2026-09-30T00:00:00Z"), NOW)).toBe("agency");
    expect(entitledTier(plan("cancelled", "2026-09-28T00:00:00Z"), NOW)).toBe("scout");
    expect(entitledTier(plan("cancelled", null), NOW)).toBe("scout");
  });
});
