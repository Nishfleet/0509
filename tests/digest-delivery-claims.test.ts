import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIGEST_PROVIDER_CLAIM_PROTOCOL } from "~/lib/delivery-attempt-lease";

const PERIOD_START = "2026-07-06T05:00:00.000Z";
const PERIOD_END = "2026-07-13T05:00:00.000Z";

function digestInput() {
  return {
    userId: "user-1",
    userName: "Owner",
    accountEmail: "owner@example.com",
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

function deliveryTarget(channel: "slack" | "whatsapp" | "teams") {
  const isWhatsApp = channel === "whatsapp";
  return {
    id: `${channel}-target-1`,
    userId: "user-1",
    watchlistId: null,
    channel,
    targetValue: isWhatsApp ? "+919999999999" : channel === "teams" ? "teams:abc123" : "slack:abc123",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: isWhatsApp
      ? "manual_whatsapp_setup"
      : channel === "teams"
        ? "manual_teams_webhook"
        : "manual_slack_webhook",
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
  channel: "slack" | "whatsapp" | "teams",
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
    provider:
      channel === "slack"
        ? "slack_incoming_webhook"
        : channel === "teams"
          ? "microsoft_teams_incoming_webhook"
          : "whatsapp_cloud_api",
    status,
    webhookStatus: status === "failed" ? "failed" : status === "pending" ? "pending" : "provider_unknown",
    targetValue: target.targetValue,
    providerMessageId: status === "sent" ? "provider-message-1" : null,
    providerStatusLastSeenAt: status === "pending" ? null : "2026-07-13T05:01:00.000Z",
    templateName: channel === "whatsapp" ? "proof_digest_customer_v1" : null,
    eventIds: ["event-1"],
    payloadSnapshot: {
      deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
    },
    idempotencyKey: `digest:digest-1:customer:${channel}:${target.targetValue}`,
    errorMessage: status === "failed" ? "Prior provider rejection." : null,
    sentAt: status === "sent" ? "2026-07-13T05:01:00.000Z" : null,
    failedAt: status === "failed" ? "2026-07-13T05:01:00.000Z" : null,
    createdAt: "2026-07-13T05:01:00.000Z",
    updatedAt: "2026-07-13T05:01:00.000Z",
  };
}

function mockDataServer(input: {
  channel: "slack" | "whatsapp" | "teams";
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
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
      emailVerified: true,
    }),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
      id: "workspace-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
  digestCadencePreference: "plan_default",
      emailEnabled: false,
      whatsappEnabled: input.channel === "whatsapp",
      slackEnabled: input.channel === "slack",
      teamsEnabled: input.channel === "teams",
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

function mockWhatsAppServer(
  sendDigestWhatsApp = vi.fn(),
  errorMessage: string | null = null,
) {
  vi.doMock("~/lib/whatsapp.server", () => ({
    prepareDigestWhatsAppTarget: vi.fn().mockReturnValue({
      templateName: "proof_digest_customer_v1",
      errorMessage,
    }),
    sendDigestWhatsApp,
    sendInstantWhatsApp: vi.fn(),
  }));
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
    isSlackWebhookDeliveryCustomerFacing: () => true,
    isTeamsWebhookDeliveryCustomerFacing: () => true,
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
  vi.doUnmock("~/lib/teams-webhook.server");
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
      prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
        ok: true,
        webhookUrl: "https://hooks.slack.test/1",
      }),
      sendSlackWebhookUrl: sendSlackWebhookMessage,
      sendSlackWebhookMessage,
    }));
    mockWhatsAppServer();

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
        payloadSnapshot: expect.objectContaining({
          deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
        }),
        timestamp: expect.any(String),
      }),
    );
    expect(sendSlackWebhookMessage).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(2);
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      pendingAttempt.id,
      expect.objectContaining({
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        status: "pending",
        webhookStatus: "provider_unknown",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      pendingAttempt.id,
      expect.objectContaining({
        expectedStatus: "pending",
        expectedWebhookStatus: "provider_unknown",
        status: "sent",
      }),
    );
    expect(updateDeliveryAttemptResult.mock.invocationCallOrder[0]).toBeLessThan(
      sendSlackWebhookMessage.mock.invocationCallOrder[0],
    );
  });

  it("claims a fresh Teams attempt before the provider so overlapping workers emit once", async () => {
    const pendingAttempt = deliveryAttempt("teams", "pending");
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
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
      channel: "teams",
      getDeliveryAttemptByIdempotencyKey,
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
    });
    const sendTeamsWebhookUrl = vi.fn().mockResolvedValue({
      provider: "microsoft_teams_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-07-13T05:02:00.000Z",
      errorMessage: null,
      deliveredAt: "2026-07-13T05:02:00.000Z",
    });
    vi.doMock("~/lib/teams-webhook.server", () => ({
      TEAMS_PROVIDER: "microsoft_teams_incoming_webhook",
      prepareTeamsWebhookTarget: vi.fn().mockResolvedValue({
        ok: true,
        webhookUrl: "https://acme.webhook.office.test/webhookb2/redacted",
      }),
      sendTeamsWebhookUrl,
    }));
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: vi.fn(),
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());
    await deliverWeeklyDigest({} as never, digestInput());

    expect(createDeliveryAttempt).toHaveBeenCalledTimes(2);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "teams",
        status: "pending",
        webhookStatus: "pending",
        payloadSnapshot: expect.objectContaining({
          deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
        }),
        timestamp: expect.any(String),
      }),
    );
    expect(sendTeamsWebhookUrl).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(2);
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
    mockWhatsAppServer(sendDigestWhatsApp);
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: vi.fn(),
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
      expect.objectContaining({
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        status: "pending",
        webhookStatus: "provider_unknown",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      failedAttempt.id,
      expect.objectContaining({
        expectedStatus: "pending",
        expectedWebhookStatus: "provider_unknown",
        status: "sent",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      failedAttempt.id,
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
    expect(updateDeliveryAttemptResult.mock.invocationCallOrder[1]).toBeLessThan(
      sendDigestWhatsApp.mock.invocationCallOrder[0],
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
        webhookUrl: "https://hooks.slack.test/1",
      }),
      sendSlackWebhookUrl: sendSlackWebhookMessage,
      sendSlackWebhookMessage,
    }));
    mockWhatsAppServer();

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
        webhookStatus: "provider_unknown",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: "2026-07-13T05:05:00.000Z",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      staleAttempt.id,
      expect.objectContaining({
        status: "sent",
        expectedStatus: "pending",
        expectedWebhookStatus: "provider_unknown",
        expectedUpdatedAt: "2026-07-13T05:05:00.000Z",
      }),
    );
  });

  it("does not reclaim a legacy stale pending digest without pre-dispatch proof", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T05:05:00.000Z"));
    const legacyAttempt = {
      ...deliveryAttempt("slack", "pending"),
      payloadSnapshot: {},
      updatedAt: "2026-07-13T05:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn();
    const { createDeliveryAttempt } = mockDataServer({
      channel: "slack",
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(legacyAttempt),
      updateDeliveryAttemptResult,
    });
    const providerSend = vi.fn();
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: providerSend,
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());

    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("does not resend after provider success when final persistence loses", async () => {
    let current: ReturnType<typeof deliveryAttempt> | null = null;
    const pendingAttempt = deliveryAttempt("slack", "pending");
    const createDeliveryAttempt = vi.fn().mockImplementation(async () => {
      current = pendingAttempt;
      return pendingAttempt.id;
    });
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockImplementation(async () => current);
    const updateDeliveryAttemptResult = vi.fn().mockImplementation(
      async (
        _env: unknown,
        _attemptId: string,
        update: { status: string; webhookStatus: string; updatedAt?: string },
      ) => {
        if (update.status === "pending" && update.webhookStatus === "provider_unknown") {
          current = {
            ...pendingAttempt,
            webhookStatus: "provider_unknown",
            updatedAt: update.updatedAt ?? pendingAttempt.updatedAt,
          };
          return true;
        }
        if (update.status === "sent") {
          return false;
        }
        return true;
      },
    );
    mockDataServer({
      channel: "slack",
      getDeliveryAttemptByIdempotencyKey,
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
    });
    const providerSend = vi.fn().mockResolvedValue({
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
        webhookUrl: "https://hooks.slack.test/1",
      }),
      sendSlackWebhookUrl: providerSend,
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());
    await deliverWeeklyDigest({} as never, digestInput());

    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(current).toMatchObject({ status: "pending", webhookStatus: "provider_unknown" });
    expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider after losing the dispatch-mark CAS", async () => {
    const pendingAttempt = deliveryAttempt("slack", "pending");
    const providerUnknownAttempt = {
      ...pendingAttempt,
      webhookStatus: "provider_unknown" as const,
    };
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(providerUnknownAttempt);
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(false);
    mockDataServer({
      channel: "slack",
      getDeliveryAttemptByIdempotencyKey,
      createDeliveryAttempt: vi.fn().mockResolvedValue(pendingAttempt.id),
      updateDeliveryAttemptResult,
    });
    const providerSend = vi.fn();
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
        ok: true,
        webhookUrl: "https://hooks.slack.test/1",
      }),
      sendSlackWebhookUrl: providerSend,
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());

    expect(providerSend).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
  });

  it("finalizes Slack preparation failures before crossing the provider boundary", async () => {
    const pendingAttempt = deliveryAttempt("slack", "pending");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockDataServer({
      channel: "slack",
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      createDeliveryAttempt: vi.fn().mockResolvedValue(pendingAttempt.id),
      updateDeliveryAttemptResult,
    });
    const providerSend = vi.fn();
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
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
      }),
      sendSlackWebhookUrl: providerSend,
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());

    expect(providerSend).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      pendingAttempt.id,
      expect.objectContaining({
        status: "failed",
        webhookStatus: "failed",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: expect.any(String),
      }),
    );
  });

  it("finalizes WhatsApp readiness failures before crossing the provider boundary", async () => {
    const pendingAttempt = deliveryAttempt("whatsapp", "pending");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockDataServer({
      channel: "whatsapp",
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      createDeliveryAttempt: vi.fn().mockResolvedValue(pendingAttempt.id),
      updateDeliveryAttemptResult,
    });
    const providerSend = vi.fn();
    mockWhatsAppServer(providerSend, "WhatsApp provider is not configured.");
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());

    expect(providerSend).not.toHaveBeenCalled();
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

  it("does not reclaim a failed provider-unknown digest attempt", async () => {
    const providerUnknownAttempt = {
      ...deliveryAttempt("slack", "failed"),
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
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: vi.fn(),
      sendSlackWebhookMessage,
    }));
    mockWhatsAppServer();

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest({} as never, digestInput());

    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
    expect(sendSlackWebhookMessage).not.toHaveBeenCalled();
  });
});
