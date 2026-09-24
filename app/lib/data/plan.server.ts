import { env } from "cloudflare:workers";

import { PLANS } from "../billing/plans";

interface PlanRow {
  tier: string;
  cap: number | null;
}

const SELECT_PLAN_CAP =
  "SELECT tier, json_extract(limits_json, '$.competitors') AS cap FROM plan WHERE workspace_id = ?";

export async function readCompetitorCap(workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(SELECT_PLAN_CAP).bind(workspaceId).first<PlanRow>();
  if (row !== null && typeof row.cap === "number") return row.cap;
  const plan = row === null ? undefined : PLANS.find((entry) => entry.id === row.tier);
  if (plan === undefined) return PLANS[0].competitors;
  return plan.competitors;
}
