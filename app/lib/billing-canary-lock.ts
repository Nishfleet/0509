export const BILLING_CANARY_LOCK_PREFIX = "billing-canary-lock:";

function normalizeBillingCanaryLockSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function billingCanaryLockPrefixForUser(userId: string) {
  return `${BILLING_CANARY_LOCK_PREFIX}${normalizeBillingCanaryLockSegment(userId)}:`;
}

export function buildBillingCanaryLockId(userId: string, nonce: string) {
  return `${billingCanaryLockPrefixForUser(userId)}${normalizeBillingCanaryLockSegment(nonce)}`;
}

export function billingCanaryLockBelongsToUser(
  lockId: string | null | undefined,
  userId: string,
) {
  return typeof lockId === "string" && lockId.startsWith(billingCanaryLockPrefixForUser(userId));
}
