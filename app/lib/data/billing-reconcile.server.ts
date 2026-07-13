import { ensureDb } from "~/lib/data/d1.server";
import { nowIso } from "~/lib/data/helpers.server";
import { validIsoTimestamp } from "~/lib/data/billing-helpers.server";
import {
  buildDodoWebhookLedgerFinalizeAfterChangedStatement,
  buildDodoWebhookLedgerFinalizeStatement,
  type DodoWebhookLedgerFinalize,
} from "~/lib/data/billing-webhook-ledger.server";
import {
  buildWatchlistGrantReconcileStatements,
  buildWatchlistRevokeReconcileStatement,
  syncWatchlistMentionTargetsIfChanged,
} from "~/lib/data/watchlist-plan-reconcile.server";
import type { AppEnv } from "~/lib/env.server";

type GrantDodoPlanAccessInput = Parameters<
  typeof import("~/lib/data/billing-plan.server").grantDodoPlanAccess
>[1];
type RevokeDodoPlanAccessInput = Parameters<
  typeof import("~/lib/data/billing-plan.server").revokeDodoPlanAccess
>[1];
type MarkDodoPlanPaymentIssueInput = Parameters<
  typeof import("~/lib/data/billing-plan.server").markDodoPlanPaymentIssue
>[1];

export async function applyDodoPlanGrantWithWatchlistReconcile(
  env: AppEnv,
  input: GrantDodoPlanAccessInput,
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.grantedAt) ?? nowIso();
  const timestamp = nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));

  const grantStatement = db.prepare(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_next_billing_at,
        dodo_plan_change_product_id,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        plan = excluded.plan,
        dodo_payment_id = CASE
          WHEN excluded.dodo_payment_id IS NOT NULL THEN excluded.dodo_payment_id
          WHEN user_plan.dodo_status = 'checkout_pending' THEN NULL
          ELSE user_plan.dodo_payment_id
        END,
        dodo_product_id = COALESCE(excluded.dodo_product_id, user_plan.dodo_product_id),
        dodo_subscription_id = COALESCE(excluded.dodo_subscription_id, user_plan.dodo_subscription_id),
        dodo_customer_id = COALESCE(excluded.dodo_customer_id, user_plan.dodo_customer_id),
        dodo_next_billing_at = COALESCE(excluded.dodo_next_billing_at, user_plan.dodo_next_billing_at),
        dodo_plan_change_product_id = CASE
          WHEN user_plan.dodo_status IN (
              'plan_change_pending',
              'plan_change_scheduled',
              'payment.failed',
              'subscription.failed',
              'subscription.on_hold'
            )
            AND excluded.dodo_payment_id IS NOT NULL
            AND user_plan.dodo_plan_change_product_id = excluded.dodo_product_id
            AND (
              excluded.dodo_subscription_id IS NULL
              OR user_plan.dodo_subscription_id = excluded.dodo_subscription_id
            )
            AND (
              excluded.dodo_customer_id IS NULL
              OR user_plan.dodo_customer_id IS NULL
              OR user_plan.dodo_customer_id = excluded.dodo_customer_id
            )
          THEN user_plan.dodo_plan_change_product_id
          ELSE NULL
        END,
        dodo_status = excluded.dodo_status,
        plan_updated_at = excluded.plan_updated_at
      WHERE
        (
          ? = 0
          AND julianday(excluded.plan_updated_at) >= julianday(user_plan.plan_updated_at)
        )
        OR (
          (
            ? = 1
            OR
            user_plan.dodo_status IN (
              'plan_change_pending',
              'plan_change_scheduled',
              'payment.failed',
              'subscription.failed',
              'subscription.on_hold'
            )
            OR (
              user_plan.dodo_status IN ('succeeded', 'payment.succeeded')
              AND user_plan.dodo_product_id = excluded.dodo_product_id
            )
          )
          AND user_plan.dodo_plan_change_product_id = excluded.dodo_product_id
          AND (
            excluded.dodo_subscription_id IS NULL
            OR user_plan.dodo_subscription_id = excluded.dodo_subscription_id
          )
          AND (
            excluded.dodo_customer_id IS NULL
            OR user_plan.dodo_customer_id IS NULL
            OR user_plan.dodo_customer_id = excluded.dodo_customer_id
          )
        )
    `).bind(
    input.userId,
    input.plan,
    input.providerPaymentId ?? null,
    input.providerProductId ?? null,
    input.providerSubscriptionId ?? null,
    input.providerCustomerId ?? null,
    input.nextBillingAt ?? null,
    null,
    input.status,
    planUpdatedAt,
    input.requirePlanChangePending ? 1 : 0,
    input.forcePlanChangePending ? 1 : 0,
  );

  if (input.requirePlanChangePending) {
    const guardedGrantStatement = db.prepare(`
      UPDATE user_plan
      SET plan = ?,
          dodo_payment_id = CASE
            WHEN ? IS NOT NULL THEN ?
            WHEN dodo_status = 'checkout_pending' THEN NULL
            ELSE dodo_payment_id
          END,
          dodo_product_id = COALESCE(?, dodo_product_id),
          dodo_subscription_id = COALESCE(?, dodo_subscription_id),
          dodo_customer_id = COALESCE(?, dodo_customer_id),
          dodo_next_billing_at = COALESCE(?, dodo_next_billing_at),
          dodo_plan_change_product_id = CASE
            WHEN dodo_status IN (
                'plan_change_pending',
                'plan_change_scheduled',
                'payment.failed',
                'subscription.failed',
                'subscription.on_hold'
              )
              AND ? IS NOT NULL
              AND dodo_plan_change_product_id = ?
              AND (
                ? IS NULL
                OR dodo_subscription_id = ?
              )
              AND (
                ? IS NULL
                OR dodo_customer_id IS NULL
                OR dodo_customer_id = ?
              )
            THEN dodo_plan_change_product_id
            ELSE NULL
          END,
          dodo_status = ?,
          plan_updated_at = ?
      WHERE user_id = ?
        AND (
          dodo_status IN (
            'plan_change_pending',
            'plan_change_scheduled',
            'payment.failed',
            'subscription.failed',
            'subscription.on_hold'
          )
          OR (
            dodo_status IN ('succeeded', 'payment.succeeded')
            AND dodo_product_id = ?
          )
        )
        AND dodo_plan_change_product_id = ?
        AND (
          ? IS NULL
          OR dodo_subscription_id = ?
        )
        AND (
          ? IS NULL
          OR dodo_customer_id IS NULL
          OR dodo_customer_id = ?
        )
    `).bind(
      input.plan,
      input.providerPaymentId ?? null,
      input.providerPaymentId ?? null,
      input.providerProductId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerCustomerId ?? null,
      input.nextBillingAt ?? null,
      input.providerPaymentId ?? null,
      input.providerProductId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerCustomerId ?? null,
      input.providerCustomerId ?? null,
      input.status,
      planUpdatedAt,
      input.userId,
      input.providerProductId ?? null,
      input.providerProductId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerCustomerId ?? null,
      input.providerCustomerId ?? null,
    );
    const acceptedPlan = {
      plan: input.plan,
      status: input.status,
      planUpdatedAt,
      processedLedgerEventId: ledger.eventId,
    };
    const results = await db.batch([
      guardedGrantStatement,
      buildDodoWebhookLedgerFinalizeAfterChangedStatement(db, ledger, processedAt),
      ...buildWatchlistGrantReconcileStatements(db, input.userId, keepActive, timestamp, acceptedPlan),
      buildDodoWebhookLedgerFinalizeStatement(
        db,
        {
          ...ledger,
          outcome: "ignored",
          metadata: {
            ...ledger.metadata,
            ignoredReason: "plan_change_guard_mismatch",
          },
        },
        processedAt,
      ),
    ]);

    const grantChanged = Number(results[0]?.meta?.changes ?? 0) > 0;
    await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [2, 3]);

    if (!grantChanged) return;

    try {
      const { persistWorkspaceEntitlementAnchor } = await import("~/lib/evidence-usage-period.server");
      await persistWorkspaceEntitlementAnchor(env, input.userId, planUpdatedAt, "plan_activation");
    } catch {
      // Anchor columns may be absent on pre-migration databases during local dev.
    }
    return;
  }

  const results = await db.batch([
    grantStatement,
    ...buildWatchlistGrantReconcileStatements(db, input.userId, keepActive, timestamp, {
      plan: input.plan,
      status: input.status,
      planUpdatedAt,
    }),
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  ]);

  await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [1, 2]);

  try {
    const { persistWorkspaceEntitlementAnchor } = await import("~/lib/evidence-usage-period.server");
    await persistWorkspaceEntitlementAnchor(env, input.userId, planUpdatedAt, "plan_activation");
  } catch {
    // Anchor columns may be absent on pre-migration databases during local dev.
  }
}


export async function applyDodoPlanRevokeWithWatchlistReconcile(
  env: AppEnv,
  input: RevokeDodoPlanAccessInput,
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.revokedAt) ?? nowIso();
  const timestamp = nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));

  const results = await db.batch([
    db.prepare(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, 'free', ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        plan = 'free',
        dodo_status = excluded.dodo_status,
        plan_updated_at = excluded.plan_updated_at
      WHERE julianday(excluded.plan_updated_at) >= julianday(user_plan.plan_updated_at)
    `).bind(input.userId, input.status, planUpdatedAt),
    buildWatchlistRevokeReconcileStatement(db, input.userId, keepActive, timestamp, {
      plan: "free",
      status: input.status,
      planUpdatedAt,
    }),
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  ]);

  await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [1]);

  // Lets callers skip side effects (e.g. lifecycle emails) when the
  // monotonic-timestamp guard rejected a stale/out-of-order event.
  return { changed: Number(results[0]?.meta?.changes ?? 0) > 0 };
}


