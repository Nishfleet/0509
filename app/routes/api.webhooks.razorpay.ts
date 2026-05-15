import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    fingerprintRazorpayWebhookBody,
    isRazorpayWebhookPlanAllowed,
    isRazorpayWebhookFresh,
    parseRazorpaySubscriptionWebhook,
    verifyRazorpayWebhookSignature,
  } = await import("~/lib/razorpay.server");
  const {
    claimRazorpayWebhookEvent,
    markRazorpayWebhookEventFinished,
    syncRazorpaySubscriptionStatus,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const rawBody = await request.text();

  await verifyRazorpayWebhookSignature({
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new Response("Invalid Razorpay webhook JSON.", { status: 400 });
  }

  const update = parseRazorpaySubscriptionWebhook(payload);
  if (update?.payloadCreatedAt && !isRazorpayWebhookFresh(update.payloadCreatedAt)) {
    throw new Response("Stale Razorpay webhook event.", { status: 400 });
  }
  if (update && !isRazorpayWebhookPlanAllowed(env, update)) {
    throw new Response("Razorpay webhook plan id does not match configured billing plans.", { status: 400 });
  }

  const headerEventId = request.headers.get("x-razorpay-event-id")?.trim() || null;
  const eventId = headerEventId ?? update?.eventId ?? await fingerprintRazorpayWebhookBody(rawBody);
  const claimed = await claimRazorpayWebhookEvent(env, {
    eventId,
    eventType: update?.event ?? "unsupported",
    subscriptionId: update?.subscriptionId ?? null,
    userId: update?.userId ?? null,
    payloadCreatedAt: update?.payloadCreatedAt ?? null,
  });

  if (!claimed) {
    return new Response(
      JSON.stringify({
        ok: true,
        processed: false,
        duplicate: true,
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

  if (!update) {
    await markRazorpayWebhookEventFinished(env, eventId, {
      outcome: "ignored",
      metadata: { reason: "unsupported_payload" },
    });
  } else {
    try {
      await syncRazorpaySubscriptionStatus(env, update);
      await markRazorpayWebhookEventFinished(env, eventId, {
        outcome: "processed",
        metadata: {
          plan: update.plan,
          status: update.status,
        },
      });
    } catch (error) {
      await markRazorpayWebhookEventFinished(env, eventId, {
        outcome: "failed",
        metadata: {
          message: error instanceof Error ? error.message : "Unknown Razorpay webhook processing error.",
        },
      });
      throw error;
    }
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
