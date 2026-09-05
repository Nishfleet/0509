/**
 * Versioned billing SKU registry — commercial identity without monetary amounts.
 */

import type { AppEnv } from "~/lib/env.server";
import type { PlanFamily } from "~/lib/plan-entitlements";

export const BILLING_SKU_SLUGS = [
  "scout_monthly_v1",
  "scout_annual_v1",
  "starter_monthly_v1",
  "starter_annual_v1",
  "agency_monthly_v1",
  "agency_annual_v1",
  "burst_500_v1",
  "campaign_2000_v1",
  "scale_7500_v1",
  // Grandfathered aliases for webhook replay / legacy checkout fields
  "proof_500_legacy",
  "proof_2000_legacy",
  "proof_7500_legacy",
] as const;

export type BillingSkuSlug = (typeof BILLING_SKU_SLUGS)[number];

export type BillingPurchaseType = "subscription" | "one_time";
export type BillingInterval = "monthly" | "annual" | "none";

export interface BillingSkuDefinition {
  slug: BillingSkuSlug;
  planFamily: PlanFamily | null;
  purchaseType: BillingPurchaseType;
  billingInterval: BillingInterval;
  entitlementVersion: 1;
  topUpQuantity: number | null;
  providerProductEnvKey: string | null;
  activeForCheckout: boolean;
  grandfathered: boolean;
  catalogVersion: string;
}

