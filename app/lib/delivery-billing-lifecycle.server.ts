import {
	createDeliveryAttempt,
	getDeliveryAttemptByIdempotencyKey,
	getUserDeliveryProfile,
	getUserPlanBillingInfo,
	listStaleBillingLifecycleEmailAttempts,
	updateDeliveryAttemptResult,
	type UserPlanBillingInfo,
} from "~/lib/data.server";
import {
	deliveryPreDispatchStaleBefore,
	isStalePreDispatchAttempt,
	markDeliveryAttemptProviderDispatch,
} from "~/lib/delivery-attempt-lease";
import {
	EMAIL_PROVIDER,
	appBaseUrl,
	escapeHtml,
	providerAcceptedAt,
	readString,
	sendCloudflareEmail,
} from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import type { DeliveryAttemptRecord } from "~/lib/types";

const BILLING_LIFECYCLE_RECOVERY_LIMIT = 10;
export const BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS = 3;

const BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE =
	"BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE" as const;

interface ScheduledCancellationStateExpectation {
	cutoff: string;
	eventId: string;
	subscriptionId: string;
	stateUpdatedAt: string;
}

type RefundStateExpectation = { paymentId: string; stateUpdatedAt: string };
type BillingMutationStateExpectation = {
	status: string;
	subscriptionId: string | null;
	paymentId: string | null;
	stateUpdatedAt: string;
};

export class BillingLifecycleEmailExplicitFailure extends Error {
	readonly code = BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE;

	constructor(
		readonly idempotencyKey: string,
		providerMessage: string | null,
	) {
		super(providerMessage ?? "Cloudflare Email explicitly rejected the lifecycle email.");
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

function billingDateLabel(iso: string | null | undefined) {
	const ms = Date.parse(iso ?? "");
	if (!Number.isFinite(ms)) {
		return null;
	}
	const formatted = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(ms));
	return `${formatted} (UTC)`;
}

function renderBillingEmailHtml(input: {
	name: string | null;
	paragraphs: string[];
	ctaLabel: string;
	ctaUrl: string;
	footnote: string;
}) {
	const greeting = input.name?.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
	const paragraphs = input.paragraphs
		.map((paragraph) => `<p style="margin: 0 0 16px;">${paragraph}</p>`)
		.join("");

	return `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      ${paragraphs}
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.ctaUrl)}" style="display: inline-block; background-color: #101828; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">
          ${escapeHtml(input.ctaLabel)}
        </a>
      </p>
      <p style="margin: 0 0 12px;">— Five to Nine</p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">${escapeHtml(input.footnote)}</p>
    </div>
  `;
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
	const duplicate = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
	const stalePreDispatch = duplicate ? isStalePreDispatchAttempt(duplicate) : false;
	const pendingOutboxDispatch =
		duplicate?.status === "pending" &&
		duplicate.webhookStatus === "pending" &&
		duplicate.payloadSnapshot?.["outboxPendingDispatch"] === true;
	const supersededOutbox =
		duplicate?.status === "skipped_due_to_dedupe" &&
		duplicate.webhookStatus === "provider_unknown";
	if (
		duplicate &&
		duplicate.status !== "failed" &&
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
		: input.stateExpectation ?? null;
	const refundExpectation = duplicate
		? readRefundStateExpectation(duplicate.payloadSnapshot) ??
			(duplicate.status === "failed" || (stalePreDispatch && !pendingOutboxDispatch)
				? input.refundExpectation ?? null
				: null)
		: input.refundExpectation ?? null;
	const mutationExpectation = duplicate
		? readBillingMutationStateExpectation(duplicate.payloadSnapshot) ??
			(duplicate.status === "failed" ||
			(stalePreDispatch && !pendingOutboxDispatch) ||
			(supersededOutbox && duplicate.payloadSnapshot?.outboxPendingDispatch !== true)
				? input.mutationExpectation ?? null
				: null)
		: input.mutationExpectation ?? null;
	const durableKind = pendingOutboxDispatch
		? readString(duplicate?.payloadSnapshot?.kind)
		: input.templateName;
	const stateStillCurrent =
		(!pendingOutboxDispatch ||
			(durableKind === duplicate.templateName && durableKind === input.templateName)) &&
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

	const billingStateFingerprint = billingLifecycleStateFingerprint(currentBillingInfo);
	const payloadSnapshot = {
		kind: input.templateName,
		subject: input.subject,
		bodyHtml: input.bodyHtml,
		tag: input.tag,
		billingStateFingerprint,
		...scheduledCancellationStateExpectationPayload(scheduledCancellationExpectation),
		...refundStateExpectationPayload(refundExpectation),
		...billingMutationStateExpectationPayload(mutationExpectation),
		...(duplicate
			? { recoveryAttemptCount: billingLifecycleRecoveryAttemptCount(duplicate) }
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
		if (retryClaimed === false) {
			return false;
		}
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
			const concurrentClaim = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
			if (concurrentClaim) {
				return false;
			}
			throw error;
		}
	}

	if (!claimUpdatedAt) {
		throw new Error("Billing lifecycle delivery claim did not return an owner token.");
	}
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
		failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
		expectedStatus: "pending",
		expectedWebhookStatus: "provider_unknown",
		expectedUpdatedAt: dispatchStartedAt,
	});
	if (finalized === false) {
		return false;
	}

