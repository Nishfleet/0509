import { ensureDb, queryAll, queryOne } from "~/lib/data/d1.server";
import { createId, createStableId, jsonValue, nowIso, parseJson } from "~/lib/data/helpers.server";
import {
  DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
} from "~/lib/data/billing-checkout.server";
import {
  buildWatchlistGrantReconcileStatements,
  syncWatchlistMentionTargetsIfChanged,
} from "~/lib/data/watchlist-plan-reconcile.server";
import type { AppEnv } from "~/lib/env.server";
import { getPlanLimit, type PaidPlanFamily } from "~/lib/plan-entitlements";

export type DodoPlanChangeReconciliationOutcome =
  | "accepted"
  | "scheduled"
  | "unchanged"
  | "unknown";

export interface DodoPlanChangeReconciliationInput {
  subjectUserId: string;
  actorUserId: string;
  subscriptionId: string;
  currentProductId: string;
  pendingProductId: string;
  claimedStatus: string;
  claimedAt: string;
  outcome: DodoPlanChangeReconciliationOutcome;
  targetPlan: PaidPlanFamily | null;
  providerStatus: string;
  providerProductId: string | null;
  scheduledChangeProductId: string | null;
  nextBillingAt: string | null;
  observedAt: string;
}

interface AuditRow {
  status: string;
  result_json: string | null;
}

const NON_RECONCILABLE_STATUSES = new Set([
  "checkout_pending",
  DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
  "payment.failed",
  "subscription.failed",
  "subscription.on_hold",
  "cancellation_scheduled",
]);

export function isDodoSubscriptionPlanChangeReconciliationDue(
  status: string | null | undefined,
  planUpdatedAt: string | null | undefined,
  planChangeProductId: string | null | undefined,
  now = Date.now(),
) {
  if (!planChangeProductId?.trim() || !status || NON_RECONCILABLE_STATUSES.has(status)) {
    return false;
  }
  const claimedAt = Date.parse(planUpdatedAt ?? "");
  return (
    Number.isFinite(claimedAt) &&
    now - claimedAt >= DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES * 60 * 1000
  );
}

export async function listStaleDodoSubscriptionPlanChangeClaims(
  env: AppEnv,
  options: { now?: string; limit?: number } = {},
) {
  const now = cleanIso(options.now ?? nowIso());
  if (!now) return [];
  const staleBefore = new Date(
    Date.parse(now) - DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES * 60 * 1000,
  ).toISOString();
  const rows = await queryAll<{
    user_id: string;
    plan: PaidPlanFamily;
    dodo_status: string;
    plan_updated_at: string;
  }>(
    env,
    `
      SELECT user_id, plan, dodo_status, plan_updated_at
      FROM user_plan
      WHERE plan IN ('scout', 'starter', 'agency')
        AND dodo_subscription_id IS NOT NULL
        AND dodo_product_id IS NOT NULL
        AND dodo_plan_change_product_id IS NOT NULL
        AND length(trim(dodo_plan_change_product_id)) > 0
        AND dodo_status IS NOT NULL
        AND dodo_status NOT IN (
          'checkout_pending', 'plan_change_scheduled', 'payment.failed',
          'subscription.failed', 'subscription.on_hold', 'cancellation_scheduled'
        )
        AND julianday(plan_updated_at) <= julianday(?)
      ORDER BY plan_updated_at ASC
      LIMIT ?
    `,
    staleBefore,
    Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))),
  );
  return rows.map((row) => ({
    userId: row.user_id,
    plan: row.plan,
    status: row.dodo_status,
    claimedAt: row.plan_updated_at,
  }));
}

