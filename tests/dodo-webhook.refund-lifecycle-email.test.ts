import { describe, expect, it, vi } from "vitest";

import { setupDodoWebhookLifecycle } from "./helpers/dodo-webhook-lifecycle";

const {
	mockWebhookDependencies, deliverDodoWebhook, explicitBillingEmailFailure, expectSanitizedWebhookFailure,
	claimedLifecycleEmailRetry, unverified, expectOutbox,
} = setupDodoWebhookLifecycle();

describe("customer lifecycle billing emails", () => {
	it("sends the refund email to the matched user", async () => {
		const { data, delivery } = mockWebhookDependencies({
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
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "free", dodoStatus: "refunded", dodoPaymentId: "pay-refunded",
					planUpdatedAt: "2026-07-05T00:00:00.000Z",
				}),
				getUserDeliveryProfile: vi
					.fn()
					.mockResolvedValue({ id: "user-refund", email: "refunded@example.com", emailVerified: true, name: null }),
			},
		});
		const response = await deliverDodoWebhook("evt-refund-email", { type: "refund.succeeded" });

		expect(await response.json()).toMatchObject({ ok: true, refunded: true });
		expectOutbox(data.applyDodoRefundWithWatchlistReconcile);
		data.getUserPlanBillingInfo.mockResolvedValue({
			plan: "free", dodoStatus: "refunded", dodoPaymentId: "pay-refund-b",
			planUpdatedAt: "2026-07-10T00:00:00.000Z",
		});
		await deliverDodoWebhook("evt-refund-a-after-b", { type: "refund.succeeded" });
		data.getUserPlanBillingInfo.mockResolvedValue({
			plan: "free", dodoStatus: "refunded", dodoPaymentId: "pay-refunded",
			planUpdatedAt: "2026-07-05T00:00:00.000Z",
		});
		data.getUserDeliveryProfile.mockResolvedValue(unverified);
		await deliverDodoWebhook("evt-u-refund", { type: "refund.succeeded" });
		expect(delivery.sendBillingRefundEmail).toHaveBeenCalledTimes(1);
		expect(delivery.sendBillingRefundEmail).toHaveBeenCalledWith(
			expect.anything(),
			{
				userId: "user-refund",
				email: "refunded@example.com",
				name: null,
				eventId: "evt-refund-email",
				paymentId: "pay-refunded",
				stateUpdatedAt: "2026-07-05T00:00:00.000Z",
				retryWebhookOnExplicitFailure: true,
			},
		);
	});

	it("keeps the refund webhook retryable when durable email outbox preparation fails", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoRefund: vi.fn(() => ({
					eventType: "refund.succeeded",
					paymentId: "pay-outbox-failure",
					refundId: "ref-outbox-failure",
					refundedAt: "2026-07-05T00:00:00.000Z",
					metadata: {},
				})),
			},
			data: {
				getUserIdForDodoPayment: vi.fn().mockResolvedValue("user-refund"),
			},
		});
		const failure = new Error("outbox unavailable");
		delivery.prepareBillingLifecycleEmailOutbox.mockRejectedValueOnce(failure);

		await expectSanitizedWebhookFailure(
			deliverDodoWebhook("evt-refund-outbox-failure", { type: "refund.succeeded" }),
		);

		expect(data.applyDodoRefundWithWatchlistReconcile).not.toHaveBeenCalled();
		expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
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

		const response = await deliverDodoWebhook("evt-refund-unmatched", { type: "refund.succeeded" });

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
				applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({
					changed: false, stateUpdatedAt: "2026-07-05T00:00:00.000Z",
				}),
			},
		});

		const response = await deliverDodoWebhook("evt-refund-noop", { type: "refund.succeeded" });

		expect(await response.json()).toMatchObject({ ok: true, refunded: true });
		expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
	});

	it("does not retry refund A after a newer purchase and refund B", async () => {
		const { delivery } = mockWebhookDependencies({
			billing: {
				extractDodoRefund: vi.fn(() => ({
					eventType: "refund.succeeded",
					paymentId: "pay-refunded-before-repurchase",
					refundId: "ref-before-repurchase",
					refundedAt: "2026-07-05T00:00:00.000Z",
					metadata: {},
				})),
			},
			data: {
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValue(
						claimedLifecycleEmailRetry(
							"refund",
							"user-refund",
							"billing-refund:user-refund:evt-refund-after-repurchase",
						),
					),
				getUserIdForDodoPayment: vi.fn().mockResolvedValue("user-refund"),
				applyDodoRefundWithWatchlistReconcile: vi.fn().mockResolvedValue({
					changed: false, stateUpdatedAt: "2026-07-05T00:00:00.000Z",
				}),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "free",
					dodoStatus: "refunded",
					dodoPaymentId: "pay-refund-b",
					planUpdatedAt: "2026-07-10T00:00:00.000Z",
				}),
			},
		});

		await deliverDodoWebhook("evt-refund-after-repurchase", { type: "refund.succeeded" });

		expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
	});

	it("retries a refund email using the ledger identity after the payment link is gone", async () => {
		const explicitFailure = explicitBillingEmailFailure(
			"billing-refund:user-refund:evt-linked-refund-retry",
		);
		const beginDodoWebhookEventProcessing = vi
			.fn()
			.mockResolvedValueOnce({ status: "claimed" })
			.mockResolvedValueOnce(
				claimedLifecycleEmailRetry(
					"refund",
					"user-refund",
					"billing-refund:user-refund:evt-linked-refund-retry",
				),
			);
		const getUserIdForDodoPayment = vi.fn().mockResolvedValueOnce("user-refund");
		const sendBillingRefundEmail = vi
			.fn()
			.mockRejectedValueOnce(explicitFailure)
			.mockResolvedValueOnce(true);
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoRefund: vi.fn(() => ({
					eventType: "refund.succeeded",
					paymentId: "pay_linked",
					refundId: "ref_linked",
					refundedAt: "2026-07-05T00:00:00.000Z",
					metadata: {},
				})),
			},
			data: {
				beginDodoWebhookEventProcessing,
				getUserIdForDodoPayment,
				applyDodoRefundWithWatchlistReconcile: vi
					.fn()
					.mockResolvedValueOnce({ changed: true, stateUpdatedAt: "2026-07-05T00:00:00.000Z" })
					.mockResolvedValueOnce({ changed: false, stateUpdatedAt: "2026-07-05T00:00:00.000Z" }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "free",
					dodoStatus: "refunded",
					dodoPaymentId: "pay_linked",
					planUpdatedAt: "2026-07-05T00:00:00.000Z",
				}),
			},
			delivery: { sendBillingRefundEmail },
		});

		await expectSanitizedWebhookFailure(
			deliverDodoWebhook("evt-linked-refund-retry", { type: "refund.succeeded" }),
		);

		const redelivery = await deliverDodoWebhook("evt-linked-refund-retry", { type: "refund.succeeded" });

		expect(await redelivery.json()).toMatchObject({ ok: true, refunded: true });
		expect(delivery.sendBillingRefundEmail).toHaveBeenCalledTimes(2);
		expect(delivery.sendBillingRefundEmail).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ paymentId: "pay_linked", stateUpdatedAt: "2026-07-05T00:00:00.000Z" }),
		);
  expect(data.getUserIdForDodoPayment).toHaveBeenCalledTimes(2);
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

		const response = await deliverDodoWebhook("evt-mor-payment", { type: "payment.succeeded" });

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

		const response = await deliverDodoWebhook("evt-checkout-fail-no-email", { type: "payment.cancelled" });

		expect(await response.json()).toMatchObject({ ok: true, checkoutFailure: true });
		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
		expect(delivery.sendBillingRefundEmail).not.toHaveBeenCalled();
	});
});
