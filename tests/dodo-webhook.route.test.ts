import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
});

function mockWebhookDependencies(overrides: {
  billing?: Record<string, unknown>;
  data?: Record<string, unknown>;
} = {}) {
  const data = {
    claimDodoWebhookEvent: vi.fn().mockResolvedValue(true),
    deactivateWatchlistsBeyondPlanLimit: vi.fn().mockResolvedValue(0),
    reactivateWatchlistsUpToPlanLimit: vi.fn().mockResolvedValue(0),
    markDodoWebhookEventFinished: vi.fn().mockResolvedValue(undefined),
    markDodoPlanPaymentIssue: vi.fn().mockResolvedValue(undefined),
    revokeDodoAccessForRefundedPayment: vi.fn().mockResolvedValue(undefined),
    grantDodoPlanAccess: vi.fn().mockResolvedValue(undefined),
    grantProofUsageCredit: vi.fn().mockResolvedValue(undefined),
    getUserIdByEmail: vi.fn().mockResolvedValue(null),
    getUserIdForDodoPayment: vi.fn().mockResolvedValue(null),
    revokeDodoPlanAccess: vi.fn().mockResolvedValue(undefined),
    ...overrides.data,
  };
  const billing = {
    verifyDodoWebhookRequest: vi.fn(),
    extractDodoProofCreditGrant: vi.fn(() => null),
    extractDodoPlanRevocation: vi.fn(() => null),
    extractDodoPlanGrant: vi.fn(() => null),
    extractDodoRefund: vi.fn(() => null),
    extractDodoSubscriptionGrant: vi.fn(() => null),
    ...overrides.billing,
  };

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
  }));
  vi.doMock("~/lib/dodo-billing.server", () => billing);
  vi.doMock("~/lib/data.server", () => data);

  return { data, billing };
}

function webhookRequest(eventId: string, body: Record<string, unknown>) {
  return new Request("https://0509.in/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "webhook-signature": "v1=signed",
    },
    body: JSON.stringify(body),
  });
}

