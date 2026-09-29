import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import { TRIAL_DAYS, type PlanId } from "./plans";

function productId(planId: PlanId): string {
  const ids: Record<PlanId, string> = {
    scout: env.DODO_PRODUCT_SCOUT,
    starter: env.DODO_PRODUCT_STARTER,
    agency: env.DODO_PRODUCT_AGENCY,
  };
  return ids[planId];
}

export async function createCheckoutUrl(input: {
  planId: PlanId;
  workspaceId: string;
  email: string;
}): Promise<string | null> {
  const product = productId(input.planId);
  if (product === "" || env.DODO_PAYMENTS_API_KEY === "") return null;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
  });
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: product, quantity: 1 }],
    customer: { email: input.email },
    subscription_data: { trial_period_days: TRIAL_DAYS },
    metadata: { workspace_id: input.workspaceId, plan: input.planId },
    return_url: `${env.BETTER_AUTH_URL}/app/competitors?upgraded=${input.planId}`,
  });
  return session.checkout_url ?? null;
}
