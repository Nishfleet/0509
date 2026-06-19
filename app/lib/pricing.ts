import type { PricingPlan, UsageBundle } from "~/lib/types";

export type PricingPlanSlug = PricingPlan["slug"];
export type UsageBundleSlug = UsageBundle["slug"];
export type PricingBillingCycle = "monthly" | "yearly";

const PLANS: PricingPlan[] = [
  {
    slug: "scout",
    name: "Scout",
    monthlyLabel: "Monthly price loading",
    yearlyLabel: "Annual price loading",
    detail: "For founders and sellers who want proof first, then a focused competitor set.",
    features: [
      "Sample proof review before signup",
      "3 active watchlists",
      "Weekly competitor scan (every Monday) + on-demand fresh checks",
      "10 saved boards",
      "Account-gated competitor research",
      "Weekly evidence-backed digest",
      "50 evidence checks per month",
      "Email-ready proof trail",
    ],
  },
  {
    slug: "starter",
    name: "Starter",
    monthlyLabel: "Monthly price loading",
    yearlyLabel: "Annual price loading",
    detail: "For teams that need a weekly rhythm of competitor evidence.",
    features: [
      "10 active watchlists",
      "Daily competitor scans + on-demand fresh checks",
      "25 saved boards",
      "Daily and weekly evidence-backed digests",
      "High-priority change alerts",
      "250 evidence checks per month",
      "Landing-page evidence for material changes",
      "Email + Slack delivery",
      "Reads ad text in 30+ languages and scripts — auto-translated into English",
      "CSV, JSON, and Slack-ready exports",
    ],
  },
  {
    slug: "agency",
    name: "Agency",
    monthlyLabel: "Monthly price loading",
    yearlyLabel: "Annual price loading",
    detail: "For agencies and growth teams watching crowded categories.",
    features: [
      "75 active watchlists",
      "Daily competitor scans, first in the nightly queue",
      "250 saved boards",
      "Daily and weekly evidence-backed briefs",
      "High-priority change alerts",
      "2,500 evidence checks per month",
      "Client-ready proof reports (share link + PDF print)",
      "Your agency name on shared reports",
      "API + MCP exports and audited workspace actions",
      "Email + Slack delivery",
      "3 team seats — teammates share watchlists, boards, and briefs",
    ],
  },
];

const USAGE_BUNDLES: UsageBundle[] = [
  {
    slug: "proof_500",
    name: "Burst Pack",
    priceLabel: "Pack price loading",
    creditLabel: "500 extra evidence checks",
    detail: "For campaign spikes that should not force a plan jump.",
  },
  {
    slug: "proof_2000",
    name: "Campaign Pack",
    priceLabel: "Pack price loading",
    creditLabel: "2,000 extra evidence checks",
    detail: "The sensible overflow pack for active launches and sale weeks.",
  },
  {
    slug: "proof_7500",
    name: "Scale Pack",
    priceLabel: "Pack price loading",
    creditLabel: "7,500 extra evidence checks",
    detail: "Bulk evidence-check capacity for agencies tracking heavy categories.",
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
