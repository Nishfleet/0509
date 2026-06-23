/**
 * Named policy hooks for evidence usage and unresolved business rules.
 * Do not scatter assumptions across routes — extend these functions.
 */

import type { PlanFamily } from "~/lib/plan-entitlements";

/** One evidence check = one billable successful landing-page proof capture. */
export function defineEvidenceCheckBillableUnit(): "successful_proof_capture" {
  return "successful_proof_capture";
}

/**
 * Scheduled competitor scans are not evidence checks today.
 * Only successful proof captures gated by proof policy consume allowance.
 */
export function scheduledMonitoringConsumesEvidenceCheck(): boolean {
  return false;
}

/**
 * OWNER DECISION PENDING: whether top-up balance remains spendable after subscription cancellation.
 * Current behavior: credits remain visible and spendable while workspace exists.
 */
export function topUpSpendAllowedAfterSubscriptionCancelled(_planFamily: PlanFamily): boolean {
  return true;
}

/**
 * OWNER DECISION PENDING: partial refund/chargeback treatment.
 * Returns quantity to claw back when refund is unambiguous; null → operator review.
 */
export function topUpRefundQuantityAdjustment(input: {
  grantedQuantity: number;
  remainingQuantity: number;
  refundType: "full" | "partial" | "unknown";
}): number | null {
  if (input.refundType === "full") {
    return -input.remainingQuantity;
  }
  if (input.refundType === "unknown") {
    return null;
  }
  return -input.remainingQuantity;
}

/**
 * OWNER DECISION PENDING: workspace ownership transfer.
 * Current behavior: grants remain on the original workspace user_id.
 */
export function topUpCreditsTransferOnOwnershipChange(): false {
  return false;
}

/**
 * OWNER DECISION PENDING: workspace merge.
 * Current behavior: not supported — credits stay on source workspace.
 */
export function topUpCreditsTransferOnWorkspaceMerge(): false {
  return false;
}

export function agencySeatCountsOwnerInLimit(): true {
  /** Owner occupies one of the three Agency seats; up to two invited teammates. */
  return true;
}
