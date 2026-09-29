import { env } from "cloudflare:workers";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

import { markWebhookEventProcessed, recordWebhookEvent } from "../data/dodo_webhook_event.server";
import { readWorkspaceIdBySubscription, upsertSubscriptionPlan } from "../data/plan.server";
import { planIdForProduct } from "./products.server";

const envelope = z.object({ type: z.string(), timestamp: z.string() });

const subscriptionData = z.object({
  subscription_id: z.string(),
  product_id: z.string(),
  status: z.string(),
  next_billing_date: z.string().nullish(),
  customer: z.object({ customer_id: z.string() }),
  metadata: z.record(z.string(), z.string()).nullish(),
});

const subscriptionEvent = z.object({ data: subscriptionData });

const OK = { status: 200 };

function log(event: string, fields: Record<string, string>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function applySubscription(body: unknown, type: string, timestamp: string): Promise<void> {
  const parsed = subscriptionEvent.safeParse(body);
  if (!parsed.success) {
    log("billing.webhook_unparsed", { type });
    return;
  }
  const { data } = parsed.data;
  const tier = planIdForProduct(data.product_id);
  if (tier === null) {
    log("billing.webhook_unknown_product", { type, product: data.product_id });
    return;
  }
  const workspaceId =
    data.metadata?.workspace_id ?? (await readWorkspaceIdBySubscription(data.subscription_id));
  if (workspaceId === null || workspaceId === undefined) {
    log("billing.webhook_no_workspace", { type, subscription: data.subscription_id });
    return;
  }
  await upsertSubscriptionPlan({
    workspaceId,
    tier,
    status: data.status,
    customerId: data.customer.customer_id,
    subscriptionId: data.subscription_id,
    currentPeriodEnd: data.next_billing_date ?? null,
    updatedAt: timestamp,
  });
}

export async function handleDodoWebhook(request: Request): Promise<Response> {
  const body = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  try {
    new Webhook(env.DODO_WEBHOOK_SECRET).verify(body, {
      "webhook-id": id,
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": request.headers.get("webhook-signature") ?? "",
    });
  } catch (error) {
    log("billing.webhook_rejected", { reason: String(error) });
    return new Response(null, { status: 400 });
  }
  const parsed = envelope.parse(JSON.parse(body));
  const now = new Date().toISOString();
  const state = await recordWebhookEvent({ id, eventType: parsed.type, payloadJson: body, receivedAt: now });
  if (state === "processed") return new Response(null, OK);
  if (parsed.type.startsWith("subscription.")) {
    await applySubscription(JSON.parse(body), parsed.type, parsed.timestamp);
  }
  await markWebhookEventProcessed(id, now);
  return new Response(null, OK);
}
