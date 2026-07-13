import type { DeliveryAttemptRecord } from "~/lib/types";

// Every provider used by the durable digest/lifecycle claim path has a
// ten-second request timeout. Keep the lease comfortably longer so a normal
// in-flight call is never reclaimed, while a worker that stopped before the
// provider call can be recovered by a later sweep.
export const DELIVERY_PRE_DISPATCH_LEASE_MS = 60_000;

export function deliveryPreDispatchStaleBefore(referenceTimeMs = Date.now()) {
  return new Date(referenceTimeMs - DELIVERY_PRE_DISPATCH_LEASE_MS).toISOString();
}

export function isStalePreDispatchAttempt(
  attempt: Pick<DeliveryAttemptRecord, "status" | "webhookStatus" | "updatedAt">,
  referenceTimeMs = Date.now(),
) {
  if (attempt.status !== "pending" || attempt.webhookStatus !== "pending") {
    return false;
  }

  const updatedAtMs = Date.parse(attempt.updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    updatedAtMs <= referenceTimeMs - DELIVERY_PRE_DISPATCH_LEASE_MS
  );
}
