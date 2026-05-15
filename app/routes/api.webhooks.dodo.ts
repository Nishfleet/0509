import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    dodoWebhookSecret,
    isDodoWebhookProductAllowed,
    parseDodoSubscriptionWebhook,
    verifyDodoWebhookSignature,
  } = await import("~/lib/dodo.server");
  const {
    claimDodoWebhookEvent,
    markDodoWebhookEventFinished,
    syncDodoSubscriptionStatus,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const rawBody = await request.text();
  const webhookId = request.headers.get("webhook-id")?.trim() || null;

  await verifyDodoWebhookSignature({
    rawBody,
    webhookId,
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    webhookSecret: dodoWebhookSecret(env),
  });

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new Response("Invalid Dodo webhook JSON.", { status: 400 });
  }

  const update = parseDodoSubscriptionWebhook(payload);
  if (update && !isDodoWebhookProductAllowed(env, update)) {
    throw new Response("Dodo webhook product id does not match configured billing products.", { status: 400 });
  }

  const eventType = typeof (payload as { type?: unknown } | null)?.type === "string"
    ? (payload as { type: string }).type
    : update?.event ?? "unsupported";
  const eventId = webhookId ?? crypto.randomUUID();
  const claimed = await claimDodoWebhookEvent(env, {
    eventId,
    eventType,
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
    await markDodoWebhookEventFinished(env, eventId, {
      outcome: "ignored",
      metadata: { reason: "unsupported_payload" },
    });
  } else {
    try {
      await syncDodoSubscriptionStatus(env, update);
      await markDodoWebhookEventFinished(env, eventId, {
        outcome: "processed",
        metadata: {
          plan: update.plan,
          status: update.status,
        },
      });
    } catch (error) {
      await markDodoWebhookEventFinished(env, eventId, {
        outcome: "failed",
        metadata: {
          message: error instanceof Error ? error.message : "Unknown Dodo webhook processing error.",
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
