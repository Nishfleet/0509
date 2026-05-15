import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    parseRazorpaySubscriptionWebhook,
    verifyRazorpayWebhookSignature,
  } = await import("~/lib/razorpay.server");
  const { syncRazorpaySubscriptionStatus } = await import("~/lib/data.server");
  const env = getEnv(context);
  const rawBody = await request.text();

  await verifyRazorpayWebhookSignature({
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });

  const update = parseRazorpaySubscriptionWebhook(rawBody ? JSON.parse(rawBody) : null);
  if (update) {
    await syncRazorpaySubscriptionStatus(env, update);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: Boolean(update),
      event: update?.event ?? null,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
