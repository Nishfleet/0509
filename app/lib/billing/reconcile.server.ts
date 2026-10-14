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
const KNOWN_PER_NIGHT = 100;
const RECENT_LIMIT = 300;
const PAGE_SIZE = 100;
const CUSTOMERS_PER_RETURN = 3;
const AT_ONCE = 10;
const NIGHTLY = { timeout: 8_000, maxRetries: 0 };
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

async function snapshot(workspaceId: string | null): Promise<string> {
  const plan = workspaceId === null ? null : await readPlanSubscription(workspaceId);
  return plan === null
    ? "none"
    : `${plan.tier}|${plan.status}|${plan.subscriptionId ?? ""}|${plan.currentPeriodEnd ?? ""}`;
}

async function reconcileOne(sub: Seen, now: Date): Promise<void> {
  const known = await readWorkspaceIdBySubscription(sub.subscription_id);
  if (known !== null && (await matchesDodo(known, sub))) return;
  const claimed = sub.metadata.workspace_id;
  const workspaceId = known ?? (typeof claimed === "string" ? claimed : null);
  const before = await snapshot(workspaceId);
  const timestamp = known === null ? sub.created_at : now.toISOString();
  const outcome = await applySubscription({ data: sub }, `subscription.${sub.status}`, timestamp);
  if (outcome === "retry") {
    say("billing.reconcile_unmatched", { subscription: sub.subscription_id, status: sub.status });
    return;
  }
  if ((await snapshot(workspaceId)) === before) return;
  say("billing.reconcile_corrected", { subscription: sub.subscription_id, status: sub.status });
  captureMessage("billing: reconcile corrected a plan the webhook had not delivered", { level: "warning" });
}

type Outcome = "ok" | "failed";

async function settle(work: () => Promise<void>): Promise<Outcome> {
  try {
    await work();
    return "ok";
  } catch (error) {
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return "failed";
  }
}

async function inGroups<Item>(items: readonly Item[], work: (item: Item) => Promise<Outcome>): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (let start = 0; start < items.length; start += AT_ONCE) {
    outcomes.push(...(await Promise.all(items.slice(start, start + AT_ONCE).map(work))));
  }
  return outcomes;
}

async function reconcileKnown(client: DodoPayments, now: Date): Promise<Outcome[]> {
  const endedSince = new Date(now.getTime() - ENDED_DAYS * DAY_MS).toISOString();
  const plans = await readReconcilablePlans(KNOWN_PER_NIGHT, endedSince);
  return inGroups(plans, (plan) =>
    settle(async () => reconcileOne(await client.subscriptions.retrieve(plan.subscriptionId), now)),
  );
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

async function reconcileRecent(client: DodoPayments, now: Date): Promise<Outcome[]> {
  const items = await recentSubscriptions(client, now);
  return inGroups(items, (item) => settle(() => reconcileOne(item, now)));
}

async function phase(work: () => Promise<Outcome[]>): Promise<Outcome[]> {
  try {
    return await work();
  } catch (error) {
    say("billing.reconcile_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return ["failed"];
  }
}

export async function reconcileBilling(now: Date): Promise<void> {
  const client = dodo(NIGHTLY);
  if (client === null) throw new Error("billing: reconcile skipped because the Dodo API key is not set");
  const outcomes = [
    ...(await phase(() => reconcileKnown(client, now))),
    ...(await phase(() => reconcileRecent(client, now))),
  ];
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome === "failed")) {
    throw new Error("billing: reconcile could not reach Dodo");
  }
}

async function customerSubscriptions(client: DodoPayments, email: string): Promise<Seen[]> {
  const customers = await client.customers.list({ email, page_size: CUSTOMERS_PER_RETURN });
  const pages = await Promise.all(
    customers.items.map((customer) => client.subscriptions.list({ customer_id: customer.customer_id, page_size: 10 })),
  );
  return pages.flatMap((page) => page.items);
}

export async function reconcileCheckoutReturn(workspaceId: string, email: string): Promise<void> {
  const current = await readPlanSubscription(workspaceId);
  if (current !== null && isSubscriptionLive(current, new Date())) return;
  const client = dodo(AT_CHECKOUT);
  if (client === null) return;
  const now = new Date();
  await settle(async () => {
    const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `reconcile:${workspaceId}` });
    if (!success) return;
    for (const sub of await customerSubscriptions(client, email)) await reconcileOne(sub, now);
  });
}
