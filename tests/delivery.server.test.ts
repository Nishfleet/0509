import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postmarkEnv = {
  POSTMARK_SERVER_TOKEN: "pm_123",
  POSTMARK_FROM_EMAIL: "alerts@0509.in",
};

function mockPostmarkSend(messageId = "msg_1") {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: messageId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function postmarkRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function expectPostmarkEmailRequest(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.postmarkapp.com/email",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "X-Postmark-Server-Token": "pm_123",
      }),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("deliverWeeklyDigest", () => {
  it("auto-provisions the account email target and records the email attempt", async () => {
    const postmarkFetch = mockPostmarkSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const upsertDigestDelivery = vi.fn();
    const upsertDeliveryTarget = vi.fn().mockResolvedValue({
      id: "email-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: "2026-04-19T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    });

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      upsertDeliveryTarget,
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    const result = await deliverWeeklyDigest(
      postmarkEnv as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        periodStart: "2026-04-12T00:00:00.000Z",
        periodEnd: "2026-04-19T00:00:00.000Z",
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
      },
    );

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
        },
      ],
    });
    expectPostmarkEmailRequest(postmarkFetch);
    expect(postmarkRequestBody(postmarkFetch)).toMatchObject({
      From: "alerts@0509.in",
      To: "owner@example.com",
      Subject: "Five to Nine weekly digest: 1 competitor changes",
      HtmlBody: expect.stringContaining("Five to Nine weekly digest"),
      MessageStream: "outbound",
      Tag: "weekly-digest",
      Metadata: {
        kind: "weekly_digest",
        item_count: "1",
        cadence: "weekly",
      },
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        lane: "customer",
        digestRunId: "digest-1",
        targetValue: "owner@example.com",
        eventIds: ["event-1"],
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "sent",
        recipientEmail: "owner@example.com",
      }),
    );
  });

  it("records a failed email attempt when Postmark network send rejects", async () => {
    const postmarkFetch = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.stubGlobal("fetch", postmarkFetch);
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const upsertDigestDelivery = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([
        {
          id: "email-target-1",
          userId: "user-1",
          watchlistId: null,
          channel: "email",
          targetValue: "owner@example.com",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: true,
          optInSource: "account_email",
          optedInAt: "2026-04-19T00:00:00.000Z",
          isPaused: false,
          pausedAt: null,
          optedOutAt: null,
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
        },
      ]),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    const result = await deliverWeeklyDigest(
      postmarkEnv as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        periodStart: "2026-04-12T00:00:00.000Z",
        periodEnd: "2026-04-19T00:00:00.000Z",
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
      },
    );

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "failed",
          targetValue: "owner@example.com",
          errorMessage: "Postmark send failed: network timeout.",
        },
      ],
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        status: "failed",
        errorMessage: "Postmark send failed: network timeout.",
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "failed",
        recipientEmail: "owner@example.com",
        errorMessage: "Postmark send failed: network timeout.",
      }),
    );
  });

  it("keeps email as the baseline when customer WhatsApp fails readiness checks", async () => {
    const postmarkFetch = mockPostmarkSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const upsertDeliveryTarget = vi.fn().mockResolvedValue({
      id: "email-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: "2026-04-19T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    });
    const sendDigestWhatsApp = vi.fn().mockResolvedValue({
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: "proof_digest_customer_v1",
      errorMessage: "Customer WhatsApp delivery is not ready yet.",
    });

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: true,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(async (_env: unknown, _userId: string, options?: { channel?: string }) => {
        if (options?.channel === "whatsapp") {
          return [
            {
              id: "wa-target-1",
              userId: "user-1",
              watchlistId: null,
              channel: "whatsapp",
              targetValue: "+919999999999",
              validationStatus: "validated",
              isValidated: true,
              isOptedIn: true,
              optInSource: "manual_import",
              optedInAt: "2026-04-19T00:00:00.000Z",
              isPaused: false,
              pausedAt: null,
              optedOutAt: null,
              templateEligible: true,
              lastSuccessfulDeliveryAt: null,
              lastSuccessfulAttemptId: null,
              providerIdentifier: "wa_1",
              metadata: {},
              createdAt: "2026-04-19T00:00:00.000Z",
              updatedAt: "2026-04-19T00:00:00.000Z",
            },
          ];
        }

        return [];
      }),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp,
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    const result = await deliverWeeklyDigest(
      postmarkEnv as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        periodStart: "2026-04-12T00:00:00.000Z",
        periodEnd: "2026-04-19T00:00:00.000Z",
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
      },
    );

    expect(result).toMatchObject({
      attempts: 2,
      channels: ["email", "whatsapp"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
        },
        {
          channel: "whatsapp",
          status: "failed",
          targetValue: "+919999999999",
        },
      ],
    });
    expect(postmarkFetch).toHaveBeenCalledTimes(1);
    expect(sendDigestWhatsApp).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "whatsapp",
        status: "failed",
        errorMessage: "Customer WhatsApp delivery is not ready yet.",
      }),
    );
  });

  it("does not send digests to pending WhatsApp setup targets", async () => {
    const postmarkFetch = mockPostmarkSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const sendDigestWhatsApp = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: true,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(async (_env: unknown, _userId: string, options?: { channel?: string }) => {
        if (options?.channel === "whatsapp") {
          return [
            {
              id: "wa-target-1",
              userId: "user-1",
              watchlistId: null,
              channel: "whatsapp",
              targetValue: "919999999999",
              validationStatus: "pending",
              isValidated: false,
              isOptedIn: true,
              optInSource: "manual_whatsapp_setup",
              optedInAt: "2026-04-19T00:00:00.000Z",
              isPaused: false,
              pausedAt: null,
              optedOutAt: null,
              templateEligible: false,
              lastSuccessfulDeliveryAt: null,
              lastSuccessfulAttemptId: null,
              providerIdentifier: "wa_1",
              metadata: {},
              createdAt: "2026-04-19T00:00:00.000Z",
              updatedAt: "2026-04-19T00:00:00.000Z",
            },
          ];
        }

        return [];
      }),
      upsertDeliveryTarget: vi.fn().mockResolvedValue({
        id: "email-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "account_email",
        optedInAt: "2026-04-19T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: false,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: null,
        metadata: {},
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp,
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(postmarkEnv as never, {
      userId: "user-1",
      userName: "Owner",
      accountEmail: "owner@example.com",
      digestRunId: "digest-1",
      periodStart: "2026-04-12T00:00:00.000Z",
      periodEnd: "2026-04-19T00:00:00.000Z",
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
    });

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
    });
    expect(postmarkFetch).toHaveBeenCalledTimes(1);
    expect(sendDigestWhatsApp).not.toHaveBeenCalled();
  });

  it("sends weekly digests to configured Slack webhooks and records the attempt", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-slack-1");
    const upsertDigestDelivery = vi.fn();
    const sendSlackWebhookMessage = vi.fn().mockResolvedValue({
      provider: "slack_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-04-19T00:00:00.000Z",
      errorMessage: null,
      deliveredAt: "2026-04-19T00:00:00.000Z",
    });

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: false,
        whatsappEnabled: false,
        slackEnabled: true,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([
        {
          id: "slack-target-1",
          userId: "user-1",
          watchlistId: null,
          channel: "slack",
          targetValue: "slack:abc123",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: true,
          optInSource: "manual_slack_webhook",
          optedInAt: "2026-04-19T00:00:00.000Z",
          isPaused: false,
          pausedAt: null,
          optedOutAt: null,
          templateEligible: true,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: "abc123",
          metadata: {
            displayName: "Growth alerts",
          },
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
        },
      ]),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      sendSlackWebhookMessage,
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    const result = await deliverWeeklyDigest(
      postmarkEnv as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: null,
        digestRunId: "digest-1",
        periodStart: "2026-04-12T00:00:00.000Z",
        periodEnd: "2026-04-19T00:00:00.000Z",
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
      },
    );

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["slack"],
      details: [
        {
          channel: "slack",
          status: "sent",
          targetValue: "slack:abc123",
        },
      ],
    });
    expect(sendSlackWebhookMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "slack",
        targetValue: "slack:abc123",
      }),
      {
        text: expect.stringContaining("Five to Nine weekly digest"),
      },
    );
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "slack",
        provider: "slack_incoming_webhook",
        status: "sent",
        webhookStatus: "delivered",
        digestRunId: "digest-1",
        targetValue: "slack:abc123",
        eventIds: ["event-1"],
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        provider: "slack_incoming_webhook",
        status: "sent",
        recipientEmail: "slack:abc123",
        externalMessageId: null,
        errorMessage: null,
        deliveredAt: "2026-04-19T00:00:00.000Z",
      }),
    );
  });

  it("reuses an existing idempotent email attempt instead of sending twice", async () => {
    const postmarkFetch = vi.fn();
    vi.stubGlobal("fetch", postmarkFetch);
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi
        .fn()
        .mockResolvedValueOnce({
          id: "attempt-1",
          userId: "user-1",
          watchlistId: null,
          digestRunId: "digest-1",
          deliveryTargetId: "email-target-1",
          lane: "customer",
          channel: "email",
          provider: "postmark",
          status: "sent",
          webhookStatus: "pending",
          targetValue: "owner@example.com",
          providerMessageId: "msg_1",
          providerStatusLastSeenAt: "2026-04-19T00:00:00.000Z",
          templateName: null,
          eventIds: ["event-1"],
          payloadSnapshot: {},
          idempotencyKey: "digest:digest-1:customer:email:owner@example.com",
          errorMessage: null,
          sentAt: "2026-04-19T00:00:00.000Z",
          failedAt: null,
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
        })
        .mockResolvedValueOnce(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([
        {
          id: "email-target-1",
          userId: "user-1",
          watchlistId: null,
          channel: "email",
          targetValue: "owner@example.com",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: true,
          optInSource: "account_email",
          optedInAt: "2026-04-19T00:00:00.000Z",
          isPaused: false,
          pausedAt: null,
          optedOutAt: null,
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
        },
      ]),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    const result = await deliverWeeklyDigest(
      postmarkEnv as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        periodStart: "2026-04-12T00:00:00.000Z",
        periodEnd: "2026-04-19T00:00:00.000Z",
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
      },
    );

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
        },
      ],
    });
    expect(postmarkFetch).not.toHaveBeenCalled();
  });
});

