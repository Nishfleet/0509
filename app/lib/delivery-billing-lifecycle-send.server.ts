import {
	createDeliveryAttempt,
	getDeliveryAttemptByIdempotencyKey,
	getUserPlanBillingInfo,
	updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
	isStalePreDispatchAttempt,
	markDeliveryAttemptProviderDispatch,
} from "~/lib/delivery-attempt-lease";
import {
	billingCancellationEmailContent,
	billingPaymentIssueEmailContent,
	billingRefundEmailContent,
} from "~/lib/delivery-billing-lifecycle-content.server";
import { BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS } from "~/lib/delivery-billing-lifecycle-recovery.server";
import {
	type BillingMutationStateExpectation,
	billingLifecycleOutboxStateStillApplies,
	billingLifecycleRecoveryAttemptCount,
	billingLifecycleStateFingerprint,
	billingMutationStateExpectationPayload,
	createBillingMutationStateExpectation,
	isExplicitlyReconciledBillingFailure,
	normalizedBillingTimestamp,
	type RefundStateExpectation,
	readBillingMutationStateExpectation,
	readRefundStateExpectation,
	readScheduledCancellationStateExpectation,
	refundStateExpectationPayload,
	type ScheduledCancellationStateExpectation,
	scheduledCancellationStateExpectationPayload,
} from "~/lib/delivery-billing-lifecycle-state.server";
import {
	EMAIL_PROVIDER,
	providerAcceptedAt,
	readString,
	sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import { type AppEnv, isEmailSendingConfigured } from "~/lib/env.server";

const BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE =
	"BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE" as const;

export class BillingLifecycleEmailExplicitFailure extends Error {
	readonly code = BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE;

	constructor(
		readonly idempotencyKey: string,
		providerMessage: string | null,
	) {
		super(
			providerMessage ??
				"Cloudflare Email explicitly rejected the lifecycle email.",
		);
		this.name = "BillingLifecycleEmailExplicitFailure";
	}
}

export function isBillingLifecycleEmailExplicitFailure(
	error: unknown,
): error is BillingLifecycleEmailExplicitFailure {
	return (
		error instanceof Error &&
		"code" in error &&
		error.code === BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE &&
		"idempotencyKey" in error &&
		typeof error.idempotencyKey === "string"
	);
}

async function sendBillingLifecycleEmail(
	env: AppEnv,
	input: {
		userId: string;
		email: string;
		idempotencyKey: string;
		subject: string;
		bodyHtml: string;
		tag: string;
		templateName: string;
		stateExpectation?: ScheduledCancellationStateExpectation | null;
		refundExpectation?: RefundStateExpectation | null;
		mutationExpectation?: BillingMutationStateExpectation | null;
		retryWebhookOnExplicitFailure?: boolean;
	},
) {
	const duplicate = await getDeliveryAttemptByIdempotencyKey(
		env,
		input.idempotencyKey,
	);
	const stalePreDispatch = duplicate
		? isStalePreDispatchAttempt(duplicate)
		: false;
	const pendingOutboxDispatch =
		duplicate?.status === "pending" &&
		duplicate.webhookStatus === "pending" &&
		duplicate.payloadSnapshot?.outboxPendingDispatch === true;
	const supersededOutbox =
		duplicate?.status === "skipped_due_to_dedupe" &&
		duplicate.webhookStatus === "provider_unknown";
	const retryableReconciledFailure = duplicate
		? isExplicitlyReconciledBillingFailure(duplicate)
		: false;
	const reconciledRecoveryAttemptCount = duplicate
		? billingLifecycleRecoveryAttemptCount(duplicate)
		: 0;
	if (
		duplicate &&
		(!retryableReconciledFailure ||
			duplicate.status !== "failed" ||
			reconciledRecoveryAttemptCount >=
				BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS) &&
		!stalePreDispatch &&
		!pendingOutboxDispatch &&
		!supersededOutbox
	) {
		return false;
	}
	const claimFromPending = stalePreDispatch || pendingOutboxDispatch;

	const currentBillingInfo = await getUserPlanBillingInfo(env, input.userId);
	const scheduledCancellationExpectation = duplicate
		? readScheduledCancellationStateExpectation(duplicate.payloadSnapshot)
		: (input.stateExpectation ?? null);
	const refundExpectation = duplicate
		? (readRefundStateExpectation(duplicate.payloadSnapshot) ??
			(duplicate.status === "failed" ||
			(stalePreDispatch && !pendingOutboxDispatch)
				? (input.refundExpectation ?? null)
				: null))
		: (input.refundExpectation ?? null);
	const mutationExpectation = duplicate
		? (readBillingMutationStateExpectation(duplicate.payloadSnapshot) ??
			(duplicate.status === "failed" ||
			(stalePreDispatch && !pendingOutboxDispatch) ||
			(supersededOutbox &&
				duplicate.payloadSnapshot?.outboxPendingDispatch !== true)
				? (input.mutationExpectation ?? null)
				: null))
		: (input.mutationExpectation ?? null);
	const durableKind = pendingOutboxDispatch
		? readString(duplicate?.payloadSnapshot?.kind)
		: input.templateName;
	const stateStillCurrent =
		(!pendingOutboxDispatch ||
			(durableKind === duplicate.templateName &&
				durableKind === input.templateName)) &&
		billingLifecycleOutboxStateStillApplies(
			durableKind,
			currentBillingInfo,
			scheduledCancellationExpectation,
			refundExpectation,
			mutationExpectation,
		);
	if (!stateStillCurrent) {
		if (duplicate && !supersededOutbox) {
			await updateDeliveryAttemptResult(env, duplicate.id, {
				provider: EMAIL_PROVIDER,
				status: "skipped_due_to_dedupe",
				webhookStatus: "provider_unknown",
				providerMessageId: null,
				providerStatusLastSeenAt: null,
				templateName: duplicate.templateName,
				errorMessage:
					"Billing lifecycle outbox was superseded by newer account state.",
				sentAt: null,
				failedAt: null,
				expectedStatus: duplicate.status,
				expectedWebhookStatus: duplicate.webhookStatus,
				expectedUpdatedAt: duplicate.updatedAt,
			});
		}
		return false;
	}

	const payloadSnapshot = {
		kind: input.templateName,
		subject: input.subject,
		bodyHtml: input.bodyHtml,
		tag: input.tag,
		billingStateFingerprint:
			billingLifecycleStateFingerprint(currentBillingInfo),
		...scheduledCancellationStateExpectationPayload(
			scheduledCancellationExpectation,
		),
		...refundStateExpectationPayload(refundExpectation),
		...billingMutationStateExpectationPayload(mutationExpectation),
		...(duplicate
			? {
					recoveryAttemptCount: retryableReconciledFailure
						? reconciledRecoveryAttemptCount + 1
						: reconciledRecoveryAttemptCount,
				}
			: {}),
	};
	let attemptId = duplicate?.id ?? null;
	let claimUpdatedAt: string | null = null;
	if (duplicate) {
		claimUpdatedAt = new Date().toISOString();
		const retryClaimed = await updateDeliveryAttemptResult(env, duplicate.id, {
			provider: EMAIL_PROVIDER,
			status: "pending",
			webhookStatus: "pending",
			providerMessageId: null,
			providerStatusLastSeenAt: null,
			templateName: input.templateName,
			errorMessage: null,
			sentAt: null,
			failedAt: null,
			payloadSnapshot,
			targetValue: input.email,
			updatedAt: claimUpdatedAt,
			expectedStatus: claimFromPending
				? "pending"
				: supersededOutbox
					? "skipped_due_to_dedupe"
					: "failed",
			expectedWebhookStatus: claimFromPending
				? "pending"
				: supersededOutbox
					? "provider_unknown"
					: undefined,
			expectedUpdatedAt: claimFromPending ? duplicate.updatedAt : undefined,
		});
		if (retryClaimed === false) return false;
	}

	if (!attemptId) {
		claimUpdatedAt = new Date().toISOString();
		try {
			attemptId = await createDeliveryAttempt(env, {
				userId: input.userId,
				watchlistId: null,
				digestRunId: null,
				deliveryTargetId: null,
				lane: "customer",
				channel: "email",
				provider: EMAIL_PROVIDER,
				status: "pending",
				webhookStatus: "pending",
				targetValue: input.email,
				templateName: input.templateName,
				eventIds: [],
				payloadSnapshot,
				idempotencyKey: input.idempotencyKey,
				timestamp: claimUpdatedAt,
			});
		} catch (error) {
			const concurrentClaim = await getDeliveryAttemptByIdempotencyKey(
				env,
				input.idempotencyKey,
			);
			if (concurrentClaim) return false;
			throw error;
		}
	}
	if (!claimUpdatedAt) {
		throw new Error(
			"Billing lifecycle delivery claim did not return an owner token.",
		);
	}
	// Configuration is a definite local boundary. Keep the durable claim in
	// pending/pending so a repaired environment can safely reclaim it without
	// inventing an ambiguous provider outcome.
	if (!isEmailSendingConfigured(env)) return false;
	const dispatchStartedAt = await markDeliveryAttemptProviderDispatch({
		attemptId,
		provider: EMAIL_PROVIDER,
		claimUpdatedAt,
		update: (id, update) => updateDeliveryAttemptResult(env, id, update),
	});
	if (!dispatchStartedAt) return false;

	const providerResult = await sendCloudflareEmail(env, {
		to: input.email,
		subject: input.subject,
		html: input.bodyHtml,
		tag: input.tag,
		unsubscribeUrl: null,
	});
	const finalized = await updateDeliveryAttemptResult(env, attemptId, {
		provider: providerResult.provider,
		status: providerResult.status,
		webhookStatus: providerResult.webhookStatus,
		providerMessageId: providerResult.providerMessageId,
		providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
		errorMessage: providerResult.errorMessage,
		sentAt: providerAcceptedAt(providerResult),
		failedAt:
			providerResult.status === "failed" ? new Date().toISOString() : null,
		expectedStatus: "pending",
		expectedWebhookStatus: "provider_unknown",
		expectedUpdatedAt: dispatchStartedAt,
	});
	if (finalized === false) return false;
	if (
		providerResult.status === "failed" &&
		providerResult.webhookStatus === "failed" &&
		input.retryWebhookOnExplicitFailure
	) {
		throw new BillingLifecycleEmailExplicitFailure(
			input.idempotencyKey,
			providerResult.errorMessage,
		);
	}
	return providerResult.status === "sent";
}

export async function sendBillingPaymentIssueEmail(
	env: AppEnv,
	input: {
		userId: string;
		email: string;
		name: string | null;
		occurredAt?: string | null;
		status: string;
		subscriptionId?: string | null;
		paymentId?: string | null;
		stateUpdatedAt: string;
		retryWebhookOnExplicitFailure?: boolean;
	},
) {
	return sendBillingLifecycleEmail(env, {
		userId: input.userId,
		email: input.email,
		retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
		mutationExpectation: createBillingMutationStateExpectation(input),
		...billingPaymentIssueEmailContent(env, input),
	});
}

export async function sendBillingCancellationEmail(
	env: AppEnv,
	input: {
		userId: string;
		email: string;
		name: string | null;
		kind: "scheduled" | "ended";
		effectiveAt?: string | null;
		eventId: string;
		subscriptionId?: string | null;
		stateUpdatedAt?: string | null;
		status?: string | null;
		paymentId?: string | null;
		retryWebhookOnExplicitFailure?: boolean;
	},
) {
	return sendBillingLifecycleEmail(env, {
		userId: input.userId,
		email: input.email,
		retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
		mutationExpectation:
			input.kind === "ended"
				? createBillingMutationStateExpectation(input)
				: null,
		...billingCancellationEmailContent(env, input),
	});
}

export async function sendBillingRefundEmail(
	env: AppEnv,
	input: {
		userId: string;
		email: string;
		name: string | null;
		eventId: string;
		paymentId: string;
		stateUpdatedAt: string;
		retryWebhookOnExplicitFailure?: boolean;
	},
) {
	const paymentId = readString(input.paymentId);
	const stateUpdatedAt = normalizedBillingTimestamp(input.stateUpdatedAt);
	return sendBillingLifecycleEmail(env, {
		userId: input.userId,
		email: input.email,
		retryWebhookOnExplicitFailure: input.retryWebhookOnExplicitFailure,
		refundExpectation:
			paymentId && stateUpdatedAt ? { paymentId, stateUpdatedAt } : null,
		...billingRefundEmailContent(env, input),
	});
}
