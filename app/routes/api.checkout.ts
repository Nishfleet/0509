import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    createStripeClient,
    parseBillingInterval,
    parseBillingPlan,
    resolveCheckoutPriceId,
  } = await import("~/lib/stripe.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const plan = parseBillingPlan(formData.get("plan"));
  const interval = parseBillingInterval(formData.get("interval"));

  if (!plan || !interval) {
    return new Response("Invalid billing selection.", { status: 400 });
  }

  const stripe = createStripeClient(env);
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: session.user.id,
    customer_email: session.user.email,
    success_url: new URL("/app?upgraded=1", request.url).toString(),
    cancel_url: new URL("/#pricing", request.url).toString(),
    line_items: [
      {
        price: resolveCheckoutPriceId(env, plan, interval),
        quantity: 1,
      },
    ],
    metadata: {
      interval,
      plan,
    },
    subscription_data: {
      metadata: {
        interval,
        plan,
        userId: session.user.id,
      },
    },
  });

  if (!checkoutSession.url) {
    throw new Response("Stripe Checkout URL was not returned.", { status: 502 });
  }

  throw redirect(checkoutSession.url);
}
