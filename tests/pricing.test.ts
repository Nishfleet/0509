import { describe, expect, it } from "vitest";

import {
  pricingPlans,
  pricingPlansForRegion,
  usageBundles,
} from "~/lib/pricing";

describe("pricingPlans", () => {
  it("uses one Dodo-backed pricing table for every visitor", () => {
    const plans = pricingPlans();

    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.slug)).toEqual(["scout", "starter", "agency"]);
  });

  it("keeps visible fallback pricing neutral until Dodo returns local checkout preview", () => {
    const [scout, starter, agency] = pricingPlans();

    expect(scout.monthlyLabel).toBe("Loading local monthly price");
    expect(scout.yearlyLabel).toBe("Loading local annual price");
    expect(starter.monthlyLabel).toBe("Loading local monthly price");
    expect(starter.yearlyLabel).toBe("Loading local annual price");
    expect(agency.monthlyLabel).toBe("Loading local monthly price");
    expect(agency.yearlyLabel).toBe("Loading local annual price");
  });

  it("keeps plan caps generous but finite", () => {
    const [scout, starter, agency] = pricingPlans();

    expect(scout.features).toContain("3 active watchlists");
    expect(scout.features).toContain("50 proof captures per month");
    expect(starter.features).toContain("10 active watchlists");
    expect(starter.features).toContain("250 proof captures per month");
    expect(agency.features).toContain("75 active watchlists");
    expect(agency.features).toContain("2,500 proof captures per month");
  });

  it("offers paid proof-capture bundles for temporary spikes", () => {
    expect(usageBundles()).toEqual([
      expect.objectContaining({
        slug: "proof_500",
        priceLabel: "Loading local pack price",
        creditLabel: "500 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_2000",
        priceLabel: "Loading local pack price",
        creditLabel: "2,000 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_7500",
        priceLabel: "Loading local pack price",
        creditLabel: "7,500 extra proof captures",
      }),
    ]);
  });

  it("does not branch copy by India versus rest of world anymore", () => {
    expect(pricingPlansForRegion()).toEqual(pricingPlans());
  });
});