export async function applyDodoRefundWithWatchlistReconcile(
  env: AppEnv,
  input: {
    paymentId: string;
    refundedAt?: string;
    userId: string | null;
  },
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const refundedAt = validIsoTimestamp(input.refundedAt) ?? nowIso();
  const timestamp = nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));

  const statements = [
    db.prepare(`
      UPDATE user_plan
      SET plan = 'free',
          dodo_status = 'refunded',
          plan_updated_at = ?
      WHERE dodo_payment_id = ?
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(refundedAt, input.paymentId, refundedAt),
    db.prepare(`
      UPDATE proof_usage_credit
      SET expires_at = ?
      WHERE provider_payment_id = ?
        AND julianday(expires_at) > julianday(?)
    `).bind(refundedAt, input.paymentId, refundedAt),
  ];

  if (input.userId) {
    statements.push(buildWatchlistRevokeReconcileStatement(db, input.userId, keepActive, timestamp, {
      plan: "free",
      status: "refunded",
      planUpdatedAt: refundedAt,
    }));
  }

  statements.push(buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt));

  const results = await db.batch(statements);
  if (input.userId) {
    const watchlistIndex = statements.length - 2;
    await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [watchlistIndex]);
  }
}


export async function applyDodoPlanPaymentIssueWithLedger(
  env: AppEnv,
  input: MarkDodoPlanPaymentIssueInput,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.occurredAt) ?? nowIso();
  const cancellationEffectiveAt = validIsoTimestamp(input.cancellationEffectiveAt ?? undefined);
  const processedAt = nowIso();

  const results = await db.batch([
    db.prepare(`
      UPDATE user_plan
      SET dodo_status = ?,
          dodo_next_billing_at = CASE
            WHEN ? IS NOT NULL THEN ?
            ELSE dodo_next_billing_at
          END,
          plan_updated_at = ?
      WHERE user_id = ?
        AND plan != 'free'
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(
      input.status,
      cancellationEffectiveAt,
      cancellationEffectiveAt,
      planUpdatedAt,
      input.userId,
      planUpdatedAt,
    ),
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  ]);

  // Lets callers skip side effects (e.g. lifecycle emails) when the
  // monotonic-timestamp guard or the plan != 'free' filter made this a no-op.
  return { changed: Number(results[0]?.meta?.changes ?? 0) > 0 };
}
