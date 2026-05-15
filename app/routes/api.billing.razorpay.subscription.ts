import { redirect, type ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    createRazorpaySubscription,
    parseRazorpayBillingCycle,
    parseRazorpayBillingPlan,
  } = await import("~/lib/razorpay.server");
  const { recordPendingRazorpaySubscription } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const plan = parseRazorpayBillingPlan(formData.get("plan"));
  const cycle = parseRazorpayBillingCycle(formData.get("cycle"));

  if (!plan || !cycle) {
    throw new Response("Invalid Razorpay billing plan.", { status: 400 });
  }

  const subscription = await createRazorpaySubscription(env, {
    plan,
    cycle,
    userId: session.user.id,
    userEmail: session.user.email,
  });

  if (!subscription.short_url) {
    throw new Response("Razorpay did not return a checkout link.", { status: 502 });
  }

  await recordPendingRazorpaySubscription(env, {
    userId: session.user.id,
    subscriptionId: subscription.id,
    customerId: subscription.customer_id ?? null,
    providerPlanId: subscription.plan_id ?? null,
    status: subscription.status,
  });

  throw redirect(subscription.short_url, { status: 303 });
}
