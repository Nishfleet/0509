import { describe, expect, it, vi } from "vitest";

import { setupBillingLifecycleDelivery } from "./helpers/billing-lifecycle-delivery";

const {
	emailEnv, emailState, emailSendPayload, mockEmailSend,
	scheduledCutoff, scheduledWatermark, currentBillingInfo, paymentIssueBillingInfo,
	currentBillingStateFingerprint, billingPayload, reconciledFailurePayload, billingAttempt, recoveryAttempt,
	scheduledRecoveryAttempt, refundRecoveryAttempt, mutationRecoveryAttempt, paymentRecoveryAttempt, useRecoveryClock,
	sendPaymentIssue, sendRefund, recoverBilling, mockBillingDataServer,
	mockRecoveryAttempt, trackAttemptUpdates,
} = setupBillingLifecycleDelivery();

describe("billing lifecycle emails",()=>{
it("does not claim stale billing email work while email is unconfigured",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_must_not_send");
const staleAttempt=recoveryAttempt("attempt-unconfigured","billing_refund",{
billingStateFingerprint:currentBillingStateFingerprint,
});
const listStaleBillingLifecycleEmailAttempts=vi.fn().mockResolvedValue([staleAttempt]);
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
mockBillingDataServer({listStaleBillingLifecycleEmailAttempts,updateDeliveryAttemptResult});

const result=await recoverBilling({DB:{}} as never);

expect(result).toEqual({
scanned:0,
claimed:0,
sent:0,
failed:0,
providerUnknown:0,
superseded:0,
conflicts:0,
});
expect(sendMock).not.toHaveBeenCalled();
expect(listStaleBillingLifecycleEmailAttempts).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
});
it("records the current recipient when retrying a failed attempt in place",async()=>{
useRecoveryClock();
mockEmailSend("msg_retry_new_target");
const failedAttempt=billingAttempt({
id:"attempt-failed-old-target",
status:"failed",
webhookStatus:"failed",
targetValue:"old@example.com",
updatedAt:"2026-07-13T08:00:00.000Z",
payloadSnapshot:reconciledFailurePayload("billing_refund_revoked",{
refundPaymentId:"payment-current",
refundStateUpdatedAt:scheduledWatermark,
}),
});
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(failedAttempt),
updateDeliveryAttemptResult,
});
const sent=await sendRefund({
email: "new@example.com",
name: null,
eventId: "evt-retry-new-target",
});
expect(sent).toBe(true);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
failedAttempt.id,
expect.objectContaining({
status: "pending",
expectedStatus: "failed",
targetValue: "new@example.com",
payloadSnapshot: expect.objectContaining({
refundPaymentId: "payment-current",
refundStateUpdatedAt: scheduledWatermark,
}),
}),
);
});
it("defers recovery until the current account email exists and is verified", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_recovery_verified_target");
const attempt = recoveryAttempt("attempt-recovery-unverified-target", "billing_refund_revoked", {}, { targetValue: "old@example.com" });
const verifiedProfile = { email: "new@example.com", emailVerified: true, name: "Owner" };
const getUserDeliveryProfile = vi.fn()
.mockResolvedValueOnce(null)
.mockResolvedValueOnce({ ...verifiedProfile, emailVerified: false })
.mockResolvedValue(verifiedProfile);
const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
mockBillingDataServer({
getUserDeliveryProfile,
listStaleBillingLifecycleEmailAttempts: vi.fn(async (_env, input: { staleBefore: string }) =>
attempt.updatedAt <= input.staleBefore ? [attempt] : []),
updateDeliveryAttemptResult,
});
async function expectDeferred(errorMessage: string) {
await expect(recoverBilling()).resolves.toMatchObject({ scanned: 1, claimed: 1, sent: 0, failed: 0 });
expect(sendMock).not.toHaveBeenCalled();
expect(attempt).toMatchObject({
status: "pending", webhookStatus: "pending", targetValue: "old@example.com", errorMessage,
});
expect(attempt.payloadSnapshot).not.toHaveProperty("recoveryAttemptCount");
}
await expectDeferred("Billing lifecycle recovery recipient is unavailable.");
vi.setSystemTime(new Date("2026-07-13T09:07:00.000Z"));
await expectDeferred("Billing lifecycle recovery recipient is not verified.");
vi.setSystemTime(new Date("2026-07-13T09:09:00.000Z"));
await expect(recoverBilling()).resolves.toMatchObject({ scanned: 1, claimed: 1, sent: 1, failed: 0 });
expect(emailSendPayload(sendMock).to).toBe("new@example.com");
expect(attempt).toMatchObject({ targetValue: "new@example.com", status: "sent" });
expect(attempt.payloadSnapshot).toHaveProperty("recoveryAttemptCount", 1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(), attempt.id, expect.objectContaining({ targetValue: "new@example.com", expectedStatus: "pending", expectedWebhookStatus: "pending" }),
);
});
it.each([
["payment issue", "billing_payment_issue", "payment.failed", "starter"],
["access ended", "billing_access_ended", "subscription.expired", "free"],
] as const)("recovers an exact %s outbox identity", async (_label, templateName, status, plan) => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_marker_recovered");
const markerAttempt = mutationRecoveryAttempt("attempt-marker", templateName, status);
const updateDeliveryAttemptResult = mockRecoveryAttempt(markerAttempt, {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo, plan, dodoStatus: status,
}),
});
const result = await recoverBilling();
expect(result).toMatchObject({ scanned: 1, claimed: 1, sent: 1, superseded: 0 });
expect(sendMock).toHaveBeenCalledTimes(1);
const claimCall = updateDeliveryAttemptResult.mock.calls[0]!;
expect(claimCall[1]).toBe(markerAttempt.id);
expect(claimCall[2].payloadSnapshot).toBeDefined();
expect(claimCall[2].payloadSnapshot.outboxPendingDispatch).toBeUndefined();
expect(typeof claimCall[2].payloadSnapshot.billingStateFingerprint).toBe("string");
});
it.each([
["payment issue A after recovery and issue B", "billing_payment_issue", "payment.failed", "starter", "subscription-a", scheduledWatermark],
["access ended A after paid and revoke B", "billing_access_ended", "subscription.expired", "free", "subscription-a", scheduledWatermark],
["payment issue missing identity", "billing_payment_issue", "payment.failed", "starter", undefined, scheduledWatermark],
["access ended missing watermark", "billing_access_ended", "subscription.expired", "free", "subscription-b", undefined],
] as const)("supersedes %s", async (_label, templateName, status, plan, expectedSubscription, expectedAt) => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_old_state_must_not_send");
const attempt = mutationRecoveryAttempt("attempt-old-state", templateName, status, expectedSubscription, expectedAt);
mockRecoveryAttempt(attempt, {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo, plan, dodoStatus: status,
dodoSubscriptionId: "subscription-b", planUpdatedAt: "2026-07-14T09:00:00.000Z",
}),
});
await expect(recoverBilling()).resolves.toMatchObject({ sent: 0, superseded: 1 });
expect(sendMock).not.toHaveBeenCalled();
});
it.each([
["exact payment", "payment-current", scheduledWatermark, 1],
["newer payment", "payment-new", scheduledWatermark, 0],
["newer watermark", "payment-current", "2026-07-14T09:00:00.000Z", 0],
])("matches recovered no-subscription payment.failed by %s", async (_label, currentPayment, currentAt, sent) => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_recovered_payment_identity");
mockRecoveryAttempt(paymentRecoveryAttempt("attempt-payment-a"), {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...paymentIssueBillingInfo, dodoSubscriptionId: null, dodoPaymentId: currentPayment, planUpdatedAt: currentAt,
}),
});
await expect(recoverBilling()).resolves.toMatchObject({ sent, superseded: sent ? 0 : 1 });
expect(sendMock).toHaveBeenCalledTimes(sent);
});
it("recovers a scheduled-cancellation outbox only for its matching future state", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_scheduled_marker_recovered");
const markerAttempt = scheduledRecoveryAttempt(
"attempt-scheduled-marker",
"evt-scheduled-marker",
{
bodyHtml: "<p>Your paid plan remains active until August.</p>",
billingStateFingerprint: null,
outboxPendingDispatch: true,
},
);
const updateDeliveryAttemptResult = mockRecoveryAttempt(markerAttempt, {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "cancellation_scheduled",
}),
});
const result = await recoverBilling();
expect(result).toMatchObject({ scanned: 1, claimed: 1, sent: 1, superseded: 0 });
expect(sendMock).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
markerAttempt.id,
expect.objectContaining({
payloadSnapshot: expect.objectContaining({
scheduledCancellationCutoff: scheduledCutoff,
scheduledCancellationEventId: "evt-scheduled-marker",
scheduledCancellationSubscriptionId: "subscription-current",
scheduledCancellationStateUpdatedAt: scheduledWatermark,
}),
}),
);
});
it("supersedes a marker outbox row when the billing state moved past its kind", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_marker_superseded");
const markerAttempt = recoveryAttempt("attempt-marker-superseded", "billing_payment_issue", {
billingStateFingerprint: null,
outboxPendingDispatch: true,
});
const updateDeliveryAttemptResult = mockRecoveryAttempt(markerAttempt, {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "active",
}),
});
const result = await recoverBilling();
expect(result).toMatchObject({ scanned: 1, claimed: 1, sent: 0, superseded: 1 });
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
markerAttempt.id,
expect.objectContaining({
status: "skipped_due_to_dedupe",
webhookStatus: "provider_unknown",
}),
);
});
it("does not replay refund A when recovery crashes before purchase and refund B", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_crash_bypass_must_not_send");
const markerAttempt = refundRecoveryAttempt("attempt-refund-crash", {
bodyHtml: "<p>Your workspace moved to Free.</p>",
billingStateFingerprint: null,
outboxPendingDispatch: true,
});
let billingInfo = { ...currentBillingInfo, plan: "free" as const, dodoStatus: "refunded" };
const listStaleBillingLifecycleEmailAttempts = vi.fn(
async (_env: unknown, input: { staleBefore: string }) =>
markerAttempt.status === "pending" &&
markerAttempt.webhookStatus === "pending" &&
markerAttempt.updatedAt <= input.staleBefore
? [markerAttempt]
: [],
);
let crashAfterFirstDurableUpdate = true;
const updateDeliveryAttemptResult = vi.fn(
async (_env: unknown, _attemptId: string, input: Record<string, unknown>) => {
markerAttempt.status = String(input.status);
markerAttempt.webhookStatus = String(input.webhookStatus);
markerAttempt.updatedAt = String(input.updatedAt ?? new Date().toISOString());
if (input.payloadSnapshot) {
markerAttempt.payloadSnapshot = input.payloadSnapshot as Record<string, unknown>;
}
if (crashAfterFirstDurableUpdate) {
crashAfterFirstDurableUpdate = false;
throw new Error("worker crashed after the durable update");
}
return true;
},
);
mockBillingDataServer({
listStaleBillingLifecycleEmailAttempts,
getUserPlanBillingInfo: vi.fn(async () => billingInfo),
updateDeliveryAttemptResult,
});
const env = { ...emailEnv, DB: {} } as never;
await expect(recoverBilling(env)).rejects.toThrow(
"worker crashed after the durable update",
);
billingInfo = { ...billingInfo, dodoPaymentId: "payment-new", planUpdatedAt: "2026-07-14T09:00:00.000Z" };
vi.setSystemTime(new Date("2026-07-13T09:07:00.000Z"));
const secondSweep = await recoverBilling(env);
expect(secondSweep).toMatchObject({ scanned: 1, claimed: 1, sent: 0, superseded: 1 });
expect(sendMock).not.toHaveBeenCalled();
expect(markerAttempt).toMatchObject({ status: "skipped_due_to_dedupe", webhookStatus: "provider_unknown" });
expect(markerAttempt.payloadSnapshot).toMatchObject({ refundPaymentId: "payment-current", refundStateUpdatedAt: scheduledWatermark });
expect(markerAttempt.payloadSnapshot).not.toHaveProperty("outboxPendingDispatch");
});
it("recovers a stale billing outbox row from its durable payload", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_recovered_billing");
const staleAttempt = recoveryAttempt("attempt-recovery", "billing_refund", {
subject: "Your refund has been processed",
billingStateFingerprint: currentBillingStateFingerprint,
});
const listStaleBillingLifecycleEmailAttempts = vi.fn().mockResolvedValue([staleAttempt]);
const updateDeliveryAttemptResult = mockRecoveryAttempt(staleAttempt, {
listStaleBillingLifecycleEmailAttempts,
});
const result = await recoverBilling();
expect(result).toEqual({
scanned: 1,
claimed: 1,
sent: 1,
failed: 0,
providerUnknown: 0,
superseded: 0,
conflicts: 0,
});
expect(sendMock).toHaveBeenCalledTimes(1);
expect(emailSendPayload(sendMock)).toEqual(
expect.objectContaining({
to: "owner@example.com",
subject: "Your refund has been processed",
}),
);
expect(listStaleBillingLifecycleEmailAttempts).toHaveBeenCalledWith(
expect.anything(),
{
staleBefore: "2026-07-13T09:04:00.000Z",
limit: 10,
maxRecoveryAttempts: 3,
},
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "pending",
expectedUpdatedAt: staleAttempt.updatedAt,
updatedAt: "2026-07-13T09:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "pending",
webhookStatus: "provider_unknown",
expectedUpdatedAt: "2026-07-13T09:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
3,
expect.anything(),
staleAttempt.id,
expect.objectContaining({ status: "sent", expectedWebhookStatus: "provider_unknown" }),
);
});
it("ignores a legacy failed recovery row without reconciled provider evidence", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_legacy_failure_must_not_send");
const legacyFailed = recoveryAttempt(
"attempt-legacy-failed",
"billing_refund_revoked",
{ billingStateFingerprint: currentBillingStateFingerprint },
{
status: "failed",
webhookStatus: "failed",
providerStatusLastSeenAt: "2026-07-13T09:04:00.000Z",
failedAt: "2026-07-13T09:04:00.000Z",
},
);
const updateDeliveryAttemptResult = mockRecoveryAttempt(legacyFailed);
const result = await recoverBilling();
expect(result).toMatchObject({ scanned: 1, claimed: 0, sent: 0, failed: 0 });
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
});
it("does not retry an untyped provider exception on later recovery sweeps", async () => {
useRecoveryClock();
emailState.emailSend = vi
.fn()
.mockRejectedValueOnce(new Error("provider connection reset"))
.mockResolvedValueOnce({ messageId: "msg_recovery_retry" });
const attempt = recoveryAttempt(
"attempt-recovery-two-sweep",
"billing_refund",
{
billingStateFingerprint: currentBillingStateFingerprint,
},
{
providerMessageId: null as string | null,
providerStatusLastSeenAt: null as string | null,
errorMessage: null as string | null,
sentAt: null as string | null,
failedAt: null as string | null,
},
);
const listStaleBillingLifecycleEmailAttempts = vi.fn(async () => {
const attempts = Number(attempt.payloadSnapshot.recoveryAttemptCount ?? 0);
const retryablePending =
attempt.status === "pending" && attempt.webhookStatus === "pending";
const retryableExplicitFailure =
attempt.status === "failed" &&
attempt.webhookStatus === "failed" &&
attempt.payloadSnapshot.billingLifecycleProviderEvidence !== undefined &&
attempts < 3;
return retryablePending || retryableExplicitFailure ? [attempt] : [];
});
const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
mockBillingDataServer({
listStaleBillingLifecycleEmailAttempts,
updateDeliveryAttemptResult,
});
const env = { ...emailEnv, DB: {} } as never;
const firstSweep = await recoverBilling(env);
const secondSweep = await recoverBilling(env);
expect(firstSweep).toMatchObject({ scanned: 1, claimed: 1, failed: 0, sent: 0, providerUnknown: 1 });
expect(secondSweep).toMatchObject({ scanned: 0, claimed: 0, sent: 0 });
expect(emailState.emailSend).toHaveBeenCalledTimes(1);
expect(attempt.status).toBe("failed");
expect(attempt.webhookStatus).toBe("provider_unknown");
expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(1);
});
it("automatically retries an explicitly reconciled failure once", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_reconciled_recovery");
const attempt = recoveryAttempt(
"attempt-reconciled-failed",
"billing_refund_revoked",
{
billingStateFingerprint: currentBillingStateFingerprint,
recoveryAttemptCount: 1,
billingLifecycleProviderEvidence: {
reference: "cf-event-reconciled-failure",
classification: "provider_rejected",
observedAt: "2026-07-13T09:04:00.000Z",
outcome: "failed",
},
},
{
status: "failed",
webhookStatus: "failed",
providerStatusLastSeenAt: "2026-07-13T09:04:00.000Z",
failedAt: "2026-07-13T09:04:00.000Z",
},
);
const listStaleBillingLifecycleEmailAttempts = vi.fn(async () =>
attempt.status === "failed" ? [attempt] : [],
);
const updateDeliveryAttemptResult = trackAttemptUpdates(attempt);
mockBillingDataServer({ listStaleBillingLifecycleEmailAttempts, updateDeliveryAttemptResult });
const firstSweep = await recoverBilling();
const secondSweep = await recoverBilling();
expect(firstSweep).toMatchObject({ scanned: 1, claimed: 1, sent: 1, failed: 0 });
expect(secondSweep).toMatchObject({ scanned: 0, claimed: 0, sent: 0 });
expect(sendMock).toHaveBeenCalledTimes(1);
expect(attempt.status).toBe("sent");
expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(2);
expect(attempt.payloadSnapshot).not.toHaveProperty("billingLifecycleProviderEvidence");
});
it("suppresses a recovered billing email after newer account state wins", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_superseded_must_not_send");
const staleAttempt = recoveryAttempt("attempt-superseded", "billing_payment_issue", {
billingStateFingerprint: currentBillingStateFingerprint,
});
const updateDeliveryAttemptResult = mockRecoveryAttempt(staleAttempt, {
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "active_after_recovery",
planUpdatedAt: "2026-07-13T09:04:00.000Z",
}),
});
const result = await recoverBilling();
expect(result).toEqual({
scanned: 1,
claimed: 1,
sent: 0,
failed: 0,
providerUnknown: 0,
superseded: 1,
conflicts: 0,
});
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "skipped_due_to_dedupe",
webhookStatus: "provider_unknown",
errorMessage:
"Billing lifecycle recovery was superseded by newer account state.",
}),
);
});
it("claims a recovery-superseded slot in place and sends fresh content", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_superseded_reclaim");
const supersededAttempt = billingAttempt({
id: "attempt-superseded-slot",
status: "skipped_due_to_dedupe",
webhookStatus: "provider_unknown",
updatedAt: "2026-07-13T08:30:00.000Z",
});
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
const mocks = mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(supersededAttempt),
getUserPlanBillingInfo: vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus: "payment.failed",
}),
updateDeliveryAttemptResult,
});
const sent = await sendPaymentIssue({ name: null,
occurredAt: scheduledWatermark, });
expect(sent).toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
supersededAttempt.id,
expect.objectContaining({
status: "pending",
expectedStatus: "skipped_due_to_dedupe",
expectedWebhookStatus: "provider_unknown",
}),
);
});
it("persists a recovered provider timeout as unknown and does not retry it", async () => {
useRecoveryClock();
emailState.emailSend = vi.fn(() => new Promise(() => undefined));
const staleAttempt = recoveryAttempt("attempt-recovery-timeout", "billing_refund", {
billingStateFingerprint: currentBillingStateFingerprint,
});
const updateDeliveryAttemptResult = mockRecoveryAttempt(staleAttempt);
const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
const resultPromise = recoverAbandonedBillingLifecycleEmails({
...emailEnv,
DB: {},
} as never);
await Promise.resolve();
await Promise.resolve();
await vi.advanceTimersByTimeAsync(10_000);
await expect(resultPromise).resolves.toEqual({
scanned: 1,
claimed: 1,
sent: 0,
failed: 0,
providerUnknown: 1,
superseded: 0,
conflicts: 0,
});
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "pending",
webhookStatus: "provider_unknown",
errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
}),
);
});
it("fails a malformed billing outbox row without calling the provider", async () => {
useRecoveryClock();
const sendMock = mockEmailSend("msg_should_not_send");
const staleAttempt = {
id: "attempt-malformed",
userId: "user-1",
targetValue: "owner@example.com",
templateName: "billing_refund",
payloadSnapshot: { kind: "billing_refund" },
updatedAt: "2026-07-13T09:03:00.000Z",
};
const updateDeliveryAttemptResult = mockRecoveryAttempt(staleAttempt);
const result = await recoverBilling();
expect(result).toEqual(
expect.objectContaining({ scanned: 1, claimed: 1, sent: 0, failed: 1 }),
);
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "failed",
webhookStatus: "failed",
errorMessage: "Billing lifecycle recovery payload is incomplete.",
}),
);
});
it("reconciles an unknown billing attempt to failed so the same idempotent send can retry", async () => {
const sendMock = mockEmailSend("msg_reconciled_retry");
const pendingAttempt = {
id: "attempt-pending",
provider: "cloudflare_email",
status: "pending",
webhookStatus: "provider_unknown",
updatedAt: "2026-07-13T09:04:00.000Z",
payloadSnapshot: billingPayload("billing_refund_revoked", {}),
};
const failedAttempt = {
...pendingAttempt,
status: "failed",
webhookStatus: "failed",
payloadSnapshot: {
...pendingAttempt.payloadSnapshot,
billingLifecycleProviderEvidence: {
reference: "cf-email-event-refund-retry",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:00.000Z",
outcome: "failed",
},
},
};
const getDeliveryAttemptByIdempotencyKey = vi
.fn()
.mockResolvedValueOnce(pendingAttempt)
.mockResolvedValueOnce(failedAttempt);
const updateDeliveryAttemptResult = vi.fn();
mockBillingDataServer({ getDeliveryAttemptByIdempotencyKey, updateDeliveryAttemptResult });
const { reconcileBillingLifecycleEmailDelivery } = await import("~/lib/delivery.server");
const providerEvidence = {
reference: "cf-email-event-refund-retry",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:00.000Z",
recipient: "must-not-persist@example.com",
bodyHtml: "<p>must not persist</p>",
apiToken: "must-not-persist",
};
await expect(
reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
idempotencyKey: "billing-refund:user-1:evt-refund-retry",
outcome: "failed",
evidence: providerEvidence,
errorMessage: "Provider confirmed the timed-out send was not accepted.",
}),
).resolves.toBe(true);
const sent = await sendRefund({ name: null,
eventId: "evt-refund-retry", });
expect(sent).toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
"attempt-pending",
expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "provider_unknown",
expectedUpdatedAt: "2026-07-13T09:04:00.000Z",
status: "failed",
webhookStatus: "failed",
payloadSnapshot: expect.objectContaining({
billingLifecycleProviderEvidence: {
reference: "cf-email-event-refund-retry",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:00.000Z",
outcome: "failed",
},
}),
}),
);
expect(
(updateDeliveryAttemptResult.mock.calls[0]?.[2].payloadSnapshot as Record<string, unknown>)
.billingLifecycleProviderEvidence,
).toEqual({
reference: "cf-email-event-refund-retry",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:00.000Z",
outcome: "failed",
});
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
"attempt-pending",
expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
3,
expect.anything(),
"attempt-pending",
expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "pending",
status: "pending",
webhookStatus: "provider_unknown",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
4,
expect.anything(),
"attempt-pending",
expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "provider_unknown",
status: "sent",
}),
);
});
it("reconciles a failed/provider_unknown attempt with provider evidence using its exact status", async () => {
const failedUnknownAttempt = {
id: "attempt-failed-unknown",
provider: "cloudflare_email",
status: "failed",
webhookStatus: "provider_unknown",
providerMessageId: null,
providerStatusLastSeenAt: "2026-07-13T09:04:00.000Z",
updatedAt: "2026-07-13T09:04:00.000Z",
payloadSnapshot: billingPayload("billing_refund_revoked", {}),
};
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(failedUnknownAttempt),
updateDeliveryAttemptResult,
});
const { reconcileBillingLifecycleEmailDelivery } = await import("~/lib/delivery.server");
await expect(
reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
idempotencyKey: "billing-refund:user-1:evt-failed-unknown",
outcome: "sent",
evidence: {
reference: "controlled-inbox-failed-unknown",
classification: "controlled_inbox_receipt",
observedAt: "2026-07-13T09:05:00.000Z",
},
}),
).resolves.toBe(true);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(),
failedUnknownAttempt.id,
expect.objectContaining({
expectedStatus: "failed",
expectedWebhookStatus: "provider_unknown",
expectedUpdatedAt: failedUnknownAttempt.updatedAt,
status: "sent",
webhookStatus: "delivered",
}),
);
});
it("allows only the first of two conflicting billing reconciliations to win", async () => {
let durableStatus = "pending";
const pendingAttempt = {
id: "attempt-pending",
provider: "cloudflare_email",
status: "pending",
webhookStatus: "provider_unknown",
providerMessageId: null,
updatedAt: "2026-07-13T09:04:00.000Z",
payloadSnapshot: billingPayload("billing_refund_revoked", {}),
};
const updateDeliveryAttemptResult = vi.fn(
async (_env: unknown, _id: string, input: { expectedStatus?: string; status: string }) => {
if (input.expectedStatus && durableStatus !== input.expectedStatus) {
return false;
}
durableStatus = input.status;
return true;
},
);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(pendingAttempt),
updateDeliveryAttemptResult,
});
const { reconcileBillingLifecycleEmailDelivery } = await import("~/lib/delivery.server");
const [sentResult, failedResult] = await Promise.all([
reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
idempotencyKey: "billing-refund:user-1:evt-reconcile-race",
outcome: "sent",
evidence: {
reference: "cf-event-race-sent",
classification: "provider_accepted",
observedAt: "2026-07-13T09:05:00.000Z",
},
}),
reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
idempotencyKey: "billing-refund:user-1:evt-reconcile-race",
outcome: "failed",
evidence: {
reference: "cf-event-race-failed",
classification: "provider_rejected",
observedAt: "2026-07-13T09:05:01.000Z",
},
}),
]);
expect([sentResult, failedResult].filter(Boolean)).toHaveLength(1);
expect(durableStatus).toBe("sent");
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(2);
for (const call of updateDeliveryAttemptResult.mock.calls) {
expect(call[2]).toEqual(expect.objectContaining({
expectedStatus: "pending",
expectedWebhookStatus: "provider_unknown",
expectedUpdatedAt: "2026-07-13T09:04:00.000Z",
}));
}
expect(emailState.emailSend).not.toHaveBeenCalled();
});
});
