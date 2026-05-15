import { redirect, type ActionFunctionArgs } from "react-router";

import { appOrigin } from "~/lib/env.server";
import { detectPricingRegion } from "~/lib/pricing";

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    createDodoCheckoutSession,
    dodoCheckoutSessionId,
    dodoCheckoutUrl,
    isDodoCheckoutOptionConfigured,
    parseDodoBillingCycle,
    parseDodoBillingPlan,
  } = await import("~/lib/dodo.server");
  const { recordPendingDodoSubscription } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const plan = parseDodoBillingPlan(formData.get("plan"));
  const cycle = parseDodoBillingCycle(formData.get("cycle"));

  if (!plan || !cycle) {
    throw new Response("Invalid Dodo billing plan.", { status: 400 });
  }

  const cloudflare = context.cloudflare as {
    country?: string | null;
  } | undefined;
  const countryCode = cloudflare?.country ?? request.headers.get("cf-ipcountry");
  const region = detectPricingRegion(countryCode ?? env.APP_REGION_DEFAULT);
  if (region === "india") {
    throw new Response("Dodo checkout is only configured for international billing.", { status: 400 });
  }
  if (!isDodoCheckoutOptionConfigured(env, plan, cycle)) {
    throw new Response("Dodo checkout is not configured for this billing option.", { status: 503 });
  }

  const returnUrl = new URL("/app?billing=dodo", appOrigin(env, request)).toString();
  const checkoutSession = await createDodoCheckoutSession(env, {
    plan,
    cycle,
    userId: session.user.id,
    userEmail: session.user.email,
    userName: session.user.name,
    returnUrl,
  });
  const checkoutUrl = dodoCheckoutUrl(checkoutSession);
  if (!checkoutUrl) {
    throw new Response("Dodo did not return a checkout link.", { status: 502 });
  }

  await recordPendingDodoSubscription(env, {
    userId: session.user.id,
    checkoutSessionId: dodoCheckoutSessionId(checkoutSession) || null,
    subscriptionId: null,
    customerId: null,
    productId: null,
    status: "checkout_created",
  });

  throw redirect(checkoutUrl, { status: 303 });
}
