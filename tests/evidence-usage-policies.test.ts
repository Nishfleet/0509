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

  it("claws back unspent top-up checks only for full refunds", () => {
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "full",
      }),
    ).toBe(-120);
  });

  it("prorates partial refunds when money amounts are present (WP-38)", () => {
    // Half-refund leaves half the unspent credits (claw back 60 of 120).
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "partial",
        refundAmount: 50,
        paymentAmount: 100,
      }),
    ).toBe(-60);
    // Full money partial still caps at remaining.
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 40,
        refundType: "partial",
        refundAmount: 100,
        paymentAmount: 100,
      }),
    ).toBe(-40);
  });

  it("keeps partial refunds without amounts (and unknown) in operator review", () => {
    expect(
      topUpRefundQuantityAdjustment({
        grantedQuantity: 500,
        remainingQuantity: 120,
        refundType: "partial",
      }),
    ).toBeNull();
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
