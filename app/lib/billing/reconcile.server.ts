import { env } from "cloudflare:workers";
import { captureMessage } from "@sentry/cloudflare";
import DodoPayments from "dodopayments";

import { readPlanSubscription, readReconcilablePlans, readWorkspaceIdBySubscription } from "../data/plan.server";
import { isSubscriptionLive } from "./entitlements";
import { planIdForProduct } from "./products.server";
import { applySubscription } from "./webhook.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 3;
const ENDED_DAYS = 45;
const KNOWN_PER_NIGHT = 500;
const RECENT_LIMIT = 300;
const PAGE_SIZE = 100;
const CUSTOMERS_PER_RETURN = 3;
const NIGHTLY = { timeout: 8_000, maxRetries: 0 };
const AT_CHECKOUT_LIMIT = 10;
const AT_CHECKOUT = { timeout: 3_000, maxRetries: 0 };

type Seen = Pick<
  Awaited<ReturnType<DodoPayments["subscriptions"]["retrieve"]>>,
  | "subscription_id"
  | "product_id"
  | "status"
  | "metadata"
  | "created_at"
  | "next_billing_date"
  | "cancel_at_next_billing_date"
>;

function dodo(options: { timeout: number; maxRetries: number }): DodoPayments | null {
  if (env.DODO_PAYMENTS_API_KEY === "") return null;
  return new DodoPayments({ bearerToken: env.DODO_PAYMENTS_API_KEY, environment: env.DODO_ENVIRONMENT, ...options });
}

function say(event: string, fields: Record<string, string>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

type Plan = NonNullable<Awaited<ReturnType<typeof readPlanSubscription>>>;

function matchesDodo(plan: Plan | null, sub: Seen): boolean {
  const ended = sub.status === "cancelled" && !sub.cancel_at_next_billing_date;
  return (
    plan !== null &&
    plan.subscriptionId === sub.subscription_id &&
    plan.status === sub.status &&
    plan.tier === planIdForProduct(sub.product_id) &&
    plan.currentPeriodEnd === (ended ? null : sub.next_billing_date)
  );
}

async function snapshot(workspaceId: string | null): Promise<string> {
  const plan = workspaceId === null ? null : await readPlanSubscription(workspaceId);
  return plan === null
    ? "none"
    : `${plan.tier}|${plan.status}|${plan.subscriptionId ?? ""}|${plan.currentPeriodEnd ?? ""}`;
}

function workspaceFor(known: string | null, sub: Seen): string | null {
  const claimed = sub.metadata.workspace_id;
  return known ?? (typeof claimed === "string" ? claimed : null);
}

async function reconcileOne(sub: Seen, readBeforeDodo: string | null): Promise<void> {
  const known = await readWorkspaceIdBySubscription(sub.subscription_id);
  const current = known === null ? null : await readPlanSubscription(known);
  if (matchesDodo(current, sub)) return;
  if (current !== null && current.updatedAt !== readBeforeDodo) return;
  const workspaceId = workspaceFor(known, sub);
  const before = await snapshot(workspaceId);
  const timestamp = current?.updatedAt ?? sub.created_at;
  const outcome = await applySubscription(
    { data: sub },
    { type: `subscription.${sub.status}`, timestamp, expectedUpdatedAt: current?.updatedAt },
  );
  if (outcome === "retry") {
    say("billing.reconcile_unmatched", { subscription: sub.subscription_id, status: sub.status });
    return;
  }
  if ((await snapshot(workspaceId)) === before) return;
  say("billing.reconcile_corrected", { subscription: sub.subscription_id, status: sub.status });
  captureMessage("billing: reconcile corrected a plan the webhook had not delivered", { level: "warning" });
}

export async function reconcileCandidates(now: Date): Promise<string[]> {
  const client = dodo(NIGHTLY);
  if (client === null) throw new Error("billing: reconcile skipped because the Dodo API key is not set");
  const endedSince = new Date(now.getTime() - ENDED_DAYS * DAY_MS).toISOString();
  const known = await readReconcilablePlans(KNOWN_PER_NIGHT, endedSince);
  const recent = await recentSubscriptions(client, now);
  return [...new Set([...known.map((plan) => plan.subscriptionId), ...recent.map((sub) => sub.subscription_id)])];
}

export async function reconcileSubscription(subscriptionId: string): Promise<void> {
  const client = dodo(NIGHTLY);
  if (client === null) throw new Error("billing: reconcile skipped because the Dodo API key is not set");
  const owner = await readWorkspaceIdBySubscription(subscriptionId);
  const readBeforeDodo = owner === null ? null : ((await readPlanSubscription(owner))?.updatedAt ?? null);
  await reconcileOne(await client.subscriptions.retrieve(subscriptionId), readBeforeDodo);
}

async function recentSubscriptions(client: DodoPayments, now: Date): Promise<Seen[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  const found: Seen[] = [];
  for await (const item of client.subscriptions.list({ created_at_gte: since, page_size: PAGE_SIZE })) {
    if (found.length >= RECENT_LIMIT) {
      say("billing.reconcile_recent_capped", { limit: RECENT_LIMIT.toFixed(0) });
      break;
    }
    found.push(item);
  }
  return found;
}

async function customerSubscriptions(client: DodoPayments, email: string): Promise<Seen[]> {
  const customers = await client.customers.list({ email, page_size: CUSTOMERS_PER_RETURN });
  const pages = await Promise.all(
    customers.items.map((customer) => client.subscriptions.list({ customer_id: customer.customer_id, page_size: 10 })),
  );
  const ids = pages.flatMap((page) => page.items.map((item) => item.subscription_id)).slice(0, AT_CHECKOUT_LIMIT);
  return Promise.all(ids.map((id) => client.subscriptions.retrieve(id)));
}

export async function reconcileCheckoutReturn(workspaceId: string, email: string): Promise<void> {
  const current = await readPlanSubscription(workspaceId);
  if (current !== null && isSubscriptionLive(current, new Date())) return;
  const client = dodo(AT_CHECKOUT);
  if (client === null) return;
  try {
    const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `reconcile:${workspaceId}` });
    if (!success) return;
    for (const sub of await customerSubscriptions(client, email)) {
      await reconcileOne(sub, current?.updatedAt ?? null);
    }
  } catch (error) {
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
  }
}

export async function startBillingReconcile(now: Date): Promise<string> {
  const id = `billing-reconcile-${now.toISOString().slice(0, 10)}`;
  await env.BILLING_RECONCILE.createBatch([{ id, params: { at: now.toISOString() } }]);
  return id;
}
