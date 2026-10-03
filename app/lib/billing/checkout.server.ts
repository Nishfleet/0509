import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import { checkoutProof } from "./checkout-proof.server";
import { TRIAL_DAYS, type BillingInterval, type PlanId } from "./plans";
import { productIdFor, testerProductId } from "./products.server";

interface CheckoutInput {
  workspaceId: string;
  email: string;
}

async function startCheckout(input: CheckoutInput & { product: string; planId: PlanId; trialDays?: number }) {
  if (input.product === "" || env.DODO_PAYMENTS_API_KEY === "") return null;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
  });
  const plan = input.planId;
  try {
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: input.product, quantity: 1 }],
      customer: { email: input.email },
      ...(input.trialDays === undefined ? {} : { subscription_data: { trial_period_days: input.trialDays } }),
      metadata: {
        workspace_id: input.workspaceId,
        plan,
        proof: await checkoutProof(input.workspaceId, input.product),
      },
      return_url: `${env.BETTER_AUTH_URL}/app/competitors?upgraded=${plan}`,
    });
    return session.checkout_url ?? null;
  } catch (error) {
    const status = error instanceof DodoPayments.APIError ? String(error.status) : "none";
    console.error(JSON.stringify({ event: "billing.checkout_failed", plan, status }));
    return null;
  }
}

export function createCheckoutUrl(
  input: CheckoutInput & { planId: PlanId; interval?: BillingInterval },
): Promise<string | null> {
  return startCheckout({
    ...input,
    product: productIdFor(input.planId, input.interval ?? "monthly"),
    trialDays: TRIAL_DAYS,
  });
}

export function createTesterCheckoutUrl(input: CheckoutInput): Promise<string | null> {
  return startCheckout({ ...input, product: testerProductId(), planId: "starter" });
}
