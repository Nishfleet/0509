import { env } from "cloudflare:workers";

import { entitledTier, resolveEntitlements, type Entitlements } from "../billing/entitlements";
import { isPlanId, type PlanId } from "../billing/plans";

interface PlanRow {
  tier: string;
  status: string;
  current_period_end: string | null;
  limits_json: string;
}

const SELECT_PLAN = "SELECT tier, status, current_period_end, limits_json FROM plan WHERE workspace_id = ?";

const SELECT_WORKSPACE_BY_SUBSCRIPTION = "SELECT workspace_id FROM plan WHERE provider_subscription_id = ?";

const UPSERT_SUBSCRIPTION = `INSERT INTO plan
  (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
SELECT ?, id, ?, ?, ?, ?, ?, ? FROM workspace WHERE id = ?
ON CONFLICT(workspace_id) DO UPDATE SET
  tier = excluded.tier,
  status = excluded.status,
  provider_customer_id = excluded.provider_customer_id,
  provider_subscription_id = excluded.provider_subscription_id,
  current_period_end = excluded.current_period_end,
  updated_at = excluded.updated_at
WHERE excluded.updated_at >= plan.updated_at`;

async function readPlan(workspaceId: string): Promise<{ tier: string; row: PlanRow | null }> {
  const row = await env.DB.prepare(SELECT_PLAN).bind(workspaceId).first<PlanRow>();
  if (row === null) return { tier: "scout", row };
  const tier = entitledTier(
    { tier: row.tier, status: row.status, currentPeriodEnd: row.current_period_end },
    new Date(),
  );
  return { tier, row };
}

export async function readEntitlements(workspaceId: string): Promise<Entitlements> {
  const { tier, row } = await readPlan(workspaceId);
  return resolveEntitlements(tier, row === null ? "{}" : row.limits_json);
}

export async function readPlanTier(workspaceId: string): Promise<PlanId> {
  const { tier } = await readPlan(workspaceId);
  return isPlanId(tier) ? tier : "scout";
}

export async function readWorkspaceIdBySubscription(subscriptionId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_SUBSCRIPTION)
    .bind(subscriptionId)
    .first<{ workspace_id: string }>();
  return row === null ? null : row.workspace_id;
}

export interface SubscriptionPlan {
  workspaceId: string;
  tier: PlanId;
  status: string;
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: string | null;
  updatedAt: string;
}

export async function upsertSubscriptionPlan(input: SubscriptionPlan): Promise<void> {
  await env.DB.prepare(UPSERT_SUBSCRIPTION)
    .bind(
      crypto.randomUUID(),
      input.tier,
      input.status,
      input.customerId,
      input.subscriptionId,
      input.currentPeriodEnd,
      input.updatedAt,
      input.workspaceId,
    )
    .run();
}
