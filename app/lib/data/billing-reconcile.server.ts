import { ensureDb } from "~/lib/data/d1.server";
import { createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
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
import {
  buildBillingLifecycleOutboxStatement,
  type BillingLifecycleEmailOutboxSpec,
} from "~/lib/data/delivery-records-attempts.server";
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

/**
 * Optional lifecycle-email outbox rider. When present, the pending
 * delivery_attempt row is inserted in the SAME D1 batch that applies the
 * plan mutation and finalizes the webhook ledger — a worker crash after the
 * batch can no longer lose the customer email, because the recovery sweep
 * replays pending outbox rows and Dodo redelivery is already deduped by the
 * finalized ledger.
 */
export interface ApplyDodoPlanOptions {
  lifecycleEmailOutbox?: BillingLifecycleEmailOutboxSpec;
  billingCanaryPrecondition?: BillingCanaryPlanSnapshot;
  returnMutationTimestamps?: boolean;
}

export interface BillingCanaryPlanSnapshot {
  plan: string | null;
  planUpdatedAt: string | null;
  dodoPaymentId: string | null;
  dodoProductId: string | null;
  dodoPlanChangeProductId: string | null;
  dodoStatus: string | null;
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  dodoNextBillingAt: string | null;
  evidenceEntitlementAnchor: string | null;
  evidenceEntitlementAnchorSource: string | null;
}

export async function applyDodoPlanGrantWithWatchlistReconcile(
  env: AppEnv,
  input: GrantDodoPlanAccessInput,
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
  options: ApplyDodoPlanOptions = {},
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.grantedAt) ?? nowIso();
  const timestamp = options.billingCanaryPrecondition ? planUpdatedAt : nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));
  const hasBillingCanaryPrecondition = options.billingCanaryPrecondition ? 1 : 0;
  const expected = options.billingCanaryPrecondition;
  const billingCanaryPreconditionSql = expected
    ? `EXISTS (
        SELECT 1 FROM user_plan
        WHERE user_id = ?
          AND plan IS ?
          AND plan_updated_at IS ?
          AND dodo_payment_id IS ?
          AND dodo_product_id IS ?
          AND dodo_plan_change_product_id IS ?
          AND dodo_status IS ?
          AND dodo_subscription_id IS ?
          AND dodo_customer_id IS ?
          AND dodo_next_billing_at IS ?
          AND evidence_entitlement_anchor IS ?
          AND evidence_entitlement_anchor_source IS ?
      )`
    : "1 = 1";
  const billingCanaryPreconditionBindings = expected
    ? [
        input.userId,
        expected.plan,
        expected.planUpdatedAt,
        expected.dodoPaymentId,
        expected.dodoProductId,
        expected.dodoPlanChangeProductId,
        expected.dodoStatus,
        expected.dodoSubscriptionId,
        expected.dodoCustomerId,
        expected.dodoNextBillingAt,
        expected.evidenceEntitlementAnchor,
        expected.evidenceEntitlementAnchorSource,
      ]
    : [];

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
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM dodo_webhook_event
        WHERE event_type = 'refund.succeeded'
          AND outcome = 'processed'
          AND json_extract(metadata_json, '$.paymentId') = ?
          AND COALESCE(json_extract(metadata_json, '$.refundType'), 'full') = 'full'
      )
        AND (${billingCanaryPreconditionSql})
        AND (
          ? = 0
          OR EXISTS (
            SELECT 1
            FROM user_plan
            WHERE user_id = ?
              AND dodo_product_id = ?
              AND dodo_subscription_id = ?
              AND dodo_customer_id = ?
          )
        )
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
          WHEN ? = 1 THEN user_plan.dodo_plan_change_product_id
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
          OR (
            user_plan.dodo_product_id = excluded.dodo_product_id
            AND user_plan.dodo_subscription_id = excluded.dodo_subscription_id
            AND user_plan.dodo_customer_id = excluded.dodo_customer_id
          )
        )
        AND (
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
    input.providerPaymentId ?? null,
    ...billingCanaryPreconditionBindings,
    input.requireProviderIdentityMatch ? 1 : 0,
    input.userId,
    input.providerProductId ?? null,
    input.providerSubscriptionId ?? null,
    input.providerCustomerId ?? null,
    hasBillingCanaryPrecondition,
    input.requireProviderIdentityMatch ? 1 : 0,
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
    const guardedStatements = [
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
    ];
    if (options.lifecycleEmailOutbox) {
      // The guarded finalize is conditional on the grant having changed rows,
      // so "this batch marked the ledger processed" is the correct gate here.
      guardedStatements.push(
        buildBillingLifecycleOutboxStatement(
          db,
          options.lifecycleEmailOutbox,
          { kind: "ledger-processed", eventId: ledger.eventId, processedAt },
          timestamp,
        ),
      );
    }
    const results = await db.batch(guardedStatements);

    const grantChanged = Number(results[0]?.meta?.changes ?? 0) > 0;
    await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [2, 3]);

    if (!grantChanged) {
      return options.returnMutationTimestamps
        ? { changed: false, watchlistUpdatedAt: timestamp }
        : { changed: false };
    }

    try {
      const { persistWorkspaceEntitlementAnchor } = await import("~/lib/evidence-usage-period.server");
      if (!options.billingCanaryPrecondition) {
        await persistWorkspaceEntitlementAnchor(env, input.userId, planUpdatedAt, "plan_activation");
      }
    } catch {
      // Anchor columns may be absent on pre-migration databases during local dev.
    }
    return options.returnMutationTimestamps
      ? { changed: true, watchlistUpdatedAt: timestamp }
      : { changed: true };
  }

  // The outbox rider must sit DIRECTLY after the grant so its changes() gate
  // reads the grant's row count (the ledger finalize below is unconditional,
  // so it cannot serve as the gate). The watchlist statements don't read
  // changes().
  const statements = [grantStatement];
  if (options.lifecycleEmailOutbox) {
    statements.push(
      buildBillingLifecycleOutboxStatement(
        db,
        {
          ...options.lifecycleEmailOutbox,
          payloadSnapshot: {
            ...options.lifecycleEmailOutbox.payloadSnapshot,
            billingMutationStatus: input.status,
            billingMutationSubscriptionId: input.providerSubscriptionId,
            billingMutationStateUpdatedAt: planUpdatedAt,
          },
        },
        { kind: "prior-statement-changed" },
        timestamp,
      ),
    );
  }
  const watchlistStart = statements.length;
  const watchlistStatements = buildWatchlistGrantReconcileStatements(
    db,
    input.userId,
    keepActive,
    timestamp,
    {
      plan: input.plan,
      status: input.status,
      planUpdatedAt,
    },
  );
  statements.push(
    ...watchlistStatements,
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  );
  const results = await db.batch(statements);

  await syncWatchlistMentionTargetsIfChanged(
    env,
    input.userId,
    timestamp,
    results,
    watchlistStatements.map((_, index) => watchlistStart + index),
  );
  const grantChanged = Number(results[0]?.meta?.changes ?? 0) > 0;

  if (grantChanged && !options.billingCanaryPrecondition) {
    try {
      const { persistWorkspaceEntitlementAnchor } = await import("~/lib/evidence-usage-period.server");
      await persistWorkspaceEntitlementAnchor(env, input.userId, planUpdatedAt, "plan_activation");
    } catch {
      // Anchor columns may be absent on pre-migration databases during local dev.
    }
  }
  return options.returnMutationTimestamps
    ? { changed: grantChanged, watchlistUpdatedAt: timestamp }
    : { changed: grantChanged };
}

