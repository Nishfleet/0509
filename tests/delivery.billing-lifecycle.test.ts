import { describe, expect, it, vi } from "vitest";

import { setupBillingLifecycleDelivery } from "./helpers/billing-lifecycle-delivery";

const {
	emailEnv, emailSendPayload, mockEmailSend,
	scheduledCutoff, scheduledWatermark, currentBillingInfo, refundBillingInfo, paymentIssueBillingInfo,
	currentBillingStateFingerprint, billingPayload, reconciledFailurePayload, billingAttempt, recoveryAttempt,
	scheduledRecoveryAttempt, refundRecoveryAttempt, mutationRecoveryAttempt, useRecoveryClock,
	sendPaymentIssue, sendRefund, sendCancellation, sendScheduledCancellation, recoverBilling, mockBillingDataServer,
} = setupBillingLifecycleDelivery();

describe("billing lifecycle emails",()=>{
it("keeps a missing-email-config attempt before the provider boundary",async()=>{
const sendMock=mockEmailSend("msg_must_not_send");
const mocks=mockBillingDataServer({
getUserPlanBillingInfo:vi.fn().mockResolvedValue(paymentIssueBillingInfo),
});
const{sendBillingPaymentIssueEmail}=await import("~/lib/delivery.server");

await expect(sendBillingPaymentIssueEmail({} as never,{
userId:"user-1",
email:"owner@example.com",
name:"Owner",
status:"payment.failed",
subscriptionId:"subscription-current",
stateUpdatedAt:scheduledWatermark,
})).resolves.toBe(false);

expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).toHaveBeenCalledTimes(1);
expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
});
it("persists scheduled-cancellation cutoff and event watermark in the outbox payload",async()=>{
mockBillingDataServer();
const{prepareBillingLifecycleEmailOutbox}=await import("~/lib/delivery.server");
const outbox=prepareBillingLifecycleEmailOutbox(emailEnv as never,{
kind:"cancellation_scheduled",
userId:"user-1",
email:"owner@example.com",
name:"Owner",
effectiveAt:scheduledCutoff,
eventId:"evt-scheduled-identity",
subscriptionId:"subscription-current",
stateUpdatedAt:scheduledWatermark,
});
expect(outbox.payloadSnapshot).toMatchObject({
scheduledCancellationCutoff:scheduledCutoff,
scheduledCancellationEventId:"evt-scheduled-identity",
scheduledCancellationSubscriptionId:"subscription-current",
scheduledCancellationStateUpdatedAt:scheduledWatermark,
});
});
it("sends the dunning email with a day-coarse deterministic idempotency key and no unsubscribe header",async()=>{
vi.useFakeTimers();
vi.setSystemTime(new Date(scheduledWatermark));
const sendMock=mockEmailSend("msg_billing_1");
const mocks=mockBillingDataServer();
const sent=await sendPaymentIssue({name:"Owner <script>",});
expect(sent).toBe(true);
const payload=emailSendPayload(sendMock);
expect(payload.to).toBe("owner@example.com");
expect(payload.subject).toBe("Action needed: a Five to Nine payment didn't go through");
expect(payload.html).toContain("your plan stays active while the payment processor retries");
expect(payload.html).toContain("https://0509.io/app/billing");
expect(payload.html).toContain("Hi Owner &lt;script&gt;,");
expect(payload.html).not.toContain("<script>");
expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
expect(payload.html).not.toContain("Unsubscribe");
const attempt=mocks.createDeliveryAttempt.mock.calls[0]?.[1];
expect(attempt.lane).toBe("customer");
expect(attempt.channel).toBe("email");
expect(attempt.templateName).toBe("billing_payment_issue");
expect(attempt.idempotencyKey).toBe("billing-payment-issue:user-1:2026-07-13");
expect(attempt.status).toBe("pending");
expect(attempt.webhookStatus).toBe("pending");
expect(attempt.timestamp).toBe(scheduledWatermark);
expect(attempt.payloadSnapshot).toEqual(
expect.objectContaining({
kind:"billing_payment_issue",
subject:"Action needed: a Five to Nine payment didn't go through",
bodyHtml:expect.stringContaining("your plan stays active"),
tag:"billing-payment-issue",
billingStateFingerprint:JSON.stringify(paymentIssueBillingInfo),
}),
);
expect(mocks.updateDeliveryAttemptResult).toHaveBeenNthCalledWith(1,expect.anything(),"attempt-1",
expect.objectContaining({status:"pending",webhookStatus:"provider_unknown",expectedWebhookStatus:"pending"}));
expect(mocks.updateDeliveryAttemptResult).toHaveBeenNthCalledWith(2,expect.anything(),"attempt-1",
expect.objectContaining({status:"sent",expectedWebhookStatus:"provider_unknown"}));
});
it("never replays a billing email after acceptance and a pre-finalize crash",async()=>{
const sendMock=mockEmailSend("msg_billing_crash");
const providerUnknown=billingAttempt({id:"attempt-provider-unknown",status:"pending",webhookStatus:"provider_unknown"});
const updateDeliveryAttemptResult=vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("worker crashed before finalize"));
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValueOnce(null).mockResolvedValue(providerUnknown),
updateDeliveryAttemptResult,
});
await expect(sendPaymentIssue()).rejects.toThrow("worker crashed before finalize");
await expect(sendPaymentIssue()).resolves.toBe(false);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(mocks.createDeliveryAttempt).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(1,expect.anything(),"attempt-1",
expect.objectContaining({status:"pending",webhookStatus:"provider_unknown",expectedWebhookStatus:"pending"}));
});
it("short-circuits a duplicate dunning send on the same day",async()=>{
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-13T18:00:00.000Z"));
const sendMock=mockEmailSend();
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi
.fn()
.mockResolvedValue({id:"attempt-existing",status:"sent"}),
});
const sent=await sendPaymentIssue({name:"Owner",});
expect(sent).toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
});
it("does not retry a legacy failed billing attempt without reconciled provider evidence",async()=>{
const sendMock=mockEmailSend("msg_must_not_send");
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi
.fn()
.mockResolvedValue(billingAttempt({
id:"attempt-failed",
status:"failed",
webhookStatus:"failed",
providerStatusLastSeenAt:"2026-07-13T09:00:00.000Z",
payloadSnapshot:billingPayload("billing_payment_issue",{}),
})),
});
const sent=await sendPaymentIssue({name:null,});
expect(sent).toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
});
it("atomically reclaims a failed dunning attempt so concurrent retries emit once",async()=>{
const sendMock=mockEmailSend("msg_failed_retry_once");
const updateDeliveryAttemptResult=vi
.fn()
.mockResolvedValueOnce(true)
.mockResolvedValueOnce(false)
.mockResolvedValueOnce(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue({
id:"attempt-failed",
provider:"cloudflare_email",
status:"failed",
webhookStatus:"failed",
providerMessageId:null,
payloadSnapshot:reconciledFailurePayload("billing_payment_issue"),
}),
updateDeliveryAttemptResult,
});
const input={
userId:"user-1",
email:"owner@example.com",
name:null,
};
const results=await Promise.all([
sendPaymentIssue(input),
sendPaymentIssue(input),
]);
expect(results.filter(Boolean)).toHaveLength(1);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
"attempt-failed",
expect.objectContaining({expectedStatus:"failed",status:"pending"}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
"attempt-failed",
expect.objectContaining({expectedStatus:"failed",status:"pending"}),
);
});
it("claims the dunning idempotency key before sending so concurrent handlers emit once",async()=>{
vi.useFakeTimers();
vi.setSystemTime(new Date(scheduledWatermark));
const sendMock=mockEmailSend("msg_concurrent_1");
const getDeliveryAttemptByIdempotencyKey=vi
.fn()
.mockResolvedValueOnce(null)
.mockResolvedValueOnce(null)
.mockResolvedValue({id:"attempt-claimed",status:"pending"});
const createDeliveryAttempt=vi
.fn()
.mockResolvedValueOnce("attempt-claimed")
.mockRejectedValueOnce(new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key"));
mockBillingDataServer({createDeliveryAttempt,getDeliveryAttemptByIdempotencyKey});
const results=await Promise.all([
sendPaymentIssue({name:"Owner",}),
sendPaymentIssue({name:"Owner",}),
]);
expect(results.filter(Boolean)).toHaveLength(1);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(createDeliveryAttempt).toHaveBeenCalledTimes(2);
});
it("does not resend a billing email while a provider-timeout outcome is unknown",async()=>{
const sendMock=mockEmailSend("msg_should_not_send");
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue({
id:"attempt-pending",
provider:"cloudflare_email",
status:"pending",
webhookStatus:"provider_unknown",
}),
});
const sent=await sendRefund({name:null,
eventId:"evt-refund-pending",});
expect(sent).toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
});
it("reclaims a stale billing pre-dispatch lease and sends once",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_stale_billing");
const staleAttempt=billingAttempt({
id:"attempt-stale",
});
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(staleAttempt),
updateDeliveryAttemptResult,
});
const sent=await sendRefund({name:null,
eventId:"evt-stale-refund",});
expect(sent).toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status:"pending",
webhookStatus:"pending",
expectedStatus:"pending",
expectedWebhookStatus:"pending",
expectedUpdatedAt:staleAttempt.updatedAt,
updatedAt:"2026-07-13T09:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status:"pending",
webhookStatus:"provider_unknown",
expectedStatus:"pending",
expectedWebhookStatus:"pending",
expectedUpdatedAt:"2026-07-13T09:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
3,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status:"sent",
expectedStatus:"pending",
expectedWebhookStatus:"provider_unknown",
}),
);
});
it("claims a freshly-enqueued outbox row and dispatches it immediately",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_outbox_dispatch");
const outboxAttempt=refundRecoveryAttempt(
"attempt-outbox",
{
bodyHtml:"<p>Your workspace moved to Free.</p>",
billingStateFingerprint:null,
outboxPendingDispatch:true,
},
{updatedAt:"2026-07-13T09:04:59.000Z"},
);
const refundedBillingInfo={
...currentBillingInfo,
plan:"free" as const,
dodoStatus:"refunded",
};
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(outboxAttempt),
getUserPlanBillingInfo:vi.fn().mockResolvedValue(refundedBillingInfo),
updateDeliveryAttemptResult,
});
const sent=await sendRefund({name:null,
eventId:"evt-outbox-refund",});
expect(sent).toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
outboxAttempt.id,
expect.objectContaining({
status:"pending",
expectedStatus:"pending",
expectedWebhookStatus:"pending",
expectedUpdatedAt:outboxAttempt.updatedAt,
targetValue:"owner@example.com",
payloadSnapshot:expect.objectContaining({
billingStateFingerprint:JSON.stringify(refundedBillingInfo),
}),
}),
);
});
it.each([
["direct refund A after refund B",false,"payment-new","2026-07-14T09:00:00.000Z","payment-current",scheduledWatermark],
["failed direct refund A after refund B",true,"payment-new","2026-07-14T09:00:00.000Z","payment-current",scheduledWatermark],
["missing payment identity",false,"payment-current",scheduledWatermark,"",scheduledWatermark],
["missing mutation watermark",false,"payment-current",scheduledWatermark,"payment-current",""],
])("blocks %s at the final provider gate",async(_label,failed,currentPayment,currentAt,paymentId,stateUpdatedAt)=>{
const sendMock=mockEmailSend("msg_stale_refund_must_not_send");
const duplicate=failed?refundRecoveryAttempt("attempt-failed-refund-a",{},{
status:"failed",webhookStatus:"failed",
}):null;
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(duplicate),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...refundBillingInfo,dodoPaymentId:currentPayment,planUpdatedAt:currentAt,
}),
});
await expect(sendRefund({eventId:"evt-refund-a",paymentId,stateUpdatedAt})).resolves.toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
});
it.each([
["exact payment","payment-current",scheduledWatermark,true],
["newer payment","payment-new",scheduledWatermark,false],
["newer watermark","payment-current","2026-07-14T09:00:00.000Z",false],
])("matches direct no-subscription payment.failed by %s",async(_label,currentPayment,currentAt,expected)=>{
const sendMock=mockEmailSend("msg_payment_identity");
const mocks=mockBillingDataServer({getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...paymentIssueBillingInfo,dodoSubscriptionId:null,dodoPaymentId:currentPayment,planUpdatedAt:currentAt,
})});
await expect(sendPaymentIssue({subscriptionId:null,paymentId:"payment-current"})).resolves.toBe(expected);
expect(sendMock).toHaveBeenCalledTimes(expected?1:0);
expect(mocks.createDeliveryAttempt).toHaveBeenCalledTimes(expected?1:0);
});
it.each([
["payment issue","billing_payment_issue","payment.failed","starter",false,null],
["failed payment issue","billing_payment_issue","payment.failed","starter",true,null],
["access ended","billing_access_ended","subscription.expired","free",false,null],
["failed access ended","billing_access_ended","subscription.expired","free",true,null],
["payment issue missing identity","billing_payment_issue","payment.failed","starter",false,"identity"],
["failed access ended missing watermark","billing_access_ended","subscription.expired","free",true,"watermark"],
]as const)("blocks stale direct %s A after state B",async(_label,templateName,status,plan,failed,missing)=>{
const sendMock=mockEmailSend("msg_stale_mutation_must_not_send");
const duplicate=failed
?missing?recoveryAttempt("attempt-failed-a",templateName,{})
:mutationRecoveryAttempt("attempt-failed-a",templateName,status,"subscription-a",scheduledWatermark)
:null;
if(duplicate)Object.assign(duplicate,{status:"failed",webhookStatus:"failed"});
const currentSubscription=missing?"subscription-a":"subscription-b";
const currentAt=missing?scheduledWatermark:"2026-07-14T09:00:00.000Z";
const mocks=mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(duplicate),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,plan,dodoStatus:status,
dodoSubscriptionId:currentSubscription,planUpdatedAt:currentAt,
}),
});
const sent=templateName === "billing_payment_issue"
?sendPaymentIssue({status,subscriptionId:missing === "identity"?null:"subscription-a",stateUpdatedAt:scheduledWatermark})
:sendCancellation({kind:"ended",eventId:"evt-ended-a",status,subscriptionId:"subscription-a",stateUpdatedAt:missing === "watermark"?null:scheduledWatermark});
await expect(sent).resolves.toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
});
it("recovers only the exact refund identity and watermark",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_refund_identity");
const refundBAt="2026-07-14T09:00:00.000Z";
const attempts=[
["exact-b","payment-new",refundBAt],
["stale-a","payment-current",scheduledWatermark],
["missing-payment",undefined,refundBAt],
["missing-watermark","payment-new",undefined],
].map(([id,refundPaymentId,refundStateUpdatedAt])=>refundRecoveryAttempt(`attempt-${id}`,{
billingStateFingerprint:null,outboxPendingDispatch:true,refundPaymentId,refundStateUpdatedAt,
}));
mockBillingDataServer({
listStaleBillingLifecycleEmailAttempts:vi.fn().mockResolvedValue(attempts),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,plan:"free",dodoStatus:"refunded",
dodoPaymentId:"payment-new",planUpdatedAt:refundBAt,
}),
updateDeliveryAttemptResult:vi.fn().mockResolvedValue(true),
});
const result=await recoverBilling();
expect(result).toMatchObject({scanned:4,claimed:4,sent:1,superseded:3});
expect(sendMock).toHaveBeenCalledTimes(1);
});
it.each([
{label:"passed cutoff",currentPlan:"starter" as const,currentCutoff:"2026-07-13T09:04:00.000Z",currentStateUpdatedAt:scheduledWatermark,expectedSent:false},
{label:"non-paid effective plan",currentPlan:"free" as const,currentCutoff:scheduledCutoff,currentStateUpdatedAt:scheduledWatermark,expectedSent:false},
{label:"later cancellation date",currentPlan:"starter" as const,currentCutoff:"2026-09-13T09:00:00.000Z",currentStateUpdatedAt:"2026-07-14T09:00:00.000Z",expectedSent:false},
{label:"matching future cancellation",currentPlan:"starter" as const,currentCutoff:scheduledCutoff,currentStateUpdatedAt:scheduledWatermark,expectedSent:true},
])(
"validates a batch-enqueued scheduled cancellation with $label before live dispatch",
async({currentPlan,currentCutoff,currentStateUpdatedAt,expectedSent})=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_scheduled_identity");
const outboxAttempt=scheduledRecoveryAttempt(
"attempt-scheduled-identity",
"evt-scheduled-identity",
{
bodyHtml:"<p>Your paid plan remains active until the cutoff.</p>",
billingStateFingerprint:null,
outboxPendingDispatch:true,
},
{updatedAt:"2026-07-13T09:04:59.000Z"},
);
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(outboxAttempt),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,
plan:currentPlan,
dodoStatus:"cancellation_scheduled",
dodoNextBillingAt:currentCutoff,
planUpdatedAt:currentStateUpdatedAt,
}),
updateDeliveryAttemptResult,
});
const sent=await sendScheduledCancellation("evt-scheduled-identity");
expect(sent).toBe(expectedSent);
expect(sendMock).toHaveBeenCalledTimes(expectedSent?1:0);
if(!expectedSent){
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(),
outboxAttempt.id,
expect.objectContaining({
status:"skipped_due_to_dedupe",
webhookStatus:"provider_unknown",
expectedUpdatedAt:outboxAttempt.updatedAt,
}),
);
expect(updateDeliveryAttemptResult.mock.calls[0]?.[2]).not.toHaveProperty(
"payloadSnapshot",
);
}else{
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
outboxAttempt.id,
expect.objectContaining({
payloadSnapshot:expect.objectContaining({
scheduledCancellationCutoff:scheduledCutoff,
scheduledCancellationEventId:"evt-scheduled-identity",
scheduledCancellationSubscriptionId:"subscription-current",
scheduledCancellationStateUpdatedAt:scheduledWatermark,
}),
}),
);
}
},
);
it("does not revive a failed older scheduled cancellation after a later date wins",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_old_scheduled_retry_must_not_send");
const failedAttempt=scheduledRecoveryAttempt(
"attempt-old-scheduled-failed",
"evt-old-scheduled",
{
...reconciledFailurePayload("billing_cancellation_scheduled",{
billingStateFingerprint:currentBillingStateFingerprint,
}),
},
{
status:"failed",
webhookStatus:"failed",
updatedAt:"2026-07-13T09:04:00.000Z",
},
);
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(failedAttempt),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus:"cancellation_scheduled",
dodoNextBillingAt:"2026-09-13T09:00:00.000Z",
planUpdatedAt:"2026-07-14T09:00:00.000Z",
}),
updateDeliveryAttemptResult,
});
const sent=await sendScheduledCancellation("evt-old-scheduled");
expect(sent).toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(),
failedAttempt.id,
expect.objectContaining({
status:"skipped_due_to_dedupe",
webhookStatus:"provider_unknown",
expectedStatus:"failed",
expectedWebhookStatus:"failed",
expectedUpdatedAt:failedAttempt.updatedAt,
}),
);
});
it.each([
{label:"replaced state",currentCutoff:"2026-09-13T09:00:00.000Z",currentStateUpdatedAt:"2026-07-14T09:00:00.000Z",expectedSent:false},
{label:"matching current state",currentCutoff:scheduledCutoff,currentStateUpdatedAt:scheduledWatermark,expectedSent:true},
])(
"validates a no-outbox scheduled-cancellation fallback against $label",
async({currentCutoff,currentStateUpdatedAt,expectedSent})=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_no_outbox_scheduled");
const createDeliveryAttempt=vi.fn().mockResolvedValue("attempt-no-outbox");
mockBillingDataServer({
createDeliveryAttempt,
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(null),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus:"cancellation_scheduled",
dodoNextBillingAt:currentCutoff,
planUpdatedAt:currentStateUpdatedAt,
}),
});
const sent=await sendScheduledCancellation("evt-no-outbox",{
subscriptionId:"subscription-current",
stateUpdatedAt:scheduledWatermark,
});
expect(sent).toBe(expectedSent);
expect(sendMock).toHaveBeenCalledTimes(expectedSent?1:0);
expect(createDeliveryAttempt).toHaveBeenCalledTimes(expectedSent?1:0);
if(expectedSent){
expect(createDeliveryAttempt).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
payloadSnapshot:expect.objectContaining({
scheduledCancellationCutoff:scheduledCutoff,
scheduledCancellationEventId:"evt-no-outbox",
scheduledCancellationSubscriptionId:"subscription-current",
scheduledCancellationStateUpdatedAt:scheduledWatermark,
}),
}),
);
}
},
);
it("retains scheduled-cancellation identity while retrying an explicit failure",async()=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_matching_scheduled_retry");
const failedAttempt=scheduledRecoveryAttempt(
"attempt-matching-scheduled-failed",
"evt-matching-scheduled-retry",
{
...reconciledFailurePayload("billing_cancellation_scheduled",{
billingStateFingerprint:currentBillingStateFingerprint,
}),
},
{
status:"failed",
webhookStatus:"failed",
updatedAt:"2026-07-13T09:04:00.000Z",
},
);
const updateDeliveryAttemptResult=vi.fn().mockResolvedValue(true);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(failedAttempt),
getUserPlanBillingInfo:vi.fn().mockResolvedValue({
...currentBillingInfo,
dodoStatus:"cancellation_scheduled",
}),
updateDeliveryAttemptResult,
});
const sent=await sendScheduledCancellation("evt-matching-scheduled-retry",{
subscriptionId:"subscription-current",
stateUpdatedAt:scheduledWatermark,
});
expect(sent).toBe(true);
expect(sendMock).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
failedAttempt.id,
expect.objectContaining({
expectedStatus:"failed",
payloadSnapshot:expect.objectContaining({
scheduledCancellationCutoff:scheduledCutoff,
scheduledCancellationEventId:"evt-matching-scheduled-retry",
scheduledCancellationSubscriptionId:"subscription-current",
scheduledCancellationStateUpdatedAt:scheduledWatermark,
}),
}),
);
});
it.each([
["scheduled cancellation","billing_cancellation_scheduled"],
["access ended","billing_access_ended"],
["refund revoked","billing_refund_revoked"],
]as const)(
"supersedes a stale batch-enqueued %s email before provider dispatch",
async(_label,templateName)=>{
useRecoveryClock();
const sendMock=mockEmailSend("msg_stale_outbox_must_not_send");
const outboxAttempt=recoveryAttempt(
`attempt-${templateName}`,
templateName,
{
subject:"Stale billing state",
bodyHtml:"<p>This message no longer describes the account.</p>",
tag:"billing-lifecycle",
billingStateFingerprint:null,
outboxPendingDispatch:true,
},
{
status:"pending" as string,
webhookStatus:"pending" as string,
updatedAt:"2026-07-13T09:04:59.000Z",
},
);
const updateDeliveryAttemptResult=vi.fn(
async(_env:unknown,_attemptId:string,input:Record<string,unknown>)=>{
outboxAttempt.status=String(input.status);
outboxAttempt.webhookStatus=String(input.webhookStatus);
return true;
},
);
mockBillingDataServer({
getDeliveryAttemptByIdempotencyKey:vi.fn().mockResolvedValue(outboxAttempt),
updateDeliveryAttemptResult,
});
const dispatch=()=>
templateName === "billing_refund_revoked"
?sendRefund({name:"Owner",
eventId:"evt-stale-outbox",})
:sendCancellation({name:"Owner",
kind:
templateName === "billing_cancellation_scheduled"?"scheduled":"ended",
eventId:"evt-stale-outbox",});
await expect(dispatch()).resolves.toBe(false);
await expect(dispatch()).resolves.toBe(false);
expect(sendMock).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
const supersede=updateDeliveryAttemptResult.mock.calls[0]?.[2];
expect(supersede).toMatchObject({
status:"skipped_due_to_dedupe",
webhookStatus:"provider_unknown",
expectedStatus:"pending",
expectedWebhookStatus:"pending",
expectedUpdatedAt:outboxAttempt.updatedAt,
});
expect(supersede).not.toHaveProperty("payloadSnapshot");
},
);
});
