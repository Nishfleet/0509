import { describe, expect, it } from "vitest";

import { toPublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";

describe("public delivery attempt summaries", () => {
  it("keeps useful recovery state without recipient, provider, or internal error details", () => {
    const summary = toPublicDeliveryAttemptSummary({
      id: "attempt-1",
      userId: "user-1",
      watchlistId: "watch-1",
      digestRunId: "digest-1",
      deliveryTargetId: "target-1",
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "failed",
      webhookStatus: "failed",
      targetValue: "owner@example.com",
      providerMessageId: "provider-secret-id",
      providerStatusLastSeenAt: "2026-07-15T04:00:00.000Z",
      templateName: "digest",
      eventIds: ["event-1"],
      payloadSnapshot: { internal: "private" },
      idempotencyKey: "private-idempotency-key",
      errorMessage: "D1_ERROR: Cloudflare token owner@example.com",
      sentAt: null,
      failedAt: "2026-07-15T04:00:00.000Z",
      createdAt: "2026-07-15T04:00:00.000Z",
      updatedAt: "2026-07-15T04:00:00.000Z",
    });

    expect(summary).toMatchObject({
      channel: "email",
      targetValue: "Configured email recipient",
      status: "failed",
      errorMessage: "Delivery failed before provider acceptance. Review delivery settings or contact support.",
      eventIds: ["event-1"],
    });
    expect(JSON.stringify(summary)).not.toContain("owner@example.com");
    expect(JSON.stringify(summary)).not.toContain("provider-secret-id");
    expect(JSON.stringify(summary)).not.toContain("private-idempotency-key");
    expect(JSON.stringify(summary)).not.toContain("D1_ERROR");
  });

  it("labels provider-accepted email without delivery evidence as unconfirmed", () => {
    const summary = toPublicDeliveryAttemptSummary({
      id: "attempt-accepted",
      userId: "user-1",
      watchlistId: null,
      digestRunId: "digest-1",
      deliveryTargetId: "target-1",
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "sent",
      webhookStatus: "provider_unknown",
      targetValue: "owner@example.com",
      providerMessageId: "provider-message-1",
      providerStatusLastSeenAt: null,
      templateName: "weekly_digest",
      eventIds: [],
      payloadSnapshot: {},
      idempotencyKey: "digest:digest-1:customer:email:owner@example.com",
      errorMessage: null,
      sentAt: "2026-07-15T04:00:00.000Z",
      failedAt: null,
      createdAt: "2026-07-15T04:00:00.000Z",
      updatedAt: "2026-07-15T04:00:00.000Z",
    });

    expect(summary.errorMessage).toBe(
      "The email provider accepted this message, but final delivery is unconfirmed.",
    );
  });

  it.each([
    ["whatsapp", "pending", "Configured WhatsApp recipient", "WhatsApp accepted this message for sending, but final delivery is unconfirmed."],
    ["whatsapp", "provider_unknown", "Configured WhatsApp recipient", "WhatsApp accepted this message for sending, but final delivery is unconfirmed."],
    ["slack", "pending", "Connected Slack workspace", "Slack accepted this message for sending, but final delivery is unconfirmed."],
    ["slack", "provider_unknown", "Connected Slack workspace", "Slack accepted this message for sending, but final delivery is unconfirmed."],
  ] as const)(
    "labels provider-accepted %s with %s receipt state as unconfirmed",
    (channel, webhookStatus, targetValue, message) => {
      const summary = toPublicDeliveryAttemptSummary({
        id: `attempt-${channel}-${webhookStatus}`,
        userId: "user-1",
        watchlistId: null,
        digestRunId: "digest-1",
        deliveryTargetId: `target-${channel}`,
        lane: "customer",
        channel,
        provider: channel === "whatsapp" ? "cloudflare_whatsapp" : "slack_webhook",
        status: "sent",
        webhookStatus,
        targetValue: channel === "whatsapp" ? "+15550000000" : "https://hooks.slack.test/secret",
        providerMessageId: `provider-message-${channel}`,
        providerStatusLastSeenAt: null,
        templateName: "weekly_digest",
        eventIds: [],
        payloadSnapshot: {},
        idempotencyKey: `digest:digest-1:customer:${channel}:target-${channel}`,
        errorMessage: null,
        sentAt: "2026-07-15T04:00:00.000Z",
        failedAt: null,
        createdAt: "2026-07-15T04:00:00.000Z",
        updatedAt: "2026-07-15T04:00:00.000Z",
      });

      expect(summary.targetValue).toBe(targetValue);
      expect(summary.errorMessage).toBe(message);
    },
  );

  it("leaves a confirmed WhatsApp delivery free of recovery copy", () => {
    const summary = toPublicDeliveryAttemptSummary({
      id: "attempt-whatsapp-delivered",
      userId: "user-1",
      watchlistId: null,
      digestRunId: "digest-1",
      deliveryTargetId: "target-whatsapp",
      lane: "customer",
      channel: "whatsapp",
      provider: "cloudflare_whatsapp",
      status: "sent",
      webhookStatus: "delivered",
      targetValue: "+15550000000",
      providerMessageId: "provider-message-whatsapp",
      providerStatusLastSeenAt: "2026-07-15T04:05:00.000Z",
      templateName: "weekly_digest",
      eventIds: [],
      payloadSnapshot: {},
      idempotencyKey: "digest:digest-1:customer:whatsapp:target-whatsapp",
      errorMessage: null,
      sentAt: "2026-07-15T04:00:00.000Z",
      failedAt: null,
      createdAt: "2026-07-15T04:00:00.000Z",
      updatedAt: "2026-07-15T04:05:00.000Z",
    });

    expect(summary.errorMessage).toBeNull();
  });

  it("distinguishes a provider rejection after the email was accepted", () => {
    const summary = toPublicDeliveryAttemptSummary({
      id: "attempt-rejected",
      userId: "user-1",
      watchlistId: null,
      digestRunId: "digest-1",
      deliveryTargetId: "target-1",
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "failed",
      webhookStatus: "failed",
      targetValue: "owner@example.com",
      providerMessageId: "provider-message-1",
      providerStatusLastSeenAt: "2026-07-15T04:05:00.000Z",
      templateName: "weekly_digest",
      eventIds: [],
      payloadSnapshot: {},
      idempotencyKey: "digest:digest-1:customer:email:owner@example.com",
      errorMessage: "Provider reconciliation confirmed rejection.",
      sentAt: "2026-07-15T04:00:00.000Z",
      failedAt: "2026-07-15T04:05:00.000Z",
      createdAt: "2026-07-15T04:00:00.000Z",
      updatedAt: "2026-07-15T04:05:00.000Z",
    });

    expect(summary.sentAt).toBe("2026-07-15T04:00:00.000Z");
    expect(summary.errorMessage).toBe(
      "The provider accepted this email, but later reported that delivery failed. Review the recipient address or contact support.",
    );
  });
});
