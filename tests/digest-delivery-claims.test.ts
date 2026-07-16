import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PERIOD_START = "2026-07-06T05:00:00.000Z";
const PERIOD_END = "2026-07-13T05:00:00.000Z";

function digestInput() {
return {
userId: "user-1",
userName: "Owner",
accountEmail: null,
digestRunId: "digest-1",
periodStart: PERIOD_START,
periodEnd: PERIOD_END,
items: [
{
eventId: "event-1",
watchlistId: "watch-1",
watchlistName: "boAt watch",
eventType: "landing_page_offer_changed",
title: "Landing page offer changed",
summary: "Offer changed on the landing page.",
},
],
};
}

function deliveryTarget(channel: "email" | "slack" | "whatsapp") {
const isWhatsApp = channel === "whatsapp";
const isEmail = channel === "email";
return {
id: `${channel}-target-1`,
userId: "user-1",
watchlistId: null,
channel,
targetValue: isWhatsApp ? "+919999999999" : isEmail ? "owner@example.com" : "slack:abc123",
validationStatus: "validated",
isValidated: true,
isOptedIn: true,
optInSource: isWhatsApp ? "manual_whatsapp_setup" : isEmail ? "account_email" : "manual_slack_webhook",
optedInAt: "2026-07-01T00:00:00.000Z",
isPaused: false,
pausedAt: null,
optedOutAt: null,
templateEligible: true,
lastSuccessfulDeliveryAt: null,
lastSuccessfulAttemptId: null,
providerIdentifier: isWhatsApp ? "wa-1" : isEmail ? null : "abc123",
metadata: {},
createdAt: "2026-07-01T00:00:00.000Z",
updatedAt: "2026-07-01T00:00:00.000Z",
};
}

function deliveryAttempt(
channel: "email" | "slack" | "whatsapp",
status: "failed" | "pending" | "sent",
) {
const target = deliveryTarget(channel);
return {
id: `attempt-${channel}-1`,
userId: "user-1",
watchlistId: null,
digestRunId: "digest-1",
deliveryTargetId: target.id,
lane: "customer",
channel,
provider: channel === "slack" ? "slack_incoming_webhook" : channel === "email" ? "cloudflare_email" : "whatsapp_cloud_api",
status,
webhookStatus: status === "failed" ? "failed" : status === "pending" ? "pending" : "provider_unknown",
targetValue: target.targetValue,
providerMessageId: status === "sent" ? "provider-message-1" : null,
providerStatusLastSeenAt: status === "pending" ? null : "2026-07-13T05:01:00.000Z",
templateName: channel === "whatsapp" ? "proof_digest_customer_v1" : null,
eventIds: ["event-1"],
payloadSnapshot: {},
idempotencyKey: `digest:digest-1:customer:${channel}:${target.targetValue}`,
errorMessage: status === "failed" ? "Prior provider rejection." : null,
sentAt: status === "sent" ? "2026-07-13T05:01:00.000Z" : null,
failedAt: status === "failed" ? "2026-07-13T05:01:00.000Z" : null,
createdAt: "2026-07-13T05:01:00.000Z",
updatedAt: "2026-07-13T05:01:00.000Z",
};
}

