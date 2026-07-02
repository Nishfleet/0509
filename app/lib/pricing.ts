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
    features.push("Sample competitor brief before signup");
  }

  features.push(`${entitlements.watchlists} active watchlists`);

  if (entitlements.scheduledScanCadence === "weekly_monday") {
    features.push("Weekly competitor review (every Monday) + on-demand fresh evidence");
  } else if (entitlements.scheduledScanCadence === "daily") {
    features.push("Daily competitor reviews + on-demand fresh evidence");
    if (plan === "agency") {
      features.push("Priority nightly review coverage");
    }
  }

  features.push(`${entitlements.collections} saved collections`);

  if (entitlements.digestCadence === "weekly") {
    features.push("Weekly change brief with screenshots and links");
  } else if (entitlements.digestCadence === "daily_and_weekly") {
    features.push("Daily and weekly change briefs with screenshots and links");
  }

  if (plan !== "scout") {
    features.push("High-priority change alerts");
  }

  features.push(
    `${entitlements.includedEvidenceChecksPerMonth.toLocaleString("en-US")} saved change records per month`,
  );

  if (plan === "scout") {
    features.push("Saved competitor research", "Email digest delivery");
  }
  if (plan === "starter" || plan === "agency") {
    features.push("Landing-page change history with screenshots");
    features.push("Email delivery");
    features.push(
      "Reads ad text in 30+ languages and scripts — auto-translated into English",
    );
    features.push("CSV and JSON exports");
  }
  if (plan === "agency") {
    features.push("Client-ready change reports (share link + PDF print)");
    features.push("Your agency name on shared reports");
    features.push("Developer exports and workspace-approved workflow actions");
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
        ? "Focused competitor monitoring for a small watchlist."
        : slug === "starter"
          ? "Daily competitor monitoring for one brand's core market."
          : "Client-ready competitor reports for agencies and crowded categories.",
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
  "Scheduled monitoring is included with your plan. Saved change records are used when Five to Nine stores a landing-page record with screenshots, page text, and the original link. Included records refresh every month and do not roll over. Purchased record packs never expire.";

export const TOP_UP_INACTIVE_PLAN_COPY =
  "Your purchased record packs are saved and will be available when a paid plan is active.";

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