/**
 * Restore a paid subscription after Dodo explicitly clears its scheduled
 * cancellation flag. This is intentionally a narrow CAS: it only touches
 * the billing status for the matching subscription, never reconciles
 * watchlists/entitlements, and uses the provider (or signature-verified
 * webhook) timestamp as the monotonic watermark.
 */
export async function applyDodoCancellationReversalWithLedger(
  env: AppEnv,
  input: GrantDodoPlanAccessInput,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.grantedAt);
  const subscriptionId = input.providerSubscriptionId?.trim() ?? "";
  const processedAt = nowIso();
  const ignoredMetadata = {
    ...ledger.metadata,
    ignoredReason: "cancellation_reversal_cas_mismatch",
  };
  const finalizeIgnored = () =>
    buildDodoWebhookLedgerFinalizeStatement(
      db,
      { ...ledger, outcome: "ignored", metadata: ignoredMetadata },
      processedAt,
    );

  // Reversal is authoritative only with all three provider identities and a
  // provider/signature timestamp. Missing values are not wildcards: record the
  // event as safely ignored so a retry cannot re-enter the normal grant path.
  const productId = input.providerProductId?.trim() ?? "";
  const customerId = input.providerCustomerId?.trim() ?? "";
  if (!planUpdatedAt) {
    throw new Error("Cancellation reversal requires a verified webhook timestamp.");
  }
  if (!subscriptionId || !productId || !customerId) {
    await db.batch([finalizeIgnored()]);
    return { changed: false, handled: true };
  }

  const reversal = db.prepare(`
    UPDATE user_plan
    SET dodo_status = CASE
          WHEN dodo_status = 'cancellation_scheduled' THEN 'active'
          ELSE dodo_status
        END,
        dodo_next_billing_at = COALESCE(?, dodo_next_billing_at),
        dodo_plan_change_product_id = CASE
          WHEN dodo_status = 'cancellation_scheduled' THEN NULL
          ELSE dodo_plan_change_product_id
        END,
        plan_updated_at = ?
    WHERE user_id = ?
      AND dodo_status IN (
        'cancellation_scheduled',
        'active',
        'succeeded',
        'payment.succeeded'
      )
      AND dodo_subscription_id = ?
      AND dodo_product_id = ?
      AND dodo_customer_id = ?
      AND julianday(?) >= julianday(plan_updated_at)
  `).bind(
    input.nextBillingAt ?? null,
    planUpdatedAt,
    input.userId,
    subscriptionId,
    productId,
    customerId,
    planUpdatedAt,
  );
  const results = await db.batch([
    reversal,
    buildDodoWebhookLedgerFinalizeAfterChangedStatement(db, ledger, processedAt),
    db.prepare(`
      UPDATE dodo_webhook_event
      SET outcome = 'ignored',
          processed_at = ?,
          processing_started_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
        AND outcome = 'processing'
        AND changes() = 0
    `).bind(processedAt, jsonValue(ignoredMetadata), ledger.eventId),
  ]);
  return {
    changed: Number(results[0]?.meta?.changes ?? 0) > 0,
    handled: true,
  };
}


