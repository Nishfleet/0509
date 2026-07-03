import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let emailSend = vi.fn();

const emailEnv = {
  get EMAIL() {
    return { send: emailSend };
  },
  EMAIL_FROM_EMAIL: "alerts@0509.io",
};

function mockEmailSend(messageId = "msg_1") {
  emailSend = vi.fn().mockResolvedValue({ messageId });
  return emailSend;
}

function emailSendPayload(sendMock: ReturnType<typeof vi.fn>) {
  return sendMock.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.resetModules();
  emailSend = vi.fn();
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("deliverWeeklyDigest", () => {
  it("auto-provisions the account email target and records the email attempt", async () => {
    const sendMock = mockEmailSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const updateDeliveryAttemptResult = vi.fn();
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
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
      {
        ...emailEnv,
        APP_ORIGIN: "https://app.0509.test/",
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
      } as never,
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
            metadata: {
              priorityScore: 90,
              priorityBand: "High priority",
              recommendedAction: "Today: review the offer shift.",
              proofTrail: "Verified from a page snapshot",
              sourceStatus: "proof_backed",
              proofCaptureId: "proof-1",
              confirmedAt: "2026-04-19T00:00:00.000Z",
            },
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
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(emailSendPayload(sendMock)).toMatchObject({
      from: "alerts@0509.io",
      to: "owner@example.com",
      subject: "1 competitor move worth seeing: boAt watch",
      html: expect.stringContaining("Five to Nine weekly digest"),
      text: expect.stringContaining("Top moves:"),
      headers: expect.objectContaining({
        "X-0509-Tag": "weekly-digest",
        "List-Unsubscribe": expect.stringContaining(
          "https://app.0509.test/unsubscribe?u=user-1&t=email-target-1&sig=",
        ),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    });
    expect(emailSendPayload(sendMock).html).toContain("Unsubscribe");
    expect(emailSendPayload(sendMock).html).toContain("Verified evidence");
    expect(emailSendPayload(sendMock).text).toContain(
      "View full digest: https://app.0509.test/app/digests?digest=digest-1",
    );
    expect(emailSendPayload(sendMock).text).toContain("Manage frequency: https://app.0509.test/app/notifications");
    expect(emailSendPayload(sendMock).text).toContain("Unsubscribe: https://app.0509.test/unsubscribe");
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        lane: "customer",
        digestRunId: "digest-1",
        targetValue: "owner@example.com",
        eventIds: ["event-1"],
        status: "pending",
        sentAt: null,
        payloadSnapshot: expect.objectContaining({
          subject: "1 competitor move worth seeing: boAt watch",
        }),
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-1",
      expect.objectContaining({
        status: "sent",
        providerMessageId: "msg_1",
        sentAt: expect.any(String),
        errorMessage: null,
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "sent",
        recipientEmail: "owner@example.com",
        deliveredAt: null,
      }),
    );
    expect(upsertDeliveryTarget).toHaveBeenCalledTimes(2);
    expect(upsertDeliveryTarget).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        targetValue: "owner@example.com",
        lastSuccessfulAttemptId: "attempt-1",
        lastSuccessfulDeliveryAt: expect.any(String),
      }),
    );
  });

  it("records a failed email attempt when the email send rejects", async () => {
    emailSend = vi.fn().mockRejectedValue(new Error("network timeout"));
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const updateDeliveryAttemptResult = vi.fn();
    const upsertDigestDelivery = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
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
      emailEnv as never,
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
          errorMessage: "Cloudflare Email send failed: network timeout.",
        },
      ],
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        status: "pending",
        errorMessage: null,
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-1",
      expect.objectContaining({
        status: "failed",
        errorMessage: "Cloudflare Email send failed: network timeout.",
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "failed",
        recipientEmail: "owner@example.com",
        errorMessage: "Cloudflare Email send failed: network timeout.",
      }),
    );
  });

  it("records a pending email attempt when the email send stalls", async () => {
    vi.useFakeTimers();
    emailSend = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const updateDeliveryAttemptResult = vi.fn();
    const upsertDigestDelivery = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
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

    const resultPromise = deliverWeeklyDigest(emailEnv as never, {
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

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "pending",
          targetValue: "owner@example.com",
          errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
        },
      ],
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        status: "pending",
        webhookStatus: "provider_unknown",
        errorMessage: null,
        failedAt: null,
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-1",
      expect.objectContaining({
        status: "pending",
        errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
        failedAt: null,
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "pending",
        recipientEmail: "owner@example.com",
        errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
      }),
    );
  });

  it("keeps email as the baseline when customer WhatsApp fails readiness checks", async () => {
    const sendMock = mockEmailSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const updateDeliveryAttemptResult = vi.fn();
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
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
      emailEnv as never,
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
    expect(sendDigestWhatsApp).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        status: "pending",
        errorMessage: null,
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-1",
      expect.objectContaining({
        status: "sent",
        providerMessageId: "msg_1",
        errorMessage: null,
      }),
    );
  });

  it("does not send digests to pending WhatsApp setup targets", async () => {
    const sendMock = mockEmailSend("msg_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const updateDeliveryAttemptResult = vi.fn();
    const sendDigestWhatsApp = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
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
    const result = await deliverWeeklyDigest(emailEnv as never, {
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
    expect(sendMock).toHaveBeenCalledTimes(1);
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      emailEnv as never,
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
      attempts: 0,
      channels: [],
      details: [],
    });
    expect(sendSlackWebhookMessage).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(upsertDigestDelivery).not.toHaveBeenCalled();
  });

  it("reuses an existing idempotent email attempt instead of sending twice", async () => {
    const sendMock = mockEmailSend("msg_1");
    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      emailEnv as never,
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
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("re-sends a digest email when the prior attempt failed, updating the existing attempt", async () => {
    const sendMock = mockEmailSend("msg_retry_1");
    const createDeliveryAttempt = vi.fn();
    const updateDeliveryAttemptResult = vi.fn();
    const upsertDigestDelivery = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "attempt-failed-1",
        userId: "user-1",
        watchlistId: null,
        digestRunId: "digest-1",
        deliveryTargetId: "email-target-1",
        lane: "customer",
        channel: "email",
        provider: "cloudflare_email",
        status: "failed",
        webhookStatus: "failed",
        targetValue: "owner@example.com",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-06-10T04:00:00.000Z",
        templateName: null,
        eventIds: ["event-1"],
        payloadSnapshot: {},
        idempotencyKey: "digest:digest-1:customer:email:owner@example.com",
        errorMessage: "Cloudflare Email send failed: network timeout.",
        sentAt: null,
        failedAt: "2026-06-10T04:00:00.000Z",
        createdAt: "2026-06-10T04:00:00.000Z",
        updatedAt: "2026-06-10T04:00:00.000Z",
      }),
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
      upsertDeliveryTarget: vi.fn().mockResolvedValue(null),
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, {
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
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
        },
      ],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-failed-1",
      expect.objectContaining({
        status: "sent",
        providerMessageId: "msg_retry_1",
        errorMessage: null,
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("does not retry provider-timeout pending digest email attempts", async () => {
    const sendMock = mockEmailSend("msg_retry_pending_1");
    const createDeliveryAttempt = vi.fn();
    const updateDeliveryAttemptResult = vi.fn();
    const upsertDigestDelivery = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "attempt-pending-1",
        userId: "user-1",
        watchlistId: null,
        digestRunId: "digest-1",
        deliveryTargetId: "email-target-1",
        lane: "customer",
        channel: "email",
        provider: "cloudflare_email",
        status: "pending",
        webhookStatus: "provider_unknown",
        targetValue: "owner@example.com",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-06-10T04:00:00.000Z",
        templateName: null,
        eventIds: ["event-1"],
        payloadSnapshot: {},
        idempotencyKey: "digest:digest-1:customer:email:owner@example.com",
        errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
        sentAt: null,
        failedAt: null,
        createdAt: "2026-06-10T04:00:00.000Z",
        updatedAt: "2026-06-10T04:00:00.000Z",
      }),
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
      upsertDeliveryTarget: vi.fn().mockResolvedValue(null),
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, {
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
      details: [{ channel: "email", status: "pending", targetValue: "owner@example.com" }],
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("skips opted-out email targets and never re-provisions the account email", async () => {
    const sendMock = mockEmailSend("msg_1");
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt: vi.fn(),
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
          isOptedIn: false,
          optInSource: "account_email",
          optedInAt: "2026-04-19T00:00:00.000Z",
          isPaused: true,
          pausedAt: "2026-05-01T00:00:00.000Z",
          optedOutAt: "2026-05-01T00:00:00.000Z",
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: null,
          metadata: {},
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ]),
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, {
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
      attempts: 0,
      channels: [],
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});

describe("deliverWatchlistAlerts", () => {
  it("sends instant alerts for confirmed watch events that clear delivery policy", async () => {
    const sendMock = mockEmailSend("msg_instant_1");
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        ...emailEnv,
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
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
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(emailSendPayload(sendMock)).toMatchObject({
      from: "alerts@0509.io",
      to: "owner@example.com",
      subject: "Landing page URL changed: Nykaa",
      html: expect.stringContaining("Five to Nine alert"),
      headers: expect.objectContaining({
        "X-0509-Tag": "instant-alert",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    });
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "email",
        lane: "customer",
        watchlistId: "watch-1",
        targetValue: "owner@example.com",
        eventIds: ["event-1"],
        providerStatusLastSeenAt: expect.any(String),
        sentAt: expect.any(String),
      }),
    );
    // The referenced ad had no captured creative, so no image is embedded.
    expect(String(emailSendPayload(sendMock).html)).not.toContain("<img");
  });

  it("does not send instant alerts to dormant Slack or WhatsApp targets", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-hidden-channel");
    const sendInstantWhatsApp = vi.fn();
    const sendSlackWebhookMessage = vi.fn();
    const listDeliveryTargets = vi.fn().mockImplementation(async (_env, _userId, options) => {
      if (options?.channel === "whatsapp") {
        return [whatsappTarget()];
      }
      if (options?.channel === "slack") {
        return [
          {
            id: "slack-target-1",
            userId: "user-1",
            watchlistId: null,
            channel: "slack",
            targetValue: "slack:[redacted]",
            validationStatus: "validated",
            isValidated: true,
            isOptedIn: true,
            optInSource: "slack_webhook",
            optedInAt: "2026-04-19T00:00:00.000Z",
            isPaused: false,
            pausedAt: null,
            optedOutAt: null,
            templateEligible: true,
            lastSuccessfulDeliveryAt: null,
            lastSuccessfulAttemptId: null,
            providerIdentifier: "slack-webhook:secret",
            metadata: {
              encryptedWebhookUrl: "https://hooks.slack.com/services/T/B/C",
            },
            createdAt: "2026-04-19T00:00:00.000Z",
            updatedAt: "2026-04-19T00:00:00.000Z",
          },
        ];
      }
      return [];
    });

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: false,
        whatsappEnabled: true,
        slackEnabled: true,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets,
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp,
    }));
    vi.doMock("~/lib/slack.server", () => ({
      sendSlackWebhookMessage,
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      {
        ...emailEnv,
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
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
      attempts: 0,
      channels: [],
    });
    expect(listDeliveryTargets).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ channel: "whatsapp" }),
    );
    expect(listDeliveryTargets).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ channel: "slack" }),
    );
    expect(sendInstantWhatsApp).not.toHaveBeenCalled();
    expect(sendSlackWebhookMessage).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it("embeds the primary event's creative image when the referenced ad has one captured", async () => {
    const sendMock = mockEmailSend("msg_instant_creative");
    const listAdsByIds = vi.fn().mockResolvedValue([
      {
        metaAdId: "meta-1",
        advertiser: "Nykaa",
        creativeImageUrl: "https://cdn.example.com/creative-1.jpg?sig=\"x\"&v=1",
      },
    ]);

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds,
      createDeliveryAttempt: vi.fn().mockResolvedValue("attempt-instant-creative"),
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
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      {
        ...emailEnv,
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
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
            eventType: "ad_new",
            status: "confirmed",
            importanceScore: 90,
            adId: "meta-1",
            baselineFromRunId: null,
            candidateId: "candidate-1",
            proofCaptureId: "proof-1",
            title: "New ad detected",
            summary: "Nykaa launched a new ad.",
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
    expect(listAdsByIds).toHaveBeenCalledTimes(1);
    expect(listAdsByIds).toHaveBeenCalledWith(expect.anything(), ["meta-1"]);
    const html = String(emailSendPayload(sendMock).html);
    expect(html).toContain(
      '<img src="https://cdn.example.com/creative-1.jpg?sig=&quot;x&quot;&amp;v=1" alt="Ad creative" width="280"',
    );
    expect(html).toContain("max-width: 280px; border-radius: 8px; border: 1px solid #e4e7ec; margin: 12px 0;");
  });

  it("sends after quiet hours when the earlier deferral used the same alert batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T18:30:00.000Z"));

    const sendMock = mockEmailSend("msg_after_quiet_hours");
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        ...emailEnv,
        BETTER_AUTH_URL: "https://0509.io",
      } as never,
      input,
    );

    vi.setSystemTime(new Date("2026-04-18T06:30:00.000Z"));
    const result = await deliverWatchlistAlerts(
      {
        ...emailEnv,
        BETTER_AUTH_URL: "https://0509.io",
      } as never,
      input,
    );

    expect(result).toEqual({
      attempts: 1,
      channels: ["email"],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      listAdsByIds: vi.fn().mockResolvedValue([]),
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

describe("instant alert failed-send retry", () => {
  it("retries a failed instant email in place instead of treating it as a duplicate", async () => {
    const sendMock = mockEmailSend("msg_instant_retry");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-new");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(undefined);
    const failedAttempt = {
      id: "attempt-failed-1",
      userId: "user-1",
      watchlistId: "watch-1",
      digestRunId: null,
      deliveryTargetId: "email-target-1",
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "failed",
      webhookStatus: "failed",
      targetValue: "owner@example.com",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: null,
      eventIds: ["event-1"],
      payloadSnapshot: {},
      idempotencyKey: "ignored",
      errorMessage: "smtp down",
      sentAt: null,
      failedAt: "2026-06-11T04:00:00.000Z",
      createdAt: "2026-06-11T04:00:00.000Z",
      updatedAt: "2026-06-11T04:00:00.000Z",
    };

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey: vi.fn(async (_env: unknown, key: string) =>
        key.endsWith(":send") ? failedAttempt : null,
      ),
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
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      {
        ...emailEnv,
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
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
            metadata: { advertiser: "Nykaa" },
            confirmedAt: "2026-04-19T00:00:00.000Z",
            suppressedAt: null,
            invalidatedAt: null,
            lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        ],
      } as never,
    );

    expect(result.attempts).toBe(1);
    // the alert was re-sent and the failed attempt row updated in place
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-failed-1",
      expect.objectContaining({ status: "sent" }),
    );
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
  });
});

