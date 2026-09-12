import type { AppEnv } from "~/lib/env.server";
import type { PricingPlanSlug } from "~/lib/pricing";

/**
 * Shared identity/state plumbing for the Dodo billing canary
 * (app/routes/api.billing.dodo.canary.ts, Gate C) and the lightweight
 * billing_dodo status probe (app/lib/status-probes.server.ts). Extracted from
 * the route so the probe reuses the exact same helpers instead of duplicating
 * them; the route's mutation flow (lock, webhooks, cleanup) stays in the
 * route.
 */

export interface BillingCanaryUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string | null;
}

export interface UserPlanSnapshot {
  user_id: string;
  plan: string;
  plan_updated_at: string;
  dodo_payment_id: string | null;
  dodo_product_id: string | null;
  dodo_plan_change_product_id: string | null;
  dodo_status: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_next_billing_at: string | null;
  evidence_entitlement_anchor: string | null;
  evidence_entitlement_anchor_source: string | null;
}

// Gate C must not borrow the launch owner's account. LAUNCH_CANARY_EMAIL is a
// real customer identity whose live billing state changes without any deploy
// — a lapsed subscription, a pending plan change, or a row deleted by an
// unrelated admin action turned the release gate red for ~24h (issue #2646),
// and because the client collapsed every non-2xx into
// billing_canary_http_failure the evidence never named the assertion.
//
// The canary now runs on a dedicated non-customer identity that this endpoint
// provisions once and nothing else mutates. The provision is INSERT OR IGNORE:
// an existing row is never repaired, so drift on the dedicated identity still
// fails the stability check loudly and the gate's strength is unchanged.
export const BILLING_CANARY_USER_ID = "billing-canary-0509";
export const BILLING_CANARY_DEFAULT_EMAIL = "billing-canary@0509.internal";

/**
 * The address the billing canary runs as when the caller does not override it.
 * Deliberately independent of LAUNCH_CANARY_EMAIL.
 */
export function resolveDedicatedBillingCanaryEmail(env: AppEnv) {
  return (env.BILLING_CANARY_EMAIL?.trim() || BILLING_CANARY_DEFAULT_EMAIL).toLowerCase();
}

/**
 * Provision the dedicated billing-canary identity exactly once: a `user` row
 * plus a `user_plan` baseline whose state satisfies the canary's stability
 * precondition (`plan` is a canary-supported slug, `dodo_status` is a settled
 * paid state, no pending plan change). Both writes are INSERT OR IGNORE, so an
 * existing row is never clobbered — drift on the dedicated identity still
 * fails the stability check instead of being silently repaired, which is what
 * keeps the gate's strength unchanged.
 */
export async function ensureDedicatedBillingCanaryUser(env: AppEnv, email: string) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?)
    `)
    .bind(BILLING_CANARY_USER_ID, "Billing Canary", email, now, now)
    .run();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO user_plan (user_id, plan, plan_updated_at, dodo_status)
      VALUES (?, 'scout', ?, 'payment.succeeded')
    `)
    .bind(BILLING_CANARY_USER_ID, now)
    .run();
}

export async function getBillingCanaryUser(env: AppEnv, email: string) {
  const result = await env.DB?.prepare(`
      SELECT
        user.id,
        user.email,
        user.name,
        user_plan.plan
      FROM user
      LEFT JOIN user_plan
        ON user_plan.user_id = user.id
      WHERE lower(user.email) = lower(?)
      LIMIT 1
    `).bind(email).all<BillingCanaryUserRow>();

  return result?.results?.[0] ?? null;
}

export async function getUserPlanSnapshot(env: AppEnv, userId: string) {
  const result = await env.DB?.prepare(`
      SELECT
        user_id,
        plan,
        plan_updated_at,
        dodo_payment_id,
        dodo_product_id,
        dodo_plan_change_product_id,
        dodo_status,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_next_billing_at,
        evidence_entitlement_anchor,
        evidence_entitlement_anchor_source
      FROM user_plan
      WHERE user_id = ?
      LIMIT 1
    `).bind(userId).all<UserPlanSnapshot>();

  return result?.results?.[0] ?? null;
}

export function planForCanary(value: string | null): PricingPlanSlug | null {
  if (value === "agency" || value === "starter" || value === "scout") {
    return value;
  }

  return null;
}