describe("deliverWatchlistAlerts", () => {
  it("sends instant alerts for confirmed watch events that clear delivery policy", async () => {
    const postmarkFetch = mockPostmarkSend("msg_instant_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-instant-1");
    const upsertDeliveryTarget = vi.fn().mockResolvedValue({
      id: "email-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: "2026-04-19T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    });

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      {
        ...postmarkEnv,
        BETTER_AUTH_URL: "https://0509.in",
      } as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        watchlist: {
          id: "watch-1",
          userId: "user-1",
          name: "Nykaa watch",
        },
        events: [
          {
            id: "event-1",
            watchlistId: "watch-1",
            runId: "run-1",
            eventType: "landing_page_url_changed",
            status: "confirmed",
            importanceScore: 90,
            adId: "meta-1",
            baselineFromRunId: null,
            candidateId: "candidate-1",
            proofCaptureId: "proof-1",
            title: "Landing page URL changed",
            summary: "The landing page URL changed.",
            metadata: {
              advertiser: "Nykaa",
            },
            confirmedAt: "2026-04-19T00:00:00.000Z",
            suppressedAt: null,
            invalidatedAt: null,
            lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        ],
      },
    );

    expect(result).toEqual({
      attempts: 1,
      channels: ["email"],
    });
    expectPostmarkEmailRequest(postmarkFetch);
    expect(postmarkRequestBody(postmarkFetch)).toMatchObject({
      From: "alerts@0509.in",
      To: "owner@example.com",
      Subject: "Landing page URL changed: Nykaa",
      HtmlBody: expect.stringContaining("Five to Nine alert"),
      MessageStream: "outbound",
      Tag: "instant-alert",
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        lane: "customer",
        watchlistId: "watch-1",
        targetValue: "owner@example.com",
        eventIds: ["event-1"],
      }),
    );
  });

  it("sends after quiet hours when the earlier deferral used the same alert batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T18:30:00.000Z"));

    const postmarkFetch = mockPostmarkSend("msg_after_quiet_hours");
    const attemptsByKey = new Map<string, { status: string; idempotencyKey: string }>();
    const createDeliveryAttempt = vi.fn().mockImplementation(async (_env, attempt) => {
      attemptsByKey.set(attempt.idempotencyKey, {
        status: attempt.status,
        idempotencyKey: attempt.idempotencyKey,
      });
      return `attempt-${attemptsByKey.size}`;
    });
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
      .mockImplementation(async (_env, key: string) => {
        const attempt = attemptsByKey.get(key);
        if (!attempt) {
          return null;
        }

        return {
          id: attempt.idempotencyKey,
          userId: "user-1",
          watchlistId: "watch-1",
          digestRunId: null,
          deliveryTargetId: "email-target-1",
          lane: "customer",
          channel: "email",
          provider: "postmark",
          status: attempt.status,
          webhookStatus: "provider_unknown",
          targetValue: "owner@example.com",
          providerMessageId: null,
          providerStatusLastSeenAt: null,
          templateName: null,
          eventIds: ["event-1"],
          payloadSnapshot: {},
          idempotencyKey: attempt.idempotencyKey,
          errorMessage: null,
          sentAt: null,
          failedAt: null,
          createdAt: "2026-04-18T18:30:00.000Z",
          updatedAt: "2026-04-18T18:30:00.000Z",
        };
      });
    const upsertDeliveryTarget = vi.fn().mockResolvedValue({
      id: "email-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: "2026-04-19T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    });

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey,
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: {
          startHour: 22,
          endHour: 8,
        },
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
    const input = {
      userId: "user-1",
      userName: "Owner",
      accountEmail: "owner@example.com",
      watchlist: {
        id: "watch-1",
        userId: "user-1",
        name: "Nykaa watch",
      },
      events: [
        {
          id: "event-1",
          watchlistId: "watch-1",
          runId: "run-1",
          eventType: "landing_page_url_changed" as const,
          status: "confirmed" as const,
          importanceScore: 90,
          adId: "meta-1",
          baselineFromRunId: null,
          candidateId: "candidate-1",
          proofCaptureId: "proof-1",
          title: "Landing page URL changed",
          summary: "The landing page URL changed.",
          metadata: {
            advertiser: "Nykaa",
          },
          confirmedAt: "2026-04-19T00:00:00.000Z",
          suppressedAt: null,
          invalidatedAt: null,
          lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
          createdAt: "2026-04-19T00:00:00.000Z",
        },
      ],
    };

    await deliverWatchlistAlerts(
      {
        ...postmarkEnv,
        BETTER_AUTH_URL: "https://0509.in",
      } as never,
      input,
    );

    vi.setSystemTime(new Date("2026-04-18T06:30:00.000Z"));
    const result = await deliverWatchlistAlerts(
      {
        ...postmarkEnv,
        BETTER_AUTH_URL: "https://0509.in",
      } as never,
      input,
    );

    expect(result).toEqual({
      attempts: 1,
      channels: ["email"],
    });
    expect(postmarkFetch).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "skipped_due_to_quiet_hours",
        idempotencyKey: expect.stringMatching(/:quiet-hours$/),
      }),
    );
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "sent",
        idempotencyKey: expect.stringMatching(/:send$/),
      }),
    );
  });
});

