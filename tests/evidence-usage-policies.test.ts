import { describe, expect, it } from "vitest";

import {
  agencySeatCountsOwnerInLimit,
  defineEvidenceCheckBillableUnit,
  scheduledMonitoringConsumesEvidenceCheck,
  topUpCreditsTransferOnOwnershipChange,
  topUpCreditsTransferOnWorkspaceMerge,
  topUpRefundQuantityAdjustment,
  topUpSpendRequiresActivePaidPlan,
} from "~/lib/evidence-usage-policies.server";

describe("evidence usage policy hooks", () => {
  it("defines the billable evidence unit and monitoring treatment", () => {
    expect(defineEvidenceCheckBillableUnit()).toBe("successful_proof_capture");
    expect(scheduledMonitoringConsumesEvidenceCheck()).toBe(false);
  });

  it("lets only active paid plans spend purchased top-up checks", () => {
    expect(topUpSpendRequiresActivePaidPlan("free")).toBe(false);
    expect(topUpSpendRequiresActivePaidPlan("scout")).toBe(true);
    expect(topUpSpendRequiresActivePaidPlan("starter")).toBe(true);
    expect(topUpSpendRequiresActivePaidPlan("agency")).toBe(true);
  });

  it("claws back only unspent top-up checks for full and partial refunds", () => {
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "full",
      }),
    ).toBe(-120);
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "partial",
      }),
    ).toBe(-120);
  });

  it("keeps unknown refund shapes in operator review", () => {
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "unknown",
      }),
    ).toBeNull();
  });

  it("does not transfer top-up grants across workspace ownership or merge changes", () => {
    expect(topUpCreditsTransferOnOwnershipChange()).toBe(false);
    expect(topUpCreditsTransferOnWorkspaceMerge()).toBe(false);
  });

  it("counts the owner inside the Agency seat limit", () => {
    expect(agencySeatCountsOwnerInLimit()).toBe(true);
  });
});
