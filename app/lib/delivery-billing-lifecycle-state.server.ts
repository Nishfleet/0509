import type { UserPlanBillingInfo } from "~/lib/data.server";
import { readString } from "~/lib/delivery-email-core.server";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import type { DeliveryAttemptRecord } from "~/lib/types";

export interface ScheduledCancellationStateExpectation {
	cutoff: string;
	eventId: string;
	subscriptionId: string;
	stateUpdatedAt: string;
}

export type RefundStateExpectation = {
	paymentId: string;
	stateUpdatedAt: string;
};

export type BillingMutationStateExpectation = {
	status: string;
	subscriptionId: string | null;
	paymentId: string | null;
	stateUpdatedAt: string;
};

export interface BillingLifecycleProviderEvidence {
	reference: string;
	classification: string;
	observedAt: string;
	outcome: "sent" | "failed";
}

export function billingLifecycleStateFingerprint(info: UserPlanBillingInfo) {
	return JSON.stringify({
		plan: info.plan,
		dodoStatus: info.dodoStatus,
		dodoPaymentId: info.dodoPaymentId,
		dodoProductId: info.dodoProductId,
		dodoPlanChangeProductId: info.dodoPlanChangeProductId,
		billingInterval: info.billingInterval,
		dodoSubscriptionId: info.dodoSubscriptionId,
		dodoCustomerId: info.dodoCustomerId,
		dodoNextBillingAt: info.dodoNextBillingAt,
		planUpdatedAt: info.planUpdatedAt,
	});
}

export function readBillingLifecycleRecoveryPayload(
	attempt: DeliveryAttemptRecord,
) {
	const kind = readString(attempt.payloadSnapshot.kind);
	const subject = readString(attempt.payloadSnapshot.subject);
	const bodyHtml = readString(attempt.payloadSnapshot.bodyHtml);
	const tag = readString(attempt.payloadSnapshot.tag);
	const billingStateFingerprint = readString(
		attempt.payloadSnapshot.billingStateFingerprint,
	);
	const pendingDispatch =
		attempt.payloadSnapshot.outboxPendingDispatch === true;
	const stateExpectation = readScheduledCancellationStateExpectation(
		attempt.payloadSnapshot,
	);
	const refundExpectation = readRefundStateExpectation(attempt.payloadSnapshot);
	const mutationExpectation = readBillingMutationStateExpectation(
		attempt.payloadSnapshot,
	);
	const targetValue = readString(attempt.targetValue);

	if (
		!kind ||
		kind !== attempt.templateName ||
		!kind.startsWith("billing_") ||
		!subject ||
		!bodyHtml ||
		!tag ||
		(!billingStateFingerprint && !pendingDispatch) ||
		!targetValue
	) {
		return null;
	}

	return {
		subject,
		bodyHtml,
		tag,
		targetValue,
		billingStateFingerprint: billingStateFingerprint ?? null,
		pendingDispatch,
		stateExpectation,
		refundExpectation,
		mutationExpectation,
	};
}

