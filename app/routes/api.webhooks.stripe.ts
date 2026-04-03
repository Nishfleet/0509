import type { ActionFunctionArgs } from "react-router";
import type Stripe from "stripe";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { downgradeUserPlan, upsertUserPlan } = await import("~/lib/plan.server");
  const {
    createStripeClient,
    getStripeObjectId,
    parseBillingPlan,
  } = await import("~/lib/stripe.server");
  const env = getEnv(context);
  const signature = request.headers.get("stripe-signature");

  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Missing Stripe signature.", { status: 400 });
  }

  const stripe = createStripeClient(env);
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return new Response("Invalid Stripe signature.", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const plan = parseBillingPlan(session.metadata?.plan);

    if (session.client_reference_id && plan) {
      await upsertUserPlan(env, {
        userId: session.client_reference_id,
        plan,
        stripeCustomerId: getStripeObjectId(session.customer),
        stripeSubscriptionId: getStripeObjectId(session.subscription),
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await downgradeUserPlan(env, subscription.id);
  }

  return new Response("ok");
}
