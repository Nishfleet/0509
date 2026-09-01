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

/**
 * Published plan prices, USD anchor. These are the real list prices the
 * product sells at; the Dodo checkout preview may show a localized amount in
 * the buyer's currency, which always overrides these on the marketing page.
 * Annual is exactly 8x monthly (4 months free) — the same ratio Dodo's
 * annual validation enforces per plan.
 */
export const PUBLISHED_PLAN_PRICES_USD: Record<
  PricingPlanSlug,
  { monthly: number; yearly: number }
> = {
  scout: { monthly: 11, yearly: 88 },
  starter: { monthly: 59, yearly: 472 },
  agency: { monthly: 199, yearly: 1592 },
};

/** Published check-pack prices, USD anchor (localized preview overrides). */
export const PUBLISHED_BUNDLE_PRICES_USD: Record<UsageBundleSlug, number> = {
  proof_500: 59,
  proof_2000: 179,
  proof_7500: 599,
};

/**
 * Published stable EUR list prices for the schema.org Offer JSON-LD on
 * /pricing (#1503). The buyer's localized amount shown at Dodo checkout can
 * drift by locale, SKU, and tax-inclusion settings — search-result surfaces
 * need a single declared number per tier and pack, so we anchor the EUR
 * list values once and ship them as-is. The EUR/USD ratio is whatever
 * Dodo's adaptive localization happens to return at the time of the
 * observed snapshot (Free=0, Scout €10, Starter €46, Agency €136; Burst
 * €28, Campaign €91, Scale €227); it is not a manually-set FX rate, and the
 *   canonical published list is what ships in structured data here even when
 *   the live Dodo preview eventually drifts off by a unit. The visible
 *   pricing card still loads the live EUR preview at render time, so the
 *   UI stays accurate; this table just keeps the JSON-LD stable.
 *
 *   Annual = 8 × monthly (the "4 months free" offer), rounded to whole euros
 *   so the published list reads cleanly and never pretends Dodo delivers
 *   sub-euro precision in the structured data.
 */
export const PUBLISHED_PLAN_PRICES_EUR: Record<
  PricingPlanSlug,
  { monthly: number; yearly: number }
> = {
  scout: { monthly: 10, yearly: 80 },
  starter: { monthly: 46, yearly: 368 },
  agency: { monthly: 136, yearly: 1088 },
};

/** Published stable EUR list prices for proof-capture packs (#1503). */
export const PUBLISHED_BUNDLE_PRICES_EUR: Record<UsageBundleSlug, number> = {
  proof_500: 28,
  proof_2000: 91,
  proof_7500: 227,
};

/**
 * Published declaration of the Free tier for the schema.org Offer JSON-LD
 * (#1503). PUBLISHED_PLAN_PRICES_USD has no Free entry because the visible
 * pricing page lists USD anchors only for paid plans — Free is described
 * in prose ("watch 1 competitor — instant first scan, a weekly
 * proof-backed brief, and 1 Collection"). Search results still want an
 * Offer for the Free tier so Google can render it as a $0 row alongside
 * the paid cards, so we declare it here as a single €0 offer. Free never
 * appears in Dodo's pricing-preview table and never carries a billing
 *   cycle, so the surface stays minimal: a name, a description, and a
 *   0-priced Offer.
 */
export interface PublishedFreePlanOffer {
  name: string;
  description: string;
  offerPriceEUR: 0;
}

export const PUBLISHED_FREE_PLAN_OFFER: PublishedFreePlanOffer = {
  name: "Free",
  description:
    "Free Five to Nine plan: watch 1 competitor with instant first scan, a weekly proof-backed brief, and 1 Collection. No card required.",
  offerPriceEUR: 0,
};

/** Published label for a plan price, e.g. "$11 USD/mo". */
export function publishedPlanPriceLabel(
  slug: PricingPlanSlug,
  cycle: PricingBillingCycle,
): string {
  return `$${PUBLISHED_PLAN_PRICES_USD[slug][cycle]} USD${cycle === "monthly" ? "/mo" : "/year"}`;
}

function planMarketingFeatures(plan: PlanFamily): string[] {
  const entitlements = getPlanEntitlements(plan);
  const features: string[] = [];

  if (plan === "scout") {
    features.push("Proof brief before signup");
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
    features.push("Landing-page change history as scheduled watches complete");
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
    monthlyLabel: publishedPlanPriceLabel(slug, "monthly"),
    yearlyLabel: publishedPlanPriceLabel(slug, "yearly"),
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
    priceLabel: `$${PUBLISHED_BUNDLE_PRICES_USD.proof_500} USD`,
    creditLabel: TOP_UP_PACK_DISPLAY.burst_500_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.burst_500_v1.detail,
    creditQuantity: 500,
  },
  {
    slug: "proof_2000",
    sku: "campaign_2000_v1",
    name: TOP_UP_PACK_DISPLAY.campaign_2000_v1.name,
    priceLabel: `$${PUBLISHED_BUNDLE_PRICES_USD.proof_2000} USD`,
    creditLabel: TOP_UP_PACK_DISPLAY.campaign_2000_v1.creditLabel,
    detail: TOP_UP_PACK_DISPLAY.campaign_2000_v1.detail,
    creditQuantity: 2000,
  },
  {
    slug: "proof_7500",
    sku: "scale_7500_v1",
    name: TOP_UP_PACK_DISPLAY.scale_7500_v1.name,
    priceLabel: `$${PUBLISHED_BUNDLE_PRICES_USD.proof_7500} USD`,
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
  "Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with page text, the original link, and a screenshot when the capture includes one. Included caps are generous and reset monthly; purchased proof captures never expire and carry over until you use them.";

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
