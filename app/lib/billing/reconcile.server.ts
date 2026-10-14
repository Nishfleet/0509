import { env } from "cloudflare:workers";
import { captureMessage } from "@sentry/cloudflare";
import DodoPayments from "dodopayments";

import { readPlanSubscription, readReconcilablePlans, readWorkspaceIdBySubscription } from "../data/plan.server";
import { isSubscriptionLive } from "./entitlements";
import { applySubscription } from "./webhook.server";

const RECENT_DAYS = 3;
const KNOWN_PER_NIGHT = 200;
const PAGE_SIZE = 100;
const CUSTOMERS_PER_RETURN = 3;

type Seen = Pick<
  Awaited<ReturnType<DodoPayments["subscriptions"]["retrieve"]>>,
  "subscription_id" | "status" | "metadata" | "created_at"
>;

function dodo(): DodoPayments | null {
  if (env.DODO_PAYMENTS_API_KEY === "") return null;
  return new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
    timeout: 10_000,
    maxRetries: 1,
  });
}

function say(event: string, fields: Record<string, string>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function snapshot(workspaceId: string | null): Promise<string> {
  const plan = workspaceId === null ? null : await readPlanSubscription(workspaceId);
  return plan === null
    ? "none"
    : `${plan.tier}|${plan.status}|${plan.subscriptionId ?? ""}|${plan.currentPeriodEnd ?? ""}`;
}

async function reconcileOne(sub: Seen, timestamp: string): Promise<void> {
  const claimed = sub.metadata.workspace_id;
  const workspaceId =
    (await readWorkspaceIdBySubscription(sub.subscription_id)) ?? (typeof claimed === "string" ? claimed : null);
  const before = await snapshot(workspaceId);
  const outcome = await applySubscription({ data: sub }, `subscription.${sub.status}`, timestamp);
  if (outcome === "retry") {
    say("billing.reconcile_unmatched", { subscription: sub.subscription_id, status: sub.status });
    captureMessage("billing: a Dodo subscription has no workspace", { level: "warning" });
    return;
  }
  if ((await snapshot(workspaceId)) === before) return;
  say("billing.reconcile_corrected", { subscription: sub.subscription_id, status: sub.status });
  captureMessage("billing: reconcile corrected a plan the webhook had not delivered", { level: "warning" });
}

async function attempt(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
  }
}

async function reconcileKnown(client: DodoPayments, now: Date): Promise<void> {
  for (const plan of await readReconcilablePlans(KNOWN_PER_NIGHT)) {
    await attempt(async () =>
      reconcileOne(await client.subscriptions.retrieve(plan.subscriptionId), now.toISOString()),
    );
  }
}

async function reconcileRecent(client: DodoPayments, now: Date): Promise<void> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const page = await client.subscriptions.list({ created_at_gte: since, page_size: PAGE_SIZE });
  for (const item of page.items) await attempt(() => reconcileOne(item, item.created_at));
}

export async function reconcileBilling(now: Date): Promise<void> {
  const client = dodo();
  if (client === null) return;
  await attempt(() => reconcileKnown(client, now));
  await attempt(() => reconcileRecent(client, now));
}

async function customerSubscriptions(client: DodoPayments, email: string): Promise<Seen[]> {
  const found: Seen[] = [];
  const customers = await client.customers.list({ email, page_size: CUSTOMERS_PER_RETURN });
  for (const customer of customers.items) {
    const page = await client.subscriptions.list({ customer_id: customer.customer_id, page_size: 10 });
    found.push(...page.items);
  }
  return found;
}

export async function reconcileCheckoutReturn(workspaceId: string, email: string): Promise<void> {
  const current = await readPlanSubscription(workspaceId);
  if (current !== null && isSubscriptionLive(current, new Date())) return;
  const client = dodo();
  if (client === null) return;
  const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `reconcile:${workspaceId}` });
  if (!success) return;
  await attempt(async () => {
    for (const sub of await customerSubscriptions(client, email)) await reconcileOne(sub, sub.created_at);
  });
}
