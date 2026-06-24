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
    applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue(undefined),
    applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue(undefined),
    applyDodoPlanRevokeWithWatchlistReconcile: vi.fn().mockResolvedValue(undefined),
    applyDodoProofCreditGrantWithLedger: vi.fn().mockResolvedValue(undefined),
    applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue(undefined),
    beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue({ status: "claimed" }),
    failDodoWebhookEventProcessing: vi.fn().mockResolvedValue(undefined),
    finalizeDodoWebhookLedgerOnly: vi.fn().mockResolvedValue(undefined),
    getUserIdForDodoPayment: vi.fn().mockResolvedValue(null),
    getUserIdForDodoLifecycle: vi.fn().mockResolvedValue(null),
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
  return new Request("https://0509.io/api/webhooks/dodo", {
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

    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerPaymentId: "pay-delayed-success",
        grantedAt: "2026-06-04T12:00:00.000Z",
      }),
      expect.any(Number),
      expect.objectContaining({
        eventId: "evt-delayed-success",
        outcome: "processed",
      }),
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
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        providerSubscriptionId: "sub_123",
        status: "subscription.cancelled",
        revokedAt: "2026-07-01T00:00:00.000Z",
      }),
      0,
      expect.objectContaining({ eventId: "evt-cancel", outcome: "processed" }),
    );
    expect(data.getUserIdForDodoLifecycle).not.toHaveBeenCalled();
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
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
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
      10,
      expect.objectContaining({ eventId: "evt-renewal", outcome: "processed" }),
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
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        plan: "scout",
      }),
      3,
      expect.objectContaining({ eventId: "evt-downgrade", outcome: "processed" }),
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
    expect(data.applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        status: "subscription.on_hold",
        occurredAt: "2026-07-01T00:00:00.000Z",
      }),
      expect.objectContaining({ eventId: "evt-on-hold", outcome: "processed" }),
    );
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
  });

  it("resolves payment-issue lifecycle events without metadata user id by Dodo linkage", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.on_hold",
          action: "payment_issue",
          userId: null,
          customerEmail: "owner@example.com",
          customerId: "cus_123",
          subscriptionId: "sub_123",
          status: "on_hold",
          revokedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        getUserIdForDodoLifecycle: vi.fn().mockResolvedValue("user-linked"),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold-linked", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(data.applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-linked",
        status: "subscription.on_hold",
      }),
      expect.objectContaining({ eventId: "evt-on-hold-linked", outcome: "processed" }),
    );
    expect(data.getUserIdForDodoLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      {
        subscriptionId: "sub_123",
        customerId: "cus_123",
        customerEmail: "owner@example.com",
      },
    );
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
  });

  it("grants proof credits through evidence_top_up_grant on payment.succeeded", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoProofCreditGrant: vi.fn(() => ({
          userId: "user-1",
          paymentId: "pay-topup-500",
          productId: "prod_pack_500",
          skuSlug: "burst_500_v1",
          bundle: "proof_500",
          quantity: 1,
          credits: 500,
          grantedAt: "2026-06-24T12:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-topup", { type: "payment.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true });
    expect(data.applyDodoProofCreditGrantWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        providerPaymentId: "pay-topup-500",
        providerProductId: "prod_pack_500",
        bundleSlug: "proof_500",
        skuSlug: "burst_500_v1",
        credits: 500,
        quantity: 1,
        grantedAt: "2026-06-24T12:00:00.000Z",
      }),
      expect.objectContaining({ eventId: "evt-topup", outcome: "processed" }),
    );
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).not.toHaveBeenCalled();
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
    expect(data.applyDodoRefundWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paymentId: "pay-refunded",
        refundedAt: "2026-07-05T00:00:00.000Z",
        userId: "user-refund",
      }),
      0,
      expect.objectContaining({ eventId: "evt-refund", outcome: "processed" }),
    );
  });

  it("resolves lifecycle events without metadata user id by stored Dodo subscription linkage", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.expired",
          action: "revoke",
          userId: null,
          customerEmail: "owner@example.com",
          customerId: "cus_456",
          subscriptionId: "sub_456",
          status: "expired",
          revokedAt: "2026-07-02T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        getUserIdForDodoLifecycle: vi.fn().mockResolvedValue("user-linked"),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-expire", { type: "subscription.expired" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(data.getUserIdForDodoLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      {
        subscriptionId: "sub_456",
        customerId: "cus_456",
        customerEmail: "owner@example.com",
      },
    );
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-linked",
        providerSubscriptionId: "sub_456",
        status: "subscription.expired",
      }),
      0,
      expect.objectContaining({ eventId: "evt-expire", outcome: "processed" }),
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
          customerId: "cus_789",
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
    expect(data.getUserIdForDodoLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      {
        subscriptionId: "sub_789",
        customerId: "cus_789",
        customerEmail: "stranger@example.com",
      },
    );
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
    expect(data.finalizeDodoWebhookLedgerOnly).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt-orphan",
        outcome: "ignored",
      }),
    );
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
        beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue({
          status: "duplicate",
          outcome: "processed",
        }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-duplicate", { type: "payment.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).not.toHaveBeenCalled();
  });

  it("rejects blank webhook ids before claiming the event", async () => {
    mockWebhookDependencies();
    const { action } = await import("~/routes/api.webhooks.dodo");

    await expect(
      action({
        context: {},
        request: new Request("https://0509.io/api/webhooks/dodo", {
          method: "POST",
          headers: {
            "webhook-signature": "v1=signed",
          },
          body: JSON.stringify({ type: "payment.succeeded" }),
        }),
        params: {},
      } as never),
    ).rejects.toMatchObject({ status: 400 });
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
        applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockRejectedValue(new Error("d1 blew up")),
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

    expect(data.failDodoWebhookEventProcessing).toHaveBeenCalledWith(
      expect.anything(),
      "evt-fails",
      expect.objectContaining({ error: "d1 blew up" }),
    );
  });
});

describe("scheduled cancellation safety", () => {
  it("keeps the plan when subscription.cancelled is effective in the future", async () => {
    const futureIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.cancelled",
          action: "revoke",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "cancelled",
          revokedAt: futureIso,
          effectiveAt: futureIso,
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-scheduled-cancel", { type: "subscription.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, cancellationScheduled: true });
    // the customer keeps what they paid for until period end
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
    expect(data.applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "cancellation_scheduled",
        cancellationEffectiveAt: futureIso,
      }),
      expect.objectContaining({
        eventId: "evt-scheduled-cancel",
        outcome: "processed",
      }),
    );
  });

  it("revokes immediately when the cancellation is already effective", async () => {
    const pastIso = "2026-06-01T00:00:00.000Z";
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.cancelled",
          action: "revoke",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "cancelled",
          revokedAt: pastIso,
          effectiveAt: pastIso,
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: webhookRequest("evt-immediate-cancel", { type: "subscription.cancelled" }),
      params: {},
    } as never);

    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).toHaveBeenCalled();
  });
});
