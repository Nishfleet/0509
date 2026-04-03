import type { AppEnv } from "~/lib/env.server";

export const PLAN_LIMITS = {
  free: {
    watchlists: 3,
    collections: 3,
    digests: false,
  },
  starter: {
    watchlists: 20,
    collections: 20,
    digests: true,
  },
  agency: {
    watchlists: Number.POSITIVE_INFINITY,
    collections: Number.POSITIVE_INFINITY,
    digests: true,
  },
} as const;

export const PLAN_UPGRADE_URL = "/#pricing";

export type UserPlan = keyof typeof PLAN_LIMITS;
export type PlanResource = "watchlists" | "collections";

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
  if (value === "starter" || value === "agency") {
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
