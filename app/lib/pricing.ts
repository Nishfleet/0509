import type { PricingPlan, UsageBundle } from "~/lib/types";

export type PricingPlanSlug = PricingPlan["slug"];
export type UsageBundleSlug = UsageBundle["slug"];
export type PricingBillingCycle = "monthly" | "yearly";

const PLANS: PricingPlan[] = [
  {
    slug: "scout",
    name: "Scout",
    monthlyLabel: "Loading local monthly price",
    yearlyLabel: "Loading local annual price",
    detail: "A paid research seat for focused ad discovery without concierge support.",
    features: [
      "3 active watchlists",
      "10 saved collections",
      "Search-led competitor research",
      "50 proof captures per month",
      "Meta source beta, no concierge support",
    ],
  },
  {
    slug: "starter",
    name: "Starter",
    monthlyLabel: "Loading local monthly price",
    yearlyLabel: "Loading local annual price",
    detail: "A generous starter layer for teams proving the habit before they scale monitoring.",
    features: [
      "10 active watchlists",
      "25 saved collections",
      "Weekly source-backed digest",
      "250 proof captures per month",
      "Meta source beta, limited reliability gate",
    ],
  },
  {
    slug: "agency",
    name: "Agency",
    monthlyLabel: "Loading local monthly price",
    yearlyLabel: "Loading local annual price",
    detail: "The serious monitoring plan for teams that need client-ready market intelligence.",
    features: [
      "75 active watchlists",
      "250 saved collections",
      "Daily and weekly source-backed briefs",
      "2,500 proof captures per month",
      "Priority Meta source beta setup",
    ],
  },
];

const USAGE_BUNDLES: UsageBundle[] = [
  {
    slug: "proof_500",
    name: "Burst Pack",
    priceLabel: "Loading local pack price",
    creditLabel: "500 extra proof captures",
    detail: "For campaign spikes that should not force a plan jump.",
  },
  {
    slug: "proof_2000",
    name: "Campaign Pack",
    priceLabel: "Loading local pack price",
    creditLabel: "2,000 extra proof captures",
    detail: "The sensible overflow pack for active launches and sale weeks.",
  },
  {
    slug: "proof_7500",
    name: "Scale Pack",
    priceLabel: "Loading local pack price",
    creditLabel: "7,500 extra proof captures",
    detail: "Bulk proof capacity for agencies tracking heavy categories.",
  },
];

export function pricingPlans(): PricingPlan[] {
  return PLANS.map((plan) => ({ ...plan, features: [...plan.features] }));
}

export function pricingPlansForRegion(): PricingPlan[] {
  return pricingPlans();
}

export function usageBundles(): UsageBundle[] {
  return USAGE_BUNDLES.map((bundle) => ({ ...bundle }));
}
