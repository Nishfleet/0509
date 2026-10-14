import { env } from "cloudflare:workers";
import { captureMessage } from "@sentry/cloudflare";
import DodoPayments from "dodopayments";

import { readPlanSubscription, readReconcilablePlans, readWorkspaceIdBySubscription } from "../data/plan.server";
import { isSubscriptionLive } from "./entitlements";
import { planIdForProduct } from "./products.server";
import { applySubscription } from "./webhook.server";

const RECENT_DAYS = 3;
const KNOWN_PER_NIGHT = 200;
const PAGE_SIZE = 100;
const CUSTOMERS_PER_RETURN = 3;
const AT_ONCE = 10;
const NIGHTLY = { timeout: 10_000, maxRetries: 1 };
const AT_CHECKOUT = { timeout: 4_000, maxRetries: 0 };

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

interface Tally {
  tried: number;
  failed: number;
}

function dodo(options: { timeout: number; maxRetries: number }): DodoPayments | null {
  if (env.DODO_PAYMENTS_API_KEY === "") return null;
  return new DodoPayments({ bearerToken: env.DODO_PAYMENTS_API_KEY, environment: env.DODO_ENVIRONMENT, ...options });
}

function say(event: string, fields: Record<string, string>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function matchesDodo(workspaceId: string, sub: Seen): Promise<boolean> {
  const plan = await readPlanSubscription(workspaceId);
  const ended = sub.status === "cancelled" && !sub.cancel_at_next_billing_date;
  return (
    plan !== null &&
    plan.subscriptionId === sub.subscription_id &&
    plan.status === sub.status &&
    plan.tier === planIdForProduct(sub.product_id) &&
    plan.currentPeriodEnd === (ended ? null : sub.next_billing_date)
  );
}

async function reconcileOne(sub: Seen, now: Date): Promise<void> {
  const known = await readWorkspaceIdBySubscription(sub.subscription_id);
  if (known !== null && (await matchesDodo(known, sub))) return;
  const timestamp = known === null ? sub.created_at : now.toISOString();
  const outcome = await applySubscription({ data: sub }, `subscription.${sub.status}`, timestamp);
  if (outcome === "retry") {
    say("billing.reconcile_unmatched", { subscription: sub.subscription_id, status: sub.status });
    captureMessage("billing: a Dodo subscription has no workspace", { level: "warning" });
    return;
  }
  say("billing.reconcile_corrected", { subscription: sub.subscription_id, status: sub.status });
  captureMessage("billing: reconcile corrected a plan the webhook had not delivered", { level: "warning" });
}

async function attempt(tally: Tally, work: () => Promise<void>): Promise<void> {
  tally.tried += 1;
  try {
    await work();
  } catch (error) {
    tally.failed += 1;
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
  }
}

async function phase(tally: Tally, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    tally.tried += 1;
    tally.failed += 1;
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
  }
}

async function inGroups<Item>(items: readonly Item[], work: (item: Item) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += AT_ONCE) {
    await Promise.all(items.slice(start, start + AT_ONCE).map(work));
  }
}

async function reconcileKnown(client: DodoPayments, now: Date, tally: Tally): Promise<void> {
  const plans = await readReconcilablePlans(KNOWN_PER_NIGHT);
  await inGroups(plans, (plan) =>
    attempt(tally, async () => reconcileOne(await client.subscriptions.retrieve(plan.subscriptionId), now)),
  );
}

async function reconcileRecent(client: DodoPayments, now: Date, tally: Tally): Promise<void> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const page = await client.subscriptions.list({ created_at_gte: since, page_size: PAGE_SIZE });
  await inGroups(page.items, (item) => attempt(tally, () => reconcileOne(item, now)));
}

export async function reconcileBilling(now: Date): Promise<void> {
  const client = dodo(NIGHTLY);
  if (client === null) {
    say("billing.reconcile_skipped", { reason: "no_api_key" });
    return;
  }
  const tally: Tally = { tried: 0, failed: 0 };
  await phase(tally, () => reconcileKnown(client, now, tally));
  await phase(tally, () => reconcileRecent(client, now, tally));
  if (tally.failed > 0 && tally.failed === tally.tried) throw new Error("billing: reconcile could not reach Dodo");
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
  const client = dodo(AT_CHECKOUT);
  if (client === null) return;
  const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `reconcile:${workspaceId}` });
  if (!success) return;
  const now = new Date();
  await attempt({ tried: 0, failed: 0 }, async () => {
    for (const sub of await customerSubscriptions(client, email)) await reconcileOne(sub, now);
  });
}
