import {
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import { validIsoTimestamp } from "~/lib/data/billing-helpers.server";
import { resolveBillingSkuFromProviderProductId } from "~/lib/billing-sku-catalog";
import { effectivePlanFromRow } from "~/lib/plan-effective.server";
import type { AppEnv } from "~/lib/env.server";

export async function grantDodoPlanAccess(
  env: AppEnv,
  input: {
    userId: string;
    plan: "scout" | "starter" | "agency";
    providerPaymentId: string | null;
    providerProductId: string | null;
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    nextBillingAt?: string | null;
    status: string;
    grantedAt?: string;
    metadata?: JsonRecord;
    forcePlanChangePending?: boolean;
    requirePlanChangePending?: boolean;
    requireProviderIdentityMatch?: boolean;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.grantedAt) ?? nowIso();

  // Preserve confirmed payment ids when subscription events lack a payment id,
  // but clear temporary checkout ids left by checkout_pending locks.
  await run(
    env,
    `
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
    `,
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
    input.requireProviderIdentityMatch ? 1 : 0,
    input.requirePlanChangePending ? 1 : 0,
    input.forcePlanChangePending ? 1 : 0,
  );
}


export async function revokeDodoPlanAccess(
  env: AppEnv,
  input: {
    userId: string;
    providerSubscriptionId: string;
    status: string;
    revokedAt?: string;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.revokedAt) ?? nowIso();

  // Mirrors grantDodoPlanAccess's monotonic guard so a late-arriving older
  // payment webhook can never resurrect a newer cancellation (and vice versa).
  // Never overwrite dodo_payment_id here — subscription ids belong in
  // dodo_subscription_id and refunds resolve via the preserved payment id.
  await run(
    env,
    `
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
    `,
    input.userId,
    input.status,
    planUpdatedAt,
  );
}


export async function markDodoPlanPaymentIssue(
  env: AppEnv,
  input: {
    userId: string;
    status: string;
    occurredAt?: string;
    cancellationEffectiveAt?: string | null;
    providerPaymentId?: string | null;
    providerSubscriptionId?: string | null;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.occurredAt) ?? nowIso();
  const cancellationEffectiveAt = validIsoTimestamp(input.cancellationEffectiveAt ?? undefined);

  // Dunning state (subscription.failed / on_hold): the customer keeps the
  // paid plan while Dodo retries the payment; only dodo_status changes so
  // the app can surface a payment-issue notice. The monotonic guard keeps a
  // late-arriving stale event from overwriting a newer grant or revocation.
  await run(
    env,
    `
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
    `,
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
  );
}


export async function revokeDodoAccessForRefundedPayment(
  env: AppEnv,
  input: {
    paymentId: string;
    refundedAt?: string;
  },
) {
  const refundedAt = validIsoTimestamp(input.refundedAt) ?? nowIso();

  // A full refund undoes whatever the payment bought. Plan payments are
  // matched via user_plan.dodo_payment_id; usage-bundle payments via
  // proof_usage_credit.provider_payment_id (its credits expire immediately).
  await run(
    env,
    `
      UPDATE user_plan
      SET plan = 'free',
          dodo_status = 'refunded',
          plan_updated_at = ?
      WHERE dodo_payment_id = ?
        AND julianday(?) >= julianday(plan_updated_at)
    `,
    refundedAt,
    input.paymentId,
    refundedAt,
  );

  await run(
    env,
    `
      UPDATE proof_usage_credit
      SET expires_at = ?
      WHERE provider_payment_id = ?
        AND julianday(expires_at) > julianday(?)
    `,
    refundedAt,
    input.paymentId,
    refundedAt,
  );
}


export async function getUserIdForDodoPayment(env: AppEnv, paymentId: string) {
  const row = await one<{ user_id: string }>(
    env,
    `
      SELECT user_id
      FROM (
        SELECT user_id, 0 AS priority
        FROM user_plan
        WHERE dodo_payment_id = ?
        UNION ALL
        SELECT workspace_user_id AS user_id, 1 AS priority
        FROM evidence_top_up_grant
        WHERE provider_payment_id = ?
      )
      ORDER BY priority ASC
      LIMIT 1
    `,
    paymentId,
    paymentId,
  );
  return row?.user_id ?? null;
}


export async function getUserIdForDodoLifecycle(
  env: AppEnv,
  input: {
    subscriptionId?: string | null;
    customerId?: string | null;
    customerEmail?: string | null;
  },
) {
  const subscriptionId = input.subscriptionId?.trim();
  if (subscriptionId) {
    const row = await one<{ user_id: string }>(
      env,
      "SELECT user_id FROM user_plan WHERE dodo_subscription_id = ? AND plan != 'free' LIMIT 1",
      subscriptionId,
    );
    if (row?.user_id) return row.user_id;
  }

  const customerId = input.customerId?.trim();
  if (customerId) {
    const row = await one<{ user_id: string }>(
      env,
      "SELECT user_id FROM user_plan WHERE dodo_customer_id = ? AND plan != 'free' ORDER BY plan_updated_at DESC LIMIT 1",
      customerId,
    );
    if (row?.user_id) return row.user_id;
  }

  const customerEmail = input.customerEmail?.trim();
  if (customerEmail) {
    const row = await one<{ user_id: string }>(
      env,
      `
        SELECT user.id AS user_id
        FROM user
        INNER JOIN user_plan
          ON user_plan.user_id = user.id
        WHERE user.email = ? COLLATE NOCASE
          AND user_plan.plan != 'free'
          AND (
            user_plan.dodo_payment_id IS NOT NULL
            OR user_plan.dodo_product_id IS NOT NULL
            OR user_plan.dodo_status IS NOT NULL
            OR user_plan.dodo_subscription_id IS NOT NULL
            OR user_plan.dodo_customer_id IS NOT NULL
          )
        ORDER BY user_plan.plan_updated_at DESC
        LIMIT 1
      `,
      customerEmail,
    );
    if (row?.user_id) return row.user_id;
  }

  return null;
}


export interface UserPlanBillingInfo {
  plan: "free" | "scout" | "starter" | "agency";
  dodoStatus: string | null;
  dodoPaymentId: string | null;
  dodoProductId: string | null;
  dodoPlanChangeProductId: string | null;
  billingInterval: "monthly" | "annual" | null;
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  dodoNextBillingAt: string | null;
  planUpdatedAt: string | null;
}

export async function getUserPlanBillingInfo(
  env: AppEnv,
  userId: string,
): Promise<UserPlanBillingInfo> {
  const row = await one<{
    plan: string | null;
    dodo_status: string | null;
    dodo_payment_id: string | null;
    dodo_product_id: string | null;
    dodo_plan_change_product_id: string | null;
    dodo_subscription_id: string | null;
    dodo_customer_id: string | null;
    dodo_next_billing_at: string | null;
    plan_updated_at: string | null;
  }>(
    env,
    `
      SELECT plan, dodo_status, dodo_payment_id, dodo_product_id, dodo_subscription_id,
             dodo_customer_id, dodo_next_billing_at, dodo_plan_change_product_id,
             plan_updated_at
      FROM user_plan
      WHERE user_id = ?
    `,
    userId,
  );

  // Same lapse rule as plan.server getUserPlan: once a scheduled cancellation
  // passes its effective date, the displayed plan must read free too —
  // otherwise the billing page shows paid UI while enforcement denies it.
  const plan = effectivePlanFromRow(row);
  const skuMatch = row?.dodo_product_id
    ? resolveBillingSkuFromProviderProductId(env, row.dodo_product_id)
    : null;
  const billingInterval =
    plan !== "free" &&
    skuMatch?.purchaseType === "subscription" &&
    skuMatch.planFamily === plan &&
    skuMatch.billingInterval !== "none"
      ? skuMatch.billingInterval
      : null;

  return {
    plan,
    dodoStatus: row?.dodo_status ?? null,
    dodoPaymentId: row?.dodo_payment_id ?? null,
    dodoProductId: row?.dodo_product_id ?? null,
    dodoPlanChangeProductId: row?.dodo_plan_change_product_id ?? null,
    billingInterval,
    dodoSubscriptionId: row?.dodo_subscription_id ?? null,
    dodoCustomerId: row?.dodo_customer_id ?? null,
    dodoNextBillingAt: row?.dodo_next_billing_at ?? null,
    planUpdatedAt: row?.plan_updated_at ?? null,
  };
}
