import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/dodo-billing.server");
});

function mockWebhookDependencies(overrides: {
  billing?: Record<string, unknown>;
  data?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
} = {}) {
  const data = {
    applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue(undefined),
    applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue({ changed: true }),
    applyDodoPlanRevokeWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: true }),
    applyDodoProofCreditGrantWithLedger: vi.fn().mockResolvedValue(undefined),
    applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: true }),
    beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue({ status: "claimed" }),
    clearDodoPlanCheckout: vi.fn().mockResolvedValue(true),
    failDodoWebhookEventProcessing: vi.fn().mockResolvedValue(undefined),
    finalizeDodoWebhookLedgerOnly: vi.fn().mockResolvedValue(undefined),
    getUserDeliveryProfile: vi
      .fn()
      .mockResolvedValue({ id: "user-1", email: "owner@example.com", name: "Owner" }),
    getUserIdForDodoPayment: vi.fn().mockResolvedValue(null),
    getUserIdForDodoLifecycle: vi.fn().mockResolvedValue(null),
    ...overrides.data,
  };
  const billing = {
    verifyDodoWebhookRequest: vi.fn(),
    extractDodoProofCreditGrant: vi.fn(() => null),
    extractDodoPlanRevocation: vi.fn(() => null),
    extractDodoPlanCheckoutFailure: vi.fn(() => null),
    extractDodoPlanGrant: vi.fn(() => null),
    extractDodoRefund: vi.fn(() => null),
    extractDodoSubscriptionGrant: vi.fn(() => null),
    ...overrides.billing,
  };
  const delivery = {
    sendBillingPaymentIssueEmail: vi.fn().mockResolvedValue(true),
    sendBillingCancellationEmail: vi.fn().mockResolvedValue(true),
    sendBillingRefundEmail: vi.fn().mockResolvedValue(true),
    ...overrides.delivery,
  };

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
  }));
  vi.doMock("~/lib/dodo-billing.server", () => billing);
  vi.doMock("~/lib/data.server", () => data);
  vi.doMock("~/lib/delivery.server", () => delivery);

  return { data, billing, delivery };
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
  it("rejects oversized webhook bodies before signature verification", async () => {
    const { billing } = mockWebhookDependencies();
    const { action } = await import("~/routes/api.webhooks.dodo");

    await expect(
      action({
        context: {},
        request: new Request("https://0509.io/api/webhooks/dodo", {
          method: "POST",
          headers: {
            "content-length": "256001",
            "webhook-id": "evt-large",
            "webhook-signature": "v1=signed",
          },
          body: "{}",
        }),
        params: {},
      } as never),
    ).rejects.toMatchObject({ status: 413 });

    expect(billing.verifyDodoWebhookRequest).not.toHaveBeenCalled();
  });

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
      1,
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

  it("refreshes local entitlements when Dodo confirms a subscription plan change", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_annual",
          plan: "starter",
          cycle: "yearly",
          status: "active",
          grantedAt: "2026-07-02T00:00:00.000Z",
          hasProviderGrantTimestamp: true,
          nextBillingAt: "2027-07-02T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-plan-changed", { type: "subscription.plan_changed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true });
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        plan: "starter",
        providerProductId: "pdt_starter_annual",
        providerSubscriptionId: "sub_123",
        providerCustomerId: "cus_123",
        nextBillingAt: "2027-07-02T00:00:00.000Z",
        status: "active",
        grantedAt: "2026-07-02T00:00:00.000Z",
        forcePlanChangePending: false,
        requirePlanChangePending: false,
      }),
      10,
      expect.objectContaining({
        eventId: "evt-plan-changed",
        outcome: "processed",
        metadata: expect.objectContaining({ eventType: "subscription.plan_changed" }),
      }),
    );
  });

  it("uses the signed webhook timestamp for no-timestamp Dodo plan-changed webhooks", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_annual",
          plan: "starter",
          cycle: "yearly",
          status: "active",
          grantedAt: null,
          hasProviderGrantTimestamp: false,
          nextBillingAt: "2027-07-02T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: webhookRequest("evt-plan-changed-no-timestamp", { type: "subscription.plan_changed" }),
      params: {},
    } as never);

    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
          userId: "user-1",
          plan: "starter",
          grantedAt: expect.any(String),
          forcePlanChangePending: true,
          requirePlanChangePending: true,
        }),
      10,
      expect.objectContaining({ eventId: "evt-plan-changed-no-timestamp" }),
    );
  });

  it("falls back to the pending-target guard when a no-timestamp plan-changed webhook lacks a timestamp header", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_annual",
          plan: "starter",
          cycle: "yearly",
          status: "active",
          grantedAt: null,
          hasProviderGrantTimestamp: false,
          nextBillingAt: "2027-07-02T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: new Request("https://0509.io/api/webhooks/dodo", {
        method: "POST",
        headers: {
          "webhook-id": "evt-plan-changed-no-header-timestamp",
          "webhook-signature": "v1=signed",
        },
        body: JSON.stringify({ type: "subscription.plan_changed" }),
      }),
      params: {},
    } as never);

    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        plan: "starter",
        grantedAt: undefined,
        forcePlanChangePending: true,
        requirePlanChangePending: true,
      }),
      10,
      expect.objectContaining({ eventId: "evt-plan-changed-no-header-timestamp" }),
    );
  });

  it("clears the pending plan checkout lock when a signed terminal checkout failure arrives", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanCheckoutFailure: vi.fn(() => ({
          eventType: "payment.cancelled",
          userId: "user-1",
          paymentId: "pay_cancelled",
          checkoutId: "checkout_1",
          status: "payment.cancelled",
          failedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-plan-cancelled", { type: "payment.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      allowMissingStoredCheckoutId: true,
      checkoutId: "checkout_1",
      occurredAt: "2026-07-01T08:00:00.000Z",
      requireMissingStoredCheckoutId: false,
    });
    expect(data.finalizeDodoWebhookLedgerOnly).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt-plan-cancelled",
        outcome: "processed",
        metadata: expect.objectContaining({
          action: "checkout_failure",
          checkoutId: "checkout_1",
          userId: "user-1",
          status: "payment.cancelled",
        }),
      }),
    );
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).not.toHaveBeenCalled();
  });

  it("clears a stale pending checkout from signed terminal failure events without a checkout id", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanCheckoutFailure: vi.fn(() => ({
          eventType: "payment.cancelled",
          userId: "user-1",
          paymentId: "pay_cancelled",
          checkoutId: null,
          status: "payment.cancelled",
          failedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-plan-cancelled-no-checkout", { type: "payment.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      allowTimestampMatchedStoredCheckoutId: true,
      checkoutId: null,
      occurredAt: "2026-07-01T08:00:00.000Z",
    });
    expect(data.finalizeDodoWebhookLedgerOnly).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt-plan-cancelled-no-checkout",
        outcome: "processed",
        metadata: expect.objectContaining({
          action: "checkout_failure",
          checkoutId: null,
          userId: "user-1",
        }),
      }),
    );
  });

  it("clears a free pending checkout when subscription.failed has no checkout id", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.failed",
          action: "payment_issue",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "failed",
          revokedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-subscription-failed-no-checkout", { type: "subscription.failed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      allowTimestampMatchedStoredCheckoutId: true,
      occurredAt: "2026-07-01T08:00:00.000Z",
    });
    expect(data.applyDodoPlanPaymentIssueWithLedger).not.toHaveBeenCalled();
    expect(data.finalizeDodoWebhookLedgerOnly).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt-subscription-failed-no-checkout",
        outcome: "processed",
        metadata: expect.objectContaining({
          action: "checkout_failure",
          checkoutId: null,
          userId: "user-1",
          eventType: "subscription.failed",
        }),
      }),
    );
  });

  it("clears a pending plan checkout when subscription mandate creation fails", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanCheckoutFailure: vi.fn(() => ({
          eventType: "subscription.failed",
          userId: "user-1",
          paymentId: null,
          checkoutId: "checkout_failed_sub",
          status: "failed",
          failedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-subscription-failed", { type: "subscription.failed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      allowMissingStoredCheckoutId: true,
      checkoutId: "checkout_failed_sub",
      occurredAt: "2026-07-01T08:00:00.000Z",
      requireMissingStoredCheckoutId: false,
    });
    expect(data.applyDodoPlanPaymentIssueWithLedger).not.toHaveBeenCalled();
  });

  it("records active subscription.failed events as payment issues when no pending checkout clears", async () => {
    const { data } = mockWebhookDependencies({
      data: {
        clearDodoPlanCheckout: vi.fn().mockResolvedValue(false),
      },
      billing: {
        extractDodoPlanCheckoutFailure: vi.fn(() => ({
          eventType: "subscription.failed",
          userId: "user-1",
          paymentId: null,
          checkoutId: "checkout_old",
          status: "failed",
          failedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.failed",
          action: "payment_issue",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "failed",
          revokedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-subscription-failed-active", { type: "subscription.failed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledTimes(1);
    expect(data.clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      allowMissingStoredCheckoutId: true,
      checkoutId: "checkout_old",
      occurredAt: "2026-07-01T08:00:00.000Z",
      requireMissingStoredCheckoutId: false,
    });
    expect(data.finalizeDodoWebhookLedgerOnly).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ action: "checkout_failure" }),
      }),
    );
    expect(data.applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        status: "subscription.failed",
        occurredAt: "2026-07-01T08:00:00.000Z",
      }),
      expect.objectContaining({
        eventId: "evt-subscription-failed-active",
        outcome: "processed",
      }),
    );
  });

  it("records Dodo plan-change payment.failed events as payment issues", async () => {
    const { data } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "payment.failed",
          action: "payment_issue",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "failed",
          revokedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-plan-change-payment-failed", { type: "payment.failed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(data.applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        status: "payment.failed",
        occurredAt: "2026-07-01T08:00:00.000Z",
      }),
      expect.objectContaining({
        eventId: "evt-plan-change-payment-failed",
        outcome: "processed",
      }),
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

  it("keeps the paid plan and records a payment issue for on-hold renewals", async () => {
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
      1,
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
      1,
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
  it("treats subscription.cancelled as terminal even when its payload carries a future date", async () => {
    const futureIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, delivery } = mockWebhookDependencies({
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

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "subscription.cancelled",
      }),
      1,
      expect.objectContaining({ eventId: "evt-scheduled-cancel", outcome: "processed" }),
    );
    expect(data.applyDodoPlanPaymentIssueWithLedger).not.toHaveBeenCalled();
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "ended", eventId: "evt-scheduled-cancel" }),
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

describe("customer lifecycle billing emails", () => {
  function paymentIssueRevocation(eventType = "subscription.on_hold") {
    return vi.fn(() => ({
      eventType,
      action: "payment_issue",
      userId: "user-1",
      customerEmail: "owner@example.com",
      subscriptionId: "sub_123",
      status: "failed",
      revokedAt: "2026-07-01T08:00:00.000Z",
      metadata: {},
    }));
  }

  it("sends exactly one dunning email when a payment issue lands", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1", email: "owner@example.com", name: "Owner" },
    );
    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
    expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
  });

  it("skips the dunning email when the monotonic guard rejected a stale event", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
      data: {
        applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue({ changed: false }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold-stale", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
  });

  it("skips the dunning email silently when the user has no delivery profile", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
      data: {
        getUserDeliveryProfile: vi.fn().mockResolvedValue(null),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold-no-profile", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
  });

  it("never fails the webhook when the lifecycle email send throws", async () => {
    const { data, delivery } = mockWebhookDependencies({
      billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
      delivery: {
        sendBillingPaymentIssueEmail: vi.fn().mockRejectedValue(new Error("email down")),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-on-hold-email-down", { type: "subscription.on_hold" }),
      params: {},
    } as never);

    // business state is committed before the email; a send failure must not 500
    expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
    expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(1);
    expect(data.failDodoWebhookEventProcessing).not.toHaveBeenCalled();
  });

  it("retains the paid grant and sends one scheduled-cancellation email for plan_changed with the cancel flag", async () => {
    const futureIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, delivery } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_monthly",
          plan: "starter",
          cycle: "monthly",
          status: "active",
          grantedAt: "2026-07-13T08:00:00.000Z",
          hasProviderGrantTimestamp: true,
          nextBillingAt: futureIso,
          cancellationScheduled: true,
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-cancel-scheduled-email", { type: "subscription.plan_changed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, cancellationScheduled: true });
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        plan: "starter",
        status: "cancellation_scheduled",
        nextBillingAt: futureIso,
      }),
      10,
      expect.objectContaining({ eventId: "evt-cancel-scheduled-email" }),
    );
    expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        kind: "scheduled",
        effectiveAt: futureIso,
        eventId: "evt-cancel-scheduled-email",
      },
    );
    expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
  });

  it("keeps a normal plan_changed grant active and sends no cancellation email", async () => {
    const { data, delivery } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_monthly",
          plan: "starter",
          cycle: "monthly",
          status: "active",
          grantedAt: "2026-07-13T08:00:00.000Z",
          hasProviderGrantTimestamp: true,
          nextBillingAt: "2026-08-13T08:00:00.000Z",
          cancellationScheduled: false,
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-normal-plan-change", { type: "subscription.plan_changed" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true });
    expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active" }),
      10,
      expect.anything(),
    );
    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
  });

  it("skips a scheduled-cancellation email when the plan-change grant was rejected as stale", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoSubscriptionGrant: vi.fn(() => ({
          eventType: "subscription.plan_changed",
          userId: "user-1",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          productId: "pdt_starter_monthly",
          plan: "starter",
          cycle: "monthly",
          status: "active",
          grantedAt: "2026-07-01T08:00:00.000Z",
          hasProviderGrantTimestamp: true,
          nextBillingAt: "2026-08-01T08:00:00.000Z",
          cancellationScheduled: true,
          metadata: {},
        })),
      },
      data: {
        applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: webhookRequest("evt-stale-scheduled-cancel", { type: "subscription.plan_changed" }),
      params: {},
    } as never);

    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
  });

  it("sends the access-ended email when a revoke lands", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.expired",
          action: "revoke",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "expired",
          revokedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-expired-email", { type: "subscription.expired" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
        kind: "ended",
        eventId: "evt-expired-email",
      },
    );
  });

  it("skips the access-ended email when the revoke was a stale no-op", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "subscription.expired",
          action: "revoke",
          userId: "user-1",
          customerEmail: "owner@example.com",
          subscriptionId: "sub_123",
          status: "expired",
          revokedAt: "2026-07-01T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        applyDodoPlanRevokeWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    await action({
      context: {},
      request: webhookRequest("evt-expired-stale", { type: "subscription.expired" }),
      params: {},
    } as never);

    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
  });

  it("sends the refund email to the matched user", async () => {
    const { delivery } = mockWebhookDependencies({
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
        getUserDeliveryProfile: vi
          .fn()
          .mockResolvedValue({ id: "user-refund", email: "refunded@example.com", name: null }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-refund-email", { type: "refund.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, refunded: true });
    expect(delivery.sendBillingRefundEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendBillingRefundEmail).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-refund",
        email: "refunded@example.com",
        name: null,
        eventId: "evt-refund-email",
      },
    );
  });

  it("sends no refund email when the payment matches no user", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoRefund: vi.fn(() => ({
          eventType: "refund.succeeded",
          paymentId: "pay-unmatched",
          refundId: "ref-2",
          refundedAt: "2026-07-05T00:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-refund-unmatched", { type: "refund.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, refunded: true });
    expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
  });

  it("sends no refund email when reconciliation reports a stale or already-free no-op", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoRefund: vi.fn(() => ({
          eventType: "refund.succeeded",
          paymentId: "pay-already-revoked",
          refundId: "ref-noop",
          refundedAt: "2026-07-05T00:00:00.000Z",
          metadata: {},
        })),
      },
      data: {
        getUserIdForDodoPayment: vi.fn().mockResolvedValue("user-refund"),
        applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-refund-noop", { type: "refund.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, refunded: true });
    expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
  });

  it("does not send a merchant receipt for payment grants because Dodo is merchant of record", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoPlanGrant: vi.fn(() => ({
          userId: "user-1",
          plan: "starter",
          paymentId: "pay-mor",
          productId: "pdt_starter_monthly",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          status: "succeeded",
          grantedAt: "2026-07-13T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-mor-payment", { type: "payment.succeeded" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true });
    expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
    expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
  });

  it("sends no lifecycle email for a checkout-failure classification", async () => {
    const { delivery } = mockWebhookDependencies({
      billing: {
        extractDodoPlanCheckoutFailure: vi.fn(() => ({
          eventType: "payment.cancelled",
          userId: "user-1",
          paymentId: "pay_cancelled",
          checkoutId: "checkout_1",
          status: "payment.cancelled",
          failedAt: "2026-07-01T08:00:00.000Z",
          metadata: {},
        })),
      },
    });

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: webhookRequest("evt-checkout-fail-no-email", { type: "payment.cancelled" }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
    expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
    expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
    expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
  });
});
