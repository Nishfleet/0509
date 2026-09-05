import { ensureDb } from "~/lib/data/d1.server";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
import { nowIso } from "~/lib/data/helpers.server";
import { validIsoTimestamp } from "~/lib/data/billing-helpers.server";
import type { AppEnv } from "~/lib/env.server";

// Dodo checkout links are payable for 24 hours by default, so the local lock
// must last at least as long as the provider session can still be completed.
export const DODO_PLAN_CHECKOUT_LOCK_MINUTES = 24 * 60;
export const DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES = 60;
export const DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS = "plan_change_pending";
export const DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS = "plan_change_scheduled";

export function isDodoSubscriptionPlanChangeStatus(status: string | null | undefined) {
  return (
    status === DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS ||
    status === DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS
  );
}

export function isBlockingDodoSubscriptionPlanChangeStatus(
  status: string | null | undefined,
  _planUpdatedAt: string | null | undefined,
  planChangeProductId?: string | null | undefined,
) {
  if (planChangeProductId) return true;
  if (status === DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS) return true;
  return status === DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS;
}

export async function claimDodoSubscriptionPlanChange(
  env: AppEnv,
    input: {
      userId: string;
      status:
        | typeof DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS
        | typeof DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS;
      providerProductId: string;
      currentSubscriptionId: string;
      currentProductId: string | null;
      currentStatus: string | null;
      currentPlanUpdatedAt: string | null;
    },
  ) {
    const db = ensureDb(env);
    const claimedAt = nowIso();
    const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "user_plan.user_id");
    const result = await db.prepare(`
        UPDATE user_plan
      SET dodo_status = ?,
          plan_updated_at = ?,
          dodo_plan_change_product_id = ?
        WHERE user_id = ?
          AND plan != 'free'
          AND dodo_subscription_id = ?
          AND (
            (? IS NULL AND dodo_product_id IS NULL)
            OR dodo_product_id = ?
          )
          AND (
            (? IS NULL AND dodo_status IS NULL)
            OR dodo_status = ?
          )
          AND (
            (? IS NULL AND plan_updated_at IS NULL)
            OR plan_updated_at = ?
          )
          AND (
            dodo_status IS NULL
            OR dodo_status NOT IN (
              'checkout_pending',
              'plan_change_pending',
              'plan_change_scheduled',
              'payment.failed',
              'subscription.failed',
              'subscription.on_hold',
              'cancellation_scheduled'
            )
          )
          ${billingCanaryGuard}
      `)
    .bind(
      input.status,
      claimedAt,
      input.providerProductId.trim(),
      input.userId,
      input.currentSubscriptionId.trim(),
      input.currentProductId?.trim() ?? null,
      input.currentProductId?.trim() ?? null,
      input.currentStatus ?? null,
      input.currentStatus ?? null,
      validIsoTimestamp(input.currentPlanUpdatedAt ?? undefined) ?? null,
      validIsoTimestamp(input.currentPlanUpdatedAt ?? undefined) ?? null,
    )
    .run();

    return Number(result.meta?.changes ?? 0) > 0 ? { claimedAt } : null;
  }