function mockDataServer(input: {
channel: "email" | "slack" | "whatsapp";
getDeliveryAttemptByIdempotencyKey: ReturnType<typeof vi.fn>;
createDeliveryAttempt?: ReturnType<typeof vi.fn>;
updateDeliveryAttemptResult: ReturnType<typeof vi.fn>;
}) {
const target = deliveryTarget(input.channel);
const createDeliveryAttempt = input.createDeliveryAttempt ?? vi.fn();
const upsertDeliveryTarget = vi.fn().mockResolvedValue(target);
const upsertDigestDelivery = vi.fn();

vi.doMock("~/lib/data.server", () => ({
listAdsByIds: vi.fn().mockResolvedValue([]),
createDeliveryAttempt,
updateDeliveryAttemptResult: input.updateDeliveryAttemptResult,
getDeliveryAttemptByIdempotencyKey: input.getDeliveryAttemptByIdempotencyKey,
getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
id: "workspace-1",
userId: "user-1",
sensitivityMode: "balanced",
instantEnabled: false,
digestEnabled: true,
emailEnabled: input.channel === "email",
whatsappEnabled: input.channel === "whatsapp",
slackEnabled: input.channel === "slack",
quietHours: null,
timezone: "Asia/Kolkata",
createdAt: "2026-07-01T00:00:00.000Z",
updatedAt: "2026-07-01T00:00:00.000Z",
}),
legacyWorkspaceDeliveryDefaults: vi.fn(),
listDeliveryTargets: vi.fn(async (
_env: unknown,
_userId: string,
options?: { channel?: string },
) => options?.channel === input.channel ? [target] : []),
upsertDeliveryTarget,
upsertDigestDelivery,
}));

return { createDeliveryAttempt, upsertDeliveryTarget, upsertDigestDelivery };
}

function mockStatefulEmailDataServer() {
let currentAttempt: ReturnType<typeof deliveryAttempt> | null = null;
const createDeliveryAttempt = vi.fn(async (_env: unknown, input: Record<string, unknown>) => {
currentAttempt = {
...deliveryAttempt("email", "pending"),
id: "attempt-email-1",
status: input.status as "pending",
webhookStatus: input.webhookStatus as "pending",
providerStatusLastSeenAt: null,
errorMessage: null,
failedAt: null,
updatedAt: String(input.timestamp),
createdAt: String(input.timestamp),
};
return currentAttempt.id;
});
const getDeliveryAttemptByIdempotencyKey = vi.fn(async () => currentAttempt);
const updateDeliveryAttemptResult = vi.fn(async (
_env: unknown,
attemptId: string,
update: Record<string, unknown>,
) => {
if (!currentAttempt || currentAttempt.id !== attemptId) return false;
if (update.expectedStatus && currentAttempt.status !== update.expectedStatus) return false;
if (update.expectedWebhookStatus && currentAttempt.webhookStatus !== update.expectedWebhookStatus) return false;
if (update.expectedUpdatedAt && currentAttempt.updatedAt !== update.expectedUpdatedAt) return false;
currentAttempt = {
...currentAttempt,
provider: typeof update.provider === "string" ? update.provider : currentAttempt.provider,
status: (update.status ?? currentAttempt.status) as typeof currentAttempt.status,
webhookStatus: (update.webhookStatus ?? currentAttempt.webhookStatus) as typeof currentAttempt.webhookStatus,
providerMessageId: update.providerMessageId === undefined
? currentAttempt.providerMessageId
: update.providerMessageId as string | null,
providerStatusLastSeenAt: update.providerStatusLastSeenAt === undefined
? currentAttempt.providerStatusLastSeenAt
: update.providerStatusLastSeenAt as string | null,
errorMessage: update.errorMessage === undefined
? currentAttempt.errorMessage
: update.errorMessage as string | null,
sentAt: update.sentAt === undefined ? currentAttempt.sentAt : update.sentAt as string | null,
failedAt: update.failedAt === undefined ? currentAttempt.failedAt : update.failedAt as string | null,
updatedAt: typeof update.updatedAt === "string" ? update.updatedAt : currentAttempt.updatedAt,
};
return true;
});
mockDataServer({
channel: "email",
getDeliveryAttemptByIdempotencyKey,
createDeliveryAttempt,
updateDeliveryAttemptResult,
});
return {
createDeliveryAttempt,
getAttempt: () => currentAttempt,
getDeliveryAttemptByIdempotencyKey,
updateDeliveryAttemptResult,
};
}

beforeEach(() => {
vi.resetModules();
vi.doMock("~/lib/plan.server", () => ({
getUserPlan: vi.fn().mockResolvedValue("starter"),
}));
vi.doMock("~/lib/email-verification.server", () => ({
isUserEmailVerified: vi.fn().mockResolvedValue(true),
}));
vi.doMock("~/lib/ga-customer-surface", () => ({
isSlackDeliveryCustomerFacing: () => true,
isWhatsAppDeliveryCustomerFacing: () => true,
}));
});

