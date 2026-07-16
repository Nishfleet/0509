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
		applyDodoCancellationReversalWithLedger: vi.fn().mockResolvedValue({ changed: false }),
    applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue(undefined),
		applyDodoPlanPaymentIssueWithLedger: vi.fn(async (_env, input: { occurredAt: string }) => ({
			changed: true, stateUpdatedAt: input.occurredAt,
		})),
		applyDodoPlanRevokeWithWatchlistReconcile: vi.fn(async (_env, input: { revokedAt: string }) => ({
			changed: true, stateUpdatedAt: input.revokedAt,
		})),
    applyDodoProofCreditGrantWithLedger: vi.fn().mockResolvedValue(undefined),
		applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({
			changed: true, stateUpdatedAt: "2026-07-05T00:00:00.000Z",
		}),
    beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue({ status: "claimed" }),
    clearDodoPlanCheckout: vi.fn().mockResolvedValue(true),
    failDodoWebhookEventProcessing: vi.fn().mockResolvedValue(undefined),
		failDodoWebhookEventForLifecycleEmailRetry: vi.fn().mockResolvedValue(true),
    finalizeDodoWebhookLedgerOnly: vi.fn().mockResolvedValue(undefined),
		getUserDeliveryProfile: vi
			.fn()
			.mockResolvedValue({ id: "user-1", email: "owner@example.com", emailVerified: true, name: "Owner" }),
		getUserPlanBillingInfo: vi.fn().mockResolvedValue({
			plan: "starter",
			dodoStatus: "subscription.on_hold",
			dodoSubscriptionId: "sub_123",
			planUpdatedAt: "2026-07-01T08:00:00.000Z",
		}),
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
		isBillingLifecycleEmailExplicitFailure: vi.fn(
			(error: unknown) =>
				error instanceof Error &&
				"code" in error &&
				error.code === "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE",
		),
		sendBillingPaymentIssueEmail: vi.fn().mockResolvedValue(true),
		sendBillingCancellationEmail: vi.fn().mockResolvedValue(true),
		sendBillingRefundEmail: vi.fn().mockResolvedValue(true),
		prepareBillingLifecycleEmailOutbox: vi.fn(
			(_env: unknown, input: { kind: string; userId: string; email: string }) => ({
				userId: input.userId,
				email: input.email,
				idempotencyKey: `outbox:${input.kind}:${input.userId}`,
				templateName: `billing_${input.kind}`,
				payloadSnapshot: { outboxPendingDispatch: true },
			}),
		),
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

function webhookRequest(
	eventId: string,
	body: Record<string, unknown>,
	timestampSeconds = Math.floor(Date.now() / 1000),
) {
  return new Request("https://0509.io/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "webhook-id": eventId,
			"webhook-timestamp": String(timestampSeconds),
      "webhook-signature": "v1=signed",
    },
    body: JSON.stringify(body),
  });
}

function deliverWebhook(
	action: typeof import("~/routes/api.webhooks.dodo").action,
	eventId: string,
	body: Record<string, unknown>,
	timestampSeconds?: number,
) {
	return action({
		context: {},
		request: webhookRequest(eventId, body, timestampSeconds),
		params: {},
	} as never);
}

async function deliverDodoWebhook(
	eventId: string,
	body: Record<string, unknown>,
	timestampSeconds?: number,
) {
	const { action } = await import("~/routes/api.webhooks.dodo");
	return deliverWebhook(action, eventId, body, timestampSeconds);
}

function explicitBillingEmailFailure(idempotencyKey: string) {
	return Object.assign(new Error("Cloudflare Email explicitly rejected the lifecycle email."), {
		code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE",
		idempotencyKey,
	});
}

function claimedLifecycleEmailRetry(
	kind: "payment_issue" | "cancellation_scheduled" | "revoke" | "refund",
	userId: string,
	idempotencyKey: string,
) {
	return {
		status: "claimed",
		lifecycleEmailRetry: { kind, userId, idempotencyKey },
	};
}

const unverified = { email: "u@example.com", emailVerified: false, name: null };
function expectOutbox(mock: ReturnType<typeof vi.fn>) {
	expect(mock.mock.calls.at(-1)?.at(-1)).toEqual({ lifecycleEmailOutbox: expect.anything() });
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
			expect.objectContaining({
				lifecycleEmailOutbox: expect.objectContaining({
					userId: "user-1",
					email: "owner@example.com",
					templateName: "billing_revoke",
					payloadSnapshot: expect.objectContaining({ outboxPendingDispatch: true }),
				}),
			}),
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
			expect.anything(),
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
			expect.anything(),
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
			expect.anything(),
		);
	});

	it("reverses a scheduled cancellation before the pending plan-change guard", async () => {
		const { data, delivery } = mockWebhookDependencies({
			data: {
				applyDodoCancellationReversalWithLedger: vi.fn().mockResolvedValue({ changed: true }),
			},
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
					cancellationScheduled: false,
					metadata: {},
				})),
			},
		});

		const { action } = await import("~/routes/api.webhooks.dodo");
		const response = await action({
			context: {},
			request: webhookRequest("evt-cancel-reversal", { type: "subscription.plan_changed" }),
			params: {},
		} as never);

		expect(await response.json()).toEqual({ ok: true });
		expect(data.applyDodoCancellationReversalWithLedger).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "user-1",
				providerProductId: "pdt_starter_annual",
				providerSubscriptionId: "sub_123",
				providerCustomerId: "cus_123",
				status: "active",
				grantedAt: expect.any(String),
			}),
			expect.objectContaining({
				eventId: "evt-cancel-reversal",
				metadata: expect.objectContaining({ action: "cancellation_reversal" }),
			}),
    );
		expect(data.applyDodoPlanGrantWithWatchlistReconcile).not.toHaveBeenCalled();
		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
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
			expect.anything(),
    );
		expect(data.applyDodoCancellationReversalWithLedger).not.toHaveBeenCalled();
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
			expect.anything(),
    );
  });

	it("uses payment identity for payment.failed without a subscription", async () => {
		const { data, delivery } = mockWebhookDependencies({
      billing: {
        extractDodoPlanRevocation: vi.fn(() => ({
          eventType: "payment.failed",
          action: "payment_issue",
          userId: "user-1",
          customerEmail: "owner@example.com",
					subscriptionId: "payment.failed",
					paymentId: "pay_failed",
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
				providerSubscriptionId: null,
				providerPaymentId: "pay_failed",
      }),
      expect.objectContaining({
        eventId: "evt-plan-change-payment-failed",
        outcome: "processed",
      }),
			expect.anything(),
    );
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			status: "payment.failed", subscriptionId: null, paymentId: "pay_failed",
			stateUpdatedAt: "2026-07-01T08:00:00.000Z",
		}));
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
			expect.anything(),
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
			expect.anything(),
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
			expect.anything(),
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
			expect.anything(),
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
			expect.anything(),
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