export async function reconcileDodoSubscriptionPlanChangeWithAudit(
  env: AppEnv,
  input: DodoPlanChangeReconciliationInput,
) {
  const normalized = normalizeInput(input);
  if (!normalized) return { ok: false as const, reason: "invalid" as const };

  const db = ensureDb(env);
  if (typeof db.batch !== "function") {
    throw new Error("Atomic D1 batch support is required for Dodo plan-change reconciliation.");
  }

  const reconciledAt = nowIso();
  const idempotencyKey = await createStableId("billing-plan-change-reconcile", [
    normalized.actorUserId,
    normalized.subjectUserId,
    normalized.subscriptionId,
    normalized.claimedAt,
    normalized.outcome,
    normalized.providerStatus,
    normalized.providerProductId,
    normalized.scheduledChangeProductId,
    normalized.observedAt,
  ]);
  const auditId = createId();
  const result = {
    subjectUserId: normalized.subjectUserId,
    subscriptionId: normalized.subscriptionId,
    outcome: normalized.outcome,
    providerStatus: normalized.providerStatus,
    providerProductId: normalized.providerProductId,
    scheduledChangeProductId: normalized.scheduledChangeProductId,
    observedAt: normalized.observedAt,
    reconciledAt,
  };
  const audit = db
    .prepare(
      `
        INSERT OR IGNORE INTO agent_action_audit (
          id, user_id, api_key_id, action_name, resource_type, resource_id,
          idempotency_key, status, result_json, error_code, error_message,
          metadata_json, created_at, updated_at
        )
        SELECT ?, ?, NULL, 'billing.plan_change.reconcile', 'user_plan', ?,
          ?, 'succeeded', ?, NULL, NULL, ?, ?, ?
        FROM user_plan
        WHERE user_id = ?
          AND dodo_subscription_id = ?
          AND dodo_product_id = ?
          AND dodo_plan_change_product_id = ?
          AND dodo_status = ?
          AND plan_updated_at = ?
      `,
    )
    .bind(
      auditId,
      normalized.actorUserId,
      normalized.subjectUserId,
      idempotencyKey,
      jsonValue(result),
      jsonValue({
        reconciliationMode: "provider_state_read_only",
        providerObservedAt: normalized.observedAt,
        providerStatus: normalized.providerStatus,
      }),
      reconciledAt,
      reconciledAt,
      normalized.subjectUserId,
      normalized.subscriptionId,
      normalized.currentProductId,
      normalized.pendingProductId,
      normalized.claimedStatus,
      normalized.claimedAt,
    );

  const statements: D1PreparedStatement[] = [audit];
  let effectIndex: number | null = null;
  let watchlistIndexes: number[] = [];
  if (normalized.outcome !== "unknown") {
    effectIndex = statements.length;
    statements.push(buildEffectStatement(db, normalized, auditId, reconciledAt));
    if (normalized.outcome === "accepted" && normalized.targetPlan) {
      watchlistIndexes = [statements.length, statements.length + 1];
      statements.push(
        ...buildWatchlistGrantReconcileStatements(
          db,
          normalized.subjectUserId,
          getPlanLimit(normalized.targetPlan, "watchlists"),
          reconciledAt,
          {
            plan: normalized.targetPlan,
            status: "active",
            planUpdatedAt: reconciledAt,
          },
        ),
      );
    }
  }

  const batch = await db.batch(statements);
  const auditCreated = Number(batch[0]?.meta?.changes ?? 0) === 1;
  const effectUpdated = effectIndex === null
    ? auditCreated
    : Number(batch[effectIndex]?.meta?.changes ?? 0) === 1;
  if (auditCreated !== effectUpdated) {
    throw new Error("Dodo plan-change reconciliation audit/effect integrity check failed.");
  }
  if (auditCreated) {
    if (watchlistIndexes.length) {
      await syncWatchlistMentionTargetsIfChanged(
        env,
        normalized.subjectUserId,
        reconciledAt,
        batch,
        watchlistIndexes,
      );
    }
    return { ok: true as const, replayed: false, ...result };
  }

  const existingAudit = await queryOne<AuditRow>(
    env,
    `SELECT status, result_json
     FROM agent_action_audit
     WHERE user_id = ? AND idempotency_key = ?
     LIMIT 1`,
    normalized.actorUserId,
    idempotencyKey,
  );
  const prior = parseJson<Record<string, unknown> | null>(existingAudit?.result_json, null);
  if (
    existingAudit?.status === "succeeded" &&
    prior?.subjectUserId === normalized.subjectUserId &&
    prior?.subscriptionId === normalized.subscriptionId &&
    prior?.outcome === normalized.outcome
  ) {
    return {
      ok: true as const,
      replayed: true,
      ...result,
      reconciledAt:
        typeof prior.reconciledAt === "string" ? prior.reconciledAt : reconciledAt,
    };
  }
  return existingAudit
    ? { ok: false as const, reason: "idempotency_conflict" as const }
    : { ok: false as const, reason: "stale" as const };
}

