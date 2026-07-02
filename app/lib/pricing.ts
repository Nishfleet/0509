import type { PricingPlan, UsageBundle } from "~/lib/types";
import {
  getPlanEntitlements,
  PLAN_FAMILIES,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { TOP_UP_PACK_DISPLAY } from "~/lib/billing-sku-catalog";

export type PricingPlanSlug = PricingPlan["slug"];
export type UsageBundleSlug = UsageBundle["slug"];
export type PricingBillingCycle = "monthly" | "yearly";

function planMarketingFeatures(plan: PlanFamily): string[] {
  const entitlements = getPlanEntitlements(plan);
  const features: string[] = [];

  if (plan === "scout") {
    features.push("Sample proof review before signup");
  }

  features.push(`${entitlements.watchlists} active watchlists`);

  if (entitlements.scheduledScanCadence === "weekly_monday") {
    features.push("Weekly competitor scan (every Monday) + on-demand fresh proof");
  } else if (entitlements.scheduledScanCadence === "daily") {
    features.push("Daily competitor scans + on-demand fresh proof");
    if (plan === "agency") {
      features.push("Priority nightly monitoring coverage");
    }
  }

  features.push(`${entitlements.collections} saved collections`);

  if (entitlements.digestCadence === "weekly") {
    features.push("Weekly evidence-backed digest");
  } else if (entitlements.digestCadence === "daily_and_weekly") {
    features.push("Daily and weekly evidence-backed digests");
  }

  if (plan !== "scout") {
    features.push("High-priority change alerts");
  }

  features.push(
    `${entitlements.includedEvidenceChecksPerMonth.toLocaleString("en-US")} proof captures per month`,
  );

  if (plan === "scout") {
    features.push("Account-gated competitor research", "Email digest delivery");
  }
  if (plan === "starter" || plan === "agency") {
    features.push("Landing-page evidence for material changes");
    features.push("Email delivery");
    features.push(
      "Reads ad text in 30+ languages and scripts — auto-translated into English",
    );
    features.push("CSV and JSON exports");
  }
  if (plan === "agency") {
    features.push("Client-ready proof reports (share link + PDF print)");
    features.push("Your agency name on shared reports");
    features.push("Read-only API + MCP exports; owner-approved workflow actions");
    features.push(
      `${entitlements.workspaceSeats} team seats — teammates share watchlists, collections, and digests`,
    );
  }

  return features;
}

const PLANS: PricingPlan[] = PLAN_FAMILIES.filter((plan) => plan !== "free").map((slug) => {
  const entitlements = getPlanEntitlements(slug);
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    monthlyLabel: "Monthly price loading",
    yearlyLabel: "Annual price loading",
    detail:
      slug === "scout"
        ? "Proof-backed monitoring for a focused competitor set."
        : slug === "starter"
          ? "Daily proof-backed competitor monitoring for one brand's core competitor set."
          : "Client-ready competitor proof for agencies and crowded categories.",
    features: planMarketingFeatures(slug),
    monthlySku: `${slug}_monthly_v1`,
    yearlySku: `${slug}_annual_v1`,
    watchlistLimit: entitlements.watchlists,
    boardLimit: entitlements.collections,
    evidenceChecksPerMonth: entitlements.includedEvidenceChecksPerMonth,
  };
});

const USAGE_BUNDLES: UsageBundle[] = [
  {
    slug: "proof_500",
    sku: "burst_500_v1",
    name: TOP_UP_PACK_DISPLAY.burst_500_v1.name,
    priceLabel: "Pack price loading",
    creditLabel: TOP_UP_PACK_DISPLAY.burst_500_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.burst_500_v1.detail,
    creditQuantity: 500,
  },
  {
    slug: "proof_2000",
    sku: "campaign_2000_v1",
    name: TOP_UP_PACK_DISPLAY.campaign_2000_v1.name,
    priceLabel: "Pack price loading",
    creditLabel: TOP_UP_PACK_DISPLAY.campaign_2000_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.campaign_2000_v1.detail,
    creditQuantity: 2000,
  },
  {
    slug: "proof_7500",
    sku: "scale_7500_v1",
    name: TOP_UP_PACK_DISPLAY.scale_7500_v1.name,
    priceLabel: "Pack price loading",
    creditLabel: TOP_UP_PACK_DISPLAY.scale_7500_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.scale_7500_v1.detail,
    creditQuantity: 7500,
  },
];

export const EVIDENCE_USAGE_CUSTOMER_COPY =
  "Scheduled monitoring is included with your plan. Proof captures are used when Five to Nine saves a new landing-page proof capture. Included proof captures refresh every month and do not roll over. Purchased proof packs never expire.";

export const TOP_UP_INACTIVE_PLAN_COPY =
  "Your purchased proof packs are saved and will be available when a paid plan is active.";

export function pricingPlans(): PricingPlan[] {
  return PLANS.map((plan) => ({ ...plan, features: [...plan.features] }));
}

export function pricingPlansForRegion(): PricingPlan[] {
  return pricingPlans();
}

export function usageBundles(): UsageBundle[] {
  return USAGE_BUNDLES.map((bundle) => ({ ...bundle }));
}

export function billingSkuForPlan(plan: PricingPlanSlug, cycle: PricingBillingCycle): string {
  return cycle === "yearly" ? `${plan}_annual_v1` : `${plan}_monthly_v1`;
}