afterEach(() => {
vi.restoreAllMocks();
vi.useRealTimers();
vi.resetModules();
vi.doUnmock("~/lib/data.server");
vi.doUnmock("~/lib/email-verification.server");
vi.doUnmock("~/lib/ga-customer-surface");
vi.doUnmock("~/lib/plan.server");
vi.doUnmock("~/lib/slack-webhook.server");
vi.doUnmock("~/lib/whatsapp.server");
});

describe("weekly digest per-target delivery claims", () => {
it("fails Slack local preparation before claiming provider dispatch", async () => {
const pendingAttempt = deliveryAttempt("slack", "pending");
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
mockDataServer({
channel: "slack",
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
createDeliveryAttempt: vi.fn().mockResolvedValue(pendingAttempt.id),
updateDeliveryAttemptResult,
});
const prepareSlackWebhookTarget = vi.fn().mockResolvedValue({
ok: false,
result: {
provider: "slack_incoming_webhook",
status: "failed",
webhookStatus: "failed",
providerMessageId: null,
providerStatusLastSeenAt: null,
errorMessage: "Slack webhook could not be decrypted.",
deliveredAt: null,
},
});
const sendSlackWebhookUrl = vi.fn();
const sendSlackWebhookMessage = vi.fn().mockResolvedValue({
provider: "slack_incoming_webhook",
status: "sent",
webhookStatus: "delivered",
providerMessageId: null,
providerStatusLastSeenAt: "2026-07-13T05:02:00.000Z",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
prepareSlackWebhookTarget,
sendSlackWebhookUrl,
sendSlackWebhookMessage,
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({} as never, digestInput());

expect(prepareSlackWebhookTarget).toHaveBeenCalledTimes(1);
expect(sendSlackWebhookUrl).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
expect.anything(),
pendingAttempt.id,
expect.objectContaining({
status: "failed",
webhookStatus: "failed",
expectedStatus: "pending",
expectedWebhookStatus: "pending",
}),
);
});
it("claims a fresh Slack attempt before the provider so overlapping workers emit once", async () => {
const pendingAttempt = deliveryAttempt("slack", "pending");
const getDeliveryAttemptByIdempotencyKey = vi
.fn()
// Both workers observed the pre-claim state. The second worker then
// refetches the durable winner after losing the unique insert.
.mockResolvedValueOnce(null)
.mockResolvedValueOnce(null)
.mockResolvedValueOnce(pendingAttempt);
const createDeliveryAttempt = vi
.fn()
.mockResolvedValueOnce(pendingAttempt.id)
.mockRejectedValueOnce(
new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key"),
);
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
mockDataServer({
channel: "slack",
getDeliveryAttemptByIdempotencyKey,
createDeliveryAttempt,
updateDeliveryAttemptResult,
});
const sendSlackWebhookMessage = vi.fn().mockResolvedValue({
provider: "slack_incoming_webhook",
status: "sent",
webhookStatus: "delivered",
providerMessageId: null,
providerStatusLastSeenAt: "2026-07-13T05:02:00.000Z",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
ok: true,
webhookUrl: "https://hooks.slack.test/services/redacted",
}),
sendSlackWebhookUrl: sendSlackWebhookMessage,
sendSlackWebhookMessage,
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({} as never, digestInput());
await deliverWeeklyDigest({} as never, digestInput());

expect(createDeliveryAttempt).toHaveBeenCalledTimes(2);
expect(createDeliveryAttempt).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
channel: "slack",
status: "pending",
webhookStatus: "pending",
timestamp: expect.any(String),
}),
);
expect(sendSlackWebhookMessage).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(2);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(1, expect.anything(), pendingAttempt.id,
expect.objectContaining({ status: "pending", webhookStatus: "provider_unknown", expectedStatus: "pending", expectedWebhookStatus: "pending" }));
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(2, expect.anything(), pendingAttempt.id,
expect.objectContaining({ expectedStatus: "pending", expectedWebhookStatus: "provider_unknown", status: "sent" }));
});