export function billingLifecycleRecoveryAttemptCount(
	attempt: DeliveryAttemptRecord,
) {
	const value = attempt.payloadSnapshot?.recoveryAttemptCount;
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function billingLifecycleOutboxStateStillApplies(
	templateName: string | null,
	info: UserPlanBillingInfo,
	scheduledCancellation: ScheduledCancellationStateExpectation | null = null,
	refund: RefundStateExpectation | null = null,
	mutation: BillingMutationStateExpectation | null = null,
) {
	switch (templateName) {
		case "billing_payment_issue":
			return (
				billingMutationStateStillApplies(info, mutation) &&
				(info.dodoStatus === "payment.failed" ||
					info.dodoStatus === "subscription.failed" ||
					info.dodoStatus === "subscription.on_hold")
			);
		case "billing_cancellation_scheduled":
			return (
				info.dodoStatus === "cancellation_scheduled" &&
				isPaidPlanFamily(info.plan) &&
				scheduledCancellation !== null &&
				isFutureBillingCutoff(scheduledCancellation.cutoff) &&
				sameBillingTimestamp(
					info.dodoNextBillingAt,
					scheduledCancellation.cutoff,
				) &&
				info.dodoSubscriptionId === scheduledCancellation.subscriptionId &&
				sameBillingTimestamp(
					info.planUpdatedAt,
					scheduledCancellation.stateUpdatedAt,
				)
			);
		case "billing_access_ended":
			return (
				billingMutationStateStillApplies(info, mutation) &&
				info.plan === "free" &&
				(info.dodoStatus === "subscription.cancelled" ||
					info.dodoStatus === "subscription.expired")
			);
		case "billing_refund_revoked":
			return (
				info.plan === "free" &&
				info.dodoStatus === "refunded" &&
				refund !== null &&
				info.dodoPaymentId === refund.paymentId &&
				sameBillingTimestamp(info.planUpdatedAt, refund.stateUpdatedAt)
			);
		default:
			return false;
	}
}

export function readBillingLifecycleProviderEvidence(
	payload: Record<string, unknown> | null | undefined,
): BillingLifecycleProviderEvidence | null {
	const value = payload?.billingLifecycleProviderEvidence;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const reference = readString(record.reference);
	const classification = readString(record.classification);
	const observedAt = normalizedBillingTimestamp(readString(record.observedAt));
	const outcome = record.outcome;
	return reference &&
		classification &&
		observedAt &&
		(outcome === "sent" || outcome === "failed")
		? { reference, classification, observedAt, outcome }
		: null;
}

export function isExplicitlyReconciledBillingFailure(
	attempt: DeliveryAttemptRecord,
) {
	const evidence = readBillingLifecycleProviderEvidence(
		attempt.payloadSnapshot,
	);
	return (
		attempt.status === "failed" &&
		attempt.webhookStatus === "failed" &&
		evidence?.outcome === "failed"
	);
}

export function createScheduledCancellationStateExpectation(input: {
	effectiveAt?: string | null;
	eventId: string;
	subscriptionId?: string | null;
	stateUpdatedAt?: string | null;
}): ScheduledCancellationStateExpectation | null {
	const cutoff = normalizedBillingTimestamp(input.effectiveAt);
	const eventId = readString(input.eventId);
	const subscriptionId = readString(input.subscriptionId);
	const stateUpdatedAt = normalizedBillingTimestamp(input.stateUpdatedAt);
	return cutoff && eventId && subscriptionId && stateUpdatedAt
		? { cutoff, eventId, subscriptionId, stateUpdatedAt }
		: null;
}

export function readScheduledCancellationStateExpectation(
	payload: Record<string, unknown> | null | undefined,
): ScheduledCancellationStateExpectation | null {
	if (!payload) return null;
	return createScheduledCancellationStateExpectation({
		effectiveAt: readString(payload.scheduledCancellationCutoff),
		eventId: readString(payload.scheduledCancellationEventId) ?? "",
		subscriptionId: readString(payload.scheduledCancellationSubscriptionId),
		stateUpdatedAt: readString(payload.scheduledCancellationStateUpdatedAt),
	});
}

export function readRefundStateExpectation(
	payload: Record<string, unknown> | null | undefined,
): RefundStateExpectation | null {
	if (!payload) return null;
	const paymentId = readString(payload.refundPaymentId);
	const stateUpdatedAt = normalizedBillingTimestamp(
		readString(payload.refundStateUpdatedAt),
	);
	return paymentId && stateUpdatedAt ? { paymentId, stateUpdatedAt } : null;
}

export function createBillingMutationStateExpectation(input: {
	status?: string | null;
	subscriptionId?: string | null;
	paymentId?: string | null;
	stateUpdatedAt?: string | null;
}): BillingMutationStateExpectation | null {
	const status = readString(input.status);
	const subscriptionId = readString(input.subscriptionId);
	const paymentId = subscriptionId ? null : readString(input.paymentId);
	const stateUpdatedAt = normalizedBillingTimestamp(input.stateUpdatedAt);
	return status && (subscriptionId || paymentId) && stateUpdatedAt
		? { status, subscriptionId, paymentId, stateUpdatedAt }
		: null;
}

export function readBillingMutationStateExpectation(
	payload: Record<string, unknown> | null | undefined,
) {
	return createBillingMutationStateExpectation({
		status: readString(payload?.billingMutationStatus),
		subscriptionId: readString(payload?.billingMutationSubscriptionId),
		paymentId: readString(payload?.billingMutationPaymentId),
		stateUpdatedAt: readString(payload?.billingMutationStateUpdatedAt),
	});
}

export function scheduledCancellationStateExpectationPayload(
	expectation: ScheduledCancellationStateExpectation | null,
) {
	return expectation
		? {
				scheduledCancellationCutoff: expectation.cutoff,
				scheduledCancellationEventId: expectation.eventId,
				scheduledCancellationSubscriptionId: expectation.subscriptionId,
				scheduledCancellationStateUpdatedAt: expectation.stateUpdatedAt,
			}
		: {};
}

export function refundStateExpectationPayload(
	expectation: RefundStateExpectation | null,
) {
	return expectation
		? {
				refundPaymentId: expectation.paymentId,
				refundStateUpdatedAt: expectation.stateUpdatedAt,
			}
		: {};
}

export function billingMutationStateExpectationPayload(
	expectation: BillingMutationStateExpectation | null,
) {
	return expectation
		? {
				billingMutationStatus: expectation.status,
				billingMutationSubscriptionId: expectation.subscriptionId,
				billingMutationPaymentId: expectation.paymentId,
				billingMutationStateUpdatedAt: expectation.stateUpdatedAt,
			}
		: {};
}

function billingMutationStateStillApplies(
	info: UserPlanBillingInfo,
	expectation: BillingMutationStateExpectation | null,
) {
	if (
		!expectation ||
		info.dodoStatus !== expectation.status ||
		!sameBillingTimestamp(info.planUpdatedAt, expectation.stateUpdatedAt)
	) {
		return false;
	}
	return expectation.subscriptionId
		? info.dodoSubscriptionId === expectation.subscriptionId
		: info.dodoPaymentId === expectation.paymentId;
}

export function normalizedBillingTimestamp(value: string | null | undefined) {
	const timestamp = Date.parse(value ?? "");
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sameBillingTimestamp(
	current: string | null | undefined,
	expected: string,
) {
	return normalizedBillingTimestamp(current) === expected;
}

function isFutureBillingCutoff(cutoff: string, now = Date.now()) {
	return Date.parse(cutoff) > now;
}
