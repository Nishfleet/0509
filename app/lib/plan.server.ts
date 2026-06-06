import type { AppEnv } from "~/lib/env.server";

export const PLAN_LIMITS = {
  free: {
    watchlists: 0,
    collections: 0,
    digests: false,
    digestCadence: "none",
    proofCapturesPerMonth: 0,
    metaSourceStatus: "beta_unavailable",
  },
  scout: {
    watchlists: 3,
    collections: 10,
    digests: true,
    digestCadence: "weekly",
    proofCapturesPerMonth: 50,
    metaSourceStatus: "beta_limited",
  },
  starter: {
    watchlists: 10,
    collections: 25,
    digests: true,
    digestCadence: "weekly",
    proofCapturesPerMonth: 250,
    metaSourceStatus: "beta_limited",
  },
  agency: {
    watchlists: 75,
    collections: 250,
    digests: true,
    digestCadence: "daily_and_weekly",
    proofCapturesPerMonth: 2500,
    metaSourceStatus: "beta_priority",
  },
} as const;

export type UserPlan = keyof typeof PLAN_LIMITS;
export type PlanResource = "watchlists" | "collections";
export type ProofUsageWarningLevel = "ok" | "warning" | "exhausted";

export const PROOF_USAGE_WARNING_RATIO = 0.8;

interface UserPlanRow {
  plan: string;
}

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

function parseUserPlan(value: string | null | undefined): UserPlan {
  if (value === "scout" || value === "starter" || value === "agency") {
    return value;
  }

  return "free";
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

export async function getUserPlan(env: AppEnv, userId: string): Promise<UserPlan> {
  const row = await one<UserPlanRow>(
    env,
    `
      SELECT plan
      FROM user_plan
      WHERE user_id = ?
    `,
    userId,
  );

  return parseUserPlan(row?.plan);
}

export async function checkPlanLimit(env: AppEnv, userId: string, resource: PlanResource) {
  const plan = await getUserPlan(env, userId);
  const limit = PLAN_LIMITS[plan][resource];
  const current = resource === "watchlists"
    ? await countWatchlists(env, userId)
    : await countCollections(env, userId);

  return {
    allowed: current < limit,
    limit,
    current,
  };
}

export async function getProofUsageSummary(env: AppEnv, userId: string) {
  const plan = await getUserPlan(env, userId);
  const windowStart = startOfRollingProofWindowIso();
  const now = new Date().toISOString();
  const [used, extraCredits] = await Promise.all([
    countProofCapturesForWorkspaceSince(env, userId, windowStart),
    sumActiveProofUsageCredits(env, userId, windowStart, now),
  ]);
  const baseLimit = PLAN_LIMITS[plan].proofCapturesPerMonth;
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
    baseLimit,
    extraCredits,
    limit,
    remaining: Math.max(0, limit - used),
    usageRatio,
    warningLevel,
    upgradeTarget: plan === "scout" ? "Starter" : plan === "starter" ? "Agency" : null,
  };
}

function startOfRollingProofWindowIso() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function countProofCapturesForWorkspaceSince(env: AppEnv, userId: string, attemptedSince: string) {
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

async function sumActiveProofUsageCredits(
  env: AppEnv,
  userId: string,
  grantedSince: string,
  now: string,
) {
  try {
    const row = await one<CountRow>(
      env,
      `
        SELECT COALESCE(SUM(credits), 0) AS count
        FROM proof_usage_credit
        WHERE user_id = ?
          AND granted_at >= ?
          AND expires_at > ?
      `,
      userId,
      grantedSince,
      now,
    );

    return Number(row?.count ?? 0);
  } catch (error) {
    if (/proof_usage_credit|no such table/i.test(error instanceof Error ? error.message : String(error))) {
      return 0;
    }
    throw error;
  }
}
