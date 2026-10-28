import { describe, expect, it } from "vitest";

import { planLine } from "../../app/lib/billing/plan-line";

describe("planLine", () => {
  const NOW = new Date("2026-10-01T00:00:00.000Z");

  it("says nothing is charged while no payment method is on file", () => {
    expect(
      planLine({ tier: "scout", status: "none", currentPeriodEnd: null, trialing: false, billed: false }, NOW),
    ).toBe("You're on Scout. No payment method is on file, so nothing is charged.");
  });

  it("gives the renewal date of an active plan", () => {
    expect(
      planLine(
        {
          tier: "starter",
          status: "active",
          currentPeriodEnd: "2026-10-15T00:00:00.000Z",
          trialing: false,
          billed: true,
        },
        NOW,
      ),
    ).toBe("You're on Starter. It renews on 15 October 2026.");
  });

  it("says when a cancelled plan stops", () => {
    expect(
      planLine(
        {
          tier: "agency",
          status: "cancelled",
          currentPeriodEnd: "2026-10-15T00:00:00.000Z",
          trialing: false,
          billed: true,
        },
        NOW,
      ),
    ).toBe("You're on Agency until 15 October 2026, then it stops.");
  });

  it("says a lapsed plan has ended and what the customer is on now", () => {
    expect(
      planLine(
        {
          tier: "scout",
          status: "cancelled",
          currentPeriodEnd: "2026-09-15T00:00:00.000Z",
          trialing: false,
          billed: true,
        },
        NOW,
      ),
    ).toBe("Your paid plan ended on 15 September 2026. You're on Scout.");
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

describe("planLine when a payment did not go through", () => {
  const base = {
    tier: "starter",
    status: "on_hold",
    currentPeriodEnd: "2026-10-20T00:00:00.000Z",
    trialing: false,
    billed: true,
  } as const;

  it("says the plan is paused and what to do, instead of promising a renewal", () => {
    expect(planLine(base, new Date("2026-10-13T00:00:00.000Z"))).toBe(
      "Your last payment for Starter didn't go through, so it's paused and you're on Scout. Update your card to switch it back on.",
    );
  });

  it("says a failed first payment left the customer on Scout", () => {
    expect(planLine({ ...base, status: "failed" }, new Date("2026-10-13T00:00:00.000Z"))).toBe(
      "Your payment for Starter didn't go through, so you're on Scout.",
    );
  });

  it("does not say a Scout plan drops to Scout", () => {
    expect(planLine({ ...base, tier: "scout" }, new Date("2026-10-13T00:00:00.000Z"))).toBe(
      "Your last payment for Scout didn't go through, so it's paused. Update your card to switch it back on.",
    );
    expect(planLine({ ...base, tier: "scout", status: "failed" }, new Date("2026-10-13T00:00:00.000Z"))).toBe(
      "Your payment for Scout didn't go through.",
    );
  });

  it("shows the on-hold line even when the plan was a trial", () => {
    expect(planLine({ ...base, trialing: true }, new Date("2026-10-13T00:00:00.000Z"))).toContain("paused");
  });
});