describe("alert email content quality", () => {
  it("renders the before/now diff and evidence link in single-event instant emails", async () => {
    const sendMock = mockEmailSend("msg_diff_1");
    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt: vi.fn().mockResolvedValue("attempt-1"),
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
      updateDeliveryAttemptResult: vi.fn(),
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
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));

    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
    await deliverWatchlistAlerts(
      {
        ...emailEnv,
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
      } as never,
      {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        watchlist: { id: "watch-1", userId: "user-1", name: "Nykaa watch" },
        events: [
          {
            id: "event-1",
            watchlistId: "watch-1",
            runId: "run-1",
            eventType: "landing_page_headline_changed",
            status: "confirmed",
            importanceScore: 90,
            adId: "meta-1",
            baselineFromRunId: null,
            candidateId: "candidate-1",
            proofCaptureId: "proof-1",
            title: "Landing page headline changed",
            summary: "The landing-page headline changed.",
            metadata: {
              advertiser: "Nykaa",
              from: "Glow Serum Sale",
              to: "Glow Serum Weekend Sale",
            },
            confirmedAt: "2026-04-19T00:00:00.000Z",
            suppressedAt: null,
            invalidatedAt: null,
            lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
            createdAt: "2026-04-19T00:00:00.000Z",
          },
        ],
      } as never,
    );

    const payload = emailSendPayload(sendMock);
    expect(payload.html).toContain("Before");
    expect(payload.html).toContain("Glow Serum Sale");
    expect(payload.html).toContain("Glow Serum Weekend Sale");
    expect(payload.html).toContain("See the evidence");
  });
});
