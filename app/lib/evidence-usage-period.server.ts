import type { AppEnv } from "~/lib/env.server";
import {
  getIncludedEvidenceAllowance,
  isPaidPlanFamily,
  parsePlanFamily,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";

export type EntitlementAnchorSource = "provider" | "plan_activation" | "fallback";

interface UsagePeriodRow {
  id: string;
  workspace_user_id: string;
  period_start: string;
  period_end: string;
  plan_family: string;
  included_allowance: number;
  included_consumed: number;
  created_at: string;
}

interface UserPlanAnchorRow {
  plan: string;
  plan_updated_at: string | null;
  evidence_entitlement_anchor: string | null;
  evidence_entitlement_anchor_source: string | null;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is not configured.");
  return env.DB;
}

function createId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/** Clamp anchor day-of-month when target month is shorter (e.g. Jan 31 → Feb 28/29). */
export function clampAnniversaryUtcDay(year: number, monthIndex: number, anchorDay: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(anchorDay, lastDay);
}

/** Add whole months to an anchor, preserving the intended anniversary with month-end clamping. */
export function addSubscriptionMonthsUtc(anchor: Date, months: number) {
  const anchorDay = anchor.getUTCDate();
  const targetMonthIndex = anchor.getUTCMonth() + months;
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const day = clampAnniversaryUtcDay(targetYear, normalizedMonth, anchorDay);
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

/** Calendar-month entitlement period containing `at` (free plan). */
export function computeCalendarMonthBounds(at: Date = new Date()) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 1));
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

/** Subscription-anchored monthly entitlement period containing `at`. */
export function computeSubscriptionPeriodBounds(anchorIso: string, at: Date = new Date()) {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Invalid entitlement anchor.");
  }

  let periodIndex = 0;
  let periodStart = anchor;
  let periodEnd = addSubscriptionMonthsUtc(anchor, 1);

  if (at < anchor) {
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodIndex,
    };
  }

  while (at >= periodEnd) {
    periodIndex += 1;
    periodStart = periodEnd;
    periodEnd = addSubscriptionMonthsUtc(anchor, periodIndex + 1);
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodIndex,
  };
}

