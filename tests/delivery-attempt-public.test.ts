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
});
