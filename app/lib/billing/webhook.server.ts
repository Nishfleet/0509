import { env } from "cloudflare:workers";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

import { markWebhookEventProcessed, recordWebhookEvent } from "../data/dodo_webhook_event.server";
import { readWorkspaceIdBySubscription, upsertSubscriptionPlan } from "../data/plan.server";
import { planIdForProduct } from "./products.server";

const envelope = z.object({
  type: z.string(),
  timestamp: z.string(),
  data: z.object({ subscription_id: z.string().optional() }).optional(),
});

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

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    log("billing.webhook_not_json", { reason: String(error) });
    return undefined;
  }
}

export async function handleDodoWebhook(request: Request): Promise<Response> {
  const body = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  try {
    new Webhook(env.DODO_WEBHOOK_SECRET).verify(
      body,
      {
        "webhook-id": id,
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      },
      { jsonParse: false },
    );
  } catch (error) {
    log("billing.webhook_rejected", { reason: String(error) });
    return new Response(null, { status: 400 });
  }
  const json = readJson(body);
  const event = envelope.safeParse(json);
  if (!event.success) {
    log("billing.webhook_ignored", { reason: "unexpected_payload" });
    return new Response(null, OK);
  }
  const { type, timestamp, data } = event.data;
  const now = new Date().toISOString();
  const state = await recordWebhookEvent({
    id,
    eventType: type,
    payloadJson: JSON.stringify({ subscription_id: data?.subscription_id ?? null, timestamp }),
    receivedAt: now,
  });
  if (state === "processed") return new Response(null, OK);
  if (type.startsWith("subscription.")) await applySubscription(json, type, timestamp);
  await markWebhookEventProcessed(id, now);
  return new Response(null, OK);
}
