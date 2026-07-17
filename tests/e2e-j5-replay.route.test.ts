import { describe, expect, it } from "vitest";

import {
  resolveJ5LifecycleTransitionEvidence,
  resolveJ5ReplayClaim,
  resolveJ5ReplayCompletion,
  resolveJ5ReplayAction,
  resolveJ5ReplayStateRequest,
  safeJ5ReplayBlocker,
} from "~/routes/api.e2e.billing.replay";
import type { J5TransitionEvidence, J5TransitionState } from "~/routes/api.e2e.billing.replay";

const viewports = ["375x812", "768x900", "1440x900"] as const;
const paymentUsers = ["e2e-payment-issue", "e2e-payment-issue-tablet", "e2e-payment-issue-desktop"] as const;

function transitionState(overrides: Partial<J5TransitionState> = {}): J5TransitionState {
  return {
    plan: "starter",
    status: "active",
    updatedAt: "2026-07-15T10:00:00.000Z",
    paymentId: "pay-fixture",
    productId: "product-fixture",
    subscriptionId: "sub-fixture",
    customerId: "cus-fixture",
    nextBillingAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

function transitionEvidence(
  before: J5TransitionState,
  after: J5TransitionState,
  response: Record<string, unknown> = { ok: true },
): J5TransitionEvidence {
  return { before, after, response };
}

function stateRequest(userId: string, options: { url?: string; method?: string; cookie?: string; marker?: string } = {}) {
  return new Request(
    options.url ?? `http://127.0.0.1:43127/api/e2e/billing/state?user_id=${userId}`,
    {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? `f9_e2e_fixture=${userId}`,
        "x-0509-e2e-test-mode": options.marker ?? "1",
      },
    },
  );
}

describe("Journey 5 localhost billing replay route contract", () => {
  it.each(viewports.map((viewport, index) => [viewport, paymentUsers[index]!] as const))("binds one signed lifecycle replay per viewport (%s)", (viewport, userId) => {
    expect(resolveJ5ReplayAction(
      `e2e-j5-billing-lifecycle-${viewport}`,
      userId,
      `e2e-run-j5-billing-lifecycle-${viewport}`,
    )).toBe("billing_lifecycle");
  });

  it("rejects unknown keys and identity mismatches", () => {
    expect(resolveJ5ReplayAction("e2e-j5-unknown", "e2e-payment-issue", "e2e-run-j5-unknown")).toBeNull();
    expect(resolveJ5ReplayAction(
      "e2e-j5-billing-lifecycle-375x812",
      "e2e-starter",
      "e2e-run-j5-billing-lifecycle-375x812",
    )).toBeNull();
    expect(resolveJ5ReplayAction(
      "e2e-j5-billing-lifecycle-375x812",
      "e2e-payment-issue",
      "e2e-run-j5-billing-lifecycle-other",
    )).toBeNull();
  });

  it("projects only allowlisted replay failure stages", () => {
    expect(safeJ5ReplayBlocker(new Error("j5_checkout_request_contract_failed"))).toBe(
      "j5_checkout_request_contract_failed",
    );
    expect(safeJ5ReplayBlocker(new Error("secret provider payload"))).toBe("j5_replay_failed");
    expect(safeJ5ReplayBlocker(null)).toBe("j5_replay_failed");
  });

  it("accepts only exact loopback state requests bound to the fixture cookie", () => {
    const userId = "e2e-payment-issue";
    expect(resolveJ5ReplayStateRequest(stateRequest(userId))).toEqual({ userId });
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, { method: "POST" }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, { marker: "0" }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, { cookie: "f9_e2e_fixture=e2e-starter" }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, {
      url: `https://0509.io/api/e2e/billing/state?user_id=${userId}`,
    }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, {
      url: `http://localhost:43127/api/e2e/billing/state?user_id=${userId}`,
    }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, {
      url: `http://127.0.0.1:43127/api/e2e/billing/state?user_id=${userId}&extra=1`,
    }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest(userId, {
      url: `http://127.0.0.1:43127/api/e2e/billing/replay?user_id=${userId}`,
    }))).toBeNull();
  });

  it("rejects duplicate fixture cookies and arbitrary user ids", () => {
    expect(resolveJ5ReplayStateRequest(stateRequest("e2e-payment-issue", {
      cookie: "f9_e2e_fixture=e2e-payment-issue; f9_e2e_fixture=e2e-payment-issue",
    }))).toBeNull();
    expect(resolveJ5ReplayStateRequest(stateRequest("customer-1"))).toBeNull();
  });

  it("gives only the marker owner a replay lease", () => {
    const now = Date.parse("2026-07-15T10:05:00.000Z");
    const row = {
      outcome: "processing",
      metadata_json: JSON.stringify({ runId: "e2e-run-j5-billing-lifecycle-375x812", status: "processing", processingToken: "owner-token", processingStartedAt: "2026-07-15T10:04:30.000Z" }),
    };
    expect(resolveJ5ReplayClaim(row, "owner-token", "e2e-run-j5-billing-lifecycle-375x812", now)).toBe("claimed");
    expect(resolveJ5ReplayClaim(row, "foreign-token", "e2e-run-j5-billing-lifecycle-375x812", now)).toBe("in_progress");
    const staleRow = {
      ...row,
      metadata_json: JSON.stringify({ runId: "e2e-run-j5-billing-lifecycle-375x812", status: "processing", processingToken: "old-token", processingStartedAt: "2026-07-15T10:00:00.000Z" }),
    };
    expect(resolveJ5ReplayClaim(staleRow, "new-token", "e2e-run-j5-billing-lifecycle-375x812", now)).toBe("stale");
  });

  it("requires the same token/run and one changed row to complete", () => {
    const input = {
      changes: 1,
      currentStatus: "processing",
      currentToken: "owner-token",
      currentRunId: "run-1",
      processingToken: "owner-token",
      runId: "run-1",
    };
    expect(resolveJ5ReplayCompletion(input)).toBe(true);
    expect(resolveJ5ReplayCompletion({ ...input, changes: 0 })).toBe(false);
    expect(resolveJ5ReplayCompletion({ ...input, currentToken: "foreign-token" })).toBe(false);
    expect(resolveJ5ReplayCompletion({ ...input, currentRunId: "run-2" })).toBe(false);
  });

  it("derives every lifecycle proof only from exact before/after states", () => {
    const activationIdentity = {
      paymentId: "e2e-j5-pay-375x812",
      productId: "e2e-j5-product-starter-monthly",
      subscriptionId: "e2e-j5-sub-e2e-activation",
      customerId: "e2e-j5-cus-e2e-activation",
    };
    const free = transitionState({ plan: "free", status: null, paymentId: null, productId: null, subscriptionId: null, customerId: null, nextBillingAt: null, updatedAt: "2026-07-15T09:59:00.000Z" });
    const active = transitionState({ ...activationIdentity, updatedAt: "2026-07-15T10:00:01.000Z" });
    const scheduled = transitionState({ ...activationIdentity, status: "cancellation_scheduled", updatedAt: "2026-07-15T10:00:04.000Z" });
    const reversed = transitionState({ ...activationIdentity, updatedAt: "2026-07-15T10:00:07.000Z" });
    const agency = transitionState({
      ...activationIdentity,
      plan: "agency",
      productId: "e2e-j5-product-agency-monthly",
      updatedAt: "2026-07-15T10:00:08.000Z",
    });
    const paymentActive = transitionState({ updatedAt: "2026-07-15T10:00:00.000Z" });
    const paymentFailed = transitionState({ status: "payment.failed", updatedAt: "2026-07-15T10:00:02.000Z" });
    const paymentRecovered = transitionState({ updatedAt: "2026-07-15T10:00:03.000Z" });
    const cancelActive = transitionState({ paymentId: "cancel-pay", subscriptionId: "cancel-sub", updatedAt: "2026-07-15T10:00:08.000Z" });
    const cancelled = transitionState({ plan: "free", status: "subscription.cancelled", paymentId: "cancel-pay", subscriptionId: "cancel-sub", updatedAt: "2026-07-15T10:00:09.000Z" });
    const expiredAfterCancel = transitionState({ ...cancelled, updatedAt: "2026-07-15T10:00:10.000Z" });
    const refundActive = transitionState({ paymentId: "refund-pay", subscriptionId: "refund-sub", updatedAt: "2026-07-15T10:00:11.000Z" });
    const refunded = transitionState({ plan: "free", status: "refunded", paymentId: "refund-pay", subscriptionId: "refund-sub", updatedAt: "2026-07-15T10:00:15.000Z" });
    const evidence: Record<string, J5TransitionEvidence> = {
      activation: transitionEvidence(free, active),
      activation_duplicate: transitionEvidence(active, active, { ok: true, duplicate: true }),
      payment_failed: transitionEvidence(paymentActive, paymentFailed, { paymentIssue: true }),
      payment_recovered: transitionEvidence(paymentFailed, paymentRecovered),
      cancellation_scheduled: transitionEvidence(active, scheduled, { cancellationScheduled: true }),
      cancellation_missing: transitionEvidence(scheduled, scheduled),
      cancellation_null: transitionEvidence(scheduled, scheduled),
      cancellation_reversed: transitionEvidence(scheduled, reversed),
      cancellation_older: transitionEvidence(reversed, reversed),
      plan_change_applied: transitionEvidence(reversed, agency),
      cancelled_activation: transitionEvidence(free, cancelActive),
      cancelled_terminal: transitionEvidence(cancelActive, cancelled, { revoked: true }),
      expired_after_cancel: transitionEvidence(cancelled, expiredAfterCancel, { revoked: true }),
      refunded_activation: transitionEvidence(free, refundActive),
      refund_partial: transitionEvidence(refundActive, refundActive, { ignored: true }),
      refund_failed: transitionEvidence(refundActive, refundActive, { ignored: true }),
      refund_succeeded: transitionEvidence(refundActive, refunded, { refunded: true }),
    };
    const expected = {
      activationPaymentId: activationIdentity.paymentId,
      activationSubscriptionId: activationIdentity.subscriptionId,
      activationCustomerId: activationIdentity.customerId,
    };
    expect(resolveJ5LifecycleTransitionEvidence(evidence, expected)).toEqual({
      activationDuplicate: true,
      paymentFailedRecovered: true,
      cancellationScheduledReversed: true,
      missingNullNoReversal: true,
      olderNoRegression: true,
      planChangeApplied: true,
      cancelledExpiredRevoked: true,
      fullRefundRevoked: true,
      partialAndFailedNoMutation: true,
    });
    const falseGreen = {
      ...evidence,
      activation_duplicate: transitionEvidence(active, transitionState({ ...activationIdentity, status: "payment.failed" }), { ok: true, duplicate: true }),
    };
    expect(resolveJ5LifecycleTransitionEvidence(falseGreen, expected).activationDuplicate).toBe(false);
  });
});
