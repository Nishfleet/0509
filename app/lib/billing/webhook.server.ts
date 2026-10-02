import { env } from "cloudflare:workers";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

import { markWebhookEventProcessed, recordWebhookEvent } from "../data/dodo_webhook_event.server";
import { readPlanSubscription, readWorkspaceIdBySubscription, upsertSubscriptionPlan } from "../data/plan.server";
import { isCheckoutProof } from "./checkout-proof.server";
import { entitledTier } from "./entitlements";
import { PLANS, type PlanId } from "./plans";
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
  cancel_at_next_billing_date: z.boolean().nullish(),
  customer: z.object({ customer_id: z.string() }),
  metadata: z.record(z.string(), z.string()).nullish(),
});

const subscriptionEvent = z.object({ data: subscriptionData });

const OK = { status: 200 };

function log(event: string, fields: Record<string, string>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

const RANK = new Map<PlanId, number>(PLANS.map((plan, index) => [plan.id, index]));

function rank(tier: string): number {
  return RANK.get(tier as PlanId) ?? 0;
}

type Workspace = { kind: "found"; id: string } | { kind: "retry" } | { kind: "ignore" };

async function resolveWorkspace(data: z.infer<typeof subscriptionData>): Promise<Workspace> {
  const known = await readWorkspaceIdBySubscription(data.subscription_id);
  if (known !== null) return { kind: "found", id: known };
  const claimed = data.metadata?.workspace_id;
  if (claimed === undefined) {
    log("billing.webhook_no_workspace", { subscription: data.subscription_id });
    return { kind: "retry" };
  }
  if (!(await isCheckoutProof(claimed, data.product_id, data.metadata?.proof))) {
    log("billing.webhook_unproven", { subscription: data.subscription_id });
    return { kind: "ignore" };
  }
  return { kind: "found", id: claimed };
}

async function displacesBetterPlan(input: {
  workspaceId: string;
  subscriptionId: string;
  tier: PlanId;
}): Promise<boolean> {
  const current = await readPlanSubscription(input.workspaceId);
  if (current === null || current.subscriptionId === input.subscriptionId) return false;
  const entitled = entitledTier(
    { tier: current.tier, status: current.status, currentPeriodEnd: current.currentPeriodEnd },
    new Date(),
  );
  return rank(entitled) > rank(input.tier);
}

async function applySubscription(body: unknown, type: string, timestamp: string): Promise<"done" | "retry"> {
  const parsed = subscriptionEvent.safeParse(body);
  if (!parsed.success) {
    log("billing.webhook_unparsed", { type });
    return "done";
  }
  const { data } = parsed.data;
  const tier = planIdForProduct(data.product_id);
  if (tier === null) {
    log("billing.webhook_unknown_product", { type, product: data.product_id });
    return "done";
  }
  const workspace = await resolveWorkspace(data);
  if (workspace.kind === "retry") return "retry";
  if (workspace.kind === "ignore") return "done";
  const workspaceId = workspace.id;
  if (await displacesBetterPlan({ workspaceId, subscriptionId: data.subscription_id, tier })) {
    log("billing.webhook_lower_tier_ignored", { type, subscription: data.subscription_id });
    return "done";
  }
  const cancelledNow = data.status === "cancelled" && data.cancel_at_next_billing_date !== true;
  await upsertSubscriptionPlan({
    workspaceId,
    tier,
    status: data.status,
    customerId: data.customer.customer_id,
    subscriptionId: data.subscription_id,
    currentPeriodEnd: cancelledNow ? null : (data.next_billing_date ?? null),
    updatedAt: timestamp,
  });
  return "done";
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    log("billing.webhook_not_json", { reason: String(error) });
    return undefined;
  }
}

function isSigned(request: Request, body: string): boolean {
  try {
    new Webhook(env.DODO_WEBHOOK_SECRET).verify(
      body,
      {
        "webhook-id": request.headers.get("webhook-id") ?? "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      },
      { jsonParse: false },
    );
    return true;
  } catch (error) {
    log("billing.webhook_rejected", { reason: String(error) });
    return false;
  }
}

export async function handleDodoWebhook(request: Request): Promise<Response> {
  const body = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  if (!isSigned(request, body)) return new Response(null, { status: 400 });
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
  const outcome = type.startsWith("subscription.") ? await applySubscription(json, type, timestamp) : "done";
  if (outcome === "retry") return new Response(null, { status: 500 });
  await markWebhookEventProcessed(id, now);
  return new Response(null, OK);
}