export async function clearDodoSubscriptionPlanChangeClaim(
  env: AppEnv,
  input: {
    userId: string;
      claimedStatus:
        | typeof DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS
        | typeof DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS;
      previousStatus: string | null;
      previousPlanUpdatedAt?: string | null;
      providerProductId: string;
      subscriptionId: string;
      claimedAt: string;
    },
  ) {
    const db = ensureDb(env);
    const result = await db.prepare(`
        UPDATE user_plan
      SET dodo_status = ?,
          plan_updated_at = COALESCE(?, plan_updated_at),
          dodo_plan_change_product_id = NULL
        WHERE user_id = ?
          AND dodo_status = ?
          AND dodo_plan_change_product_id = ?
          AND dodo_subscription_id = ?
          AND plan_updated_at = ?
      `)
    .bind(
      input.previousStatus ?? null,
      validIsoTimestamp(input.previousPlanUpdatedAt ?? undefined),
      input.userId,
      input.claimedStatus,
      input.providerProductId.trim(),
      input.subscriptionId.trim(),
      validIsoTimestamp(input.claimedAt) ?? input.claimedAt,
    )
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function markDodoSubscriptionPlanChangeScheduled(
  env: AppEnv,
  input: { userId: string },
) {
  const db = ensureDb(env);
  const result = await db.prepare(`
      UPDATE user_plan
      SET dodo_status = ?,
          plan_updated_at = ?
      WHERE user_id = ?
        AND dodo_status = ?
    `)
    .bind(
      DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
      nowIso(),
      input.userId,
      DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
    )
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function claimDodoPlanCheckout(
  env: AppEnv,
  input: {
    userId: string;
    checkoutId?: string | null;
    claimedAt?: string;
    staleAfterMinutes?: number;
  },
) {
  const claimedAt = validIsoTimestamp(input.claimedAt) ?? nowIso();
  const checkoutId =
    typeof input.checkoutId === "string" && input.checkoutId.trim() ? input.checkoutId.trim() : null;
  const staleAfterMs =
    Math.max(
      DODO_PLAN_CHECKOUT_LOCK_MINUTES,
      input.staleAfterMinutes ?? DODO_PLAN_CHECKOUT_LOCK_MINUTES,
    ) *
    60 *
    1000;
  const staleBefore = new Date(Date.parse(claimedAt) - staleAfterMs).toISOString();
  const db = ensureDb(env);
  const result = await db.prepare(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, 'free', ?, 'checkout_pending', ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        dodo_payment_id = excluded.dodo_payment_id,
        dodo_status = 'checkout_pending',
        plan_updated_at = excluded.plan_updated_at
      WHERE user_plan.plan = 'free'
        AND (
          user_plan.dodo_status IS NULL
          OR user_plan.dodo_status != 'checkout_pending'
          OR julianday(user_plan.plan_updated_at) <= julianday(?)
        )
    `)
    .bind(input.userId, checkoutId, claimedAt, staleBefore)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function clearDodoPlanCheckout(
  env: AppEnv,
  userId: string,
  options: {
    allowMissingStoredCheckoutId?: boolean;
    allowTimestampMatchedStoredCheckoutId?: boolean;
    occurredAt?: string | null;
    checkoutId?: string | null;
    requireMissingStoredCheckoutId?: boolean;
  } = {},
) {
  const occurredAt = validIsoTimestamp(options.occurredAt ?? undefined);
  const checkoutId =
    typeof options.checkoutId === "string" && options.checkoutId.trim()
      ? options.checkoutId.trim()
      : null;
  const checkoutBindings: string[] = [];
  let checkoutGuard = "";
  if (checkoutId) {
    checkoutGuard = options.allowMissingStoredCheckoutId
      ? "\n        AND (dodo_payment_id = ? OR dodo_payment_id IS NULL)"
      : "\n        AND dodo_payment_id = ?";
    checkoutBindings.push(checkoutId);
  } else if (options.requireMissingStoredCheckoutId || !options.allowTimestampMatchedStoredCheckoutId || !occurredAt) {
    checkoutGuard = "\n        AND dodo_payment_id IS NULL";
  }
  const timestampGuard = occurredAt
    ? "\n        AND (plan_updated_at IS NULL OR julianday(plan_updated_at) <= julianday(?))"
    : "";
  const db = ensureDb(env);
  const result = await db.prepare(`
      UPDATE user_plan
      SET dodo_payment_id = NULL,
          dodo_status = NULL
      WHERE user_id = ?
        AND plan = 'free'
        AND dodo_status = 'checkout_pending'${checkoutGuard}${timestampGuard}
    `)
    .bind(...[userId, ...checkoutBindings, ...(occurredAt ? [occurredAt] : [])])
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}
