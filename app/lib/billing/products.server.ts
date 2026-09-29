import { env } from "cloudflare:workers";

import { PLANS, type PlanId } from "./plans";

function configuredProducts(): Record<PlanId, string> {
  return {
    scout: env.DODO_PRODUCT_SCOUT,
    starter: env.DODO_PRODUCT_STARTER,
    agency: env.DODO_PRODUCT_AGENCY,
  };
}

export function productIdFor(planId: PlanId): string {
  return configuredProducts()[planId];
}

export function planIdForProduct(productId: string): PlanId | null {
  if (productId === "") return null;
  const products = configuredProducts();
  return PLANS.find((plan) => products[plan.id] === productId)?.id ?? null;
}
