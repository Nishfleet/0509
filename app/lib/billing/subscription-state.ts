const PAID_STATUSES = new Set(["trialing", "active", "past_due"]);

export function isSubscriptionLive(plan: { status: string; currentPeriodEnd: string | null }, now: Date): boolean {
  if (PAID_STATUSES.has(plan.status)) return true;
  const paidThrough = plan.currentPeriodEnd === null ? Number.NaN : Date.parse(plan.currentPeriodEnd);
  return plan.status === "cancelled" && paidThrough > now.getTime();
}

const ENDED_STATUSES = new Set(["cancelled", "expired"]);

export function isPlanLapsed(plan: { status: string; currentPeriodEnd: string | null }, now: Date): boolean {
  return ENDED_STATUSES.has(plan.status) && !isSubscriptionLive(plan, now);
}

export function isPaymentHeld(plan: { status: string }): boolean {
  return plan.status === "on_hold";
}

export function isPaymentFailed(plan: { status: string }): boolean {
  return plan.status === "failed";
}

export function isWorkspacePaid(plan: { status: string; currentPeriodEnd: string | null } | null, now: Date): boolean {
  return plan !== null && isSubscriptionLive(plan, now);
}

export function entitledTier(
  plan: { tier: string; status: string; currentPeriodEnd: string | null },
  now: Date,
): string {
  return isSubscriptionLive(plan, now) ? plan.tier : "scout";
}