describe("Dodo webhook route", () => {
  it("passes the immutable payment grant timestamp instead of the delivery timestamp", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanGrant: vi.fn(() => ({
          userId: "user-1",
          plan: "starter",
          paymentId: "pay-delayed-success",
          productId: "prod_starter_monthly",
          status: "succeeded",
          grantedAt: "2026-06-04T12:00:00.000Z",
          metadata: {
            created_at: "2026-06-04T12:00:00.000Z",
          },
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");

    await action({
      context: {},
      request: webhookRequest("evt-delayed-success", { type: "payment.succeeded" }),
      params: {},
    } as never);

    expect(data.grantDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerPaymentId: "pay-delayed-success",
        grantedAt: "2026-06-04T12:00:00.000Z",
      }),
    );
    expect(data.markDodoWebhookEventFinished).toHaveBeenCalledWith(
      expect.anything(),
      "evt-delayed-success",
      expect.objectContaining({ outcome: "processed" }),
    );
  });

  it("revokes plan access when a subscription lifecycle event arrives", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.cancelled",
          action: "revoke",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "cancelled",
          revokedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-cancel", { type: "subscription.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(data.revokeDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        providerSubscriptionId: "sub_123",
        status: "subscription.cancelled",
        revokedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    // free plan allows 0 watchlists — all of them stop scanning on revocation
    expect(data.deactivateWatchlistsBeyondPlanLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      0,
    );
    expect(data.getUserIdByEmail).not.toHaveBeenCalled();
  });

  it("grants and refreshes the plan from subscription.renewed (real subscriptions carry no product_cart)", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.renewed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_monthly",
          plan: "starter",
          cycle: "monthly",
          status: "active",
          grantedAt: "2026-07-12T00:00:00.000Z",
          nextBillingAt: "2026-08-12T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-renewal", { type: "subscription.renewed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true });
    expect(data.grantDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        plan: "starter",
        providerSubscriptionId: "sub_123",
        providerCustomerId: "cus_123",
        nextBillingAt: "2026-08-12T00:00:00.000Z",
        status: "active",
        grantedAt: "2026-07-12T00:00:00.000Z",
      }),
    );
    expect(data.markDodoWebhookEventFinished).toHaveBeenCalledWith(
      expect.anything(),
      "evt-renewal",
      expect.objectContaining({ outcome: "processed" }),
    );
    // resubscribe/renewal brings auto-paused watchlists back up to the limit
    expect(data.reactivateWatchlistsUpToPlanLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      10,
    );
  });

  it("deactivates over-limit watchlists when a plan switch is a downgrade", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanGrant: vi.fn(() => ({
          userId: "user-1",
          plan: "scout",
          paymentId: "pay-downgrade",
          productId: "prod_scout_monthly",
          status: "succeeded",
          grantedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: webhookRequest("evt-downgrade", { type: "payment.succeeded" }),
      params: {},
    } as never);

    // scout keeps its newest 3 watchlists scanning; the rest pause
    expect(data.deactivateWatchlistsBeyondPlanLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      3,
    );
  });

  it("keeps the paid plan and records a payment issue for on-hold/failed renewals", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.on_hold",
          action: "payment_issue",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "on_hold",
          revokedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(data.markDodoPlanPaymentIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        status: "subscription.on_hold",
        occurredAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    // the paying customer must NOT lose access over a renewal hiccup
    expect(data.revokeDodoPlanAccess).not.toHaveBeenCalled();
  });

  it("revokes plan and expires credits when a full refund succeeds", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoRefund: vi.fn(() => ({
          eventType: "refund.succeeded",
          paymentId: "pay-refunded",
          refundId: "ref-1",
          refundedAt: "2026-07-05T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        getUserIdForDodoPayment: vi.fn().mockResolvedValue("user-refund"),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-refund", { type: "refund.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, refunded: true });
    expect(data.revokeDodoAccessForRefundedPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paymentId: "pay-refunded",
        refundedAt: "2026-07-05T00:00:00.000Z",
      }),
    );
    expect(data.deactivateWatchlistsBeyondPlanLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-refund",
      0,
    );
  });

  it("resolves the user by customer email when subscription metadata lacks a user id", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.expired",
          action: "revoke",
          userId: null,
          customerEmail: "owner@example.com",
          subscriptionId: "sub_456",
          status: "expired",
          revokedAt: "2026-07-02T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        getUserIdByEmail: vi.fn().mockResolvedValue("user-email-match"),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-expire", { type: "subscription.expired" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(data.getUserIdByEmail).toHaveBeenCalledWith(expect.anything(), "owner@example.com");
    expect(data.revokeDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-email-match" }),
    );
  });

  it("acknowledges but does not revoke when no user can be matched", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.cancelled",
          action: "revoke",
          userId: null,
          customerEmail: "stranger@example.com",
          subscriptionId: "sub_789",
          status: "cancelled",
          revokedAt: "2026-07-03T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-orphan", { type: "subscription.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
    expect(data.revokeDodoPlanAccess).not.toHaveBeenCalled();
  });

  it("skips processing entirely when the event was already claimed", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanGrant: vi.fn(() => ({
          userId: "user-1",
          plan: "starter",
          paymentId: "pay-1",
          productId: "prod_1",
          status: "succeeded",
          grantedAt: "2026-06-04T12:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        claimDodoWebhookEvent: vi.fn().mockResolvedValue(false),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-duplicate", { type: "payment.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(data.grantDodoPlanAccess).not.toHaveBeenCalled();
    expect(data.markDodoWebhookEventFinished).not.toHaveBeenCalled();
  });

  it("marks the ledger entry failed when processing throws, so redelivery can retry", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanGrant: vi.fn(() => ({
          userId: "user-1",
          plan: "starter",
          paymentId: "pay-1",
          productId: "prod_1",
          status: "succeeded",
          grantedAt: "2026-06-04T12:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        grantDodoPlanAccess: vi.fn().mockRejectedValue(new Error("d1 blew up")),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");

    await expect(
      action({
        context: {},
        request: webhookRequest("evt-fails", { type: "payment.succeeded" }),
        params: {},
      } as never),
    ).rejects.toThrow("d1 blew up");

    expect(data.markDodoWebhookEventFinished).toHaveBeenCalledWith(
      expect.anything(),
      "evt-fails",
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});
