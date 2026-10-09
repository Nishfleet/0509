import { env } from "cloudflare:workers";
import { z } from "zod";

import { entitledTier, isWorkspacePaid, resolveEntitlements, type Entitlements } from "../billing/entitlements";
import { isPlanId, type PlanId, type PlanSummary } from "../billing/plans";
import { readWorkspaceIdForOwner } from "./workspace.server";

const planRow = z.object({
  tier: z.string(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  trialing: z.number(),
  limits_json: z.string(),
  provider_customer_id: z.string().nullable(),
});

type PlanRow = z.infer<typeof planRow>;

const SELECT_PLAN =
  "SELECT tier, status, current_period_end, trialing, limits_json, provider_customer_id FROM plan WHERE workspace_id = ?";

const SELECT_WORKSPACE_PLANS =
  "SELECT workspace_id, tier, status, current_period_end, limits_json FROM plan WHERE workspace_id IN (SELECT value FROM json_each(?1))";

const SELECT_WORKSPACE_BY_SUBSCRIPTION = "SELECT workspace_id FROM plan WHERE provider_subscription_id = ?";

const UPSERT_SUBSCRIPTION = `INSERT INTO plan
  (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
SELECT ?, id, ?, ?, ?, ?, ?, ?, ? FROM workspace WHERE id = ?
ON CONFLICT(workspace_id) DO UPDATE SET
  tier = excluded.tier,
  status = excluded.status,
  provider_customer_id = excluded.provider_customer_id,
  provider_subscription_id = excluded.provider_subscription_id,
  current_period_end = excluded.current_period_end,
  trialing = excluded.trialing,
  updated_at = excluded.updated_at
WHERE ? = 1 OR excluded.updated_at >= plan.updated_at`;

async function readPlan(workspaceId: string, db: D1Database = env.DB): Promise<{ tier: string; row: PlanRow | null }> {
  const row = planRow.nullable().parse(await db.prepare(SELECT_PLAN).bind(workspaceId).first());
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

export async function readOwnerWorkspaceApiAccess(
  userId: string,
): Promise<{ workspaceId: string; apiAccess: boolean } | null> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) return null;
  return { workspaceId, apiAccess: (await readEntitlements(workspaceId)).api_access };
}

const WORKSPACE_ID_CHUNK = 500;

const workspacePlanRow = z.object({
  workspace_id: z.string(),
  tier: z.string(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  limits_json: z.string(),
});

async function readWorkspacePlanRows(unique: readonly string[]): Promise<z.infer<typeof workspacePlanRow>[]> {
  const statements = [];
  for (let start = 0; start < unique.length; start += WORKSPACE_ID_CHUNK) {
    const ids = JSON.stringify(unique.slice(start, start + WORKSPACE_ID_CHUNK));
    statements.push(env.DB.prepare(SELECT_WORKSPACE_PLANS).bind(ids));
  }
  const batches = await env.DB.batch(statements);
  return batches.flatMap((batch) => workspacePlanRow.array().parse(batch.results));
}

export async function readWorkspaceEntitlements(
  workspaceIds: readonly string[],
): Promise<ReadonlyMap<string, Entitlements>> {
  const unique = [...new Set(workspaceIds)];
  const entitlements = new Map<string, Entitlements>();
  if (unique.length === 0) return entitlements;
  const results = await readWorkspacePlanRows(unique);
  const now = new Date();
  const found = new Map(results.map((row) => [row.workspace_id, row] as const));
  for (const id of unique) {
    const row = found.get(id);
    entitlements.set(
      id,
      row === undefined
        ? resolveEntitlements("scout", "{}")
        : resolveEntitlements(
            entitledTier({ tier: row.tier, status: row.status, currentPeriodEnd: row.current_period_end }, now),
            row.limits_json,
          ),
    );
  }
  return entitlements;
}

export async function readPlanTier(workspaceId: string): Promise<PlanId> {
  const { tier } = await readPlan(workspaceId);
  return isPlanId(tier) ? tier : "scout";
}

export async function readPlanSummary(workspaceId: string, db: D1Database = env.DB): Promise<PlanSummary> {
  const { tier, row } = await readPlan(workspaceId, db);
  return {
    tier: isPlanId(tier) ? tier : "scout",
    status: row === null ? "none" : row.status,
    currentPeriodEnd: row === null ? null : row.current_period_end,
    trialing: row !== null && row.trialing === 1,
    billed: row !== null && row.provider_customer_id !== null,
  };
}

const readPlanCustomerIdRow = z.object({ provider_customer_id: z.string().nullable() });

export async function readPlanCustomerId(workspaceId: string): Promise<string | null> {
  const row = readPlanCustomerIdRow
    .nullable()
    .parse(
      await env.DB.prepare("SELECT provider_customer_id FROM plan WHERE workspace_id = ?").bind(workspaceId).first(),
    );
  return row === null ? null : row.provider_customer_id;
}

const readWorkspaceIdBySubscriptionRow = z.object({ workspace_id: z.string() });

export async function readWorkspaceIdBySubscription(subscriptionId: string): Promise<string | null> {
  const row = readWorkspaceIdBySubscriptionRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_WORKSPACE_BY_SUBSCRIPTION).bind(subscriptionId).first());
  return row === null ? null : row.workspace_id;
}

export interface PlanSubscription {
  tier: string;
  status: string;
  currentPeriodEnd: string | null;
  subscriptionId: string | null;
  updatedAt: string;
}

const readPlanSubscriptionRow = z.object({
  tier: z.string(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  provider_subscription_id: z.string().nullable(),
  updated_at: z.string(),
});

export async function readPlanSubscription(workspaceId: string): Promise<PlanSubscription | null> {
  const row = readPlanSubscriptionRow
    .nullable()
    .parse(
      await env.DB.prepare(
        "SELECT tier, status, current_period_end, provider_subscription_id, updated_at FROM plan WHERE workspace_id = ?",
      )
        .bind(workspaceId)
        .first(),
    );
  if (row === null) return null;
  return {
    tier: row.tier,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    subscriptionId: row.provider_subscription_id,
    updatedAt: row.updated_at,
  };
}

export interface SubscriptionPlan {
  workspaceId: string;
  replace?: boolean;
  tier: PlanId;
  status: string;
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: string | null;
  trialing: boolean;
  updatedAt: string;
}

export async function readPaidWorkspaceIds(now: Date): Promise<ReadonlySet<string>> {
  const rows = await env.DB.prepare("SELECT workspace_id, status, current_period_end FROM plan").all<{
    workspace_id: string;
    status: string;
    current_period_end: string | null;
  }>();
  return new Set(
    rows.results
      .filter((row) => isWorkspacePaid({ status: row.status, currentPeriodEnd: row.current_period_end }, now))
      .map((row) => row.workspace_id),
  );
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
      input.trialing ? 1 : 0,
      input.updatedAt,
      input.workspaceId,
      input.replace === true ? 1 : 0,
    )
    .run();
}
