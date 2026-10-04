import { describe, expect, it } from "vitest";

import { planLine } from "../../app/lib/billing/plan-line";

describe("planLine", () => {
  it("says no payment is set up when nothing is billed", () => {
    expect(planLine({ tier: "scout", status: "none", currentPeriodEnd: null, trialing: false, billed: false })).toBe(
      "You're on Scout. No payment is set up.",
    );
  });

  it("gives the renewal date of an active plan", () => {
    expect(
      planLine({
        tier: "starter",
        status: "active",
        currentPeriodEnd: "2026-10-15T00:00:00.000Z",
        trialing: false,
        billed: true,
      }),
    ).toBe("You're on Starter. It renews on 15 October 2026.");
  });

  it("says when a cancelled plan stops", () => {
    expect(
      planLine({
        tier: "agency",
        status: "cancelled",
        currentPeriodEnd: "2026-10-15T00:00:00.000Z",
        trialing: false,
        billed: true,
      }),
    ).toBe("You're on Agency until 15 October 2026, then it stops.");
  });

  const trialing = {
    tier: "starter",
    status: "active",
    currentPeriodEnd: "2026-10-06T10:00:00.000Z",
    trialing: true,
    billed: true,
  } as const;
  const before = new Date("2026-10-02T00:00:00.000Z");

  it("names the trial end while the trial runs", () => {
    expect(planLine(trialing, before)).toBe("You're on Starter. Your trial ends on 6 October 2026.");
  });

  it("states no charge amount, so a yearly plan never shows the monthly price", () => {
    expect(planLine({ ...trialing, tier: "agency" }, before)).toBe(
      "You're on Agency. Your trial ends on 6 October 2026.",
    );
  });

  it("goes back to the renewal date once the trial has ended", () => {
    expect(planLine(trialing, new Date("2026-10-06T10:00:00.000Z"))).toBe(
      "You're on Starter. It renews on 6 October 2026.",
    );
  });

  it.each(["on_hold", "failed", "cancelled"])("does not claim a running trial when the status is %s", (status) => {
    expect(planLine({ ...trialing, status }, before)).not.toContain("trial");
  });
});
