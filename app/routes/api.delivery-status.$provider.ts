import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { verifyWhatsAppWebhookChallenge } = await import("~/lib/whatsapp.server");
  const env = getEnv(context);

  if (params.provider !== "whatsapp") {
    throw new Response("Not found", { status: 404 });
  }

  const challenge = verifyWhatsAppWebhookChallenge(env, new URL(request.url));
  if (!challenge) {
    return new Response("OK", { status: 200 });
  }

  return new Response(challenge, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
  const {
    extractWhatsAppWebhookStatusUpdates,
    verifyWhatsAppWebhookSignature,
  } = await import("~/lib/whatsapp.server");
  const env = getEnv(context);

  if (params.provider !== "whatsapp") {
    throw new Response("Not found", { status: 404 });
  }

  const rawBody = await request.text();
  await verifyWhatsAppWebhookSignature(env, request, rawBody);
  const payload = rawBody ? JSON.parse(rawBody) : null;
  const updates = extractWhatsAppWebhookStatusUpdates(payload);
  const reconciled = [];

  for (const update of updates) {
    const result = await reconcileDeliveryStatus(env, update);
    if (result) {
      reconciled.push(result.id);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: updates.length,
      reconciled: reconciled.length,
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
