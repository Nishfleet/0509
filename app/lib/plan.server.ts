import type { AppEnv } from "~/lib/env.server";
import {
  getIncludedEvidenceAllowance,
  getPlanEntitlements,
  getPlanLimit,
  getWorkspaceSeatLimit,
  PLAN_LIMITS,
  type PlanFamily,
  type PlanResource,
} from "~/lib/plan-entitlements";
import { effectivePlanFromRow, type EffectivePlanRow } from "~/lib/plan-effective.server";
import {
  getEvidenceUsageSummary,
  isEvidenceTopUpReadError,
  listTopUpGrantHistory,
} from "~/lib/evidence-usage.server";

export { PLAN_LIMITS };
export type { PlanFamily as UserPlan, PlanResource };

export type ProofUsageWarningLevel = "ok" | "warning" | "exhausted";
export const PROOF_USAGE_WARNING_RATIO = 0.8;

export {
  canUsePlanFeature,
  getPlanEntitlements,
  getPlanLimit,
  getIncludedEvidenceAllowance,
  getWorkspaceSeatLimit,
  getScheduledMonitoringPolicy,
  planAllowsDigestCadence,
  parsePlanFamily,
} from "~/lib/plan-entitlements";

interface CountRow {
  count: number;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  return env.DB;
}

async function many<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const db = ensureDb(env);
  const result = await db.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

async function one<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const rows = await many<T>(env, sql, ...bindings);
  return rows[0] ?? null;
}

async function countWatchlists(env: AppEnv, userId: string) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM watchlist
      WHERE user_id = ?
        AND is_active = 1
    `,
    userId,
  );

  return Number(row?.count ?? 0);
}

async function countCollections(env: AppEnv, userId: string) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM collection
      WHERE user_id = ?
    `,
    userId,
  );

  return Number(row?.count ?? 0);
}

export async function getUserPlan(env: AppEnv, userId: string): Promise<PlanFamily> {
  const row = await one<EffectivePlanRow>(
    env,
    `
      SELECT plan, dodo_status, dodo_next_billing_at
      FROM user_plan
      WHERE user_id = ?
    `,
    userId,
  );

  return effectivePlanFromRow(row);
}

export async function getEffectiveWorkspacePlan(env: AppEnv, workspaceUserId: string) {
  return getUserPlan(env, workspaceUserId);
}

export async function getEffectiveWorkspaceEntitlements(env: AppEnv, workspaceUserId: string) {
  const plan = await getEffectiveWorkspacePlan(env, workspaceUserId);
  return getPlanEntitlements(plan);
}

export async function getUserPlanForActor(env: AppEnv, actorUserId: string): Promise<PlanFamily> {
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const workspace = await resolveWorkspace(env, actorUserId);
  return getUserPlan(env, workspace.workspaceUserId);
}

export async function checkPlanLimit(env: AppEnv, userId: string, resource: PlanResource) {
  const plan = await getUserPlan(env, userId);
  const limit = getPlanLimit(plan, resource);
  const current = resource === "watchlists"
    ? await countWatchlists(env, userId)
    : await countCollections(env, userId);

  return {
    allowed: current < limit,
    limit,
    current,
  };
}

export async function checkPlanLimitForActor(
  env: AppEnv,
  actorUserId: string,
  resource: PlanResource,
) {
  const { resolveWorkspace } = await import("~/lib/workspace.server");
  const workspace = await resolveWorkspace(env, actorUserId);
  return checkPlanLimit(env, workspace.workspaceUserId, resource);
}