function parseAnchorMs(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

export async function readWorkspaceEntitlementAnchor(env: AppEnv, workspaceUserId: string) {
  const row = await ensureDb(env)
    .prepare(
      `
        SELECT plan, plan_updated_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source
        FROM user_plan
        WHERE user_id = ?
        LIMIT 1
      `,
    )
    .bind(workspaceUserId)
    .first<UserPlanAnchorRow>();

  return row;
}

export async function persistWorkspaceEntitlementAnchor(
  env: AppEnv,
  workspaceUserId: string,
  anchor: string,
  source: EntitlementAnchorSource,
) {
  const existing = await readWorkspaceEntitlementAnchor(env, workspaceUserId);
  const existingMs = parseAnchorMs(existing?.evidence_entitlement_anchor);
  const candidateMs = parseAnchorMs(anchor);

  if (existing?.evidence_entitlement_anchor) {
    if (Number.isNaN(candidateMs) || candidateMs < existingMs) {
      return {
        anchor: existing.evidence_entitlement_anchor,
        source: (existing.evidence_entitlement_anchor_source as EntitlementAnchorSource) ?? "fallback",
        changed: false as const,
      };
    }
    if (candidateMs === existingMs) {
      return {
        anchor: existing.evidence_entitlement_anchor,
        source: (existing.evidence_entitlement_anchor_source as EntitlementAnchorSource) ?? source,
        changed: false as const,
      };
    }
  }

  await ensureDb(env)
    .prepare(
      `
        INSERT INTO user_plan (user_id, plan, evidence_entitlement_anchor, evidence_entitlement_anchor_source, plan_updated_at)
        VALUES (?, 'free', ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          evidence_entitlement_anchor = excluded.evidence_entitlement_anchor,
          evidence_entitlement_anchor_source = excluded.evidence_entitlement_anchor_source
        WHERE user_plan.evidence_entitlement_anchor IS NULL
           OR julianday(excluded.evidence_entitlement_anchor) >= julianday(user_plan.evidence_entitlement_anchor)
      `,
    )
    .bind(workspaceUserId, anchor, source, nowIso())
    .run();

  return { anchor, source, changed: true as const };
}

export async function ensureWorkspaceEntitlementAnchor(
  env: AppEnv,
  workspaceUserId: string,
  input?: {
    providerAnchor?: string | null;
    planActivationAt?: string | null;
  },
) {
  const row = await readWorkspaceEntitlementAnchor(env, workspaceUserId);
  if (row?.evidence_entitlement_anchor) {
    return {
      anchor: row.evidence_entitlement_anchor,
      source: (row.evidence_entitlement_anchor_source as EntitlementAnchorSource) ?? "fallback",
    };
  }

  if (input?.providerAnchor) {
    const persisted = await persistWorkspaceEntitlementAnchor(
      env,
      workspaceUserId,
      input.providerAnchor,
      "provider",
    );
    return { anchor: persisted.anchor, source: persisted.source };
  }

  if (input?.planActivationAt) {
    const persisted = await persistWorkspaceEntitlementAnchor(
      env,
      workspaceUserId,
      input.planActivationAt,
      "plan_activation",
    );
    return { anchor: persisted.anchor, source: persisted.source };
  }

  if (row?.plan_updated_at && isPaidPlanFamily(parsePlanFamily(row.plan))) {
    const persisted = await persistWorkspaceEntitlementAnchor(
      env,
      workspaceUserId,
      row.plan_updated_at,
      "plan_activation",
    );
    return { anchor: persisted.anchor, source: persisted.source };
  }

  const fallback = nowIso();
  const persisted = await persistWorkspaceEntitlementAnchor(env, workspaceUserId, fallback, "fallback");
  return { anchor: persisted.anchor, source: persisted.source };
}

async function readCurrentUsagePeriod(
  env: AppEnv,
  workspaceUserId: string,
  periodStart: string,
) {
  return ensureDb(env)
    .prepare(
      `
        SELECT id, workspace_user_id, period_start, period_end, plan_family,
               included_allowance, included_consumed, created_at
        FROM evidence_usage_period
        WHERE workspace_user_id = ?
          AND period_start = ?
        LIMIT 1
      `,
    )
    .bind(workspaceUserId, periodStart)
    .first<UsagePeriodRow>();
}

export async function ensureCurrentEvidenceUsagePeriod(
  env: AppEnv,
  workspaceUserId: string,
  planFamily?: PlanFamily,
) {
  const effectivePlan = planFamily ?? (await getUserPlan(env, workspaceUserId));
  if (!isPaidPlanFamily(effectivePlan)) {
    // Free still owns a real, persisted monthly period: the instant first scan
    // carries one included evidence check (see getIncludedEvidenceAllowance),
    // and a placeholder row with a zero allowance would silently starve it.
    const { periodStart, periodEnd } = computeCalendarMonthBounds();
    const allowance = getIncludedEvidenceAllowance("free");

    const existing = await readCurrentUsagePeriod(env, workspaceUserId, periodStart);
    if (existing) {
      if (existing.plan_family !== "free" || existing.included_allowance !== allowance) {
        await ensureDb(env)
          .prepare(
            `
              UPDATE evidence_usage_period
              SET plan_family = ?,
                  included_allowance = ?
              WHERE id = ?
            `,
          )
          .bind("free", allowance, existing.id)
          .run();
        return {
          ...existing,
          plan_family: "free",
          included_allowance: allowance,
        };
      }
      return existing;
    }

    const id = createId();
    await ensureDb(env)
      .prepare(
        `
          INSERT INTO evidence_usage_period (
            id, workspace_user_id, period_start, period_end, plan_family,
            included_allowance, included_consumed, created_at
          )
          VALUES (?, ?, ?, ?, 'free', ?, 0, ?)
          ON CONFLICT(workspace_user_id, period_start) DO NOTHING
        `,
      )
      .bind(id, workspaceUserId, periodStart, periodEnd, allowance, nowIso())
      .run();

    const created = await readCurrentUsagePeriod(env, workspaceUserId, periodStart);
    if (created) return created;

    return {
      id,
      workspace_user_id: workspaceUserId,
      period_start: periodStart,
      period_end: periodEnd,
      plan_family: "free",
      included_allowance: allowance,
      included_consumed: 0,
      created_at: nowIso(),
    } satisfies UsagePeriodRow;
  }

  const { anchor } = await ensureWorkspaceEntitlementAnchor(env, workspaceUserId);
  const { periodStart, periodEnd } = computeSubscriptionPeriodBounds(anchor);
  const allowance = getIncludedEvidenceAllowance(effectivePlan);

  const existing = await readCurrentUsagePeriod(env, workspaceUserId, periodStart);
  if (existing) {
    if (existing.plan_family !== effectivePlan) {
      const nextAllowance = allowance;
      await ensureDb(env)
        .prepare(
          `
            UPDATE evidence_usage_period
            SET plan_family = ?,
                included_allowance = ?
            WHERE id = ?
          `,
        )
        .bind(effectivePlan, nextAllowance, existing.id)
        .run();
      return {
        ...existing,
        plan_family: effectivePlan,
        included_allowance: nextAllowance,
      };
    }
    return existing;
  }

  const id = createId();
  await ensureDb(env)
    .prepare(
      `
        INSERT INTO evidence_usage_period (
          id, workspace_user_id, period_start, period_end, plan_family,
          included_allowance, included_consumed, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(workspace_user_id, period_start) DO NOTHING
      `,
    )
    .bind(id, workspaceUserId, periodStart, periodEnd, effectivePlan, allowance, nowIso())
    .run();

  const created = await readCurrentUsagePeriod(env, workspaceUserId, periodStart);
  if (created) return created;

  return {
    id,
    workspace_user_id: workspaceUserId,
    period_start: periodStart,
    period_end: periodEnd,
    plan_family: effectivePlan,
    included_allowance: allowance,
    included_consumed: 0,
    created_at: nowIso(),
  } satisfies UsagePeriodRow;
}