	if (providerResult.status === "failed" && input.retryWebhookOnExplicitFailure) {
		throw new BillingLifecycleEmailExplicitFailure(
			input.idempotencyKey,
			providerResult.errorMessage,
		);
	}

	return providerResult.status === "sent";
}

function billingLifecycleStateFingerprint(info: UserPlanBillingInfo) {
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

function readBillingLifecycleRecoveryPayload(attempt: DeliveryAttemptRecord) {
	const kind = readString(attempt.payloadSnapshot.kind);
	const subject = readString(attempt.payloadSnapshot.subject);
	const bodyHtml = readString(attempt.payloadSnapshot.bodyHtml);
	const tag = readString(attempt.payloadSnapshot.tag);
	const billingStateFingerprint = readString(
		attempt.payloadSnapshot.billingStateFingerprint,
	);
	const pendingDispatch = attempt.payloadSnapshot.outboxPendingDispatch === true;
	const stateExpectation = readScheduledCancellationStateExpectation(
		attempt.payloadSnapshot,
	);
	const refundExpectation = readRefundStateExpectation(attempt.payloadSnapshot);
	const mutationExpectation = readBillingMutationStateExpectation(attempt.payloadSnapshot);
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

function billingLifecycleRecoveryAttemptCount(attempt: DeliveryAttemptRecord) {
	const value = attempt.payloadSnapshot?.recoveryAttemptCount;
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function billingLifecycleOutboxStateStillApplies(
	templateName: string | null,
	info: UserPlanBillingInfo,
	scheduledCancellation: ScheduledCancellationStateExpectation | null = null,
	refund: RefundStateExpectation | null = null,
	mutation: BillingMutationStateExpectation | null = null,
) {
	switch (templateName) {
		case "billing_payment_issue":
			return billingMutationStateStillApplies(info, mutation) && (
				info.dodoStatus === "payment.failed" ||
				info.dodoStatus === "subscription.failed" ||
				info.dodoStatus === "subscription.on_hold"
			);
		case "billing_cancellation_scheduled":
			return (
				info.dodoStatus === "cancellation_scheduled" &&
				isPaidPlanFamily(info.plan) &&
				scheduledCancellation !== null &&
				isFutureBillingCutoff(scheduledCancellation.cutoff) &&
				sameBillingTimestamp(info.dodoNextBillingAt, scheduledCancellation.cutoff) &&
				info.dodoSubscriptionId === scheduledCancellation.subscriptionId &&
				sameBillingTimestamp(info.planUpdatedAt, scheduledCancellation.stateUpdatedAt)
			);
		case "billing_access_ended":
			return billingMutationStateStillApplies(info, mutation) && (
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
	if (!env.DB) {
		return emptyResult;
	}

	const attempts = await listStaleBillingLifecycleEmailAttempts(env, {
		staleBefore: deliveryPreDispatchStaleBefore(),
		limit: BILLING_LIFECYCLE_RECOVERY_LIMIT,
		maxRecoveryAttempts: BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS,
	});
	const result = { ...emptyResult, scanned: attempts.length };

	for (const attempt of attempts) {
		const payload = readBillingLifecycleRecoveryPayload(attempt);
		const recoveryAttemptCount = billingLifecycleRecoveryAttemptCount(attempt) + 1;
		const retryingExplicitFailure =
			attempt.status === "failed" &&
			attempt.webhookStatus === "failed" &&
			attempt.providerStatusLastSeenAt !== null;
		const [currentBillingInfo, currentProfile] = payload
			? await Promise.all([
					getUserPlanBillingInfo(env, attempt.userId),
					getUserDeliveryProfile(env, attempt.userId),
				])
			: [null, null];
		const profileEmail = readString(currentProfile?.email) ?? null;
		const currentEmail = currentProfile?.emailVerified === true ? profileEmail : null;
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
			if (superseded !== true) {
				result.conflicts += 1;
			} else {
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
			if (deferred !== true) {
				result.conflicts += 1;
			} else {
				result.claimed += 1;
			}
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
							billingStateFingerprint:
								payload.pendingDispatch
									? billingLifecycleStateFingerprint(currentBillingInfo)
									: payload.billingStateFingerprint,
							...scheduledCancellationStateExpectationPayload(
								payload.stateExpectation,
							),
							...refundStateExpectationPayload(payload.refundExpectation),
							...billingMutationStateExpectationPayload(payload.mutationExpectation),
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
			if (finalized === false) {
				result.conflicts += 1;
			} else {
				result.failed += 1;
			}
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
			failedAt: providerResult.status === "failed" ? new Date().toISOString() : null,
			expectedStatus: "pending",
			expectedWebhookStatus: "provider_unknown",
			expectedUpdatedAt: dispatchStartedAt,
		});
		if (finalized === false) {
			result.conflicts += 1;
		} else if (providerResult.status === "sent") {
			result.sent += 1;
		} else if (providerResult.status === "pending") {
			result.providerUnknown += 1;
		} else {
			result.failed += 1;
		}
	}

	return result;
}

export async function reconcileBillingLifecycleEmailDelivery(
	env: AppEnv,
	input: {
		idempotencyKey: string;
		outcome: "sent" | "failed";
		reconciledAt: string;
		errorMessage?: string | null;
	},
) {
	if (!/^billing-(?:payment-issue|cancellation|refund):/.test(input.idempotencyKey)) {
		return false;
	}

	const attempt = await getDeliveryAttemptByIdempotencyKey(env, input.idempotencyKey);
	if (
		!attempt ||
		attempt.status !== "pending" ||
		attempt.webhookStatus !== "provider_unknown"
	) {
		return false;
	}

	const reconciled = await updateDeliveryAttemptResult(env, attempt.id, {
		provider: attempt.provider || EMAIL_PROVIDER,
		status: input.outcome,
		webhookStatus: input.outcome === "sent" ? "delivered" : "failed",
		providerMessageId: attempt.providerMessageId,
		providerStatusLastSeenAt: input.reconciledAt,
		errorMessage:
			input.outcome === "failed"
				? input.errorMessage ?? "Provider reconciliation confirmed the email was not accepted."
				: null,
		sentAt: input.outcome === "sent" ? input.reconciledAt : null,
		failedAt: input.outcome === "failed" ? input.reconciledAt : null,
		expectedStatus: "pending",
	});
	return reconciled !== false;
}

interface BillingLifecycleEmailContent {
	idempotencyKey: string;
	subject: string;
	bodyHtml: string;
	tag: string;
	templateName: string;
	stateExpectation?: ScheduledCancellationStateExpectation | null;
}

function billingPaymentIssueEmailContent(
	env: AppEnv,
	input: { userId: string; name: string | null; occurredAt?: string | null },
): BillingLifecycleEmailContent {
	const occurredAtMs = Date.parse(input.occurredAt ?? "");
	const dayKey = new Date(
		Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
	).toISOString().slice(0, 10);
	return {
		idempotencyKey: `billing-payment-issue:${input.userId}:${dayKey}`,
		subject: "Action needed: a Five to Nine payment didn't go through",
		tag: "billing-payment-issue",
		templateName: "billing_payment_issue",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"The latest payment for your Five to Nine subscription didn't go through. Nothing has changed yet — your plan stays active while the payment processor retries.",
				"To avoid an interruption, make sure your payment method is up to date.",
			],
			ctaLabel: "Update payment method",
			ctaUrl: `${appBaseUrl(env)}/app/billing`,
			footnote:
				"If a retry has already succeeded, you can ignore this email — nothing changes.",
		}),
	};
}

function billingCancellationEmailContent(
	env: AppEnv,
	input: {
		userId: string;
		name: string | null;
		kind: "scheduled" | "ended";
		effectiveAt?: string | null;
		eventId: string;
		subscriptionId?: string | null;
		stateUpdatedAt?: string | null;
	},
): BillingLifecycleEmailContent {
	const billingUrl = `${appBaseUrl(env)}/app/billing`;
	const idempotencyKey = `billing-cancellation:${input.userId}:${input.eventId}`;

	if (input.kind === "scheduled") {
		const dateLabel = billingDateLabel(input.effectiveAt);
		const activeUntil = dateLabel
			? `Your plan stays active until <strong>${escapeHtml(dateLabel)}</strong> — watchlists, digests, and alerts keep running until then.`
			: "Your plan stays active until the end of the period you already paid for — watchlists, digests, and alerts keep running until then.";
		return {
			idempotencyKey,
			tag: "billing-cancellation",
			subject: "Your Five to Nine cancellation is confirmed",
			templateName: "billing_cancellation_scheduled",
			stateExpectation: createScheduledCancellationStateExpectation(input),
			bodyHtml: renderBillingEmailHtml({
				name: input.name,
				paragraphs: [
					`Your Five to Nine subscription is cancelled and won't renew. ${activeUntil}`,
					"After that, your workspace moves to the Free plan. Watchlists over the Free limit are paused automatically (the newest one stays active), and your boards, history, and evidence stay in place.",
				],
				ctaLabel: "Review billing",
				ctaUrl: billingUrl,
				footnote:
					"Changed your mind? Once your access ends, resubscribe from your billing page — paused watchlists resume automatically.",
			}),
		};
	}

	return {
		idempotencyKey,
		tag: "billing-cancellation",
		subject: "Your Five to Nine plan has ended",
		templateName: "billing_access_ended",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"Your Five to Nine subscription has ended and your workspace is now on the Free plan.",
				"Watchlists over the Free limit were paused automatically — the newest one stays active. Your boards, history, and evidence are untouched.",
			],
			ctaLabel: "Reactivate your plan",
			ctaUrl: billingUrl,
			footnote:
				"Resubscribe any time — paused watchlists resume automatically when a plan is active again.",
		}),
	};
}