it("atomically reclaims a failed WhatsApp attempt so overlapping retries emit once", async () => {
const failedAttempt = deliveryAttempt("whatsapp", "failed");
const pendingAttempt = deliveryAttempt("whatsapp", "pending");
const getDeliveryAttemptByIdempotencyKey = vi
.fn()
// Both workers observed the failed row. The second worker then
// refetches the durable pending claim after losing failed -> pending CAS.
.mockResolvedValueOnce(failedAttempt)
.mockResolvedValueOnce(failedAttempt)
.mockResolvedValueOnce(pendingAttempt);
const updateDeliveryAttemptResult = vi
.fn()
.mockResolvedValueOnce(true)
.mockResolvedValueOnce(true)
.mockResolvedValueOnce(true)
.mockResolvedValueOnce(false);
const { createDeliveryAttempt } = mockDataServer({
channel: "whatsapp",
getDeliveryAttemptByIdempotencyKey,
updateDeliveryAttemptResult,
});
const sendDigestWhatsApp = vi.fn().mockResolvedValue({
provider: "whatsapp_cloud_api",
status: "sent",
webhookStatus: "provider_unknown",
providerMessageId: "wamid.1",
providerStatusLastSeenAt: "2026-07-13T05:02:00.000Z",
templateName: "proof_digest_customer_v1",
errorMessage: null,
});
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp }));
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
sendSlackWebhookMessage: vi.fn(),
}));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({} as never, digestInput());
await deliverWeeklyDigest({} as never, digestInput());

expect(createDeliveryAttempt).not.toHaveBeenCalled();
expect(sendDigestWhatsApp).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
failedAttempt.id,
expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
failedAttempt.id,
expect.objectContaining({ expectedStatus: "pending", webhookStatus: "provider_unknown" }),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
3,
expect.anything(),
failedAttempt.id,
expect.objectContaining({ expectedWebhookStatus: "provider_unknown", status: "sent" }),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
4,
expect.anything(),
failedAttempt.id,
expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
);
});

it("reclaims a stale pre-dispatch Slack lease and calls the provider once", async () => {
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-13T05:05:00.000Z"));
const staleAttempt = {
...deliveryAttempt("slack", "pending"),
updatedAt: "2026-07-13T05:03:00.000Z",
};
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
const { createDeliveryAttempt } = mockDataServer({
channel: "slack",
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(staleAttempt),
updateDeliveryAttemptResult,
});
const sendSlackWebhookMessage = vi.fn().mockResolvedValue({
provider: "slack_incoming_webhook",
status: "sent",
webhookStatus: "delivered",
providerMessageId: null,
providerStatusLastSeenAt: "2026-07-13T05:05:00.000Z",
errorMessage: null,
deliveredAt: "2026-07-13T05:05:00.000Z",
});
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
ok: true,
webhookUrl: "https://hooks.slack.test/services/redacted",
}),
sendSlackWebhookUrl: sendSlackWebhookMessage,
sendSlackWebhookMessage,
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({} as never, digestInput());

expect(createDeliveryAttempt).not.toHaveBeenCalled();
expect(sendSlackWebhookMessage).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "pending",
webhookStatus: "pending",
expectedStatus: "pending",
expectedWebhookStatus: "pending",
expectedUpdatedAt: staleAttempt.updatedAt,
updatedAt: "2026-07-13T05:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
expect.anything(),
staleAttempt.id,
expect.objectContaining({
status: "pending",
expectedStatus: "pending",
expectedWebhookStatus: "pending",
expectedUpdatedAt: "2026-07-13T05:05:00.000Z",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
3,
expect.anything(),
staleAttempt.id,
expect.objectContaining({ status: "sent", expectedWebhookStatus: "provider_unknown" }),
);
});

