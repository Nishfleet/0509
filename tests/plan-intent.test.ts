import { describe, expect, it } from "vitest";

import { inPickedOrder, planName } from "../app/lib/plan-order";
import { planStartHref } from "../app/lib/pricing-page";

describe("the plan chosen on the pricing page", () => {
  it("is carried on each plan's start link, with the source when there is one", () => {
    expect(planStartHref("starter", null)).toBe("/login?plan=starter");
    expect(planStartHref("agency", "llms")).toBe("/login?plan=agency&utm_source=llms");
  });

  it("comes first on the plan step and leaves the rest in order", () => {
    expect(inPickedOrder("agency").map((plan) => plan.id)).toEqual(["agency", "scout", "starter"]);
    expect(inPickedOrder("scout").map((plan) => plan.id)).toEqual(["scout", "starter", "agency"]);
  });

  it("changes nothing when no plan was picked", () => {
    expect(inPickedOrder(null).map((plan) => plan.id)).toEqual(["scout", "starter", "agency"]);
  });

  it("names a plan the way the price page does", () => {
    expect(planName("starter")).toBe("Starter");
  });
});