describe("reconcileDeliveryStatus", () => {
  it("marks a WhatsApp setup target validated after delivered webhook proof", async () => {
    const attempt = {
      id: "attempt-setup-1",
      userId: "user-1",
      watchlistId: null,
      digestRunId: null,
      deliveryTargetId: "whatsapp-target-1",
      lane: "customer",
      channel: "whatsapp",
      provider: "whatsapp_cloud_api",
      status: "sent",
      webhookStatus: "delivered",
      targetValue: "919876543210",
      providerMessageId: "wamid.setup-1",
      providerStatusLastSeenAt: "2026-06-07T00:00:00.000Z",
      templateName: "proof_digest_customer_v1",
      eventIds: [],
      payloadSnapshot: {
        kind: "whatsapp_setup_validation",
      },
      idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:wamid.setup-1",
      errorMessage: null,
      sentAt: "2026-06-07T00:00:00.000Z",
      failedAt: null,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
      getDeliveryTargetById: vi.fn().mockResolvedValue(whatsappTarget()),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn().mockResolvedValue(attempt),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
    const result = await reconcileDeliveryStatus({} as never, {
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.setup-1",
      webhookStatus: "delivered",
      status: "sent",
      rawProviderStatus: "delivered",
      providerStatusLastSeenAt: "2026-06-07T00:00:00.000Z",
    });

    expect(result).toEqual(attempt);
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        channel: "whatsapp",
        targetValue: "919876543210",
        validationStatus: "validated",
        isValidated: true,
        templateEligible: true,
        lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-setup-1",
        providerIdentifier: "wamid.setup-1",
        metadata: expect.objectContaining({
          validationAttemptId: "attempt-setup-1",
          validationWebhookStatus: "delivered",
        }),
      }),
    );
  });

  it("marks a WhatsApp setup target invalid after failed webhook proof without clearing old success proof", async () => {
    const attempt = {
      id: "attempt-setup-2",
      userId: "user-1",
      watchlistId: null,
      digestRunId: null,
      deliveryTargetId: "whatsapp-target-1",
      lane: "customer",
      channel: "whatsapp",
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "failed",
      targetValue: "919876543210",
      providerMessageId: "wamid.setup-2",
      providerStatusLastSeenAt: "2026-06-07T01:00:00.000Z",
      templateName: "proof_digest_customer_v1",
      eventIds: [],
      payloadSnapshot: {
        kind: "whatsapp_setup_validation",
      },
      idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:wamid.setup-2",
      errorMessage: "Recipient blocked delivery.",
      sentAt: null,
      failedAt: "2026-06-07T01:00:00.000Z",
      createdAt: "2026-06-07T01:00:00.000Z",
      updatedAt: "2026-06-07T01:00:00.000Z",
    };
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
      getDeliveryTargetById: vi.fn().mockResolvedValue(
        whatsappTarget({
          validationStatus: "validated",
          isValidated: true,
          templateEligible: true,
          lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
          lastSuccessfulAttemptId: "attempt-existing",
          metadata: {
            displayName: "Founder phone",
            validationProviderMessageId: "wamid.setup-2",
          },
        }),
      ),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn().mockResolvedValue(attempt),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
    await reconcileDeliveryStatus({} as never, {
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.setup-2",
      webhookStatus: "failed",
      status: "failed",
      rawProviderStatus: "failed",
      providerStatusLastSeenAt: "2026-06-07T01:00:00.000Z",
      errorMessage: "Recipient blocked delivery.",
    });

    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationStatus: "invalid",
        isValidated: false,
        templateEligible: false,
        lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-existing",
        metadata: expect.objectContaining({
          validationWebhookStatus: "failed",
          validationErrorMessage: "Recipient blocked delivery.",
        }),
      }),
    );
  });

  it("does not validate WhatsApp setup targets from Meta sent-only status", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
      getDeliveryTargetById: vi.fn().mockResolvedValue(whatsappTarget()),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn().mockResolvedValue({
        id: "attempt-setup-3",
        userId: "user-1",
        watchlistId: null,
        digestRunId: null,
        deliveryTargetId: "whatsapp-target-1",
        lane: "customer",
        channel: "whatsapp",
        provider: "whatsapp_cloud_api",
        status: "sent",
        webhookStatus: "delivered",
        targetValue: "919876543210",
        providerMessageId: "wamid.setup-1",
        providerStatusLastSeenAt: "2026-06-07T02:00:00.000Z",
        templateName: "proof_digest_customer_v1",
        eventIds: [],
        payloadSnapshot: {
          kind: "whatsapp_setup_validation",
        },
        idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:wamid.setup-1",
        errorMessage: null,
        sentAt: "2026-06-07T02:00:00.000Z",
        failedAt: null,
        createdAt: "2026-06-07T02:00:00.000Z",
        updatedAt: "2026-06-07T02:00:00.000Z",
      }),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
    await reconcileDeliveryStatus({} as never, {
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.setup-1",
      webhookStatus: "delivered",
      status: "sent",
      rawProviderStatus: "sent",
      providerStatusLastSeenAt: "2026-06-07T02:00:00.000Z",
    });

    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("ignores stale WhatsApp setup webhooks from older validation attempts", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
      getDeliveryTargetById: vi.fn().mockResolvedValue(
        whatsappTarget({
          metadata: {
            displayName: "Founder phone",
            validationProviderMessageId: "wamid.setup-new",
          },
        }),
      ),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn().mockResolvedValue({
        id: "attempt-setup-old",
        userId: "user-1",
        watchlistId: null,
        digestRunId: null,
        deliveryTargetId: "whatsapp-target-1",
        lane: "customer",
        channel: "whatsapp",
        provider: "whatsapp_cloud_api",
        status: "failed",
        webhookStatus: "failed",
        targetValue: "919876543210",
        providerMessageId: "wamid.setup-old",
        providerStatusLastSeenAt: "2026-06-07T03:00:00.000Z",
        templateName: "proof_digest_customer_v1",
        eventIds: [],
        payloadSnapshot: {
          kind: "whatsapp_setup_validation",
        },
        idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:wamid.setup-old",
        errorMessage: "Old setup failed.",
        sentAt: null,
        failedAt: "2026-06-07T03:00:00.000Z",
        createdAt: "2026-06-07T03:00:00.000Z",
        updatedAt: "2026-06-07T03:00:00.000Z",
      }),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
    await reconcileDeliveryStatus({} as never, {
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.setup-old",
      webhookStatus: "failed",
      status: "failed",
      rawProviderStatus: "failed",
      providerStatusLastSeenAt: "2026-06-07T03:00:00.000Z",
      errorMessage: "Old setup failed.",
    });

    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("validates WhatsApp setup targets by provider id when the attempt is not found yet", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn(),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn().mockResolvedValue(whatsappTarget()),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn(),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn().mockResolvedValue(null),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
    const result = await reconcileDeliveryStatus({} as never, {
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.setup-1",
      webhookStatus: "delivered",
      status: "sent",
      rawProviderStatus: "delivered",
      providerStatusLastSeenAt: "2026-06-07T04:00:00.000Z",
    });

    expect(result).toBeNull();
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationStatus: "validated",
        isValidated: true,
        templateEligible: true,
        lastSuccessfulDeliveryAt: "2026-06-07T04:00:00.000Z",
        providerIdentifier: "wamid.setup-1",
        metadata: expect.objectContaining({
          validationWebhookStatus: "delivered",
          validationReconciledWithoutAttempt: true,
        }),
      }),
    );
  });
});

function whatsappTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: "whatsapp-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "whatsapp",
    targetValue: "919876543210",
    validationStatus: "pending",
    isValidated: false,
    isOptedIn: true,
    optInSource: "manual_whatsapp_setup",
    optedInAt: "2026-06-07T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: false,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: "wamid.setup-1",
    metadata: {
      displayName: "Founder phone",
      validationProviderMessageId: "wamid.setup-1",
    },
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}
