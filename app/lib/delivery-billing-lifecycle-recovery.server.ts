import {
	getDeliveryAttemptByIdempotencyKey,
	getUserDeliveryProfile,
	getUserPlanBillingInfo,
	listStaleBillingLifecycleEmailAttempts,
	updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
	deliveryPreDispatchStaleBefore,
	markDeliveryAttemptProviderDispatch,
} from "~/lib/delivery-attempt-lease";
import {
	billingLifecycleOutboxStateStillApplies,
	billingLifecycleRecoveryAttemptCount,
	billingLifecycleStateFingerprint,
	billingMutationStateExpectationPayload,
	isExplicitlyReconciledBillingFailure,
	normalizedBillingTimestamp,
	readBillingLifecycleRecoveryPayload,
	refundStateExpectationPayload,
	scheduledCancellationStateExpectationPayload,
} from "~/lib/delivery-billing-lifecycle-state.server";
import {
	EMAIL_PROVIDER,
	providerAcceptedAt,
	readString,
	sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import { type AppEnv, isEmailSendingConfigured } from "~/lib/env.server";

const BILLING_LIFECYCLE_RECOVERY_LIMIT = 10;
export const BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS = 3;

export async function recoverAbandonedBillingLifecycleEmails(env: AppEnv) {
	const emptyResult = {
		scanned: 0,
		claimed: 0,
		sent: 0,
		failed: 0,
		providerUnknown: 0,
		superseded: 0,
		conflicts: 0,
	};
	if (!env.DB) return emptyResult;
	if (!isEmailSendingConfigured(env)) return emptyResult;

	const attempts = await listStaleBillingLifecycleEmailAttempts(env, {
		staleBefore: deliveryPreDispatchStaleBefore(),
		limit: BILLING_LIFECYCLE_RECOVERY_LIMIT,
		maxRecoveryAttempts: BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS,
	});
	const result = { ...emptyResult, scanned: attempts.length };

	for (const attempt of attempts) {
		if (
			attempt.status === "failed" &&
			!isExplicitlyReconciledBillingFailure(attempt)
		) {
			continue;
		}
		const payload = readBillingLifecycleRecoveryPayload(attempt);
		const recoveryAttemptCount =
			billingLifecycleRecoveryAttemptCount(attempt) + 1;
		const retryingExplicitFailure =
			isExplicitlyReconciledBillingFailure(attempt);
		const [currentBillingInfo, currentProfile] = payload
			? await Promise.all([
					getUserPlanBillingInfo(env, attempt.userId),
					getUserDeliveryProfile(env, attempt.userId),
				])
			: [null, null];
		const profileEmail = readString(currentProfile?.email) ?? null;
		const currentEmail =
			currentProfile?.emailVerified === true ? profileEmail : null;
		const billingStateStillCurrent =
			payload !== null &&
			currentBillingInfo !== null &&
			(payload.pendingDispatch
				? billingLifecycleOutboxStateStillApplies(
						attempt.templateName,
						currentBillingInfo,
						payload.stateExpectation,
						payload.refundExpectation,
						payload.mutationExpectation,
					)
				: billingLifecycleStateFingerprint(currentBillingInfo) ===
					payload.billingStateFingerprint);

		if (payload && !billingStateStillCurrent) {
			const superseded = await updateDeliveryAttemptResult(env, attempt.id, {
				provider: EMAIL_PROVIDER,
				status: "skipped_due_to_dedupe",
				webhookStatus: "provider_unknown",
				providerMessageId: null,
				providerStatusLastSeenAt: null,
				templateName: attempt.templateName,
				errorMessage:
					"Billing lifecycle recovery was superseded by newer account state.",
				sentAt: null,
				failedAt: null,
				expectedStatus: retryingExplicitFailure ? "failed" : "pending",
				expectedWebhookStatus: retryingExplicitFailure ? "failed" : "pending",
				expectedUpdatedAt: attempt.updatedAt,
			});
			if (superseded !== true) result.conflicts += 1;
			else {
				result.claimed += 1;
				result.superseded += 1;
			}
			continue;
		}

		if (payload && !currentEmail) {
			const deferred = await updateDeliveryAttemptResult(env, attempt.id, {
				provider: attempt.provider,
				status: attempt.status,
				webhookStatus: attempt.webhookStatus,
				providerMessageId: attempt.providerMessageId,
				providerStatusLastSeenAt: attempt.providerStatusLastSeenAt,
				templateName: attempt.templateName,
				errorMessage:
					retryingExplicitFailure && attempt.errorMessage
						? attempt.errorMessage
						: profileEmail
							? "Billing lifecycle recovery recipient is not verified."
							: "Billing lifecycle recovery recipient is unavailable.",
				sentAt: attempt.sentAt,
				failedAt: attempt.failedAt,
				updatedAt: new Date().toISOString(),
				expectedStatus: retryingExplicitFailure ? "failed" : "pending",
				expectedWebhookStatus: retryingExplicitFailure ? "failed" : "pending",
				expectedUpdatedAt: attempt.updatedAt,
			});
			if (deferred !== true) result.conflicts += 1;
			else result.claimed += 1;
			continue;
		}

		const claimUpdatedAt = new Date().toISOString();
		const claimed = await updateDeliveryAttemptResult(env, attempt.id, {
			provider: EMAIL_PROVIDER,
			status: "pending",
			webhookStatus: "pending",
			providerMessageId: null,
			providerStatusLastSeenAt: null,
			templateName: attempt.templateName,
			errorMessage: null,
			sentAt: null,
			failedAt: null,
			payloadSnapshot:
				payload && currentBillingInfo
					? {
							kind: attempt.templateName,
							subject: payload.subject,
							bodyHtml: payload.bodyHtml,
							tag: payload.tag,
							billingStateFingerprint: payload.pendingDispatch
								? billingLifecycleStateFingerprint(currentBillingInfo)
								: payload.billingStateFingerprint,
							...scheduledCancellationStateExpectationPayload(
								payload.stateExpectation,
							),
							...refundStateExpectationPayload(payload.refundExpectation),
							...billingMutationStateExpectationPayload(
								payload.mutationExpectation,
							),
							recoveryAttemptCount,
						}
					: undefined,
			targetValue: currentEmail ?? undefined,
			updatedAt: claimUpdatedAt,
			expectedStatus: retryingExplicitFailure ? "failed" : "pending",
			expectedWebhookStatus: retryingExplicitFailure ? "failed" : "pending",
			expectedUpdatedAt: attempt.updatedAt,
		});
		if (claimed !== true) {
			result.conflicts += 1;
			continue;
		}
		result.claimed += 1;

		if (!payload || !currentEmail) {
			const failedAt = new Date().toISOString();
			const finalized = await updateDeliveryAttemptResult(env, attempt.id, {
				provider: EMAIL_PROVIDER,
				status: "failed",
				webhookStatus: "failed",
				providerMessageId: null,
				providerStatusLastSeenAt: null,
				templateName: attempt.templateName,
				errorMessage: payload
					? "Billing lifecycle recovery recipient is unavailable."
					: "Billing lifecycle recovery payload is incomplete.",
				sentAt: null,
				failedAt,
				expectedStatus: "pending",
				expectedWebhookStatus: "pending",
				expectedUpdatedAt: claimUpdatedAt,
			});
			if (finalized === false) result.conflicts += 1;
			else result.failed += 1;
			continue;
		}

		const dispatchStartedAt = await markDeliveryAttemptProviderDispatch({
			attemptId: attempt.id,
			provider: EMAIL_PROVIDER,
			claimUpdatedAt,
			update: (id, update) => updateDeliveryAttemptResult(env, id, update),
		});
		if (!dispatchStartedAt) {
			result.conflicts += 1;
			continue;
		}
		const providerResult = await sendCloudflareEmail(env, {
			to: currentEmail,
			subject: payload.subject,
			html: payload.bodyHtml,
			tag: payload.tag,
			unsubscribeUrl: null,
		});
		const finalized = await updateDeliveryAttemptResult(env, attempt.id, {
			provider: providerResult.provider,
			status: providerResult.status,
			webhookStatus: providerResult.webhookStatus,
			providerMessageId: providerResult.providerMessageId,
			providerStatusLastSeenAt: providerResult.providerStatusLastSeenAt,
			templateName: attempt.templateName,
			errorMessage: providerResult.errorMessage,
			sentAt: providerAcceptedAt(providerResult),
			failedAt:
				providerResult.status === "failed" ? new Date().toISOString() : null,
			expectedStatus: "pending",
			expectedWebhookStatus: "provider_unknown",
			expectedUpdatedAt: dispatchStartedAt,
		});
		if (finalized === false) result.conflicts += 1;
		else if (providerResult.status === "sent") result.sent += 1;
		else if (providerResult.webhookStatus === "provider_unknown") {
			result.providerUnknown += 1;
		} else result.failed += 1;
	}
	return result;
}

export async function reconcileBillingLifecycleEmailDelivery(
	env: AppEnv,
	input: {
		idempotencyKey: string;
		outcome: "sent" | "failed";
		evidence: {
			reference: string;
			classification: string;
			observedAt: string;
		};
		errorMessage?: string | null;
	},
) {
	if (
		!/^billing-(?:payment-issue|cancellation|refund):/.test(
			input.idempotencyKey,
		)
	) {
		return false;
	}
	const reference = readString(input.evidence?.reference);
	const classification = readString(input.evidence?.classification);
	const observedAt = normalizedBillingTimestamp(input.evidence?.observedAt);
	if (
		!reference ||
		reference.length > 200 ||
		!classification ||
		classification.length > 80 ||
		!observedAt
	) {
		return false;
	}

	const attempt = await getDeliveryAttemptByIdempotencyKey(
		env,
		input.idempotencyKey,
	);
	const hasReconcilableUnknownOutcome =
		attempt?.webhookStatus === "provider_unknown" &&
		(attempt.status === "pending" ||
			(attempt.status === "failed" &&
				Boolean(attempt.providerStatusLastSeenAt)));
	if (
		!attempt ||
		!hasReconcilableUnknownOutcome
	) {
		return false;
	}
	const reconciled = await updateDeliveryAttemptResult(env, attempt.id, {
		provider: attempt.provider || EMAIL_PROVIDER,
		status: input.outcome,
		webhookStatus: input.outcome === "sent" ? "delivered" : "failed",
		providerMessageId: attempt.providerMessageId,
		providerStatusLastSeenAt: observedAt,
		errorMessage:
			input.outcome === "failed"
				? (input.errorMessage ??
					"Provider reconciliation confirmed the email was not accepted.")
				: null,
		sentAt: input.outcome === "sent" ? observedAt : null,
		failedAt: input.outcome === "failed" ? observedAt : null,
		payloadSnapshot: {
			...attempt.payloadSnapshot,
			billingLifecycleProviderEvidence: {
				reference,
				classification,
				observedAt,
				outcome: input.outcome,
			},
		},
		expectedStatus: attempt.status,
		expectedWebhookStatus: "provider_unknown",
		expectedUpdatedAt: attempt.updatedAt,
	});
	return reconciled !== false;
}
