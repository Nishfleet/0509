import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import type { PlanId } from "./plans";
import { productIdFor } from "./products.server";

export async function changeSubscriptionPlan(subscriptionId: string, planId: PlanId): Promise<boolean> {
  const product = productIdFor(planId);
  if (product === "" || env.DODO_PAYMENTS_API_KEY === "") return false;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
    timeout: 15_000,
    maxRetries: 0,
  });
  try {
    await client.subscriptions.changePlan(subscriptionId, {
      product_id: product,
      quantity: 1,
      proration_billing_mode: "prorated_immediately",
      effective_at: "immediately",
      on_payment_failure: "prevent_change",
    });
    return true;
  } catch (error) {
    const status = error instanceof DodoPayments.APIError ? String(error.status) : "none";
    console.error(JSON.stringify({ event: "billing.change_plan_failed", plan: planId, status }));
    return false;
  }
}
