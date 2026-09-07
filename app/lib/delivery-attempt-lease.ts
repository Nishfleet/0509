import type { DeliveryAttemptRecord } from "~/lib/types";

// pending/pending is exclusively a pre-provider lease. Immediately before a
// provider call, durable senders must atomically move the row to
// pending/provider_unknown. The timeout only recovers work proven not to have
// crossed that boundary; it is never used to guess whether a send completed.
export const DELIVERY_PRE_DISPATCH_LEASE_MS = 60_000;
export const DELIVERY_DISPATCH_UNKNOWN_MESSAGE =
	"Provider dispatch started; outcome requires reconciliation if interrupted.";
export const INSTANT_PROVIDER_CLAIM_PROTOCOL = "instant_preclaim_v1";
export const DIGEST_PROVIDER_CLAIM_PROTOCOL = "digest_preclaim_v1";

export function hasTrustedDigestProviderRetryEvidence(
	attempt: Pick<DeliveryAttemptRecord, "payloadSnapshot">,
) {
	return (
		attempt.payloadSnapshot.deliveryClaimProtocol ===
		DIGEST_PROVIDER_CLAIM_PROTOCOL
	);
}

export function hasTrustedInstantProviderRetryEvidence(
	attempt: Pick<DeliveryAttemptRecord, "payloadSnapshot">,
) {
	if (
		attempt.payloadSnapshot.deliveryClaimProtocol ===
		INSTANT_PROVIDER_CLAIM_PROTOCOL
	) {
		return true;
	}

	const evidence = attempt.payloadSnapshot.instantAlertProviderEvidence;
	if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
		return false;
	}

	const record = evidence as Record<string, unknown>;
	return (
		record.outcome === "failed" &&
		typeof record.reference === "string" &&
		record.reference.trim().length > 0 &&
		typeof record.classification === "string" &&
		record.classification.trim().length > 0 &&
		typeof record.observedAt === "string" &&
		Number.isFinite(Date.parse(record.observedAt))
	);
}

export function deliveryPreDispatchStaleBefore(referenceTimeMs = Date.now()) {
	return new Date(referenceTimeMs - DELIVERY_PRE_DISPATCH_LEASE_MS).toISOString();
}

export function isStalePreDispatchAttempt(
	attempt: Pick<DeliveryAttemptRecord, "status" | "webhookStatus" | "updatedAt">,
	referenceTimeMs = Date.now(),
) {
	if (attempt.status !== "pending" || attempt.webhookStatus !== "pending") {
		return false;
	}

	const updatedAtMs = Date.parse(attempt.updatedAt);
	return (
		Number.isFinite(updatedAtMs) &&
		updatedAtMs <= referenceTimeMs - DELIVERY_PRE_DISPATCH_LEASE_MS
	);
}

export async function markDeliveryAttemptProviderDispatch(input: {
	attemptId: string;
	provider: string;
	claimUpdatedAt: string;
	update: (attemptId: string, update: {
		provider: string;
		status: "pending";
		webhookStatus: "provider_unknown";
		providerMessageId: null;
		providerStatusLastSeenAt: null;
		errorMessage: string;
		sentAt: null;
		failedAt: null;
		expectedStatus: "pending";
		expectedWebhookStatus: "pending";
		expectedUpdatedAt: string;
		updatedAt: string;
	}) => Promise<boolean | void>;
}) {
	const dispatchStartedAt = new Date().toISOString();
	const marked = await input.update(input.attemptId, {
		provider: input.provider,
		status: "pending",
		webhookStatus: "provider_unknown",
		providerMessageId: null,
		providerStatusLastSeenAt: null,
		errorMessage: DELIVERY_DISPATCH_UNKNOWN_MESSAGE,
		sentAt: null,
		failedAt: null,
		expectedStatus: "pending",
		expectedWebhookStatus: "pending",
		expectedUpdatedAt: input.claimUpdatedAt,
		updatedAt: dispatchStartedAt,
	});
	return marked === false ? null : dispatchStartedAt;
}
