import { describe, expect, it } from "vitest";

import { planLine } from "../../app/lib/billing/plan-line";

describe("planLine", () => {
  it("says no payment is set up when nothing is billed", () => {
    expect(planLine({ tier: "scout", status: "none", currentPeriodEnd: null, billed: false })).toBe(
      "You're on Scout. No payment is set up.",
    );
  });

  it("gives the renewal date of an active plan", () => {
    expect(
      planLine({ tier: "starter", status: "active", currentPeriodEnd: "2026-10-15T00:00:00.000Z", billed: true }),
    ).toBe("You're on Starter. It renews on 15 October 2026.");
  });

  it("says when a cancelled plan stops", () => {
    expect(
      planLine({ tier: "agency", status: "cancelled", currentPeriodEnd: "2026-10-15T00:00:00.000Z", billed: true }),
    ).toBe("You're on Agency until 15 October 2026, then it stops.");
  });
});
