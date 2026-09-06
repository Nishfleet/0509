/**
 * Named policy hooks for evidence usage business rules.
 * Do not scatter assumptions across routes; extend these functions.
 */

import type { PlanFamily } from "~/lib/plan-entitlements";

/** One evidence check = one billable successful landing-page proof capture. */
export function defineEvidenceCheckBillableUnit(): "successful_proof_capture" {
  return "successful_proof_capture";
}

/**
 * Scheduled competitor scans are not proof captures today.
 * Only successful proof captures gated by proof policy consume allowance.
 */
export function scheduledMonitoringConsumesEvidenceCheck(): boolean {
  return false;
}

/** Purchased proof captures are retained forever but only spendable on an active paid plan. */
export function topUpSpendRequiresActivePaidPlan(planFamily: PlanFamily): boolean {
  return planFamily === "scout" || planFamily === "starter" || planFamily === "agency";
}

/**
 * Full top-up refunds claw back only the unspent purchased proof captures.
 * Partial refunds with money amounts claw back a prorated share of remaining
 * credits: min(remaining, round(remaining × refundAmount/paymentAmount)).
 * Partial without amounts (and unknown shapes) stay manual-review only.
 */
export function topUpRefundQuantityAdjustment(input: {
  grantedQuantity: number;
  remainingQuantity: number;
  refundType: "full" | "partial" | "unknown";
  refundAmount?: number | null;
  paymentAmount?: number | null;
}): number | null {
  const remaining = Math.max(0, Math.floor(input.remainingQuantity));
  if (input.refundType === "full") {
    return -remaining;
  }
  if (input.refundType === "partial") {
    const refundAmount = input.refundAmount;
    const paymentAmount = input.paymentAmount;
    if (
      typeof refundAmount !== "number" ||
      typeof paymentAmount !== "number" ||
      !Number.isFinite(refundAmount) ||
      !Number.isFinite(paymentAmount) ||
      refundAmount <= 0 ||
      paymentAmount <= 0
    ) {
      return null;
    }
    const ratio = Math.min(1, refundAmount / paymentAmount);
    const clawback = Math.min(remaining, Math.round(remaining * ratio));
    return -clawback;
  }
  return null;
}

/** Top-up grants remain on the original workspace owner after ownership changes. */
export function topUpCreditsTransferOnOwnershipChange(): false {
  return false;
}

/** Workspace merges are not supported; top-up grants do not transfer. */
export function topUpCreditsTransferOnWorkspaceMerge(): false {
  return false;
}

export function agencySeatCountsOwnerInLimit(): true {
  /** Owner occupies one of the three Agency seats; up to two invited teammates. */
  return true;
}
