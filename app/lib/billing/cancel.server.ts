import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

import { readPlanSubscription } from "../data/plan.server";

const ENDED = new Set(["cancelled", "expired", "failed"]);

export async function cancelPlanForDelete(workspaceId: string): Promise<boolean> {
  const plan = await readPlanSubscription(workspaceId);
  const subscriptionId = plan?.subscriptionId ?? null;
  if (plan === null || subscriptionId === null || ENDED.has(plan.status)) return true;
  if (env.DODO_PAYMENTS_API_KEY === "") return false;
  const client = new DodoPayments({ bearerToken: env.DODO_PAYMENTS_API_KEY, environment: env.DODO_ENVIRONMENT });
  try {
    await client.subscriptions.update(subscriptionId, {
      status: "cancelled",
      cancel_reason: "cancelled_by_customer",
    });
    return true;
  } catch (error) {
    const status = error instanceof DodoPayments.APIError ? String(error.status) : "none";
    console.error(JSON.stringify({ event: "billing.cancel_on_delete_failed", status }));
    return false;
  }
}