const SKU_CATALOG: Record<BillingSkuSlug, BillingSkuDefinition> = {
  scout_monthly_v1: {
    slug: "scout_monthly_v1",
    planFamily: "scout",
    purchaseType: "subscription",
    billingInterval: "monthly",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_SCOUT_MONTHLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  scout_annual_v1: {
    slug: "scout_annual_v1",
    planFamily: "scout",
    purchaseType: "subscription",
    billingInterval: "annual",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_SCOUT_YEARLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  starter_monthly_v1: {
    slug: "starter_monthly_v1",
    planFamily: "starter",
    purchaseType: "subscription",
    billingInterval: "monthly",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_STARTER_MONTHLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  starter_annual_v1: {
    slug: "starter_annual_v1",
    planFamily: "starter",
    purchaseType: "subscription",
    billingInterval: "annual",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_STARTER_YEARLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  agency_monthly_v1: {
    slug: "agency_monthly_v1",
    planFamily: "agency",
    purchaseType: "subscription",
    billingInterval: "monthly",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_AGENCY_MONTHLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  agency_annual_v1: {
    slug: "agency_annual_v1",
    planFamily: "agency",
    purchaseType: "subscription",
    billingInterval: "annual",
    entitlementVersion: 1,
    topUpQuantity: null,
    providerProductEnvKey: "DODO_0509_PRODUCT_AGENCY_YEARLY_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  burst_500_v1: {
    slug: "burst_500_v1",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 500,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_500_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  campaign_2000_v1: {
    slug: "campaign_2000_v1",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 2000,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_2000_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  scale_7500_v1: {
    slug: "scale_7500_v1",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 7500,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_7500_ID",
    activeForCheckout: true,
    grandfathered: false,
    catalogVersion: "v1",
  },
  proof_500_legacy: {
    slug: "proof_500_legacy",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 500,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_500_ID",
    activeForCheckout: false,
    grandfathered: true,
    catalogVersion: "v1",
  },
  proof_2000_legacy: {
    slug: "proof_2000_legacy",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 2000,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_2000_ID",
    activeForCheckout: false,
    grandfathered: true,
    catalogVersion: "v1",
  },
  proof_7500_legacy: {
    slug: "proof_7500_legacy",
    planFamily: null,
    purchaseType: "one_time",
    billingInterval: "none",
    entitlementVersion: 1,
    topUpQuantity: 7500,
    providerProductEnvKey: "DODO_0509_PRODUCT_PROOF_PACK_7500_ID",
    activeForCheckout: false,
    grandfathered: true,
    catalogVersion: "v1",
  },
};

/** Legacy pricing.ts bundle slugs → canonical SKU */
const LEGACY_BUNDLE_TO_SKU: Record<string, BillingSkuSlug> = {
  proof_500: "burst_500_v1",
  proof_2000: "campaign_2000_v1",
  proof_7500: "scale_7500_v1",
};

/** Legacy plan+cycle checkout → canonical SKU */
export function billingSkuForPlanCheckout(plan: string, cycle: string): BillingSkuSlug | null {
  if (cycle === "yearly") cycle = "annual";
  const slug = `${plan}_${cycle}_v1`;
  return slug in SKU_CATALOG ? (slug as BillingSkuSlug) : null;
}

export function resolveBillingSku(slug: string): BillingSkuDefinition | null {
  const normalized = slug.trim() as BillingSkuSlug;
  return SKU_CATALOG[normalized] ?? null;
}

export function resolveBillingSkuFromLegacyBundle(bundleSlug: string): BillingSkuDefinition | null {
  const mapped = LEGACY_BUNDLE_TO_SKU[bundleSlug];
  return mapped ? SKU_CATALOG[mapped] : null;
}

export function readProviderProductId(env: AppEnv, sku: BillingSkuDefinition): string {
  const key = sku.providerProductEnvKey;
  if (!key) return "";
  const value = env[key as keyof AppEnv];
  return typeof value === "string" ? value.trim() : "";
}

export function resolveBillingSkuFromProviderProductId(
  env: AppEnv,
  productId: string,
): BillingSkuDefinition | null {
  const normalized = productId.trim();
  if (!normalized) return null;

  for (const sku of Object.values(SKU_CATALOG)) {
    if (!sku.providerProductEnvKey) continue;
    if (readProviderProductId(env, sku) === normalized) {
      return sku;
    }
  }
  return null;
}

export function listCheckoutSkus(): BillingSkuDefinition[] {
  return Object.values(SKU_CATALOG).filter((sku) => sku.activeForCheckout);
}

export function listSkusMissingProviderConfiguration(env: AppEnv): BillingSkuSlug[] {
  return listCheckoutSkus()
    .filter((sku) => !readProviderProductId(env, sku))
    .map((sku) => sku.slug);
}

export function topUpQuantityForSku(sku: BillingSkuDefinition): number {
  if (sku.topUpQuantity === null || sku.topUpQuantity <= 0) {
    throw new Error(`SKU ${sku.slug} is not a top-up pack.`);
  }
  return sku.topUpQuantity;
}

export function isSubscriptionSku(sku: BillingSkuDefinition): boolean {
  return sku.purchaseType === "subscription" && sku.planFamily !== null;
}

export function isTopUpSku(sku: BillingSkuDefinition): boolean {
  return sku.purchaseType === "one_time" && sku.topUpQuantity !== null;
}

export type CheckoutTarget =
  | { kind: "plan"; sku: BillingSkuSlug; planFamily: PlanFamily; cycle: "monthly" | "yearly" }
  | { kind: "top_up"; sku: BillingSkuSlug; quantity: number };

export function checkoutTargetFromSku(slug: string): CheckoutTarget | null {
  const sku = resolveBillingSku(slug);
  if (!sku || !sku.activeForCheckout) return null;

  if (isSubscriptionSku(sku) && sku.planFamily) {
    return {
      kind: "plan",
      sku: sku.slug,
      planFamily: sku.planFamily,
      cycle: sku.billingInterval === "annual" ? "yearly" : "monthly",
    };
  }

  if (isTopUpSku(sku)) {
    return {
      kind: "top_up",
      sku: sku.slug,
      quantity: topUpQuantityForSku(sku),
    };
  }

  return null;
}

/** Display-only bundle metadata keyed by canonical SKU slug */
export const TOP_UP_PACK_DISPLAY: Record<
  "burst_500_v1" | "campaign_2000_v1" | "scale_7500_v1",
  { name: string; creditLabel: string; detail: string }
> = {
  burst_500_v1: {
    name: "Proof Pack — 500",
    creditLabel: "500 extra proof captures",
    detail: "For sale-week spikes when campaigns move faster than the included capture allowance.",
  },
  campaign_2000_v1: {
    name: "Proof Pack — 2,000",
    creditLabel: "2,000 extra proof captures",
    detail: "Overflow capture volume for active launches and promo weeks.",
  },
  scale_7500_v1: {
    name: "Proof Pack — 7,500",
    creditLabel: "7,500 extra proof captures",
    detail: "Bulk capture volume for agencies tracking heavy categories.",
  },
};

export const LEGACY_USAGE_BUNDLE_SLUGS = ["proof_500", "proof_2000", "proof_7500"] as const;
export type LegacyUsageBundleSlug = (typeof LEGACY_USAGE_BUNDLE_SLUGS)[number];

export function legacyBundleSlugForSku(slug: BillingSkuSlug): LegacyUsageBundleSlug | null {
  switch (slug) {
    case "burst_500_v1":
    case "proof_500_legacy":
      return "proof_500";
    case "campaign_2000_v1":
    case "proof_2000_legacy":
      return "proof_2000";
    case "scale_7500_v1":
    case "proof_7500_legacy":
      return "proof_7500";
    default:
      return null;
  }
}
