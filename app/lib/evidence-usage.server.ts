import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import {
  getIncludedEvidenceAllowance,
  isPaidPlanFamily,
  parsePlanFamily,
  type PlanFamily,
} from "~/lib/plan-entitlements";
import { defineEvidenceCheckBillableUnit, topUpSpendRequiresActivePaidPlan } from "~/lib/evidence-usage-policies.server";
import {
  ensureCurrentEvidenceUsagePeriod,
  ensureWorkspaceEntitlementAnchor,
} from "~/lib/evidence-usage-period.server";
import { getUserPlan } from "~/lib/plan.server";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export { defineEvidenceCheckBillableUnit };
export {
  addSubscriptionMonthsUtc,
  clampAnniversaryUtcDay,
  computeSubscriptionPeriodBounds,
  ensureCurrentEvidenceUsagePeriod,
  ensureWorkspaceEntitlementAnchor,
} from "~/lib/evidence-usage-period.server";

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
}

function createId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

export function isEvidenceUsageStorageUnavailableError(message: string) {
  return (
    /D1 binding/i.test(message) ||
    /no such table:\s*(?:main\.)?(?:evidence_usage_period|evidence_usage_reservation|evidence_top_up_grant|evidence_top_up_adjustment|evidence_top_up_ledger_entry|proof_usage_credit|proof_usage_credit_migration)\b/i.test(
      message,
    )
  );
}

async function readWorkspacePlanFamily(env: AppEnv, workspaceUserId: string): Promise<PlanFamily> {
  return getUserPlan(env, workspaceUserId);
}

async function sumLedgerDeltaForGrant(env: AppEnv, grantId: string) {
  try {
    const row = await ensureDb(env)
      .prepare(
        `
          SELECT COALESCE(SUM(quantity_delta), 0) AS total
          FROM evidence_top_up_ledger_entry
          WHERE grant_id = ?
        `,
      )
      .bind(grantId)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  } catch {
    return null;
  }
}

