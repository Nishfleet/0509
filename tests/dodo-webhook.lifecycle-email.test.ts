import { describe, expect, it, vi } from "vitest";

import { setupDodoWebhookLifecycle } from "./helpers/dodo-webhook-lifecycle";

const {
	mockWebhookDependencies, deliverDodoWebhook, explicitBillingEmailFailure, expectSanitizedWebhookFailure,
	claimedLifecycleEmailRetry, unverified, expectOutbox, subscriptionGrant, paymentIssueRevocation,
} = setupDodoWebhookLifecycle();

describe("customer lifecycle billing emails", () => {
	it("sends exactly one dunning email when a payment issue lands", async () => {
		const { delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
		});

		const response = await deliverDodoWebhook("evt-on-hold", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(1);
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledWith(
			expect.anything(),
			{
				userId: "user-1",
				email: "owner@example.com",
				name: "Owner",
				occurredAt: "2026-07-01T08:00:00.000Z",
				status: "subscription.on_hold",
				subscriptionId: "sub_123",
				paymentId: null,
				stateUpdatedAt: "2026-07-01T08:00:00.000Z",
				retryWebhookOnExplicitFailure: true,
			},
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

		const response = await deliverDodoWebhook("evt-on-hold-stale", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
	});

	it("skips the dunning email silently when the user has no delivery profile", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				getUserDeliveryProfile: vi.fn().mockResolvedValue(null),
			},
		});

		const response = await deliverDodoWebhook("evt-on-hold-no-profile", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.prepareBillingLifecycleEmailOutbox).not.toHaveBeenCalled();
		data.getUserDeliveryProfile.mockResolvedValue(unverified);
		await deliverDodoWebhook("evt-u-pay", { type: "subscription.on_hold" });
		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
		expectOutbox(data.applyDodoPlanPaymentIssueWithLedger);
	});

	it("does not re-arm or resend when an untyped lifecycle email exception is replayed", async () => {
		const beginDodoWebhookEventProcessing = vi
			.fn()
			.mockResolvedValueOnce({ status: "claimed" })
			.mockResolvedValueOnce({ status: "duplicate", outcome: "processed" });
		const { data, delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: { beginDodoWebhookEventProcessing },
			delivery: {
				sendBillingPaymentIssueEmail: vi.fn().mockRejectedValue(new Error("email down")),
			},
		});

		const response = await deliverDodoWebhook("evt-on-hold-email-down", { type: "subscription.on_hold" });
		const replay = await deliverDodoWebhook("evt-on-hold-email-down", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(1);
		expect(data.failDodoWebhookEventForLifecycleEmailRetry).not.toHaveBeenCalled();
		expect(data.failDodoWebhookEventProcessing).not.toHaveBeenCalled();
	});

	it("durably fails an explicitly rejected lifecycle email and retries only that failed attempt on redelivery", async () => {
		const explicitFailure = explicitBillingEmailFailure(
			"billing-payment-issue:user-1:2026-07-01",
		);
		const beginDodoWebhookEventProcessing = vi
			.fn()
			.mockResolvedValueOnce({ status: "claimed" })
			.mockResolvedValueOnce(
				claimedLifecycleEmailRetry(
					"payment_issue",
					"user-1",
					"billing-payment-issue:user-1:2026-07-01",
				),
			);
		const applyDodoPlanPaymentIssueWithLedger = vi
			.fn()
			.mockResolvedValueOnce({ changed: true, stateUpdatedAt: "2026-07-01T08:00:00.000Z" })
			.mockResolvedValueOnce({ changed: false, stateUpdatedAt: "2026-07-01T08:00:00.000Z" });
		const sendBillingPaymentIssueEmail = vi
			.fn()
			.mockRejectedValueOnce(explicitFailure)
			.mockResolvedValueOnce(true);
		const { data, delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				applyDodoPlanPaymentIssueWithLedger,
				beginDodoWebhookEventProcessing,
			},
			delivery: { sendBillingPaymentIssueEmail },
		});

		await expectSanitizedWebhookFailure(
			deliverDodoWebhook("evt-on-hold-email-retry", { type: "subscription.on_hold" }),
		);

		expect(data.failDodoWebhookEventForLifecycleEmailRetry).toHaveBeenCalledWith(
			expect.anything(),
			"evt-on-hold-email-retry",
			expect.objectContaining({
				idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
				kind: "payment_issue",
				userId: "user-1",
			}),
		);

		const redelivery = await deliverDodoWebhook("evt-on-hold-email-retry", { type: "subscription.on_hold" });

		expect(await redelivery.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(2);
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({
				status: "subscription.on_hold", subscriptionId: "sub_123", paymentId: null,
				stateUpdatedAt: "2026-07-01T08:00:00.000Z",
			}),
		);
		expect(applyDodoPlanPaymentIssueWithLedger).toHaveBeenCalledTimes(2);
		expect(data.failDodoWebhookEventForLifecycleEmailRetry).toHaveBeenCalledTimes(1);
	});

	it("acknowledges a reclaimed email retry when the delivery attempt is already sent or provider-unknown", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValue(
						claimedLifecycleEmailRetry(
							"payment_issue",
							"user-1",
							"billing-payment-issue:user-1:2026-07-01",
						),
					),
				applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue({
					changed: false, stateUpdatedAt: "2026-07-01T08:00:00.000Z",
				}),
			},
			delivery: { sendBillingPaymentIssueEmail: vi.fn().mockResolvedValue(false) },
		});

		const response = await deliverDodoWebhook("evt-on-hold-email-suppressed", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.sendBillingPaymentIssueEmail).toHaveBeenCalledTimes(1);
		expect(data.failDodoWebhookEventForLifecycleEmailRetry).not.toHaveBeenCalled();
	});

	it("does not retry a failed dunning email after a newer lifecycle event recovered the plan", async () => {
		const { delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValue(
						claimedLifecycleEmailRetry(
							"payment_issue",
							"user-1",
							"billing-payment-issue:user-1:2026-07-01",
						),
					),
				applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue({ changed: false }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "starter",
					dodoStatus: "subscription.renewed",
				}),
			},
		});

		const response = await deliverDodoWebhook("evt-on-hold-after-recovery", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
	});

	it("does not apply retry metadata to a different lifecycle branch", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue(
					claimedLifecycleEmailRetry(
						"refund",
						"user-1",
						"billing-refund:user-1:evt-wrong-retry-kind",
					),
				),
				applyDodoPlanPaymentIssueWithLedger: vi.fn().mockResolvedValue({ changed: false }),
			},
		});

		await deliverDodoWebhook("evt-wrong-retry-kind", { type: "subscription.on_hold" });

		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
		expect(data.getUserPlanBillingInfo).not.toHaveBeenCalled();
	});

	it("does not return a retriable failure unless reopening the processed ledger succeeded", async () => {
		const explicitFailure = explicitBillingEmailFailure(
			"billing-payment-issue:user-1:2026-07-01",
		);
		const { data } = mockWebhookDependencies({
			billing: { extractDodoPlanRevocation: paymentIssueRevocation() },
			data: {
				failDodoWebhookEventForLifecycleEmailRetry: vi.fn().mockResolvedValue(false),
			},
			delivery: {
				sendBillingPaymentIssueEmail: vi.fn().mockRejectedValue(explicitFailure),
			},
		});

		const response = await deliverDodoWebhook("evt-on-hold-retry-not-armed", { type: "subscription.on_hold" });

		expect(await response.json()).toMatchObject({ ok: true, paymentIssue: true });
		expect(data.failDodoWebhookEventForLifecycleEmailRetry).toHaveBeenCalledTimes(1);
		expect(data.failDodoWebhookEventProcessing).not.toHaveBeenCalled();
	});

	it("retries an access-ended email using the ledger identity after revoke removes active linkage", async () => {
		const explicitFailure = explicitBillingEmailFailure(
			"billing-cancellation:user-linked:evt-linked-revoke-retry",
		);
		const beginDodoWebhookEventProcessing = vi
			.fn()
			.mockResolvedValueOnce({ status: "claimed" })
			.mockResolvedValueOnce(
				claimedLifecycleEmailRetry(
					"revoke",
					"user-linked",
					"billing-cancellation:user-linked:evt-linked-revoke-retry",
				),
			);
		const getUserIdForDodoLifecycle = vi.fn().mockResolvedValueOnce("user-linked");
		const sendBillingCancellationEmail = vi
			.fn()
			.mockRejectedValueOnce(explicitFailure)
			.mockResolvedValueOnce(true);
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoPlanRevocation: vi.fn(() => ({
					eventType: "subscription.expired",
					action: "revoke",
					userId: null,
					customerEmail: null,
					subscriptionId: "sub_linked",
					customerId: null,
					status: "subscription.expired",
					revokedAt: "2026-07-01T00:00:00.000Z",
					metadata: {},
				})),
			},
			data: {
				beginDodoWebhookEventProcessing,
				getUserIdForDodoLifecycle,
				applyDodoPlanRevokeWithWatchlistReconcile: vi
					.fn()
					.mockResolvedValueOnce({ changed: true, stateUpdatedAt: "2026-07-01T00:00:00.000Z" })
					.mockResolvedValueOnce({ changed: false, stateUpdatedAt: "2026-07-01T00:00:00.000Z" }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "free",
					dodoStatus: "subscription.expired",
					dodoSubscriptionId: "sub_linked",
					planUpdatedAt: "2026-07-01T00:00:00.000Z",
				}),
			},
			delivery: { sendBillingCancellationEmail },
		});

		await expectSanitizedWebhookFailure(
			deliverDodoWebhook("evt-linked-revoke-retry", { type: "subscription.expired" }),
		);

		const redelivery = await deliverDodoWebhook("evt-linked-revoke-retry", { type: "subscription.expired" });

		expect(await redelivery.json()).toMatchObject({ ok: true, revoked: true });
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(2);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({
				status: "subscription.expired", subscriptionId: "sub_linked",
				stateUpdatedAt: "2026-07-01T00:00:00.000Z",
			}),
		);
  expect(data.getUserIdForDodoLifecycle).toHaveBeenCalledTimes(2);
	});

	it("retains the paid grant and sends one scheduled-cancellation email for plan_changed with the cancel flag", async () => {
		const futureIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: "2026-07-13T08:00:00.000Z", hasProviderGrantTimestamp: true, nextBillingAt: futureIso, cancellationScheduled: true }),
			},
		});

		const response = await deliverDodoWebhook("evt-cancel-scheduled-email", { type: "subscription.plan_changed" });

		expect(await response.json()).toMatchObject({ ok: true, cancellationScheduled: true });
		expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				plan: "starter",
				status: "cancellation_scheduled",
				nextBillingAt: futureIso,
				requireProviderIdentityMatch: true,
			}),
			10,
			expect.objectContaining({ eventId: "evt-cancel-scheduled-email" }),
			expect.anything(),
		);
		expect(data.applyDodoPlanRevokeWithWatchlistReconcile).not.toHaveBeenCalled();
		expect(delivery.prepareBillingLifecycleEmailOutbox).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				kind: "cancellation_scheduled",
				effectiveAt: futureIso,
				eventId: "evt-cancel-scheduled-email",
				subscriptionId: "sub_123",
				stateUpdatedAt: "2026-07-13T08:00:00.000Z",
			}),
		);
		data.getUserDeliveryProfile.mockResolvedValue(unverified);
		await deliverDodoWebhook("evt-u-scheduled", { type: "subscription.plan_changed" });
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
		expectOutbox(data.applyDodoPlanGrantWithWatchlistReconcile);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
			expect.anything(),
			{
				userId: "user-1",
				email: "owner@example.com",
				name: "Owner",
				kind: "scheduled",
				effectiveAt: futureIso,
				eventId: "evt-cancel-scheduled-email",
				subscriptionId: "sub_123",
				stateUpdatedAt: "2026-07-13T08:00:00.000Z",
				retryWebhookOnExplicitFailure: true,
			},
		);
		expect(delivery.sendBillingPaymentIssueEmail).not.toHaveBeenCalled();
	});

	it("applies a scheduled cancellation without a provider timestamp via the normal grant path", async () => {
		const futureIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: null, hasProviderGrantTimestamp: false, nextBillingAt: futureIso, cancellationScheduled: true }),
			},
		});

		const response = await deliverDodoWebhook("evt-cancel-scheduled-no-ts", { type: "subscription.plan_changed" });

		expect(await response.json()).toMatchObject({ ok: true, cancellationScheduled: true });
		expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				plan: "starter",
				status: "cancellation_scheduled",
				requirePlanChangePending: false,
				forcePlanChangePending: false,
				requireProviderIdentityMatch: true,
				grantedAt: expect.any(String),
			}),
			10,
			expect.objectContaining({ eventId: "evt-cancel-scheduled-no-ts" }),
			expect.anything(),
		);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
		expect(delivery.prepareBillingLifecycleEmailOutbox).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				subscriptionId: "sub_123",
				stateUpdatedAt: expect.any(String),
			}),
		);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				kind: "scheduled",
				effectiveAt: futureIso,
				subscriptionId: "sub_123",
				stateUpdatedAt: expect.any(String),
			}),
		);
	});

	it("retries one timestamp-less scheduled-cancellation event with its original signed watermark", async () => {
		const eventId = "evt-cancel-scheduled-no-ts-retry";
		const firstTimestamp = Date.parse("2026-07-13T08:00:00.000Z") / 1000;
		const secondTimestamp = Date.parse("2026-07-13T08:05:00.000Z") / 1000;
		const firstWatermark = new Date(firstTimestamp * 1000).toISOString();
		const futureIso = "2026-08-13T08:00:00.000Z";
		const explicitFailure = explicitBillingEmailFailure(
			`billing-cancellation:user-1:${eventId}`,
		);
		const applyGrant = vi.fn().mockResolvedValue({ changed: true });
		const sendCancellation = vi
			.fn()
			.mockRejectedValueOnce(explicitFailure)
			.mockResolvedValueOnce(true);
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: null, hasProviderGrantTimestamp: false, nextBillingAt: futureIso, cancellationScheduled: true }),
			},
			data: {
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValueOnce({ status: "claimed" })
					.mockResolvedValueOnce(
						claimedLifecycleEmailRetry(
							"cancellation_scheduled",
							"user-1",
							`billing-cancellation:user-1:${eventId}`,
						),
					),
				applyDodoPlanGrantWithWatchlistReconcile: applyGrant,
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "starter",
					dodoStatus: "cancellation_scheduled",
					dodoSubscriptionId: "sub_123",
					dodoNextBillingAt: futureIso,
					planUpdatedAt: firstWatermark,
				}),
			},
			delivery: { sendBillingCancellationEmail: sendCancellation },
		});
		await expectSanitizedWebhookFailure(
			deliverDodoWebhook(eventId, { type: "subscription.plan_changed" }, firstTimestamp),
		);
		const redelivery = await deliverDodoWebhook(eventId, { type: "subscription.plan_changed" }, secondTimestamp);

		expect(await redelivery.json()).toMatchObject({ ok: true, cancellationScheduled: true });
		expect(applyGrant).toHaveBeenCalledTimes(1);
		expect(data.finalizeDodoWebhookLedgerOnly).toHaveBeenCalledTimes(1);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(2);
		expect(sendCancellation.mock.calls.map(([, input]) => input.stateUpdatedAt)).toEqual([
			firstWatermark,
			firstWatermark,
		]);
	});

	it("keeps a normal plan_changed grant active and sends no cancellation email", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: "2026-07-13T08:00:00.000Z", hasProviderGrantTimestamp: true, nextBillingAt: "2026-08-13T08:00:00.000Z", cancellationScheduled: false }),
			},
		});

		const response = await deliverDodoWebhook("evt-normal-plan-change", { type: "subscription.plan_changed" });

		expect(await response.json()).toMatchObject({ ok: true });
		expect(data.applyDodoPlanGrantWithWatchlistReconcile).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: "active" }),
			10,
			expect.anything(),
			expect.anything(),
		);
		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
	});

	it("skips a scheduled-cancellation email when the plan-change grant was rejected as stale", async () => {
		const { delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: "2026-07-01T08:00:00.000Z", hasProviderGrantTimestamp: true, nextBillingAt: "2026-08-01T08:00:00.000Z", cancellationScheduled: true }),
			},
			data: {
				applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
			},
		});

		await deliverDodoWebhook("evt-stale-scheduled-cancel", { type: "subscription.plan_changed" });

		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
	});

	it("does not retry a scheduled-cancellation email after the cancellation was reversed", async () => {
		const { delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: "2026-07-01T08:00:00.000Z", hasProviderGrantTimestamp: true, nextBillingAt: "2026-08-01T08:00:00.000Z", cancellationScheduled: true }),
			},
			data: {
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValue(
						claimedLifecycleEmailRetry(
							"cancellation_scheduled",
							"user-1",
							"billing-cancellation:user-1:evt-reversed-scheduled-cancel",
						),
					),
				applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "starter",
					dodoStatus: "active",
				}),
			},
		});

		await deliverDodoWebhook("evt-reversed-scheduled-cancel", {
			type: "subscription.plan_changed",
		});

		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
	});

	it("retries a scheduled-cancellation email while the same subscription remains scheduled", async () => {
		const { data, delivery } = mockWebhookDependencies({
			billing: {
				extractDodoSubscriptionGrant: subscriptionGrant({ grantedAt: "2026-07-01T08:00:00.000Z", hasProviderGrantTimestamp: true, nextBillingAt: "2026-08-01T08:00:00.000Z", cancellationScheduled: true }),
			},
			data: {
				beginDodoWebhookEventProcessing: vi.fn().mockResolvedValue(
					claimedLifecycleEmailRetry(
						"cancellation_scheduled",
						"user-1",
						"billing-cancellation:user-1:evt-scheduled-cancel-retry",
					),
				),
				applyDodoPlanGrantWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "starter",
					dodoStatus: "cancellation_scheduled",
					dodoSubscriptionId: "sub_123",
					dodoNextBillingAt: "2026-08-01T08:00:00.000Z",
					planUpdatedAt: "2026-07-01T08:00:00.000Z",
				}),
			},
		});

		await deliverDodoWebhook("evt-scheduled-cancel-retry", {
			type: "subscription.plan_changed",
		});

		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
		expect(data.applyDodoPlanGrantWithWatchlistReconcile).not.toHaveBeenCalled();
	});

	it("sends the access-ended email when a revoke lands", async () => {
		const { data, delivery } = mockWebhookDependencies({
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

		const response = await deliverDodoWebhook("evt-expired-email", { type: "subscription.expired" });

		expect(await response.json()).toMatchObject({ ok: true, revoked: true });
		data.getUserDeliveryProfile.mockResolvedValue(unverified);
		await deliverDodoWebhook("evt-u-revoke", { type: "subscription.expired" });
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledTimes(1);
		expectOutbox(data.applyDodoPlanRevokeWithWatchlistReconcile);
		expect(delivery.sendBillingCancellationEmail).toHaveBeenCalledWith(
			expect.anything(),
			{
				userId: "user-1",
				email: "owner@example.com",
				name: "Owner",
				kind: "ended",
				eventId: "evt-expired-email",
				status: "subscription.expired",
				subscriptionId: "sub_123",
				stateUpdatedAt: "2026-07-01T00:00:00.000Z",
				retryWebhookOnExplicitFailure: true,
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

		await deliverDodoWebhook("evt-expired-stale", { type: "subscription.expired" });

		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
	});

	it("does not retry an access-ended email after a newer plan was activated", async () => {
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
				beginDodoWebhookEventProcessing: vi
					.fn()
					.mockResolvedValue(
						claimedLifecycleEmailRetry(
							"revoke",
							"user-1",
							"billing-cancellation:user-1:evt-expired-after-reactivation",
						),
					),
				applyDodoPlanRevokeWithWatchlistReconcile: vi.fn().mockResolvedValue({ changed: false }),
				getUserPlanBillingInfo: vi.fn().mockResolvedValue({
					plan: "agency",
					dodoStatus: "active",
				}),
			},
		});

		await deliverDodoWebhook("evt-expired-after-reactivation", {
			type: "subscription.expired",
		});

		expect(delivery.sendBillingCancellationEmail).not.toHaveBeenCalled();
	});

});
