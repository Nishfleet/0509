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
  features.push(`${entitlements.collections} Collections`);

  if (entitlements.scheduledScanCadence === "every_6h") {
    features.push("6-hour scans");
  } else if (entitlements.scheduledScanCadence === "every_3h") {
    // FIX-8 / WP-37: Agency priority slots — only first 25 run every 3h.
    if (plan === "agency" && entitlements.priorityScanSlots != null) {
      features.push(
        `Top ${entitlements.priorityScanSlots} competitors every 3 hours; rest every 6 hours`,
      );
    } else {
      features.push("3-hour scans");
    }
  }

  if (entitlements.digestCadence === "weekly") {
    features.push("Weekly Brief");
  } else if (entitlements.digestCadence === "daily_and_weekly") {
    features.push("Daily + weekly Briefs");
  }

  features.push(
    `${entitlements.includedEvidenceChecksPerMonth.toLocaleString("en-US")} proof captures/month`,
  );

  if (plan === "scout") {
    features.push("Saved competitor research", "Email brief delivery");
  }
  if (plan === "starter" || plan === "agency") {
    features.push("Email Notifications");
    features.push("Exports");
    features.push("Landing-page change history with screenshots");
  }
  if (plan === "agency") {
    features.push("Team workspace");
    features.push("API + MCP access");
    features.push("Client reports");
    features.push("Shared report branding");
  }

  return features;
}

const PLANS: PricingPlan[] = PLAN_FAMILIES.filter((plan) => plan !== "free").map((slug) => {
  const entitlements = getPlanEntitlements(slug);
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    monthlyLabel: "Localized at checkout",
    yearlyLabel: "Billed annually — 4 months free",
    detail:
      slug === "scout"
        ? "6-hour competitor monitoring for a small watchlist."
        : slug === "starter"
          ? "3-hour competitor monitoring for one brand's core market."
          : "75 competitors — top 25 checked every 3 hours, the rest every 6 hours, with client-ready reports.",
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
    priceLabel: "Localized at checkout",
    creditLabel: TOP_UP_PACK_DISPLAY.burst_500_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.burst_500_v1.detail,
    creditQuantity: 500,
  },
  {
    slug: "proof_2000",
    sku: "campaign_2000_v1",
    name: TOP_UP_PACK_DISPLAY.campaign_2000_v1.name,
    priceLabel: "Localized at checkout",
    creditLabel: TOP_UP_PACK_DISPLAY.campaign_2000_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.campaign_2000_v1.detail,
    creditQuantity: 2000,
  },
  {
    slug: "proof_7500",
    sku: "scale_7500_v1",
    name: TOP_UP_PACK_DISPLAY.scale_7500_v1.name,
    priceLabel: "Localized at checkout",
    creditLabel: TOP_UP_PACK_DISPLAY.scale_7500_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.scale_7500_v1.detail,
    creditQuantity: 7500,
  },
];

/**
 * Free weekly digest footer upgrade line. Facts are read from the Scout
 * entitlements so this can never drift from the catalog; pricing stays with
 * the /pricing page (Dodo localizes currency at checkout — never hardcode a
 * monetary amount here).
 */
export function freeWeeklyDigestUpgradeNote(): string {
  const scout = getPlanEntitlements("scout");
  const cadenceLabel =
    scout.scheduledScanCadence === "every_3h"
      ? "checks every 3 hours"
      : scout.scheduledScanCadence === "every_6h"
        ? "checks every 6 hours"
        : "checks weekly";
  return `Your free watch includes an instant first scan, one proof-backed brief, and one saved Collection. Scout ${cadenceLabel} and unlocks ${scout.collections} Collections across ${scout.watchlists} competitors.`;
}

export const EVIDENCE_USAGE_CUSTOMER_COPY =
  "Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with screenshots, page text, and the original link. Included caps are generous and reset monthly; purchased proof captures never expire and carry over until you use them.";

export const TOP_UP_INACTIVE_PLAN_COPY =
  "Your purchased proof captures are saved and will be available when a paid plan is active.";

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
