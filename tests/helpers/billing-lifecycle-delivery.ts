import { afterEach, beforeEach, vi } from "vitest";

export function setupBillingLifecycleDelivery() {
	let emailSend: ReturnType<typeof vi.fn> = vi.fn();
	const emailState = {
		get emailSend() {
			return emailSend;
		},
		set emailSend(value: ReturnType<typeof vi.fn>) {
			emailSend = value;
		},
	};
	const emailEnv = {
		get EMAIL() {
			return { send: emailSend };
		},
		EMAIL_FROM_EMAIL: "alerts@0509.io",
	};

	function mockEmailSend(messageId = "msg_1") {
		emailSend = vi.fn().mockResolvedValue({ messageId });
		return emailSend;
	}

	function emailSendPayload(sendMock: ReturnType<typeof vi.fn>) {
		return sendMock.mock.calls[0]?.[0];
	}

	beforeEach(() => {
		vi.resetModules();
		emailSend = vi.fn();
		vi.doMock("~/lib/plan.server", () => ({
			getUserPlan: vi.fn().mockResolvedValue("starter"),
		}));
		vi.doMock("~/lib/email-verification.server", () => ({
			isUserEmailVerified: vi.fn().mockResolvedValue(true),
			requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
			emailUnverifiedActionResult: () => ({
				ok: false,
				error: "email_unverified",
				message: "Verify your email",
			}),
			requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
			EMAIL_UNVERIFIED_ERROR: "email_unverified",
			EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		vi.useRealTimers();
		vi.doUnmock("~/lib/email-verification.server");
		vi.doUnmock("~/lib/plan.server");
	});

	const scheduledCutoff = new Date(Date.UTC(2026, 7, 13, 9)).toISOString();
	const scheduledWatermark = new Date(Date.UTC(2026, 6, 13, 9)).toISOString();
	const currentBillingInfo = {
		plan: "starter" as const,
		dodoStatus: "active",
		dodoPaymentId: "payment-current",
		dodoProductId: "product-current",
		dodoPlanChangeProductId: null,
		billingInterval: "monthly" as const,
		dodoSubscriptionId: "subscription-current",
		dodoCustomerId: "customer-current",
		dodoNextBillingAt: scheduledCutoff,
		planUpdatedAt: scheduledWatermark,
	};
	const refundBillingInfo = { ...currentBillingInfo, plan: "free" as const, dodoStatus: "refunded" };
	const paymentIssueBillingInfo = { ...currentBillingInfo, dodoStatus: "payment.failed" };
	const accessEndedBillingInfo = { ...currentBillingInfo, plan: "free" as const, dodoStatus: "subscription.expired" };
	let defaultBillingInfo: typeof currentBillingInfo | typeof refundBillingInfo | typeof accessEndedBillingInfo = currentBillingInfo;
	const billingState = {
		get defaultBillingInfo() {
			return defaultBillingInfo;
		},
		set defaultBillingInfo(value: typeof defaultBillingInfo) {
			defaultBillingInfo = value;
		},
	};
	const currentBillingStateFingerprint = JSON.stringify(currentBillingInfo);

	function billingPayload<T extends Record<string, unknown>>(templateName: string, overrides: T) {
		return {
			kind: templateName,
			subject: "Billing lifecycle update",
			bodyHtml: "<p>Billing lifecycle update.</p>",
			tag: "billing-lifecycle",
			billingStateFingerprint: currentBillingStateFingerprint,
			...overrides,
		};
	}
	function reconciledFailurePayload(templateName: string, overrides: Record<string, unknown> = {}) {
		return billingPayload(templateName, {
			...overrides,
			billingLifecycleProviderEvidence: {
				reference: `cf-event-${templateName}`,
				classification: "provider_rejected",
				observedAt: "2026-07-13T09:00:00.000Z",
				outcome: "failed",
			},
		});
	}
	function billingAttempt<T extends Record<string, unknown>>(overrides: T) {
		return {
			id: "attempt-billing", userId: "user-1", provider: "cloudflare_email",
			status: "pending", webhookStatus: "pending", providerMessageId: null as string | null,
			providerStatusLastSeenAt: null as string | null, targetValue: "owner@example.com",
			templateName: "billing_refund_revoked", errorMessage: null as string | null,
			sentAt: null as string | null, failedAt: null as string | null,
			updatedAt: "2026-07-13T09:03:00.000Z", ...overrides,
		};
	}
	function recoveryAttempt(id: string, templateName = "billing_refund_revoked", payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
		return { ...billingAttempt({ id, templateName, payloadSnapshot: billingPayload(templateName, payloadOverrides) as Record<string, unknown>, ...attemptOverrides }) };
	}
	function scheduledRecoveryAttempt(id: string, eventId: string, payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
		return recoveryAttempt(id, "billing_cancellation_scheduled", { scheduledCancellationCutoff: scheduledCutoff, scheduledCancellationEventId: eventId, scheduledCancellationSubscriptionId: "subscription-current", scheduledCancellationStateUpdatedAt: scheduledWatermark, ...payloadOverrides }, attemptOverrides);
	}
	function refundRecoveryAttempt(id: string, payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
		return recoveryAttempt(id, "billing_refund_revoked", { refundPaymentId: currentBillingInfo.dodoPaymentId, refundStateUpdatedAt: currentBillingInfo.planUpdatedAt, ...payloadOverrides }, attemptOverrides);
	}
	function mutationRecoveryAttempt(id: string, templateName: string, status: string, subscriptionId: string | null | undefined = "subscription-current", stateUpdatedAt: string | undefined = scheduledWatermark) {
		return recoveryAttempt(id, templateName, { billingMutationStatus: status, billingMutationSubscriptionId: subscriptionId, billingMutationStateUpdatedAt: stateUpdatedAt, billingStateFingerprint: null, outboxPendingDispatch: true });
	}
	function paymentRecoveryAttempt(id: string, paymentId = "payment-current", stateUpdatedAt = scheduledWatermark) {
		const attempt = mutationRecoveryAttempt(id, "billing_payment_issue", "payment.failed", null, stateUpdatedAt);
		attempt.payloadSnapshot.billingMutationPaymentId = paymentId;
		return attempt;
	}
	function useRecoveryClock(at = "2026-07-13T09:05:00.000Z") {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(at));
	}
	type Delivery = typeof import("~/lib/delivery.server");
	type PaymentInput = Parameters<Delivery["sendBillingPaymentIssueEmail"]>[1];
	type RefundInput = Parameters<Delivery["sendBillingRefundEmail"]>[1];
	type CancellationInput = Parameters<Delivery["sendBillingCancellationEmail"]>[1];
	const recipient = { userId: "user-1", email: "owner@example.com", name: "Owner" };
	async function sendPaymentIssue(overrides: Partial<PaymentInput> = {}) {
		defaultBillingInfo = paymentIssueBillingInfo;
		const delivery = await import("~/lib/delivery.server");
		return delivery.sendBillingPaymentIssueEmail(emailEnv as never, { ...recipient, status: "payment.failed", subscriptionId: "subscription-current", stateUpdatedAt: scheduledWatermark, ...overrides });
	}
	async function sendRefund(overrides: Partial<RefundInput> & Pick<RefundInput, "eventId">) {
		defaultBillingInfo = refundBillingInfo;
		const delivery = await import("~/lib/delivery.server");
		return delivery.sendBillingRefundEmail(emailEnv as never, { ...recipient, paymentId: "payment-current", stateUpdatedAt: scheduledWatermark, ...overrides });
	}
	async function sendCancellation(input: Omit<CancellationInput, "userId" | "email" | "name"> & Partial<Pick<CancellationInput, "userId" | "email" | "name">>) {
		if (input.kind === "ended") defaultBillingInfo = accessEndedBillingInfo;
		const delivery = await import("~/lib/delivery.server");
		return delivery.sendBillingCancellationEmail(emailEnv as never, { ...recipient, ...(input.kind === "ended" ? { status: "subscription.expired", subscriptionId: "subscription-current", stateUpdatedAt: scheduledWatermark } : {}), ...input });
	}
	function sendScheduledCancellation(eventId: string, overrides: Partial<CancellationInput> = {}) {
		return sendCancellation({ name: "Owner", kind: "scheduled", effectiveAt: scheduledCutoff, eventId, ...overrides });
	}
	async function recoverBilling(env = { ...emailEnv, DB: {} } as never) {
		const delivery = await import("~/lib/delivery.server");
		return delivery.recoverAbandonedBillingLifecycleEmails(env);
	}
	function mockBillingDataServer(overrides: Record<string, unknown> = {}) {
		const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
		const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue(null);
		const listStaleBillingLifecycleEmailAttempts = vi.fn().mockResolvedValue([]);
		const updateDeliveryAttemptResult = vi.fn();
		vi.doMock("~/lib/data.server", () => ({ createDeliveryAttempt, getDeliveryAttemptByIdempotencyKey, listStaleBillingLifecycleEmailAttempts, updateDeliveryAttemptResult, getUserDeliveryProfile: vi.fn().mockResolvedValue({ email: "owner@example.com", emailVerified: true, name: "Owner" }), getUserPlanBillingInfo: vi.fn(async () => defaultBillingInfo), ...overrides }));
		return { createDeliveryAttempt, getDeliveryAttemptByIdempotencyKey, listStaleBillingLifecycleEmailAttempts, updateDeliveryAttemptResult };
	}
	function mockRecoveryAttempt(attempt: unknown, overrides: Record<string, unknown> = {}) {
		const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
		mockBillingDataServer({ listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([attempt]), updateDeliveryAttemptResult, ...overrides });
		return updateDeliveryAttemptResult;
	}
	function trackAttemptUpdates(attempt: ReturnType<typeof recoveryAttempt>) {
		return vi.fn(async (_env: unknown, _attemptId: string, input: Record<string, unknown>) => {
			if (input.expectedStatus && attempt.status !== input.expectedStatus) return false;
			if (input.expectedWebhookStatus && attempt.webhookStatus !== input.expectedWebhookStatus) return false;
			if (input.expectedUpdatedAt && attempt.updatedAt !== input.expectedUpdatedAt) return false;
			attempt.provider = String(input.provider); attempt.status = String(input.status); attempt.webhookStatus = String(input.webhookStatus);
			attempt.providerMessageId = (input.providerMessageId as string | null) ?? null;
			attempt.providerStatusLastSeenAt = (input.providerStatusLastSeenAt as string | null) ?? null;
			attempt.errorMessage = (input.errorMessage as string | null) ?? null;
			attempt.sentAt = (input.sentAt as string | null) ?? null; attempt.failedAt = (input.failedAt as string | null) ?? null;
			if (input.payloadSnapshot) attempt.payloadSnapshot = input.payloadSnapshot as Record<string, unknown>;
			attempt.targetValue = String(input.targetValue ?? attempt.targetValue); attempt.updatedAt = String(input.updatedAt ?? new Date().toISOString());
			return true;
		});
	}

	afterEach(() => {
		defaultBillingInfo = currentBillingInfo;
		vi.doUnmock("~/lib/data.server");
	});

	return {
		emailEnv, emailState, emailSendPayload, mockEmailSend,
		scheduledCutoff, scheduledWatermark, currentBillingInfo, refundBillingInfo, paymentIssueBillingInfo, accessEndedBillingInfo,
		billingState, currentBillingStateFingerprint, billingPayload, reconciledFailurePayload, billingAttempt, recoveryAttempt,
		scheduledRecoveryAttempt, refundRecoveryAttempt, mutationRecoveryAttempt, paymentRecoveryAttempt, useRecoveryClock,
		recipient, sendPaymentIssue, sendRefund, sendCancellation, sendScheduledCancellation, recoverBilling, mockBillingDataServer,
		mockRecoveryAttempt, trackAttemptUpdates,
	};
}
