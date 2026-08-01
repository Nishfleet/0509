import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
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
import { resolveMonitoringOrchestrationLeaseMs } from "~/lib/monitoring-fanout.server";

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
  expires_at: string;
  source: string;
  owner_run_id: string | null;
  owner_processing_token: string | null;
  owner_lease_seen_at: string | null;
}

export interface EvidenceFinalizationLease {
  runId: string;
  processingToken: string;
}

export class EvidenceTopUpReadError extends Error {
  override readonly name = "EvidenceTopUpReadError";

  constructor(message: string, cause: unknown) {
    super(message, { cause });
  }
}

export function isEvidenceTopUpReadError(
  error: unknown,
): error is EvidenceTopUpReadError {
  return error instanceof EvidenceTopUpReadError;
}

function createId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function reservationExpiry(now: string) {
  return new Date(Date.parse(now) + RESERVATION_TTL_MS).toISOString();
}

function activeWorkflowLeaseCutoff(env: AppEnv, now: string) {
  return new Date(Date.parse(now) - resolveMonitoringOrchestrationLeaseMs(env)).toISOString();
}

async function claimPendingReservationOwner(
  env: AppEnv,
  row: Pick<ReservationRow, "id" | "owner_run_id" | "owner_processing_token">,
  lease: EvidenceFinalizationLease | undefined,
  now: string,
) {
  if (!lease) {
    const result = await ensureDb(env)
      .prepare(
        `
          UPDATE evidence_usage_reservation
          SET expires_at = ?
          WHERE id = ?
            AND status = 'pending'
            AND source LIKE '%:atomic'
            AND owner_run_id IS NULL
            AND owner_processing_token IS NULL
            AND expires_at > ?
        `,
      )
      .bind(reservationExpiry(now), row.id, now)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  }

  const result = await ensureDb(env)
    .prepare(
      `
        UPDATE evidence_usage_reservation
        SET owner_run_id = ?,
            owner_processing_token = ?,
            owner_lease_seen_at = ?,
            expires_at = ?
        WHERE id = ?
          AND status = 'pending'
          AND source LIKE '%:atomic'
          AND (owner_run_id IS NULL OR owner_run_id = ?)
          AND EXISTS (
            SELECT 1
            FROM watchlist_run
            WHERE id = ?
              AND status = 'running'
              AND processing_token = ?
          )
      `,
    )
    .bind(
      lease.runId,
      lease.processingToken,
      now,
      reservationExpiry(now),
      row.id,
      lease.runId,
      lease.runId,
      lease.processingToken,
    )
    .run();

  return Number(result.meta?.changes ?? 0) === 1;
}

export function isEvidenceUsageStorageUnavailableError(message: string) {
  return (
    /D1 binding/i.test(message) ||
    /no such table:\s*(?:main\.)?(?:evidence_usage_period|evidence_usage_reservation|evidence_top_up_grant|evidence_top_up_adjustment|evidence_top_up_ledger_entry|proof_usage_credit|proof_usage_credit_migration)\b/i.test(
      message,
    )
  );
}

function isLegacyCreditSchemaCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*(?:main\.)?(?:proof_usage_credit|proof_usage_credit_migration)\b/i.test(
    message,
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
  } catch (error) {
    throw new EvidenceTopUpReadError("D1 top-up balance read failed", error);
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
  } catch (error) {
    if (isLegacyCreditSchemaCompatibilityError(error)) {
      return [];
    }
    throw new EvidenceTopUpReadError("D1 legacy top-up migration read failed", error);
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

  const results = await db.batch([
    db
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
      ),
    db
      .prepare(
        `
          UPDATE evidence_top_up_grant
          SET quantity_remaining = MAX(
                0,
                quantity_granted + COALESCE(
                  (SELECT SUM(quantity_delta)
                   FROM evidence_top_up_ledger_entry
                   WHERE grant_id = ?),
                  0
                )
              ),
              status = CASE
                WHEN MAX(
                  0,
                  quantity_granted + COALESCE(
                    (SELECT SUM(quantity_delta)
                     FROM evidence_top_up_ledger_entry
                     WHERE grant_id = ?),
                    0
                  )
                ) <= 0 THEN 'depleted'
                ELSE 'active'
              END
          WHERE id = ?
            AND workspace_user_id = ?
            AND EXISTS (
              SELECT 1
              FROM evidence_top_up_ledger_entry
              WHERE grant_id = ?
                AND idempotency_key = ?
            )
        `,
      )
      .bind(
        input.grantId,
        input.grantId,
        input.grantId,
        input.workspaceUserId,
        input.grantId,
        input.idempotencyKey,
      ),
  ]);

  return (Number(results[0]?.meta?.changes ?? 0) === 1
    ? { applied: true as const, entryId }
    : { applied: false as const });
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
  } catch (error) {
    throw new EvidenceTopUpReadError("D1 top-up history read failed", error);
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
    lease?: EvidenceFinalizationLease;
  },
): Promise<EvidenceReservationResult> {
  const now = input.now ?? nowIso();
  const plan = await readWorkspacePlanFamily(env, input.workspaceUserId);
  const period = await ensureCurrentEvidenceUsagePeriod(env, input.workspaceUserId, plan);
  const db = ensureDb(env);
  const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "?");
  const reservationSource = `${input.source}:atomic`;

  const existing = await db
    .prepare(
      `
        SELECT id, status, usage_period_id, top_up_grant_id, source, expires_at,
               owner_run_id, owner_processing_token, owner_lease_seen_at
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
      if (!existing.source?.endsWith(":atomic")) {
        return { ok: false, reason: "unavailable" };
      }
      if (!(await claimPendingReservationOwner(env, existing, input.lease, now))) {
        return { ok: false, reason: "unavailable" };
      }
      return {
        ok: true,
        reservationId: existing.id,
        pool: existing.top_up_grant_id ? "top_up" : "included",
      };
    }
    if (existing.status === "released") {
      // A release marker is terminal. Replacing it outside the same claim
      // transaction would let the old releaser return the replacement's
      // allowance. The caller must use a fresh logical key or surface this
      // operation for operator recovery.
      return { ok: false, reason: "unavailable" };
    }
  }

  const expiresAt = reservationExpiry(now);
  const ownerPredicate = input.lease
    ? `
              AND EXISTS (
                SELECT 1
                FROM watchlist_run
                WHERE id = ?
                  AND status = 'running'
                  AND processing_token = ?
              )`
    : "";
  const ownerPredicateBindings = input.lease
    ? [input.lease.runId, input.lease.processingToken]
    : [];

  // The reservation claim and included increment are one D1 transaction. A
  // same-key conflict has no row owned by this caller, so the guarded
  // increment is a no-op and the conflict winner is returned below.
  {
    const reservationId = createId();
    const results = await db.batch([
      db
        .prepare(
          `
            INSERT INTO evidence_usage_reservation (
              id, workspace_user_id, usage_period_id, top_up_grant_id,
              logical_operation_key, quantity, status, reserved_at, expires_at, source,
              owner_run_id, owner_processing_token, owner_lease_seen_at
            )
            SELECT ?, ?, ?, NULL, ?, 1, 'pending', ?, ?, ?, ?, ?, ?
            FROM evidence_usage_period
            WHERE id = ?
              AND included_consumed < included_allowance
              ${ownerPredicate}
              ${billingCanaryGuard}
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
          reservationSource,
          input.lease?.runId ?? null,
          input.lease?.processingToken ?? null,
          input.lease ? now : null,
          period.id,
          ...ownerPredicateBindings,
          ...(billingCanaryGuard ? [input.workspaceUserId] : []),
        ),
      db
        .prepare(
          `
            UPDATE evidence_usage_period
            SET included_consumed = included_consumed + 1
            WHERE id = ?
              AND included_consumed < included_allowance
              AND EXISTS (
                SELECT 1
                FROM evidence_usage_reservation
                WHERE id = ?
                  AND logical_operation_key = ?
                  AND usage_period_id = ?
                  AND status = 'pending'
              )
          `,
        )
        .bind(period.id, reservationId, input.logicalOperationKey, period.id),
    ]);

    if (Number(results[1]?.meta?.changes ?? 0) === 1) {
      return { ok: true, reservationId, pool: "included" };
    }

    const concurrent = await db
      .prepare(
        `
          SELECT id, status, usage_period_id, top_up_grant_id, source, expires_at,
                 owner_run_id, owner_processing_token, owner_lease_seen_at
          FROM evidence_usage_reservation
          WHERE logical_operation_key = ?
          LIMIT 1
        `,
      )
      .bind(input.logicalOperationKey)
      .first<ReservationRow & { status: string }>();
    if (concurrent?.status === "settled") {
      return { ok: false, reason: "duplicate" };
    }
    if (concurrent?.status === "pending") {
      if (!concurrent.source?.endsWith(":atomic")) {
        return { ok: false, reason: "unavailable" };
      }
      if (!(await claimPendingReservationOwner(env, concurrent, input.lease, now))) {
        return { ok: false, reason: "unavailable" };
      }
      return {
        ok: true,
        reservationId: concurrent.id,
        pool: concurrent.top_up_grant_id ? "top_up" : "included",
      };
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
    const consumptionKey = `reserve:${input.logicalOperationKey}:${grant.id}:${reservationId}`;
    const results = await db.batch([
      db
        .prepare(
          `
            INSERT INTO evidence_usage_reservation (
              id, workspace_user_id, usage_period_id, top_up_grant_id,
              logical_operation_key, quantity, status, reserved_at, expires_at, source,
              owner_run_id, owner_processing_token, owner_lease_seen_at
            )
            SELECT ?, ?, NULL, ?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?
            FROM evidence_top_up_grant
            WHERE id = ?
              AND workspace_user_id = ?
              AND quantity_granted + COALESCE(
                (SELECT SUM(quantity_delta)
                 FROM evidence_top_up_ledger_entry
                 WHERE grant_id = evidence_top_up_grant.id),
                0
              ) > 0
              ${ownerPredicate}
              ${billingCanaryGuard}
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
          reservationSource,
          input.lease?.runId ?? null,
          input.lease?.processingToken ?? null,
          input.lease ? now : null,
          grant.id,
          input.workspaceUserId,
          ...ownerPredicateBindings,
          ...(billingCanaryGuard ? [input.workspaceUserId] : []),
        ),
      db
        .prepare(
          `
            INSERT INTO evidence_top_up_ledger_entry (
              id, grant_id, workspace_user_id, quantity_delta, entry_type,
              reservation_id, idempotency_key, metadata_json, created_at
            )
            SELECT ?, ?, ?, -1, 'consumption', ?, ?, '{}', ?
            WHERE EXISTS (
              SELECT 1
              FROM evidence_usage_reservation
              WHERE id = ?
                AND logical_operation_key = ?
                AND top_up_grant_id = ?
                AND status = 'pending'
            )
            ON CONFLICT(idempotency_key) DO NOTHING
          `,
        )
        .bind(
          createId(),
          grant.id,
          input.workspaceUserId,
          reservationId,
          consumptionKey,
          now,
          reservationId,
          input.logicalOperationKey,
          grant.id,
        ),
      db
        .prepare(
          `
            UPDATE evidence_top_up_grant
            SET quantity_remaining = MAX(
                  0,
                  quantity_granted + COALESCE(
                    (SELECT SUM(quantity_delta)
                     FROM evidence_top_up_ledger_entry
                     WHERE grant_id = ?),
                    0
                  )
                ),
                status = CASE
                  WHEN MAX(
                    0,
                    quantity_granted + COALESCE(
                      (SELECT SUM(quantity_delta)
                       FROM evidence_top_up_ledger_entry
                       WHERE grant_id = ?),
                      0
                    )
                  ) <= 0 THEN 'depleted'
                  ELSE 'active'
                END
            WHERE id = ?
              AND workspace_user_id = ?
              AND EXISTS (
                SELECT 1
                FROM evidence_top_up_ledger_entry
                WHERE reservation_id = ?
                  AND idempotency_key = ?
              )
          `,
        )
        .bind(
          grant.id,
          grant.id,
          grant.id,
          input.workspaceUserId,
          reservationId,
          consumptionKey,
        ),
    ]);

    if (Number(results[1]?.meta?.changes ?? 0) === 1) {
      return { ok: true, reservationId, pool: "top_up" };
    }

    const concurrent = await db
      .prepare(
        `
          SELECT id, status, usage_period_id, top_up_grant_id, source, expires_at,
                 owner_run_id, owner_processing_token, owner_lease_seen_at
          FROM evidence_usage_reservation
          WHERE logical_operation_key = ?
          LIMIT 1
        `,
      )
      .bind(input.logicalOperationKey)
      .first<ReservationRow & { status: string }>();
    if (concurrent?.status === "settled") {
      return { ok: false, reason: "duplicate" };
    }
    if (concurrent?.status === "pending") {
      if (!concurrent.source?.endsWith(":atomic")) {
        return { ok: false, reason: "unavailable" };
      }
      if (!(await claimPendingReservationOwner(env, concurrent, input.lease, now))) {
        return { ok: false, reason: "unavailable" };
      }
      return {
        ok: true,
        reservationId: concurrent.id,
        pool: concurrent.top_up_grant_id ? "top_up" : "included",
      };
    }
  }

  return { ok: false, reason: "exhausted" };
}

export async function settleEvidenceReservation(
  env: AppEnv,
  logicalOperationKey: string,
  settledAt?: string,
  lease?: EvidenceFinalizationLease,
) {
  const db = ensureDb(env);
  const ownershipPredicate = lease
    ? `
          AND owner_run_id = ?
          AND owner_processing_token = ?
          AND EXISTS (
            SELECT 1
            FROM watchlist_run
            WHERE id = ?
              AND status = 'running'
              AND processing_token = ?
          )`
    : `
          AND owner_run_id IS NULL
          AND owner_processing_token IS NULL`;
  const ownershipBindings = lease
    ? [lease.runId, lease.processingToken, lease.runId, lease.processingToken]
    : [];
  const result = await db
    .prepare(
      `
        UPDATE evidence_usage_reservation
        SET status = 'settled',
            settled_at = ?
        WHERE logical_operation_key = ?
          AND status = 'pending'
          AND source LIKE '%:atomic'
          ${ownershipPredicate}
      `,
    )
    .bind(
      settledAt ?? nowIso(),
      logicalOperationKey,
      ...ownershipBindings,
    )
    .run();

  if (Number(result.meta?.changes ?? 0) > 0) {
    return true;
  }

  // A replay of the same successful proof is idempotent only when the
  // original atomic reservation is already settled. A released, missing, or
  // legacy reservation means quota ownership was lost, so callers must not
  // publish downstream customer effects.
  const current = await db
    .prepare(
      `
        SELECT status, source
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
          ${ownershipPredicate}
        LIMIT 1
      `,
    )
    .bind(
      logicalOperationKey,
      ...ownershipBindings,
    )
    .first<{ status: string; source: string | null }>();

  return current?.status === "settled" && current.source?.endsWith(":atomic") === true;
}

export async function releaseEvidenceReservation(
  env: AppEnv,
  logicalOperationKey: string,
  lease?: EvidenceFinalizationLease,
) {
  return releaseEvidenceReservationWithGuard(env, logicalOperationKey, { lease });
}

async function releaseEvidenceReservationWithGuard(
  env: AppEnv,
  logicalOperationKey: string,
  options: {
    lease?: EvidenceFinalizationLease;
    staleAt?: string;
  },
) {
  const db = ensureDb(env);
  const lease = options.lease;
  const activeOwnerCutoff = options.staleAt
    ? activeWorkflowLeaseCutoff(env, options.staleAt)
    : null;
  const row = await db
    .prepare(
      `
        SELECT id, usage_period_id, top_up_grant_id, workspace_user_id, status, expires_at,
               source, owner_run_id, owner_processing_token, owner_lease_seen_at
        FROM evidence_usage_reservation
        WHERE logical_operation_key = ?
        LIMIT 1
      `,
    )
    .bind(logicalOperationKey)
    .first<ReservationRow & { workspace_user_id: string }>();

  if (!row) return false;
  if (row.status !== "pending") {
    if (row.status !== "released") return false;
    if (options.staleAt) return false;
    if (!lease) {
      return row.owner_run_id === null && row.owner_processing_token === null;
    }
    if (
      row.owner_run_id !== lease.runId ||
      row.owner_processing_token !== lease.processingToken
    ) {
      return false;
    }
    const activeLease = await db
      .prepare(
        `
          SELECT id
          FROM watchlist_run
          WHERE id = ?
            AND status = 'running'
            AND processing_token = ?
          LIMIT 1
        `,
      )
      .bind(lease.runId, lease.processingToken)
      .first<{ id: string }>();
    return activeLease?.id === lease.runId;
  }

  // The unique marker makes the compensating statement belong only to the
  // CAS winner. Legacy rows without the atomic source marker are released
  // without guessing at quota ownership and remain operator-recoverable.
  const releasedAt = `${nowIso()}:${createId()}`;
  const guardPredicate = lease
    ? `
            AND owner_run_id = ?
            AND owner_processing_token = ?
            AND EXISTS (
              SELECT 1
              FROM watchlist_run
              WHERE id = ?
                AND status = 'running'
                AND processing_token = ?
            )`
    : options.staleAt
      ? `
            AND expires_at <= ?
            AND (
              (owner_run_id IS NULL AND owner_processing_token IS NULL)
              OR NOT EXISTS (
                SELECT 1
                FROM watchlist_run
                WHERE id = evidence_usage_reservation.owner_run_id
                  AND status = 'running'
                  AND processing_token = evidence_usage_reservation.owner_processing_token
                  AND processing_started_at IS NOT NULL
                  AND processing_started_at >= ?
              )
            )`
      : `
            AND owner_run_id IS NULL
            AND owner_processing_token IS NULL`;
  const guardBindings = lease
    ? [lease.runId, lease.processingToken, lease.runId, lease.processingToken]
    : options.staleAt
      ? [options.staleAt, activeOwnerCutoff]
      : [];
  const statements = [
    db
      .prepare(
        `
          UPDATE evidence_usage_reservation
            SET status = 'released',
              released_at = ?
          WHERE id = ?
            AND status = 'pending'
            ${guardPredicate}
        `,
      )
      .bind(
        releasedAt,
        row.id,
        ...guardBindings,
      ),
  ];

  if (row.usage_period_id) {
    statements.push(
      db
        .prepare(
          `
            UPDATE evidence_usage_period
            SET included_consumed = included_consumed - 1
            WHERE id = ?
              AND included_consumed > 0
              AND EXISTS (
                SELECT 1
                FROM evidence_usage_reservation
                WHERE id = ?
                  AND status = 'released'
                  AND released_at = ?
                  AND source LIKE '%:atomic'
              )
          `,
        )
        .bind(row.usage_period_id, row.id, releasedAt),
    );
  }

  if (row.top_up_grant_id) {
    const releaseKey = `release:${logicalOperationKey}`;
    statements.push(
      db
        .prepare(
          `
            INSERT INTO evidence_top_up_ledger_entry (
              id, grant_id, workspace_user_id, quantity_delta, entry_type,
              reservation_id, idempotency_key, metadata_json, created_at
            )
            SELECT ?, ?, ?, 1, 'release', ?, ?, '{}', ?
            WHERE EXISTS (
              SELECT 1
              FROM evidence_usage_reservation
              WHERE id = ?
                AND status = 'released'
                AND released_at = ?
                AND source LIKE '%:atomic'
            )
              AND NOT EXISTS (
                SELECT 1
                FROM evidence_top_up_ledger_entry
                WHERE grant_id = ?
                  AND entry_type = 'refund'
                  AND COALESCE(
                    json_extract(metadata_json, '$.reason'),
                    'full_provider_refund'
                  ) = 'full_provider_refund'
              )
            ON CONFLICT(idempotency_key) DO NOTHING
          `,
        )
        .bind(
          createId(),
          row.top_up_grant_id,
          row.workspace_user_id,
          row.id,
          releaseKey,
          nowIso(),
          row.id,
          releasedAt,
          row.top_up_grant_id,
        ),
      db
        .prepare(
          `
            UPDATE evidence_top_up_grant
            SET quantity_remaining = MAX(
                  0,
                  quantity_granted + COALESCE(
                    (SELECT SUM(quantity_delta)
                     FROM evidence_top_up_ledger_entry
                     WHERE grant_id = ?),
                    0
                  )
                ),
                status = CASE
                  WHEN MAX(
                    0,
                    quantity_granted + COALESCE(
                      (SELECT SUM(quantity_delta)
                       FROM evidence_top_up_ledger_entry
                       WHERE grant_id = ?),
                      0
                    )
                  ) <= 0 THEN 'depleted'
                  ELSE 'active'
                END
            WHERE id = ?
              AND workspace_user_id = ?
              AND EXISTS (
                SELECT 1
                FROM evidence_top_up_ledger_entry
                WHERE grant_id = ?
                  AND reservation_id = ?
                  AND idempotency_key = ?
              )
          `,
        )
        .bind(
          row.top_up_grant_id,
          row.top_up_grant_id,
          row.top_up_grant_id,
          row.workspace_user_id,
          row.top_up_grant_id,
          row.id,
          releaseKey,
        ),
    );
  }

  const results = await db.batch(statements);
  return Number(results[0]?.meta?.changes ?? 0) > 0;
}

export async function reconcileStaleEvidenceReservations(env: AppEnv, now = nowIso()) {
  const db = ensureDb(env);
  const activeOwnerCutoff = activeWorkflowLeaseCutoff(env, now);
  const stale = await db
    .prepare(
      `
        SELECT logical_operation_key
        FROM evidence_usage_reservation
        WHERE status = 'pending'
          AND expires_at <= ?
          AND (
            (owner_run_id IS NULL AND owner_processing_token IS NULL)
            OR NOT EXISTS (
              SELECT 1
              FROM watchlist_run
              WHERE id = evidence_usage_reservation.owner_run_id
                AND status = 'running'
                AND processing_token = evidence_usage_reservation.owner_processing_token
                AND processing_started_at IS NOT NULL
                AND processing_started_at >= ?
            )
          )
        LIMIT 100
      `,
    )
    .bind(now, activeOwnerCutoff)
    .all<{ logical_operation_key: string }>();

  let released = 0;
  for (const row of stale.results ?? []) {
    try {
      if (
        await releaseEvidenceReservationWithGuard(env, row.logical_operation_key, {
          staleAt: now,
        })
      ) {
        released += 1;
      }
    } catch (error) {
      // One poisoned compensation must not strand every later reservation in
      // the bounded sweep. D1 batch keeps this row pending for a later retry;
      // the stable key makes the failure observable without logging customer
      // or provider payloads.
      console.error("Evidence reservation reconciliation failed", {
        logicalOperationKey: row.logical_operation_key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return released;
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
    lease?: EvidenceFinalizationLease;
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
    lease: input.lease,
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
    lease?: EvidenceFinalizationLease;
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
  lease?: EvidenceFinalizationLease,
) {
  if (outcome === "succeeded") {
    return settleEvidenceReservation(env, logicalOperationKey, undefined, lease);
  }
  return tryReleaseEvidenceForProofCapture(env, logicalOperationKey, lease);
}

export async function tryReleaseEvidenceForProofCapture(
  env: AppEnv,
  logicalOperationKey: string,
  lease?: EvidenceFinalizationLease,
) {
  try {
    return await releaseEvidenceReservation(env, logicalOperationKey, lease);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }
    return false;
  }
}

export async function tryFinalizeEvidenceForProofCapture(
  env: AppEnv,
  logicalOperationKey: string,
  outcome: "succeeded" | "failed",
  lease?: EvidenceFinalizationLease,
) {
  try {
    return await finalizeEvidenceForProofCapture(env, logicalOperationKey, outcome, lease);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }
    return false;
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