export async function applyDodoPlanRevokeWithWatchlistReconcile(
  env: AppEnv,
  input: RevokeDodoPlanAccessInput,
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
  options: ApplyDodoPlanOptions = {},
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.revokedAt) ?? nowIso();
  const timestamp = nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));

  const statements = [
    db.prepare(`
      UPDATE user_plan
      SET plan = 'free',
          dodo_status = ?,
          plan_updated_at = ?
      WHERE user_id = ?
        AND plan != 'free'
        AND dodo_subscription_id = ?
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(
      input.status,
      planUpdatedAt,
      input.userId,
      input.providerSubscriptionId,
      planUpdatedAt,
    ),
  ];
  if (options.lifecycleEmailOutbox) {
    // Gate on the revoke's changes(): the ledger finalize below is
    // unconditional, and the "plan has ended" email must only exist when
    // access really transitioned.
    statements.push(
      buildBillingLifecycleOutboxStatement(
        db,
        {
          ...options.lifecycleEmailOutbox,
          payloadSnapshot: {
            ...options.lifecycleEmailOutbox.payloadSnapshot,
            billingMutationStatus: input.status,
            billingMutationSubscriptionId: input.providerSubscriptionId,
            billingMutationStateUpdatedAt: planUpdatedAt,
          },
        },
        { kind: "prior-statement-changed" },
        timestamp,
      ),
    );
  }
  // Advance the lifecycle watermark even when another terminal event already
  // made the plan free. Keep the earlier terminal status, and keep this after
  // the outbox rider so a watermark-only update never sends another email.
  statements.push(
    db.prepare(`
      UPDATE user_plan
      SET plan_updated_at = ?
      WHERE user_id = ?
        AND plan = 'free'
        AND (dodo_subscription_id IS NULL OR dodo_subscription_id = ?)
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(
      planUpdatedAt,
      input.userId,
      input.providerSubscriptionId,
      planUpdatedAt,
    ),
  );
  const watchlistIndex = statements.length;
  statements.push(
    buildWatchlistRevokeReconcileStatement(db, input.userId, keepActive, timestamp, {
      plan: "free",
      status: input.status,
      planUpdatedAt,
    }),
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  );
  const results = await db.batch(statements);

  await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [watchlistIndex]);

  // Lets callers skip side effects (e.g. lifecycle emails) when the
  // monotonic-timestamp guard rejected a stale/out-of-order event, or when
  // the plan was already free (SQLite counts a matched UPDATE row as changed
  // even when values are identical, so a second terminal event — e.g.
  // subscription.cancelled after refund.succeeded already revoked — would
  // otherwise re-trigger the "plan has ended" email).
  return {
    changed: Number(results[0]?.meta?.changes ?? 0) > 0,
    stateUpdatedAt: planUpdatedAt,
  };
}


