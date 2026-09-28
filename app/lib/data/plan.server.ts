import { env } from "cloudflare:workers";

import { resolveEntitlements, type Entitlements } from "../billing/entitlements";

interface PlanLimitsRow {
  tier: string;
  limits_json: string;
}

const SELECT_PLAN_LIMITS = "SELECT tier, limits_json FROM plan WHERE workspace_id = ?";

export async function readEntitlements(workspaceId: string): Promise<Entitlements> {
  const row = await env.DB.prepare(SELECT_PLAN_LIMITS).bind(workspaceId).first<PlanLimitsRow>();
  if (row === null) return resolveEntitlements("scout", "");
  return resolveEntitlements(row.tier, row.limits_json);
}