function buildEffectStatement(
  db: ReturnType<typeof ensureDb>,
  input: ReturnType<typeof normalizeInput> & {},
  auditId: string,
  reconciledAt: string,
) {
  if (!input) throw new Error("Invalid Dodo plan-change reconciliation input.");
  const commonWhere = `
    WHERE user_id = ?
      AND dodo_subscription_id = ?
      AND dodo_product_id = ?
      AND dodo_plan_change_product_id = ?
      AND dodo_status = ?
      AND plan_updated_at = ?
      AND EXISTS (
        SELECT 1 FROM agent_action_audit
        WHERE id = ? AND status = 'succeeded'
      )
  `;
  const commonBindings = [
    input.subjectUserId,
    input.subscriptionId,
    input.currentProductId,
    input.pendingProductId,
    input.claimedStatus,
    input.claimedAt,
    auditId,
  ];

  if (input.outcome === "accepted") {
    return db.prepare(`
      UPDATE user_plan
      SET plan = ?, dodo_product_id = ?, dodo_status = 'active',
          dodo_next_billing_at = COALESCE(?, dodo_next_billing_at),
          dodo_plan_change_product_id = NULL, plan_updated_at = ?
      ${commonWhere}
    `).bind(
      input.targetPlan,
      input.pendingProductId,
      input.nextBillingAt,
      reconciledAt,
      ...commonBindings,
    );
  }
  if (input.outcome === "scheduled") {
    return db.prepare(`
      UPDATE user_plan
      SET dodo_status = ?,
          dodo_next_billing_at = COALESCE(?, dodo_next_billing_at),
          plan_updated_at = ?
      ${commonWhere}
    `).bind(
      DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
      input.nextBillingAt,
      reconciledAt,
      ...commonBindings,
    );
  }
  return db.prepare(`
    UPDATE user_plan
    SET dodo_status = 'active',
        dodo_next_billing_at = COALESCE(?, dodo_next_billing_at),
        dodo_plan_change_product_id = NULL, plan_updated_at = ?
    ${commonWhere}
  `).bind(input.nextBillingAt, reconciledAt, ...commonBindings);
}

function normalizeInput(input: DodoPlanChangeReconciliationInput) {
  const subjectUserId = input.subjectUserId.trim();
  const actorUserId = input.actorUserId.trim();
  const subscriptionId = input.subscriptionId.trim();
  const currentProductId = input.currentProductId.trim();
  const pendingProductId = input.pendingProductId.trim();
  const claimedStatus = input.claimedStatus.trim();
  const claimedAt = cleanIso(input.claimedAt);
  const observedAt = cleanIso(input.observedAt);
  const nextBillingAt = input.nextBillingAt ? cleanIso(input.nextBillingAt) : null;
  const providerStatus = input.providerStatus.trim().toLowerCase();
  const providerProductId = input.providerProductId?.trim() || null;
  const scheduledChangeProductId = input.scheduledChangeProductId?.trim() || null;
  const targetPlan = input.targetPlan;
  const outcomeValid =
    input.outcome === "unknown" ||
    (providerStatus === "active" &&
      (input.outcome === "accepted"
        ? Boolean(targetPlan && providerProductId === pendingProductId)
        : input.outcome === "scheduled"
          ? Boolean(targetPlan && scheduledChangeProductId === pendingProductId)
          : providerProductId === currentProductId && !scheduledChangeProductId));
  if (
    !subjectUserId ||
    !actorUserId ||
    !subscriptionId ||
    !currentProductId ||
    !pendingProductId ||
    !claimedStatus ||
    !claimedAt ||
    !observedAt ||
    !providerStatus ||
    !outcomeValid ||
    (input.nextBillingAt && !nextBillingAt)
  ) {
    return null;
  }
  return {
    ...input,
    subjectUserId,
    actorUserId,
    subscriptionId,
    currentProductId,
    pendingProductId,
    claimedStatus,
    claimedAt,
    observedAt,
    nextBillingAt,
    providerStatus,
    providerProductId,
    scheduledChangeProductId,
    targetPlan,
  };
}

function cleanIso(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
