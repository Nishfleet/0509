import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import { readPlanSubscription, type PlanSubscription } from "../data/plan.server";
import { isSubscriptionLive } from "./entitlements";
import type { PlanSummary } from "./plans";
import { testerProductId } from "./products.server";

const NEVER_STARTED = new Set(["failed", "pending"]);

async function isTesterSubscription(subscriptionId: string): Promise<boolean> {
  if (env.DODO_PAYMENTS_API_KEY === "") return false;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
    timeout: 10_000,
    maxRetries: 1,
  });
  try {
    return (await client.subscriptions.retrieve(subscriptionId)).product_id === testerProductId();
  } catch {
    return false;
  }
}

export async function isReturningCustomer(plan: PlanSubscription | null): Promise<boolean> {
  const subscriptionId = plan?.subscriptionId ?? null;
  if (plan === null || subscriptionId === null || NEVER_STARTED.has(plan.status)) return false;
  return !(await isTesterSubscription(subscriptionId));
}

export async function returningForGate(workspaceId: string, plan: PlanSummary): Promise<boolean> {
  const gateShown = !plan.billed || !isSubscriptionLive(plan, new Date());
  return gateShown && (await isReturningCustomer(await readPlanSubscription(workspaceId)));
}