export async function getProofUsageSummary(env: AppEnv, userId: string) {
  try {
    const summary = await getEvidenceUsageSummary(env, userId);
    const usageRatio =
      summary.includedAllowance > 0
        ? summary.includedUsed / summary.includedAllowance
        : summary.includedUsed > 0
          ? Number.POSITIVE_INFINITY
          : 0;
    const warningLevel: ProofUsageWarningLevel =
      summary.includedAllowance > 0 && summary.includedUsed >= summary.includedAllowance
        ? "exhausted"
        : summary.includedAllowance > 0 && usageRatio >= PROOF_USAGE_WARNING_RATIO
          ? "warning"
          : "ok";

    return {
      plan: summary.plan,
      used: summary.includedUsed,
      includedUsed: summary.includedUsed,
      baseLimit: summary.includedAllowance,
      extraCredits: summary.topUpRemaining,
      limit: summary.includedAllowance + summary.topUpRemaining,
      remaining: summary.totalAvailable,
      usageRatio,
      warningLevel,
      upgradeTarget:
        summary.plan === "scout" ? "Starter" : summary.plan === "starter" ? "Agency" : null,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      includedRemaining: summary.includedRemaining,
      topUpRemaining: summary.topUpRemaining,
      topUpRetainedWhileInactive: summary.topUpRetainedWhileInactive,
      canSpendTopUps: summary.canSpendTopUps,
      totalAvailable: summary.totalAvailable,
      nextPeriodStart: summary.nextPeriodStart,
    };
  } catch (error) {
    if (isEvidenceTopUpReadError(error)) {
      throw error;
    }
    return getProofUsageSummaryLegacy(env, userId);
  }
}

async function getProofUsageSummaryLegacy(env: AppEnv, userId: string) {
  const plan = await getUserPlan(env, userId);
  const windowStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();
  const now = new Date().toISOString();
  const [used, extraCredits] = await Promise.all([
    countProofCapturesForWorkspaceSinceLegacy(env, userId, windowStart),
    sumLegacyProofUsageCredits(env, userId, now),
  ]);
  const baseLimit = getIncludedEvidenceAllowance(plan);
  const limit = baseLimit + extraCredits;
  const usageRatio = limit > 0 ? used / limit : used > 0 ? Number.POSITIVE_INFINITY : 0;
  const warningLevel: ProofUsageWarningLevel =
    limit > 0 && used >= limit
      ? "exhausted"
      : limit > 0 && usageRatio >= PROOF_USAGE_WARNING_RATIO
        ? "warning"
        : "ok";

  return {
    plan,
    used,
    includedUsed: used,
    baseLimit,
    extraCredits,
    limit,
    remaining: Math.max(0, limit - used),
    usageRatio,
    warningLevel,
    upgradeTarget: plan === "scout" ? "Starter" : plan === "starter" ? "Agency" : null,
    periodStart: windowStart,
    periodEnd: null,
    includedRemaining: Math.max(0, baseLimit - used),
    topUpRemaining: extraCredits,
    topUpRetainedWhileInactive: plan === "free" ? extraCredits : 0,
    canSpendTopUps: plan !== "free",
    totalAvailable: Math.max(0, limit - used),
    nextPeriodStart: null,
  };
}

async function countProofCapturesForWorkspaceSinceLegacy(
  env: AppEnv,
  userId: string,
  attemptedSince: string,
) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.attempted_at >= ?
    `,
    userId,
    attemptedSince,
  );
  return Number(row?.count ?? 0);
}

async function sumLegacyProofUsageCredits(env: AppEnv, userId: string, now: string) {
  try {
    const row = await one<CountRow>(
      env,
      `
        SELECT COALESCE(SUM(credits), 0) AS count
        FROM proof_usage_credit
        WHERE user_id = ?
          AND expires_at > ?
      `,
      userId,
      now,
    );
    return Number(row?.count ?? 0);
  } catch {
    const row = await one<CountRow>(
      env,
      `
        SELECT COALESCE(SUM(quantity_remaining), 0) AS count
        FROM evidence_top_up_grant
        WHERE workspace_user_id = ?
          AND status = 'active'
      `,
      userId,
    );
    return Number(row?.count ?? 0);
  }
}

export async function listActiveProofCreditGrants(env: AppEnv, userId: string) {
  const grants = await listTopUpGrantHistory(env, userId);
  return grants
    .filter((grant) => grant.status === "active" && grant.quantity_remaining > 0)
    .map((grant) => ({
      credits: grant.quantity_remaining,
      skuSlug: grant.sku_slug,
      providerPaymentId: grant.provider_payment_id,
      grantedAt: grant.granted_at,
      expiresAt: null as string | null,
    }));
}

export async function requirePlanFeature(
  env: AppEnv,
  workspaceUserId: string,
  feature: Parameters<typeof import("~/lib/plan-entitlements").canUsePlanFeature>[1],
) {
  const plan = await getUserPlan(env, workspaceUserId);
  const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
  if (!canUsePlanFeature(plan, feature)) {
    return { allowed: false as const, plan };
  }
  return { allowed: true as const, plan };
}