it("never replays Slack after the durable dispatch marker survives a worker crash", async () => {
const providerUnknown = { ...deliveryAttempt("slack", "pending"), webhookStatus: "provider_unknown" as const };
const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
mockDataServer({
channel: "slack",
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(providerUnknown),
createDeliveryAttempt: vi.fn().mockResolvedValue(providerUnknown.id),
updateDeliveryAttemptResult,
});
const sendSlackWebhookMessage = vi.fn().mockRejectedValue(new Error("worker crashed after dispatch"));
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
ok: true,
webhookUrl: "https://hooks.slack.test/services/redacted",
}),
sendSlackWebhookUrl: sendSlackWebhookMessage,
sendSlackWebhookMessage,
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await expect(deliverWeeklyDigest({} as never, digestInput())).rejects.toThrow("worker crashed after dispatch");
await deliverWeeklyDigest({} as never, digestInput());

expect(sendSlackWebhookMessage).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(expect.anything(), providerUnknown.id,
expect.objectContaining({ status: "pending", webhookStatus: "provider_unknown", expectedWebhookStatus: "pending" }));
});

it("does not reclaim a provider-unknown digest attempt", async () => {
const providerUnknownAttempt = {
...deliveryAttempt("slack", "pending"),
webhookStatus: "provider_unknown" as const,
providerStatusLastSeenAt: "2026-07-13T05:01:00.000Z",
updatedAt: "2026-07-13T05:01:00.000Z",
};
const updateDeliveryAttemptResult = vi.fn();
const { createDeliveryAttempt } = mockDataServer({
channel: "slack",
getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(providerUnknownAttempt),
updateDeliveryAttemptResult,
});
const sendSlackWebhookMessage = vi.fn();
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
sendSlackWebhookMessage,
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({} as never, digestInput());

expect(createDeliveryAttempt).not.toHaveBeenCalled();
expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
expect(sendSlackWebhookMessage).not.toHaveBeenCalled();
});

it("does not resend when Cloudflare may have accepted before a local exception", async () => {
const state = mockStatefulEmailDataServer();
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
sendSlackWebhookMessage: vi.fn(),
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));
const send = vi.fn().mockRejectedValue(
new Error("provider accepted the message before the response stream failed"),
);
const env = {
EMAIL: { send },
EMAIL_FROM_EMAIL: "notify@0509.io",
APP_ORIGIN: "https://0509.io",
} as never;

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest(env, digestInput());
expect(state.getAttempt()).toMatchObject({
status: "failed",
webhookStatus: "provider_unknown",
providerStatusLastSeenAt: expect.any(String),
});

await deliverWeeklyDigest(env, digestInput());

expect(send).toHaveBeenCalledTimes(1);
expect(state.getAttempt()).toMatchObject({
status: "failed",
webhookStatus: "provider_unknown",
});
expect(state.updateDeliveryAttemptResult).not.toHaveBeenCalledWith(
expect.anything(),
"attempt-email-1",
expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
);
});

it("retries a known pre-dispatch email configuration failure exactly once after recovery", async () => {
const state = mockStatefulEmailDataServer();
vi.doMock("~/lib/slack-webhook.server", () => ({
SLACK_PROVIDER: "slack_incoming_webhook",
sendSlackWebhookMessage: vi.fn(),
}));
vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));
const send = vi.fn().mockResolvedValue({ messageId: "message-1" });

const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
await deliverWeeklyDigest({ APP_ORIGIN: "https://0509.io" } as never, digestInput());

expect(send).not.toHaveBeenCalled();
expect(state.getAttempt()).toMatchObject({
status: "failed",
webhookStatus: "failed",
providerStatusLastSeenAt: null,
errorMessage: "Email sending is not configured for this environment.",
});

await deliverWeeklyDigest({
EMAIL: { send },
EMAIL_FROM_EMAIL: "notify@0509.io",
APP_ORIGIN: "https://0509.io",
} as never, digestInput());

expect(send).toHaveBeenCalledTimes(1);
expect(state.getAttempt()).toMatchObject({
status: "sent",
webhookStatus: "provider_unknown",
providerMessageId: "message-1",
});
});
});