export async function rebuildTopUpGrantBalance(env: AppEnv, grantId: string) {
  const grant = await ensureDb(env)
    .prepare(
      `
        SELECT id, quantity_granted, quantity_remaining
        FROM evidence_top_up_grant
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(grantId)
    .first<{ id: string; quantity_granted: number; quantity_remaining: number }>();

  if (!grant) return null;

  const ledgerDelta = await sumLedgerDeltaForGrant(env, grantId);
  if (ledgerDelta === null) {
    return Number(grant.quantity_remaining ?? 0);
  }

  const derived = Math.max(0, Number(grant.quantity_granted) + ledgerDelta);
  return derived;
}

async function listActiveTopUpGrants(env: AppEnv, workspaceUserId: string) {
  try {
    const result = await ensureDb(env)
      .prepare(
        `
          SELECT id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
                 quantity_granted, quantity_remaining, granted_at, status, catalog_version
          FROM evidence_top_up_grant
          WHERE workspace_user_id = ?
            AND status IN ('active', 'depleted')
          ORDER BY granted_at ASC
        `,
      )
      .bind(workspaceUserId)
      .all<TopUpGrantRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

async function getTopUpGrantByProviderPaymentId(env: AppEnv, providerPaymentId: string) {
  return ensureDb(env)
    .prepare(
      `
        SELECT id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
               quantity_granted, quantity_remaining, granted_at, status, catalog_version
        FROM evidence_top_up_grant
        WHERE provider_payment_id = ?
        LIMIT 1
      `,
    )
    .bind(providerPaymentId)
    .first<TopUpGrantRow>();
}

async function deriveTopUpRemainingForGrant(env: AppEnv, grant: TopUpGrantRow) {
  const rebuilt = await rebuildTopUpGrantBalance(env, grant.id);
  if (rebuilt === null) {
    return grant.status === "active" ? Math.max(0, Number(grant.quantity_remaining ?? 0)) : 0;
  }
  return rebuilt;
}

async function sumDerivedTopUpRemaining(env: AppEnv, workspaceUserId: string) {
  const grants = await listActiveTopUpGrants(env, workspaceUserId);
  let total = 0;
  for (const grant of grants) {
    total += await deriveTopUpRemainingForGrant(env, grant);
  }
  return total;
}

async function listUnmigratedLegacyCredits(env: AppEnv, workspaceUserId: string, now: string) {
  try {
    const result = await ensureDb(env)
      .prepare(
        `
          SELECT p.id, p.user_id, p.credits, p.provider_payment_id, p.granted_at, p.expires_at
          FROM proof_usage_credit p
          LEFT JOIN proof_usage_credit_migration m ON m.legacy_credit_id = p.id
          WHERE p.user_id = ?
            AND m.legacy_credit_id IS NULL
            AND p.expires_at > ?
            AND p.credits > 0
        `,
      )
      .bind(workspaceUserId, now)
      .all<{
        id: string;
        user_id: string;
        credits: number;
        provider_payment_id: string | null;
        granted_at: string;
      }>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function migrateLegacyTopUpCreditsIfNeeded(env: AppEnv, workspaceUserId: string) {
  const now = nowIso();
  const legacyRows = await listUnmigratedLegacyCredits(env, workspaceUserId, now);
  if (legacyRows.length === 0) return { migrated: 0 };

  let migrated = 0;
  for (const row of legacyRows) {
    const paymentId = row.provider_payment_id?.trim() || `legacy-credit:${row.id}`;
    const idempotencyKey = `legacy-migrate:${row.id}`;
    const grantId = createId();
    const grantedAt = row.granted_at || now;

    await ensureDb(env)
      .prepare(
        `
          INSERT INTO evidence_top_up_grant (
            id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
            quantity_granted, quantity_remaining, granted_at, status, catalog_version, metadata_json
          )
          VALUES (?, ?, 'legacy_migrated_v1', ?, 'legacy', ?, ?, ?, 'active', 'legacy', ?)
          ON CONFLICT(provider_payment_id) DO NOTHING
        `,
      )
      .bind(
        grantId,
        workspaceUserId,
        paymentId,
        row.credits,
        row.credits,
        grantedAt,
        JSON.stringify({ legacyCreditId: row.id }),
      )
      .run();

    const grant = await getTopUpGrantByProviderPaymentId(env, paymentId);
    if (!grant) {
      continue;
    }

    const migrationInsert = await ensureDb(env)
      .prepare(
        `
          INSERT INTO proof_usage_credit_migration (
            legacy_credit_id, grant_id, workspace_user_id, migrated_at, idempotency_key
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(legacy_credit_id) DO NOTHING
        `,
      )
      .bind(row.id, grant.id, workspaceUserId, now, idempotencyKey)
      .run();

    if ((migrationInsert.meta?.changes ?? 0) === 0) {
      continue;
    }

    migrated += 1;
  }

  return { migrated };
}

async function appendTopUpLedgerEntry(
  env: AppEnv,
  input: {
    grantId: string;
    workspaceUserId: string;
    quantityDelta: number;
    entryType: "consumption" | "release" | "refund" | "adjustment";
    reservationId?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  const db = ensureDb(env);
  const entryId = createId();
  const createdAt = nowIso();

  const insert = await db
    .prepare(
      `
        INSERT INTO evidence_top_up_ledger_entry (
          id, grant_id, workspace_user_id, quantity_delta, entry_type,
          reservation_id, idempotency_key, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `,
    )
    .bind(
      entryId,
      input.grantId,
      input.workspaceUserId,
      input.quantityDelta,
      input.entryType,
      input.reservationId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.metadata ?? {}),
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
              ELSE 'active'
            END
        WHERE id = ?
      `,
    )
    .bind(input.quantityDelta, input.quantityDelta, input.grantId)
    .run();

  return { applied: true as const, entryId };
}

export async function getEvidenceUsageSummary(env: AppEnv, workspaceUserId: string) {
  await migrateLegacyTopUpCreditsIfNeeded(env, workspaceUserId);
  const plan = await readWorkspacePlanFamily(env, workspaceUserId);
  const period = await ensureCurrentEvidenceUsagePeriod(env, workspaceUserId, plan);
  const includedUsed = Number(period.included_consumed ?? 0);
  const includedAllowance = Number(period.included_allowance ?? 0);
  const includedRemaining = Math.max(0, includedAllowance - includedUsed);
  const topUpRemaining = await sumDerivedTopUpRemaining(env, workspaceUserId);
  const canSpendTopUps = topUpSpendRequiresActivePaidPlan(plan);
  const spendableTopUp = canSpendTopUps ? topUpRemaining : 0;
  const totalAvailable = includedRemaining + spendableTopUp;

  return {
    plan,
    periodStart: period.period_start,
    periodEnd: period.period_end,
    includedAllowance,
    includedUsed,
    includedRemaining,
    topUpRemaining,
    topUpSpendable: spendableTopUp,
    topUpRetainedWhileInactive: !canSpendTopUps ? topUpRemaining : 0,
    totalAvailable,
    nextPeriodStart: period.period_end,
    canSpendTopUps,
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
  return appendTopUpLedgerEntry(env, {
    grantId: input.grantId,
    workspaceUserId: input.workspaceUserId,
    quantityDelta: input.quantityDelta,
    entryType: "refund",
    idempotencyKey: input.idempotencyKey,
    metadata: {
      reason: input.reason,
      providerEventId: input.providerEventId ?? null,
    },
  });
}

export type EvidenceReservationResult =
  | { ok: true; reservationId: string; pool: "included" | "top_up" }
  | { ok: false; reason: "exhausted" | "duplicate" | "unavailable" | "top_up_inactive_plan" };

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
        SELECT id, status, usage_period_id, top_up_grant_id
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
        LIMIT 1
      `,
    )
    .bind(input.logicalOperationKey)
    .first<ReservationRow & { status: string }>();

  if (existing) {
    if (existing.status === "settled") {
      return { ok: false, reason: "duplicate" };
    }
    if (existing.status === "pending") {
      return {
        ok: true,
        reservationId: existing.id,
        pool: existing.top_up_grant_id ? "top_up" : "included",
      };
    }
  }

  const includedRemaining = Number(period.included_allowance) - Number(period.included_consumed);
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

  if (!topUpSpendRequiresActivePaidPlan(plan)) {
    if ((await sumDerivedTopUpRemaining(env, input.workspaceUserId)) > 0) {
      return { ok: false, reason: "top_up_inactive_plan" };
    }
    return { ok: false, reason: "exhausted" };
  }

  const grants = await listActiveTopUpGrants(env, input.workspaceUserId);
  for (const grant of grants) {
    const remaining = await deriveTopUpRemainingForGrant(env, grant);
    if (remaining <= 0) continue;

    const reservationId = createId();
    const ledger = await appendTopUpLedgerEntry(env, {
      grantId: grant.id,
      workspaceUserId: input.workspaceUserId,
      quantityDelta: -1,
      entryType: "consumption",
      reservationId,
      idempotencyKey: `reserve:${input.logicalOperationKey}:${grant.id}`,
    });

    if (!ledger.applied) continue;

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
        SELECT id, usage_period_id, top_up_grant_id, workspace_user_id, status
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
        LIMIT 1
      `,
    )
    .bind(logicalOperationKey)
    .first<ReservationRow & { workspace_user_id: string }>();

  if (!row || row.status !== "pending") return;

  const releasedAt = nowIso();
  await db
    .prepare(
      `
        UPDATE evidence_usage_reservation
        SET status = 'released',
            released_at = ?
        WHERE id = ?
          AND status = 'pending'
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
    await appendTopUpLedgerEntry(env, {
      grantId: row.top_up_grant_id,
      workspaceUserId: row.workspace_user_id,
      quantityDelta: 1,
      entryType: "release",
      reservationId: row.id,
      idempotencyKey: `release:${logicalOperationKey}`,
    });
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

export async function reserveEvidenceForProofCapture(
  env: AppEnv,
  input: {
    workspaceUserId: string;
    proofTargetId: string;
    idempotencyKey: string;
    source: string;
  },
) {
  const logicalOperationKey = buildEvidenceLogicalOperationKey({
    workspaceUserId: input.workspaceUserId,
    proofTargetId: input.proofTargetId,
    idempotencyKey: input.idempotencyKey,
  });
  const result = await reserveEvidenceCheck(env, {
    workspaceUserId: input.workspaceUserId,
    logicalOperationKey,
    source: input.source,
  });
  return { result, logicalOperationKey };
}

export async function tryReserveEvidenceForProofCapture(
  env: AppEnv,
  input: {
    workspaceUserId: string;
    proofTargetId: string;
    idempotencyKey: string;
    source: string;
  },
) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return null;
  }

  try {
    return await reserveEvidenceForProofCapture(env, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isEvidenceUsageStorageUnavailableError(message)) {
      return null;
    }
    throw error;
  }
}

export async function finalizeEvidenceForProofCapture(
  env: AppEnv,
  logicalOperationKey: string,
  outcome: "succeeded" | "failed",
) {
  if (outcome === "succeeded") {
    await settleEvidenceReservation(env, logicalOperationKey);
    return;
  }
  await tryReleaseEvidenceForProofCapture(env, logicalOperationKey);
}

export async function tryReleaseEvidenceForProofCapture(
  env: AppEnv,
  logicalOperationKey: string,
) {
  try {
    await releaseEvidenceReservation(env, logicalOperationKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }
  }
}

export async function tryFinalizeEvidenceForProofCapture(
  env: AppEnv,
  logicalOperationKey: string,
  outcome: "succeeded" | "failed",
) {
  try {
    await finalizeEvidenceForProofCapture(env, logicalOperationKey, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }
  }
}

/** @deprecated Use computeSubscriptionPeriodBounds — kept for transitional tests. */
export function utcCalendarMonthBounds(at: Date = new Date()) {
  const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

export async function rebuildWorkspaceTopUpBalance(env: AppEnv, workspaceUserId: string) {
  const grants = await listActiveTopUpGrants(env, workspaceUserId);
  let total = 0;
  for (const grant of grants) {
    total += (await rebuildTopUpGrantBalance(env, grant.id)) ?? 0;
  }
  return total;
}

export function workspaceHasPaidPlanForTopUps(plan: PlanFamily) {
  return isPaidPlanFamily(plan) && topUpSpendRequiresActivePaidPlan(plan);
}
