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

function deliveryTarget(channel: "slack" | "whatsapp") {
  const isWhatsApp = channel === "whatsapp";
  return {
    id: `${channel}-target-1`,
    userId: "user-1",
    watchlistId: null,
    channel,
    targetValue: isWhatsApp ? "+919999999999" : "slack:abc123",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: isWhatsApp ? "manual_whatsapp_setup" : "manual_slack_webhook",
    optedInAt: "2026-07-01T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: isWhatsApp ? "wa-1" : "abc123",
    metadata: {},
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function deliveryAttempt(
  channel: "slack" | "whatsapp",
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
    provider: channel === "slack" ? "slack_incoming_webhook" : "whatsapp_cloud_api",
    status,
    webhookStatus: status === "failed" ? "failed" : "provider_unknown",
    targetValue: target.targetValue,
    providerMessageId: status === "sent" ? "provider-message-1" : null,
    providerStatusLastSeenAt: "2026-07-13T05:01:00.000Z",
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
  channel: "slack" | "whatsapp";
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
      emailEnabled: false,
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
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/ga-customer-surface");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/slack-webhook.server");
  vi.doUnmock("~/lib/whatsapp.server");
});

describe("weekly digest per-target delivery claims", () => {
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
      sendSlackWebhookMessage,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());
    await deliverWeeklyDigest({} as never, digestInput());

    expect(createDeliveryAttempt).toHaveBeenCalledTimes(2);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: "slack", status: "pending" }),
    );
    expect(sendSlackWebhookMessage).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      pendingAttempt.id,
      expect.objectContaining({ expectedStatus: "pending", status: "sent" }),
    );
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
      expect.objectContaining({ expectedStatus: "pending", status: "sent" }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      failedAttempt.id,
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
  });
});
