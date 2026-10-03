import { env } from "cloudflare:workers";

import { PLANS, type BillingInterval, type PlanId } from "./plans";

function configuredProducts(interval: BillingInterval): Record<PlanId, string> {
  if (interval === "yearly") {
    return {
      scout: env.DODO_PRODUCT_SCOUT_YEARLY,
      starter: env.DODO_PRODUCT_STARTER_YEARLY,
      agency: env.DODO_PRODUCT_AGENCY_YEARLY,
    };
  }
  return {
    scout: env.DODO_PRODUCT_SCOUT,
    starter: env.DODO_PRODUCT_STARTER,
    agency: env.DODO_PRODUCT_AGENCY,
  };
}

export function testerProductId(): string {
  return env.DODO_PRODUCT_TESTER;
}

export function productIdFor(planId: PlanId, interval: BillingInterval = "monthly"): string {
  return configuredProducts(interval)[planId];
}

export function planIdForProduct(productId: string): PlanId | null {
  if (productId === "") return null;
  if (productId === env.DODO_PRODUCT_TESTER) return "starter";
  const monthly = configuredProducts("monthly");
  const yearly = configuredProducts("yearly");
  return PLANS.find((plan) => monthly[plan.id] === productId || yearly[plan.id] === productId)?.id ?? null;
}