export async function applyDodoRefundWithWatchlistReconcile(
  env: AppEnv,
  input: {
    paymentId: string;
    refundedAt?: string;
    userId: string | null;
    refundType?: "full" | "partial";
    /** Minor units; required with paymentAmount for partial top-up proration. */
    refundAmount?: number | null;
    paymentAmount?: number | null;
  },
  watchlistLimit: number,
  ledger: DodoWebhookLedgerFinalize,
  options: ApplyDodoPlanOptions = {},
) {
  const db = ensureDb(env);
  const refundedAt = validIsoTimestamp(input.refundedAt) ?? nowIso();
  const timestamp = nowIso();
  const processedAt = nowIso();
  const keepActive = Math.max(0, Math.floor(watchlistLimit));
  const refundType = input.refundType ?? "full";
  const isFullRefund = refundType === "full";
  // FIX-9: partial refunds with money amounts prorate remaining top-up credits;
  // partial without amounts stay manual-review (no automatic clawback).
  const canProratePartial =
    !isFullRefund &&
    typeof input.refundAmount === "number" &&
    typeof input.paymentAmount === "number" &&
    Number.isFinite(input.refundAmount) &&
    Number.isFinite(input.paymentAmount) &&
    input.refundAmount > 0 &&
    input.paymentAmount > 0;
  const topUpRefundAllowed = isFullRefund || canProratePartial;
  const refundRatio = canProratePartial
    ? Math.min(1, Number(input.refundAmount) / Number(input.paymentAmount))
    : 1;
  const topUpRefundKey = `dodo-refund:${ledger.eventId}:${input.paymentId}`;

  const statements = [
    db.prepare(`
      UPDATE user_plan
      SET plan = 'free',
          dodo_status = 'refunded',
          plan_updated_at = ?
      WHERE dodo_payment_id = ?
        AND plan != 'free'
        AND ? = 1
        AND NOT EXISTS (
          SELECT 1
          FROM evidence_top_up_grant
          WHERE provider_payment_id = ?
        )
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(refundedAt, input.paymentId, isFullRefund ? 1 : 0, input.paymentId, refundedAt),
  ];
  if (options.lifecycleEmailOutbox) {
    // Gate on the plan transition's changes() (results[0] is the caller's
    // `changed` signal too): the refund email asserts the workspace moved to
    // Free, so it must only be enqueued when that transition applied.
    statements.push(
      buildBillingLifecycleOutboxStatement(
        db,
        {
          ...options.lifecycleEmailOutbox,
          payloadSnapshot: {
            ...options.lifecycleEmailOutbox.payloadSnapshot,
            refundPaymentId: input.paymentId,
            refundStateUpdatedAt: refundedAt,
          },
        },
        { kind: "prior-statement-changed" },
        timestamp,
      ),
    );
  }
  statements.push(
    // Preserve the provider audit state when an earlier terminal event
    // already moved the workspace to Free. This statement follows the plan
    // transition in the same D1 batch; results[0] remains the only signal for
    // whether customer-facing access actually changed.
    db.prepare(`
      UPDATE user_plan
      SET dodo_status = 'refunded',
          plan_updated_at = ?
      WHERE dodo_payment_id = ?
        AND plan = 'free'
        AND dodo_status != 'refunded'
        AND ? = 1
        AND NOT EXISTS (
          SELECT 1
          FROM evidence_top_up_grant
          WHERE provider_payment_id = ?
        )
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(refundedAt, input.paymentId, isFullRefund ? 1 : 0, input.paymentId, refundedAt),
    // Full refunds expire legacy proof_usage_credit rows; partial proration only
    // adjusts the top-up ledger (remaining credits stay spendable).
    db.prepare(`
      UPDATE proof_usage_credit
      SET expires_at = ?
      WHERE provider_payment_id = ?
        AND ? = 1
        AND julianday(expires_at) > julianday(?)
    `).bind(refundedAt, input.paymentId, isFullRefund ? 1 : 0, refundedAt),
  );

  const topUpLedgerIndex = statements.length;
  // Full: claw back all remaining. Partial+amounts: min(remaining, round(remaining * ratio)).
  statements.push(
    db.prepare(`
      INSERT INTO evidence_top_up_ledger_entry (
        id, grant_id, workspace_user_id, quantity_delta, entry_type,
        reservation_id, idempotency_key, metadata_json, created_at
      )
      SELECT ?, grant.id, grant.workspace_user_id,
             -MIN(
               MAX(
                 0,
                 grant.quantity_granted + COALESCE(
                   (SELECT SUM(entry.quantity_delta)
                    FROM evidence_top_up_ledger_entry AS entry
                    WHERE entry.grant_id = grant.id),
                   0
                 )
               ),
               CASE
                 WHEN ? = 1 THEN MAX(
                   0,
                   grant.quantity_granted + COALESCE(
                     (SELECT SUM(entry.quantity_delta)
                      FROM evidence_top_up_ledger_entry AS entry
                      WHERE entry.grant_id = grant.id),
                     0
                   )
                 )
                 ELSE CAST(
                   ROUND(
                     MAX(
                       0,
                       grant.quantity_granted + COALESCE(
                         (SELECT SUM(entry.quantity_delta)
                          FROM evidence_top_up_ledger_entry AS entry
                          WHERE entry.grant_id = grant.id),
                         0
                       )
                     ) * ?
                   ) AS INTEGER
                 )
               END
             ),
             'refund', NULL, ?, ?, ?
      FROM evidence_top_up_grant AS grant
      WHERE grant.provider_payment_id = ?
        AND ? = 1
      ON CONFLICT(idempotency_key) DO NOTHING
    `).bind(
      createId(),
      isFullRefund ? 1 : 0,
      refundRatio,
      topUpRefundKey,
      jsonValue({
        reason: `${refundType}_provider_refund`,
        providerEventId: ledger.eventId,
        refundAmount: input.refundAmount ?? null,
        paymentAmount: input.paymentAmount ?? null,
        refundRatio,
      }),
      timestamp,
      input.paymentId,
      topUpRefundAllowed ? 1 : 0,
    ),
    db.prepare(`
      UPDATE evidence_top_up_grant
      SET quantity_remaining = MAX(
            0,
            quantity_granted + COALESCE(
              (SELECT SUM(entry.quantity_delta)
               FROM evidence_top_up_ledger_entry AS entry
               WHERE entry.grant_id = evidence_top_up_grant.id),
              0
            )
          ),
          status = CASE
            WHEN MAX(
              0,
              quantity_granted + COALESCE(
                (SELECT SUM(entry.quantity_delta)
                 FROM evidence_top_up_ledger_entry AS entry
                 WHERE entry.grant_id = evidence_top_up_grant.id),
                0
              )
            ) <= 0 THEN 'depleted'
            ELSE 'active'
          END
      WHERE provider_payment_id = ?
        AND EXISTS (
          SELECT 1
          FROM evidence_top_up_ledger_entry
          WHERE grant_id = evidence_top_up_grant.id
            AND idempotency_key = ?
        )
    `).bind(input.paymentId, topUpRefundKey),
  );

  let watchlistIndex: number | null = null;
  if (input.userId) {
    watchlistIndex = statements.length;
    statements.push(buildWatchlistRevokeReconcileStatement(db, input.userId, keepActive, timestamp, {
      plan: "free",
      status: "refunded",
      planUpdatedAt: refundedAt,
    }));
  }

  statements.push(buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt));

  const results = await db.batch(statements);
  if (input.userId && watchlistIndex !== null) {
    await syncWatchlistMentionTargetsIfChanged(env, input.userId, timestamp, results, [watchlistIndex]);
  }

  // Lets callers skip the refund email when the monotonic-timestamp guard
  // no-oped the plan update (e.g. an out-of-order refund webhook after a
  // later plan change) — the email asserts "your workspace has moved to the
  // Free plan", so it must only send when that transition really applied.
  const changed = Number(results[0]?.meta?.changes ?? 0) > 0;
  const topUpChanged = Number(results[topUpLedgerIndex]?.meta?.changes ?? 0) > 0;
  const result = { changed, stateUpdatedAt: refundedAt };
  return topUpChanged ? { ...result, topUpChanged: true as const } : result;
}


