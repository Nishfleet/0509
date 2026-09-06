import { describe, expect, it, vi } from "vitest";

import { setupBillingLifecycleDelivery } from "./helpers/billing-lifecycle-delivery";

const {
	emailEnv, emailState, emailSendPayload, mockEmailSend,
	scheduledWatermark, currentBillingInfo, refundBillingInfo,
	billingState, currentBillingStateFingerprint, billingPayload, reconciledFailurePayload, billingAttempt,
	refundRecoveryAttempt,
	recipient, sendPaymentIssue, sendRefund, sendCancellation, sendScheduledCancellation, recoverBilling, mockBillingDataServer,
	trackAttemptUpdates,
} = setupBillingLifecycleDelivery();

describe("billing lifecycle emails",()=>{
it("keeps an in-flight pre-dispatch claim separate from provider-unknown reconciliation", async () => {
let releaseProvider: ((value: { messageId: string }) => void) | undefined;
let signalProviderStarted: (() => void) | undefined;
const providerStarted = new Promise<void>((resolve) => {
signalProviderStarted = resolve;
});
emailState.emailSend = vi.fn().mockImplementation(
() =>
new Promise<{ messageId: string }>((resolve) => {
releaseProvider = resolve;
signalProviderStarted?.();
}),
);
let durableStatus: string | null = null;
let durableWebhookStatus: string | null = null;
let durableUpdatedAt: string | null = null;
const createDeliveryAttempt = vi.fn().mockImplementation(async (
_env: unknown,
input: { status: string; webhookStatus: string; timestamp?: string },
) => {
durableStatus = input.status;
durableWebhookStatus = input.webhookStatus;
durableUpdatedAt = input.timestamp ?? null;
return "attempt-in-flight";
});
const getDeliveryAttemptByIdempotencyKey = vi.fn().mockImplementation(async () => {
if (!durableStatus) {
return null;
}
return {
id: "attempt-in-flight",
provider: "cloudflare_email",
status: durableStatus,
webhookStatus: durableWebhookStatus,
providerMessageId: null,
updatedAt: durableUpdatedAt,
};
});
const updateDeliveryAttemptResult = vi.fn(
async (
_env: unknown,
_id: string,
input: {
expectedStatus?: string;
expectedWebhookStatus?: string;
expectedUpdatedAt?: string;
status: string;
webhookStatus: string;
updatedAt?: string;
},
) => {
if (input.expectedStatus && durableStatus !== input.expectedStatus) {
return false;
}
if (
input.expectedWebhookStatus &&
durableWebhookStatus !== input.expectedWebhookStatus
) {
return false;
}
if (input.expectedUpdatedAt && durableUpdatedAt !== input.expectedUpdatedAt) {
return false;
}
durableStatus = input.status;
durableWebhookStatus = input.webhookStatus;
durableUpdatedAt = input.updatedAt ?? durableUpdatedAt;
return true;
},
);
mockBillingDataServer({
createDeliveryAttempt,
getDeliveryAttemptByIdempotencyKey,
updateDeliveryAttemptResult,
});
const { reconcileBillingLifecycleEmailDelivery } = await import("~/lib/delivery.server");
const sendResult = sendRefund({ name: null,
eventId: "evt-in-flight-reconcile", });
await providerStarted;
await expect(
reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
idempotencyKey: "billing-refund:user-1:evt-in-flight-reconcile",
outcome: "failed",
evidence: {
reference: "cf-event-in-flight-rejected",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:00.000Z",
},
errorMessage: "Provider evidence confirmed no acceptance.",
}),
).resolves.toBe(true);
releaseProvider?.({ messageId: "msg_arrived_after_reconcile" });
await expect(sendResult).resolves.toBe(false);
expect(durableStatus).toBe("failed");
expect(durableWebhookStatus).toBe("failed");
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
"attempt-in-flight",
expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "provider_unknown",
status: "sent",
}),
);
});
it("sends the scheduled-cancellation email with the active-until date and event-keyed idempotency", async () => {
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
const sendMock = mockEmailSend();
const mocks = mockBillingDataServer({
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "cancellation_scheduled",
dodoNextBillingAt: "2026-08-01T00:00:00.000Z",
}),
});
const sent = await sendScheduledCancellation("evt-cancel-1", {
effectiveAt: "2026-08-01T00:00:00.000Z",
subscriptionId: "subscription-current",
stateUpdatedAt: scheduledWatermark,
});
expect(sent).toBe(true);
const payload = emailSendPayload(sendMock);
expect(payload.subject).toBe("Your Five to Nine cancellation is confirmed");
expect(payload.html).toContain("August 1, 2026 (UTC)");
expect(payload.html).toContain("won't renew");
expect(payload.html).toContain("paused automatically");
expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
expect(attempt.templateName).toBe("billing_cancellation_scheduled");
expect(attempt.idempotencyKey).toBe("billing-cancellation:user-1:evt-cancel-1");
});
it("does not send a scheduled cancellation without a provable future cutoff", async () => {
const sendMock = mockEmailSend();
const mocks = mockBillingDataServer({
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "cancellation_scheduled",
}),
});
const sent = await sendScheduledCancellation("evt-cancel-2", {
name: null,
effectiveAt: null,
subscriptionId: "subscription-current",
stateUpdatedAt: scheduledWatermark,
});
expect(sent).toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
});
it("sends the access-ended email describing the real Free-plan downgrade behavior", async () => {
const sendMock = mockEmailSend();
const mocks = mockBillingDataServer();
const sent = await sendCancellation({ name: "Owner",
kind: "ended",
eventId: "evt-expired-1", });
expect(sent).toBe(true);
const payload = emailSendPayload(sendMock);
expect(payload.subject).toBe("Your Five to Nine plan has ended");
expect(payload.html).toContain("now on the Free plan");
expect(payload.html).toContain("the newest one stays active");
expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
expect(attempt.templateName).toBe("billing_access_ended");
expect(attempt.idempotencyKey).toBe("billing-cancellation:user-1:evt-expired-1");
});
it("sends the refund email with plan and credit consequences and event-keyed idempotency", async () => {
const sendMock = mockEmailSend();
const mocks = mockBillingDataServer();
const sent = await sendRefund({ name: "Owner",
eventId: "evt-refund-1", });
expect(sent).toBe(true);
const payload = emailSendPayload(sendMock);
expect(payload.subject).toBe("We've processed your Five to Nine refund");
expect(payload.html).toContain("moved to the Free plan");
expect(payload.html).toContain("credits from that purchase have expired");
expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
expect(attempt.lane).toBe("customer");
expect(attempt.templateName).toBe("billing_refund_revoked");
expect(attempt.idempotencyKey).toBe("billing-refund:user-1:evt-refund-1");
expect(attempt.payloadSnapshot).toMatchObject({
refundPaymentId: "payment-current",
refundStateUpdatedAt: scheduledWatermark,
});
});
it("sends once and stays provider-unknown when an untyped rejection is replayed", async () => {
vi.useFakeTimers();
vi.setSystemTime(new Date(scheduledWatermark));
emailState.emailSend = vi
.fn()
.mockRejectedValueOnce(new Error("smtp down"))
.mockResolvedValueOnce({ messageId: "msg_retry_succeeded" });
let attemptStatus: "missing" | "pending" | "failed" | "sent" = "missing";
let attemptWebhookStatus: "pending" | "failed" | "provider_unknown" = "pending";
const createDeliveryAttempt = vi.fn().mockImplementation(async () => {
attemptStatus = "pending";
return "attempt-retry";
});
const getDeliveryAttemptByIdempotencyKey = vi.fn().mockImplementation(async () => {
if (attemptStatus === "missing") {
return null;
}
return {
id: "attempt-retry",
provider: "cloudflare_email",
status: attemptStatus,
webhookStatus: attemptWebhookStatus,
providerMessageId: null,
};
});
const updateDeliveryAttemptResult = vi.fn(
async (
_env: unknown,
_attemptId: string,
input: {
expectedStatus?: string;
status: "pending" | "failed" | "sent";
webhookStatus: "pending" | "failed" | "provider_unknown";
},
) => {
if (input.expectedStatus && attemptStatus !== input.expectedStatus) {
return false;
}
attemptStatus = input.status;
attemptWebhookStatus = input.webhookStatus;
return true;
},
);
mockBillingDataServer({
createDeliveryAttempt,
getDeliveryAttemptByIdempotencyKey,
updateDeliveryAttemptResult,
});
const input = {
userId: "user-1",
email: "owner@example.com",
name: null,
occurredAt: "2026-07-01T08:00:00.000Z",
retryWebhookOnExplicitFailure: true,
};
await expect(sendPaymentIssue(input)).resolves.toBe(false);
expect(attemptStatus).toBe("failed");
expect(attemptWebhookStatus).toBe("provider_unknown");
vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));
await expect(sendPaymentIssue(input)).resolves.toBe(false);
expect(attemptStatus).toBe("failed");
expect(attemptWebhookStatus).toBe("provider_unknown");
expect(emailState.emailSend).toHaveBeenCalledTimes(1);
expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
expect(createDeliveryAttempt.mock.calls[0]?.[1]).toEqual(
expect.objectContaining({
idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
}),
);
});
it.each([
{ startingCount: 2, expectedProviderCalls: 1 },
{ startingCount: 3, expectedProviderCalls: 0 },
])(
"enforces the max-three recovery budget from reconciled count $startingCount",
async ({ startingCount, expectedProviderCalls }) => {
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));
emailState.emailSend = vi.fn().mockRejectedValue(new Error("provider explicitly rejected"));
const attempt = billingAttempt({
id: "attempt-live-redelivery-budget",
status: "failed" as "pending" | "failed" | "sent",
webhookStatus: "failed" as "pending" | "failed" | "provider_unknown",
providerMessageId: null as string | null,
providerStatusLastSeenAt: "2026-07-14T08:55:00.000Z" as string | null,
templateName: "billing_refund_revoked",
payloadSnapshot: billingPayload("billing_refund_revoked", {
subject: "Your refund has been processed",
bodyHtml: "<p>Your refund is complete.</p>",
tag: "billing-refund",
billingStateFingerprint: currentBillingStateFingerprint,
recoveryAttemptCount: startingCount,
billingLifecycleProviderEvidence: {
reference: "cf-event-live-redelivery-budget",
classification: "provider_rejected",
observedAt: "2026-07-14T08:55:00.000Z",
outcome: "failed",
},
}) as Record<string, unknown>,
errorMessage: "Earlier explicit rejection." as string | null,
sentAt: null as string | null,
failedAt: "2026-07-14T08:55:00.000Z" as string | null,
updatedAt: "2026-07-14T08:55:00.000Z",
});
const listStaleBillingLifecycleEmailAttempts = vi.fn(async () => {
const count = attempt.payloadSnapshot.recoveryAttemptCount;
return attempt.status === "failed" &&
attempt.webhookStatus === "failed" &&
attempt.providerStatusLastSeenAt !== null &&
Number.isSafeInteger(count) &&
Number(count) < 3
? [attempt]
: [];
});
const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(attempt),
listStaleBillingLifecycleEmailAttempts,
updateDeliveryAttemptResult,
});
await expect(sendRefund({ name: null,
eventId: "evt-live-redelivery-budget",
retryWebhookOnExplicitFailure: true, })).resolves.toBe(false);
const firstCron = await recoverBilling();
const secondCron = await recoverBilling();
expect([firstCron.scanned, secondCron.scanned]).toEqual([0, 0]);
expect(emailState.emailSend).toHaveBeenCalledTimes(expectedProviderCalls);
expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(3);
},
);
it.each(["2", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
"normalizes invalid reconciled recovery count %s before incrementing",
async (invalidCount) => {
const sendMock = mockEmailSend("msg_invalid_count_reclaim");
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(billingAttempt({
id: "attempt-invalid-recovery-count",
status: "failed",
webhookStatus: "failed",
providerStatusLastSeenAt: "2026-07-14T08:55:00.000Z",
payloadSnapshot: reconciledFailurePayload("billing_refund_revoked", {
recoveryAttemptCount: invalidCount,
}),
})),
updateDeliveryAttemptResult,
});
await expect(
sendRefund({ name: null,
eventId: "evt-invalid-recovery-count", }),
).resolves.toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
"attempt-invalid-recovery-count",
expect.objectContaining({
payloadSnapshot: expect.objectContaining({ recoveryAttemptCount: 1 }),
}),
);
},
);
it.each([
["sent", "delivered"],
["pending", "provider_unknown"],
] as const)(
"never auto-resends a durable %s/%s lifecycle attempt",
async (status, webhookStatus) => {
const sendMock = mockEmailSend("msg_must_not_send");
const mocks = mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(billingAttempt({
id: "attempt-terminal-or-unknown",
status,
webhookStatus,
providerMessageId: status === "sent" ? "msg_existing" : null,
})),
});
await expect(
sendRefund({ name: null,
eventId: "evt-suppressed-redelivery",
retryWebhookOnExplicitFailure: true, }),
).resolves.toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
},
);
it("keeps an untyped billing provider rejection unknown instead of declaring failure", async () => {
emailState.emailSend = vi.fn().mockRejectedValue(new Error("smtp down"));
const mocks = mockBillingDataServer();
const sent = await sendRefund({ name: null,
eventId: "evt-refund-2", });
expect(sent).toBe(false);
const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
expect(attempt.status).toBe("pending");
expect(attempt.idempotencyKey).toBe("billing-refund:user-1:evt-refund-2");
expect(mocks.updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(),
"attempt-1",
expect.objectContaining({
status: "failed",
webhookStatus: "provider_unknown",
providerStatusLastSeenAt: expect.any(String),
errorMessage: "Cloudflare Email send outcome is unknown after provider exception: smtp down.",
}),
);
});
it("does not re-arm a webhook when email sending is unconfigured", async () => {
billingState.defaultBillingInfo = refundBillingInfo;
let created = false;
const attempt = refundRecoveryAttempt("attempt-unconfigured", {}, {
updatedAt: scheduledWatermark,
});
const createDeliveryAttempt = vi.fn(async () => {
created = true;
return attempt.id;
});
const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
mockBillingDataServer({
createDeliveryAttempt,
getDeliveryAttemptByIdempotencyKey: vi.fn(async () => created ? attempt : null),
updateDeliveryAttemptResult,
});
const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
const send = () => sendBillingRefundEmail(
{ EMAIL_FROM_EMAIL: "alerts@0509.io" } as never,
{
...recipient,
eventId: "evt-unconfigured-email",
paymentId: "payment-current",
stateUpdatedAt: scheduledWatermark,
retryWebhookOnExplicitFailure: true,
},
);
await expect(send()).resolves.toBe(false);
await expect(send()).resolves.toBe(false);
expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
expect(emailState.emailSend).not.toHaveBeenCalled();
expect(attempt.status).toBe("pending");
expect(attempt.webhookStatus).toBe("pending");
expect(attempt.providerStatusLastSeenAt).toBeNull();
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
attempt.id,
expect.objectContaining({
status: "pending",
webhookStatus: "pending",
expectedStatus: "pending",
expectedWebhookStatus: "pending",
}),
);
});
});