function billingRefundEmailContent(
	env: AppEnv,
	input: { userId: string; name: string | null; eventId: string },
): BillingLifecycleEmailContent {
	return {
		idempotencyKey: `billing-refund:${input.userId}:${input.eventId}`,
		subject: "Your Five to Nine refund has been processed",
		tag: "billing-refund",
		templateName: "billing_refund_revoked",
		bodyHtml: renderBillingEmailHtml({
			name: input.name,
			paragraphs: [
				"A full refund for your Five to Nine purchase has been processed. Your workspace has moved to the Free plan, and credits from that purchase have expired.",
				"Your boards, history, and evidence stay in place on the Free plan.",
			],
			ctaLabel: "View billing",
			ctaUrl: `${appBaseUrl(env)}/app/billing`,
			footnote:
				"If this refund is unexpected, contact support using the address below.",
		}),
	};
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
			input.kind === "ended" ? createBillingMutationStateExpectation(input) : null,
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

export type BillingLifecycleEmailOutboxInput =
	| { kind: "payment_issue"; userId: string; email: string; name: string | null; occurredAt?: string | null }
	| {
			kind: "cancellation_scheduled";
			userId: string;
			email: string;
			name: string | null;
			effectiveAt?: string | null;
			eventId: string;
			subscriptionId?: string | null;
			stateUpdatedAt?: string | null;
		}
	| { kind: "revoke"; userId: string; email: string; name: string | null; eventId: string }
	| { kind: "refund"; userId: string; email: string; name: string | null; eventId: string };

export function prepareBillingLifecycleEmailOutbox(
	env: AppEnv,
	input: BillingLifecycleEmailOutboxInput,
) {
	const content =
		input.kind === "payment_issue"
			? billingPaymentIssueEmailContent(env, input)
			: input.kind === "cancellation_scheduled"
				? billingCancellationEmailContent(env, { ...input, kind: "scheduled" })
				: input.kind === "revoke"
					? billingCancellationEmailContent(env, { ...input, kind: "ended" })
					: billingRefundEmailContent(env, input);
	const stateExpectation = content.stateExpectation ?? null;
	return {
		userId: input.userId,
		email: input.email,
		idempotencyKey: content.idempotencyKey,
		templateName: content.templateName,
		payloadSnapshot: {
			kind: content.templateName,
			subject: content.subject,
			bodyHtml: content.bodyHtml,
			tag: content.tag,
			billingStateFingerprint: null,
			outboxPendingDispatch: true,
			...scheduledCancellationStateExpectationPayload(stateExpectation),
		},
	};
}

function createScheduledCancellationStateExpectation(input: {
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

function readScheduledCancellationStateExpectation(
	payload: Record<string, unknown> | null | undefined,
): ScheduledCancellationStateExpectation | null {
	if (!payload) {
		return null;
	}
	return createScheduledCancellationStateExpectation({
		effectiveAt: readString(payload.scheduledCancellationCutoff),
		eventId: readString(payload.scheduledCancellationEventId) ?? "",
		subscriptionId: readString(payload.scheduledCancellationSubscriptionId),
		stateUpdatedAt: readString(payload.scheduledCancellationStateUpdatedAt),
	});
}

function readRefundStateExpectation(
	payload: Record<string, unknown> | null | undefined,
): RefundStateExpectation | null {
	if (!payload) return null;
	const paymentId = readString(payload.refundPaymentId);
	const stateUpdatedAt = normalizedBillingTimestamp(readString(payload.refundStateUpdatedAt));
	return paymentId && stateUpdatedAt ? { paymentId, stateUpdatedAt } : null;
}

function createBillingMutationStateExpectation(input: {
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

function readBillingMutationStateExpectation(
	payload: Record<string, unknown> | null | undefined,
) {
	return createBillingMutationStateExpectation({
		status: readString(payload?.billingMutationStatus),
		subscriptionId: readString(payload?.billingMutationSubscriptionId),
		paymentId: readString(payload?.billingMutationPaymentId),
		stateUpdatedAt: readString(payload?.billingMutationStateUpdatedAt),
	});
}

function scheduledCancellationStateExpectationPayload(
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

function refundStateExpectationPayload(expectation: RefundStateExpectation | null) {
	return expectation ? {
		refundPaymentId: expectation.paymentId,
		refundStateUpdatedAt: expectation.stateUpdatedAt,
	} : {};
}

function billingMutationStateExpectationPayload(
	expectation: BillingMutationStateExpectation | null,
) {
	return expectation ? {
		billingMutationStatus: expectation.status,
		billingMutationSubscriptionId: expectation.subscriptionId,
		billingMutationPaymentId: expectation.paymentId,
		billingMutationStateUpdatedAt: expectation.stateUpdatedAt,
	} : {};
}

function billingMutationStateStillApplies(
	info: UserPlanBillingInfo,
	expectation: BillingMutationStateExpectation | null,
) {
	if (!expectation || info.dodoStatus !== expectation.status ||
			!sameBillingTimestamp(info.planUpdatedAt, expectation.stateUpdatedAt)) return false;
	return expectation.subscriptionId
		? info.dodoSubscriptionId === expectation.subscriptionId
		: info.dodoPaymentId === expectation.paymentId;
}

function normalizedBillingTimestamp(value: string | null | undefined) {
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
