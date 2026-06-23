import type { AppEnv } from "~/lib/env.server";
import {
  getIncludedEvidenceAllowance,
  parsePlanFamily,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { defineEvidenceCheckBillableUnit } from "~/lib/evidence-usage-policies.server";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export { defineEvidenceCheckBillableUnit };

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

interface TopUpGrantRow {
  id: string;
  workspace_user_id: string;
  sku_slug: string;
  provider_payment_id: string;
  provider_product_id: string;
  quantity_granted: number;
  quantity_remaining: number;
  granted_at: string;
  status: string;
  catalog_version: string | null;
}

interface ReservationRow {
  id: string;
  workspace_user_id: string;
  usage_period_id: string | null;
  top_up_grant_id: string | null;
  logical_operation_key: string;
  quantity: number;
  status: string;
  reserved_at: string;
  expires_at: string;
  settled_at: string | null;
  released_at: string | null;
  source: string;
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

export function utcCalendarMonthBounds(at: Date = new Date()) {
  const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

async function readWorkspacePlanFamily(env: AppEnv, workspaceUserId: string): Promise<PlanFamily> {
  const row = await ensureDb(env)
    .prepare(`SELECT plan FROM user_plan WHERE user_id = ? LIMIT 1`)
    .bind(workspaceUserId)
    .first<{ plan: string }>();
  return parsePlanFamily(row?.plan);
}

export async function ensureCurrentEvidenceUsagePeriod(
  env: AppEnv,
  workspaceUserId: string,
  planFamily?: PlanFamily,
) {
  const plan = planFamily ?? (await readWorkspacePlanFamily(env, workspaceUserId));
  const { periodStart, periodEnd } = utcCalendarMonthBounds();
  const allowance = getIncludedEvidenceAllowance(plan);

  const existing = await ensureDb(env)
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

  if (existing) {
    if (existing.plan_family !== plan) {
      await ensureDb(env)
        .prepare(
          `
            UPDATE evidence_usage_period
            SET plan_family = ?,
                included_allowance = ?
            WHERE id = ?
          `,
        )
        .bind(plan, allowance, existing.id)
        .run();
      return {
        ...existing,
        plan_family: plan,
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
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `,
    )
    .bind(id, workspaceUserId, periodStart, periodEnd, plan, allowance, nowIso())
    .run();

  return {
    id,
    workspace_user_id: workspaceUserId,
    period_start: periodStart,
    period_end: periodEnd,
    plan_family: plan,
    included_allowance: allowance,
    included_consumed: 0,
    created_at: nowIso(),
  } satisfies UsagePeriodRow;
}

async function sumLegacyActiveTopUpCredits(env: AppEnv, workspaceUserId: string, now: string) {
  try {
    const row = await ensureDb(env)
      .prepare(
        `
          SELECT COALESCE(SUM(credits), 0) AS total
          FROM proof_usage_credit
          WHERE user_id = ?
            AND expires_at > ?
        `,
      )
      .bind(workspaceUserId, now)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}

async function sumTopUpGrantRemaining(env: AppEnv, workspaceUserId: string) {
  try {
    const row = await ensureDb(env)
      .prepare(
        `
          SELECT COALESCE(SUM(quantity_remaining), 0) AS total
          FROM evidence_top_up_grant
          WHERE workspace_user_id = ?
            AND status = 'active'
            AND quantity_remaining > 0
        `,
      )
      .bind(workspaceUserId)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}

export async function getEvidenceUsageSummary(env: AppEnv, workspaceUserId: string) {
  const plan = await readWorkspacePlanFamily(env, workspaceUserId);
  const period = await ensureCurrentEvidenceUsagePeriod(env, workspaceUserId, plan);
  const includedUsed = Number(period.included_consumed ?? 0);
  const includedAllowance = Number(period.included_allowance ?? 0);
  const includedRemaining = Math.max(0, includedAllowance - includedUsed);
  const now = nowIso();
  const [topUpRemaining, legacyTopUp] = await Promise.all([
    sumTopUpGrantRemaining(env, workspaceUserId),
    sumLegacyActiveTopUpCredits(env, workspaceUserId, now),
  ]);
  const topUpTotal = topUpRemaining + legacyTopUp;
  const totalAvailable = includedRemaining + topUpTotal;

  return {
    plan,
    periodStart: period.period_start,
    periodEnd: period.period_end,
    includedAllowance,
    includedUsed,
    includedRemaining,
    topUpRemaining: topUpTotal,
    topUpGrantRemaining: topUpRemaining,
    legacyTopUpRemaining: legacyTopUp,
    totalAvailable,
    nextPeriodStart: period.period_end,
    billableUnit: defineEvidenceCheckBillableUnit(),
  };
}

export async function listTopUpGrantHistory(env: AppEnv, workspaceUserId: string, limit = 50) {
  try {
    const result = await ensureDb(env)
      .prepare(
        `
          SELECT id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
                 quantity_granted, quantity_remaining, granted_at, status, catalog_version
          FROM evidence_top_up_grant
          WHERE workspace_user_id = ?
          ORDER BY granted_at DESC
          LIMIT ?
        `,
      )
      .bind(workspaceUserId, limit)
      .all<TopUpGrantRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function grantEvidenceTopUp(
  env: AppEnv,
  input: {
    workspaceUserId: string;
    skuSlug: string;
    providerPaymentId: string;
    providerProductId: string;
    quantityGranted: number;
    catalogVersion?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const id = createId();
  const grantedAt = nowIso();
  const quantity = Math.max(0, Math.floor(input.quantityGranted));
  await ensureDb(env)
    .prepare(
      `
        INSERT INTO evidence_top_up_grant (
          id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
          quantity_granted, quantity_remaining, granted_at, status, catalog_version, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(provider_payment_id) DO NOTHING
      `,
    )
    .bind(
      id,
      input.workspaceUserId,
      input.skuSlug,
      input.providerPaymentId,
      input.providerProductId,
      quantity,
      quantity,
      grantedAt,
      input.catalogVersion ?? "v1",
      JSON.stringify(input.metadata ?? {}),
    )
    .run();
}

export async function applyTopUpRefundAdjustment(
  env: AppEnv,
  input: {
    grantId: string;
    workspaceUserId: string;
    quantityDelta: number;
    reason: string;
    idempotencyKey: string;
    providerEventId?: string | null;
  },
) {
  const adjustmentId = createId();
  const createdAt = nowIso();
  const db = ensureDb(env);

  const insert = await db
    .prepare(
      `
        INSERT INTO evidence_top_up_adjustment (
          id, grant_id, workspace_user_id, quantity_delta, reason,
          provider_event_id, idempotency_key, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `,
    )
    .bind(
      adjustmentId,
      input.grantId,
      input.workspaceUserId,
      input.quantityDelta,
      input.reason,
      input.providerEventId ?? null,
      input.idempotencyKey,
      createdAt,
    )
    .run();

  if ((insert.meta?.changes ?? 0) === 0) {
    return { applied: false as const };
  }

  await db
    .prepare(
      `
        UPDATE evidence_top_up_grant
        SET quantity_remaining = MAX(0, quantity_remaining + ?),
            status = CASE
              WHEN MAX(0, quantity_remaining + ?) <= 0 THEN 'depleted'
              ELSE status
            END
        WHERE id = ?
      `,
    )
    .bind(input.quantityDelta, input.quantityDelta, input.grantId)
    .run();

  return { applied: true as const };
}

export type EvidenceReservationResult =
  | { ok: true; reservationId: string; pool: "included" | "top_up" }
  | { ok: false; reason: "exhausted" | "duplicate" | "unavailable" };

export async function reserveEvidenceCheck(
  env: AppEnv,
  input: {
    workspaceUserId: string;
    logicalOperationKey: string;
    source: string;
    now?: string;
  },
): Promise<EvidenceReservationResult> {
  const now = input.now ?? nowIso();
  const plan = await readWorkspacePlanFamily(env, input.workspaceUserId);
  const period = await ensureCurrentEvidenceUsagePeriod(env, input.workspaceUserId, plan);
  const db = ensureDb(env);

  const existing = await db
    .prepare(
      `
        SELECT id, status
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
        LIMIT 1
      `,
    )
    .bind(input.logicalOperationKey)
    .first<{ id: string; status: string }>();

  if (existing) {
    if (existing.status === "settled") {
      return { ok: false, reason: "duplicate" };
    }
    if (existing.status === "pending" && existing.id) {
      return { ok: true, reservationId: existing.id, pool: "included" };
    }
  }

  const includedRemaining =
    Number(period.included_allowance) - Number(period.included_consumed);
  const expiresAt = new Date(Date.parse(now) + RESERVATION_TTL_MS).toISOString();

  if (includedRemaining > 0) {
    const update = await db
      .prepare(
        `
          UPDATE evidence_usage_period
          SET included_consumed = included_consumed + 1
          WHERE id = ?
            AND included_consumed < included_allowance
        `,
      )
      .bind(period.id)
      .run();

    if ((update.meta?.changes ?? 0) === 1) {
      const reservationId = createId();
      await db
        .prepare(
          `
            INSERT INTO evidence_usage_reservation (
              id, workspace_user_id, usage_period_id, top_up_grant_id,
              logical_operation_key, quantity, status, reserved_at, expires_at, source
            )
            VALUES (?, ?, ?, NULL, ?, 1, 'pending', ?, ?, ?)
            ON CONFLICT(logical_operation_key) DO NOTHING
          `,
        )
        .bind(
          reservationId,
          input.workspaceUserId,
          period.id,
          input.logicalOperationKey,
          now,
          expiresAt,
          input.source,
        )
        .run();
      return { ok: true, reservationId, pool: "included" };
    }
  }

  const grant = await db
    .prepare(
      `
        SELECT id
        FROM evidence_top_up_grant
        WHERE workspace_user_id = ?
          AND status = 'active'
          AND quantity_remaining > 0
        ORDER BY granted_at ASC
        LIMIT 1
      `,
    )
    .bind(input.workspaceUserId)
    .first<{ id: string }>();

  if (grant?.id) {
    const debit = await db
      .prepare(
        `
          UPDATE evidence_top_up_grant
          SET quantity_remaining = quantity_remaining - 1,
              status = CASE WHEN quantity_remaining - 1 <= 0 THEN 'depleted' ELSE status END
          WHERE id = ?
            AND quantity_remaining > 0
        `,
      )
      .bind(grant.id)
      .run();

    if ((debit.meta?.changes ?? 0) === 1) {
      const reservationId = createId();
      await db
        .prepare(
          `
            INSERT INTO evidence_usage_reservation (
              id, workspace_user_id, usage_period_id, top_up_grant_id,
              logical_operation_key, quantity, status, reserved_at, expires_at, source
            )
            VALUES (?, ?, NULL, ?, ?, 1, 'pending', ?, ?, ?)
            ON CONFLICT(logical_operation_key) DO NOTHING
          `,
        )
        .bind(
          reservationId,
          input.workspaceUserId,
          grant.id,
          input.logicalOperationKey,
          now,
          expiresAt,
          input.source,
        )
        .run();
      return { ok: true, reservationId, pool: "top_up" };
    }
  }

  const legacy = await sumLegacyActiveTopUpCredits(env, input.workspaceUserId, now);
  if (legacy > 0) {
    return { ok: true, reservationId: createId(), pool: "top_up" };
  }

  return { ok: false, reason: "exhausted" };
}

export async function settleEvidenceReservation(
  env: AppEnv,
  logicalOperationKey: string,
  settledAt?: string,
) {
  await ensureDb(env)
    .prepare(
      `
        UPDATE evidence_usage_reservation
        SET status = 'settled',
            settled_at = ?
        WHERE logical_operation_key = ?
          AND status = 'pending'
      `,
    )
    .bind(settledAt ?? nowIso(), logicalOperationKey)
    .run();
}

export async function releaseEvidenceReservation(env: AppEnv, logicalOperationKey: string) {
  const db = ensureDb(env);
  const row = await db
    .prepare(
      `
        SELECT id, usage_period_id, top_up_grant_id, status
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
        LIMIT 1
      `,
    )
    .bind(logicalOperationKey)
    .first<ReservationRow>();

  if (!row || row.status !== "pending") return;

  const releasedAt = nowIso();
  await db
    .prepare(
      `
        UPDATE evidence_usage_reservation
        SET status = 'released',
            released_at = ?
        WHERE id = ?
      `,
    )
    .bind(releasedAt, row.id)
    .run();

  if (row.usage_period_id) {
    await db
      .prepare(
        `
          UPDATE evidence_usage_period
          SET included_consumed = CASE
            WHEN included_consumed > 0 THEN included_consumed - 1
            ELSE 0
          END
          WHERE id = ?
        `,
      )
      .bind(row.usage_period_id)
      .run();
  }

  if (row.top_up_grant_id) {
    await db
      .prepare(
        `
          UPDATE evidence_top_up_grant
          SET quantity_remaining = quantity_remaining + 1,
              status = 'active'
          WHERE id = ?
        `,
      )
      .bind(row.top_up_grant_id)
      .run();
  }
}

export async function reconcileStaleEvidenceReservations(env: AppEnv, now = nowIso()) {
  const db = ensureDb(env);
  const stale = await db
    .prepare(
      `
        SELECT logical_operation_key
        FROM evidence_usage_reservation
        WHERE status = 'pending'
          AND expires_at <= ?
        LIMIT 100
      `,
    )
    .bind(now)
    .all<{ logical_operation_key: string }>();

  for (const row of stale.results ?? []) {
    await releaseEvidenceReservation(env, row.logical_operation_key);
  }

  return (stale.results ?? []).length;
}

export function buildEvidenceLogicalOperationKey(input: {
  workspaceUserId: string;
  proofTargetId: string;
  idempotencyKey: string;
}) {
  return `evidence:${input.workspaceUserId}:${input.proofTargetId}:${input.idempotencyKey}`;
}
