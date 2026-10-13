import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import { readPlanSubscription, type PlanSubscription } from "../data/plan.server";
import { isSubscriptionLive } from "./entitlements";
import type { PlanSummary } from "./plans";
import { testerProductId } from "./products.server";

const NEVER_STARTED = new Set(["failed", "pending"]);

async function isTesterSubscription(subscriptionId: string): Promise<boolean | null> {
  if (env.DODO_PAYMENTS_API_KEY === "") return null;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
    timeout: 10_000,
    maxRetries: 1,
  });
  try {
    return (await client.subscriptions.retrieve(subscriptionId)).product_id === testerProductId();
  } catch (error) {
    const status =
      error instanceof DodoPayments.APIError && typeof error.status === "number" ? String(error.status) : "none";
    console.error(JSON.stringify({ event: "billing.returning_lookup_failed", status }));
    return null;
  }
}

export async function returningLookup(plan: PlanSubscription | null): Promise<boolean | null> {
  const subscriptionId = plan?.subscriptionId ?? null;
  if (plan === null || subscriptionId === null || NEVER_STARTED.has(plan.status)) return false;
  const tester = await isTesterSubscription(subscriptionId);
  return tester === null ? null : !tester;
}

export async function isReturningCustomer(plan: PlanSubscription | null): Promise<boolean> {
  return (await returningLookup(plan)) === true;
}

export async function returningForGate(workspaceId: string, plan: PlanSummary): Promise<boolean> {
  const gateShown = !plan.billed || !isSubscriptionLive(plan, new Date());
  return gateShown && (await isReturningCustomer(await readPlanSubscription(workspaceId)));
}
