import { env } from "cloudflare:workers";

import { resolveEntitlements, type Entitlements } from "../billing/entitlements";
import { isPlanId, type PlanId } from "../billing/plans";

interface PlanLimitsRow {
  tier: string;
  limits_json: string;
}

const SELECT_PLAN_LIMITS = "SELECT tier, limits_json FROM plan WHERE workspace_id = ?";

export async function readEntitlements(workspaceId: string): Promise<Entitlements> {
  const row = await env.DB.prepare(SELECT_PLAN_LIMITS).bind(workspaceId).first<PlanLimitsRow>();
  if (row === null) return resolveEntitlements("scout", "{}");
  return resolveEntitlements(row.tier, row.limits_json);
}

const SELECT_PLAN_TIER = "SELECT tier FROM plan WHERE workspace_id = ?";

export async function readPlanTier(workspaceId: string): Promise<PlanId> {
  const row = await env.DB.prepare(SELECT_PLAN_TIER).bind(workspaceId).first<{ tier: string }>();
  return row !== null && isPlanId(row.tier) ? row.tier : "scout";
}
