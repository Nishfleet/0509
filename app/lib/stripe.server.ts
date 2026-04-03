import Stripe from "stripe";

import type { AppEnv } from "~/lib/env.server";

export const STRIPE_API_VERSION = "2026-02-25.clover";

export type BillingPlan = "starter" | "agency";
export type BillingInterval = "monthly" | "yearly";

export function createStripeClient(env: Pick<AppEnv, "STRIPE_SECRET_KEY">) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe secret key is not configured.");
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function parseBillingPlan(value: FormDataEntryValue | string | null | undefined): BillingPlan | null {
  return value === "starter" || value === "agency" ? value : null;
}

export function parseBillingInterval(value: FormDataEntryValue | string | null | undefined): BillingInterval | null {
  return value === "monthly" || value === "yearly" ? value : null;
}

export function resolveCheckoutPriceId(
  env: AppEnv,
  plan: BillingPlan,
  interval: BillingInterval,
) {
  const priceId = plan === "starter"
    ? interval === "yearly"
      ? env.STRIPE_STARTER_YEARLY_PRICE_ID ?? env.STRIPE_STARTER_PRICE_ID
      : env.STRIPE_STARTER_PRICE_ID
    : interval === "yearly"
      ? env.STRIPE_AGENCY_YEARLY_PRICE_ID ?? env.STRIPE_AGENCY_PRICE_ID
      : env.STRIPE_AGENCY_PRICE_ID;

  if (!priceId) {
    throw new Error(`Stripe price id is not configured for ${plan} ${interval}.`);
  }

  return priceId;
}

export function getStripeObjectId(
  value: string | { id: string } | Stripe.DeletedCustomer | Stripe.DeletedSubscription | null | undefined,
) {
  if (typeof value === "string") {
    return value;
  }

  if (value && "id" in value && typeof value.id === "string") {
    return value.id;
  }

  return null;
}