export async function applyDodoPlanPaymentIssueWithLedger(
  env: AppEnv,
  input: MarkDodoPlanPaymentIssueInput,
  ledger: DodoWebhookLedgerFinalize,
  options: ApplyDodoPlanOptions = {},
) {
  const db = ensureDb(env);
  const planUpdatedAt = validIsoTimestamp(input.occurredAt) ?? nowIso();
  const cancellationEffectiveAt = validIsoTimestamp(input.cancellationEffectiveAt ?? undefined);
  const timestamp = nowIso();
  const processedAt = nowIso();

  const statements = [
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
        AND (? IS NULL OR dodo_payment_id = ?)
        AND (? IS NULL OR dodo_subscription_id = ?)
        AND julianday(?) >= julianday(plan_updated_at)
    `).bind(
      input.status,
      cancellationEffectiveAt,
      cancellationEffectiveAt,
      planUpdatedAt,
      input.userId,
      input.providerPaymentId ?? null,
      input.providerPaymentId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerSubscriptionId ?? null,
      planUpdatedAt,
    ),
  ];
  if (options.lifecycleEmailOutbox) {
    // Gate on the status update's changes(): the ledger finalize below is
    // unconditional, and a monotonic-guard no-op must not enqueue dunning.
    statements.push(
      buildBillingLifecycleOutboxStatement(
        db,
        {
          ...options.lifecycleEmailOutbox,
          payloadSnapshot: {
            ...options.lifecycleEmailOutbox.payloadSnapshot,
            billingMutationStatus: input.status,
            billingMutationSubscriptionId: input.providerSubscriptionId ?? null,
            billingMutationPaymentId: input.providerPaymentId ?? null,
            billingMutationStateUpdatedAt: planUpdatedAt,
          },
        },
        { kind: "prior-statement-changed" },
        timestamp,
      ),
    );
  }
  statements.push(buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt));
  const results = await db.batch(statements);

  // Lets callers skip side effects (e.g. lifecycle emails) when the
  // monotonic-timestamp guard or the plan != 'free' filter made this a no-op.
  return {
    changed: Number(results[0]?.meta?.changes ?? 0) > 0,
    stateUpdatedAt: planUpdatedAt,
  };
}
