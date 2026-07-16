import { afterEach, beforeEach, expect, vi } from "vitest";

export function setupDodoWebhookLifecycle() {
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
			applyDodoPlanPaymentIssueWithLedger: vi.fn(async (_env, input: { occurredAt: string }) => ({ changed: true, stateUpdatedAt: input.occurredAt })),
			applyDodoPlanRevokeWithWatchlistReconcile: vi.fn(async (_env, input: { revokedAt: string }) => ({ changed: true, stateUpdatedAt: input.revokedAt })),
			applyDodoProofCreditGrantWithLedger: vi.fn().mockResolvedValue(undefined),
			applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: true, stateUpdatedAt: "2026-07-05T00:00:00.000Z" }),
			beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue({ status: "claimed" }),
			clearDodoPlanCheckout: vi.fn().mockResolvedValue(true),
			failDodoWebhookEventProcessing: vi.fn().mockResolvedValue(undefined),
			failDodoWebhookEventForLifecycleEmailRetry: vi.fn().mockResolvedValue(true),
			finalizeDodoWebhookLedgerOnly: vi.fn().mockResolvedValue(undefined),
			getUserDeliveryProfile: vi.fn().mockResolvedValue({ id: "user-1", email: "owner@example.com", emailVerified: true, name: "Owner" }),
			getUserPlanBillingInfo: vi.fn().mockResolvedValue({ plan: "starter", dodoStatus: "subscription.on_hold", dodoSubscriptionId: "sub_123", planUpdatedAt: "2026-07-01T08:00:00.000Z" }),
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
			isBillingLifecycleEmailExplicitFailure: vi.fn((error: unknown) => error instanceof Error && "code" in error && error.code === "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE"),
			sendBillingPaymentIssueEmail: vi.fn().mockResolvedValue(true),
			sendBillingCancellationEmail: vi.fn().mockResolvedValue(true),
			sendBillingRefundEmail: vi.fn().mockResolvedValue(true),
			prepareBillingLifecycleEmailOutbox: vi.fn((_env: unknown, input: { kind: string; userId: string; email: string }) => ({ userId: input.userId, email: input.email, idempotencyKey: `outbox:${input.kind}:${input.userId}`, templateName: `billing_${input.kind}`, payloadSnapshot: { outboxPendingDispatch: true } })),
			...overrides.delivery,
		};
		vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })) }));
		vi.doMock("~/lib/dodo-billing.server", () => billing);
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => delivery);
		return { data, billing, delivery };
	}

	function webhookRequest(eventId: string, body: Record<string, unknown>, timestampSeconds = Math.floor(Date.now() / 1000)) {
		return new Request("https://0509.io/api/webhooks/dodo", { method: "POST", headers: { "webhook-id": eventId, "webhook-timestamp": String(timestampSeconds), "webhook-signature": "v1=signed" }, body: JSON.stringify(body) });
	}
	function deliverWebhook(action: typeof import("~/routes/api.webhooks.dodo").action, eventId: string, body: Record<string, unknown>, timestampSeconds?: number) {
		return action({ context: {}, request: webhookRequest(eventId, body, timestampSeconds), params: {} } as never);
	}
	async function deliverDodoWebhook(eventId: string, body: Record<string, unknown>, timestampSeconds?: number) {
		const { action } = await import("~/routes/api.webhooks.dodo");
		return deliverWebhook(action, eventId, body, timestampSeconds);
	}
	function explicitBillingEmailFailure(idempotencyKey: string) {
		return Object.assign(new Error("Cloudflare Email explicitly rejected the lifecycle email."), { code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE", idempotencyKey });
	}
	async function expectSanitizedWebhookFailure(result: Promise<unknown>) {
		let thrown: unknown;
		try {
			await result;
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Response);
		const response = thrown as Response;
		expect(response.status).toBe(500);
		expect(await response.text()).toBe(
			"Dodo webhook processing failed. The event will be retried.",
		);
	}
	function claimedLifecycleEmailRetry(kind: "payment_issue" | "cancellation_scheduled" | "revoke" | "refund", userId: string, idempotencyKey: string) {
		return { status: "claimed", lifecycleEmailRetry: { kind, userId, idempotencyKey } };
	}
	const unverified = { email: "u@example.com", emailVerified: false, name: null };
	function expectOutbox(mock: ReturnType<typeof vi.fn>) {
		expect(mock.mock.calls.at(-1)?.at(-1)).toEqual({ lifecycleEmailOutbox: expect.anything() });
	}
	function subscriptionGrant(overrides: Record<string, unknown>) {
		return vi.fn(() => ({ eventType: "subscription.plan_changed", userId: "user-1", subscriptionId: "sub_123", customerId: "cus_123", productId: "pdt_starter_monthly", plan: "starter", cycle: "monthly", status: "active", metadata: {}, ...overrides }));
	}
	function paymentIssueRevocation(eventType = "subscription.on_hold") {
		return vi.fn(() => ({ eventType, action: "payment_issue", userId: "user-1", customerEmail: "owner@example.com", subscriptionId: "sub_123", status: "failed", revokedAt: "2026-07-01T08:00:00.000Z", metadata: {} }));
	}

	return { mockWebhookDependencies, webhookRequest, deliverWebhook, deliverDodoWebhook, explicitBillingEmailFailure, expectSanitizedWebhookFailure, claimedLifecycleEmailRetry, unverified, expectOutbox, subscriptionGrant, paymentIssueRevocation };
}
