import { describe, expect, it } from "vitest";

import { dodoAnnualUnavailableCopy } from "~/lib/dodo-pricing-display";
import {
  EVIDENCE_USAGE_CUSTOMER_COPY,
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

    expect(scout.monthlyLabel).toBe("Localized at checkout");
    expect(scout.yearlyLabel).toBe("Billed annually — 4 months free");
    expect(starter.monthlyLabel).toBe("Localized at checkout");
    expect(starter.yearlyLabel).toBe("Billed annually — 4 months free");
    expect(agency.monthlyLabel).toBe("Localized at checkout");
    expect(agency.yearlyLabel).toBe("Billed annually — 4 months free");
    for (const plan of [scout, starter, agency]) {
      expect(plan.monthlyLabel.toLowerCase()).not.toContain("price loading");
      expect(plan.yearlyLabel.toLowerCase()).not.toContain("price loading");
    }
  });

  it("keeps plan caps generous but finite", () => {
    const [scout, starter, agency] = pricingPlans();

    expect(scout.features).toContain("3 active watchlists");
    expect(scout.features).toContain("10 Collections");
    expect(scout.features).toContain("6-hour scans");
    expect(scout.detail).toContain("6-hour competitor monitoring");
    expect(scout.features).toContain("Weekly Brief");
    expect(scout.features).not.toContain("Slack");
    expect(scout.features).toContain("50 proof captures/month");
    expect(starter.features).toContain("10 active watchlists");
    expect(starter.features).toContain("25 Collections");
    expect(starter.features).toContain("3-hour scans");
    expect(starter.detail).toContain("3-hour competitor monitoring");
    expect(starter.features).toContain("Daily + weekly Briefs");
    expect(starter.features).toContain("Email Notifications");
    expect(starter.features).toContain("Exports");
    expect(starter.features).not.toContain("Slack");
    expect(starter.features).toContain("250 proof captures/month");
    expect(agency.features).toContain("75 active watchlists");
    expect(agency.features).toContain("250 Collections");
    expect(agency.features).toContain(
      "Top 25 competitors every 3 hours; rest every 6 hours",
    );
    expect(agency.detail).toContain(
      "75 competitors — top 25 checked every 3 hours, the rest every 6 hours",
    );
    expect(agency.features).not.toContain("Slack");
    expect(agency.features).toContain("2,500 proof captures/month");
    expect(agency.features).toContain("Team workspace");
    expect(agency.features).toContain("API + MCP access");
    expect(agency.features).toContain("Client reports");
    expect(agency.features).toContain("Shared report branding");
    expect(agency.features.filter((feature) => feature === "Daily + weekly Briefs")).toHaveLength(1);
    expect(agency.features.join("\n")).not.toContain("workspace-approved");
    expect(agency.features.join("\n")).not.toContain("nightly queue");
  });

  it("offers paid proof capture packs for temporary spikes", () => {
    expect(usageBundles()).toEqual([
      expect.objectContaining({
        slug: "proof_500",
        priceLabel: "Localized at checkout",
        creditLabel: "500 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_2000",
        priceLabel: "Localized at checkout",
        creditLabel: "2,000 extra proof captures",
      }),
      expect.objectContaining({
        slug: "proof_7500",
        priceLabel: "Localized at checkout",
        creditLabel: "7,500 extra proof captures",
      }),
    ]);
  });

  it("states the customer-facing proof capture accounting contract", () => {
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).toContain("Scheduled scans are included with your plan");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).toContain("proof-backed capture");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).toContain("Included captures reset every month");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).toContain("Purchased capture packs never expire");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).not.toContain("saved change records");
    expect(EVIDENCE_USAGE_CUSTOMER_COPY).not.toContain("record packs");
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
