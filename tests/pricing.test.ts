import { describe, expect, it } from "vitest";

import { dodoAnnualUnavailableCopy } from "~/lib/dodo-pricing-display";
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

  it("keeps visible fallback pricing neutral until live prices return", () => {
    const [scout, starter, agency] = pricingPlans();

    expect(scout.monthlyLabel).toBe("Monthly price loading");
    expect(scout.yearlyLabel).toBe("Annual price loading");
    expect(starter.monthlyLabel).toBe("Monthly price loading");
    expect(starter.yearlyLabel).toBe("Annual price loading");
    expect(agency.monthlyLabel).toBe("Monthly price loading");
    expect(agency.yearlyLabel).toBe("Annual price loading");
  });

  it("keeps plan caps generous but finite", () => {
    const [scout, starter, agency] = pricingPlans();

    expect(scout.features).toContain("3 active watchlists");
    expect(scout.features).toContain("Weekly evidence-backed digest");
    expect(scout.features).toContain("Email digest delivery");
    expect(scout.features).not.toContain("Slack");
    expect(scout.features).toContain("50 proof captures per month");
    expect(starter.features).toContain("10 active watchlists");
    expect(starter.features).toContain("Email delivery");
    expect(starter.features).not.toContain("Slack");
    expect(starter.features).toContain("250 proof captures per month");
    expect(agency.features).toContain("75 active watchlists");
    expect(agency.features).not.toContain("Slack");
    expect(agency.features).toContain("2,500 proof captures per month");
    expect(agency.features).toContain("Priority nightly monitoring coverage");
    expect(agency.features).toContain("Read-only API + MCP exports; owner-approved workflow actions");
    expect(agency.features.filter((feature) => feature === "Daily and weekly evidence-backed digests")).toHaveLength(1);
    expect(agency.features.join("\n")).not.toContain("nightly queue");
  });

  it("offers paid proof-capture bundles for temporary spikes", () => {
    expect(usageBundles()).toEqual([
      expect.objectContaining({
        slug: "proof_500",
        priceLabel: "Pack price loading",
        creditLabel: "500 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_2000",
        priceLabel: "Pack price loading",
        creditLabel: "2,000 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_7500",
        priceLabel: "Pack price loading",
        creditLabel: "7,500 extra proof captures",
      }),
    ]);
  });

  it("does not branch copy by India versus rest of world anymore", () => {
    expect(pricingPlansForRegion()).toEqual(pricingPlans());
  });

  it("keeps annual-unavailable fallback copy readable without validation details", () => {
    expect(dodoAnnualUnavailableCopy(null)).toBe(
      "Annual checkout is unavailable while pricing syncs. Monthly checkout still works.",
    );
    expect(dodoAnnualUnavailableCopy(null)).not.toContain("Annual annual");
  });
});
