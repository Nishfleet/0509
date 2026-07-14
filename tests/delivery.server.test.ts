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
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/plan.server");
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
      from: { email: "alerts@0509.io", name: "Five to Nine" },
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
        webhookStatus: "pending",
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
      from: { email: "alerts@0509.io", name: "Five to Nine" },
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

describe("billing lifecycle emails", () => {
  const scheduledCutoff = new Date(Date.UTC(2026, 7, 13, 9)).toISOString();
  const scheduledWatermark = new Date(Date.UTC(2026, 6, 13, 9)).toISOString();
  const currentBillingInfo = {
    plan: "starter" as const,
    dodoStatus: "active",
    dodoPaymentId: "payment-current",
    dodoProductId: "product-current",
    dodoPlanChangeProductId: null,
    billingInterval: "monthly" as const,
    dodoSubscriptionId: "subscription-current",
    dodoCustomerId: "customer-current",
    dodoNextBillingAt: scheduledCutoff,
    planUpdatedAt: scheduledWatermark,
  };
  const refundBillingInfo = { ...currentBillingInfo, plan: "free" as const, dodoStatus: "refunded" };
  const paymentIssueBillingInfo = { ...currentBillingInfo, dodoStatus: "payment.failed" };
  const accessEndedBillingInfo = { ...currentBillingInfo, plan: "free" as const, dodoStatus: "subscription.expired" };
  let defaultBillingInfo: typeof currentBillingInfo | typeof refundBillingInfo | typeof accessEndedBillingInfo = currentBillingInfo;
  const currentBillingStateFingerprint = JSON.stringify(currentBillingInfo);

  function billingPayload<T extends Record<string, unknown>>(templateName: string, overrides: T) {
    return {
      kind: templateName,
      subject: "Billing lifecycle update",
      bodyHtml: "<p>Billing lifecycle update.</p>",
      tag: "billing-lifecycle",
      billingStateFingerprint: currentBillingStateFingerprint,
      ...overrides,
    };
  }

  function billingAttempt<T extends Record<string, unknown>>(overrides: T) {
    return {
      id: "attempt-billing",
      userId: "user-1",
      provider: "cloudflare_email",
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null as string | null,
      providerStatusLastSeenAt: null as string | null,
      targetValue: "owner@example.com",
      templateName: "billing_refund_revoked",
      errorMessage: null as string | null,
      sentAt: null as string | null,
      failedAt: null as string | null,
      updatedAt: "2026-07-13T09:03:00.000Z",
      ...overrides,
    };
  }

  function recoveryAttempt(id: string, templateName = "billing_refund_revoked", payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
    return billingAttempt({
      id,
      templateName,
      payloadSnapshot: billingPayload(templateName, payloadOverrides) as Record<string, unknown>,
      ...attemptOverrides,
    });
  }

  function scheduledRecoveryAttempt(id: string, eventId: string, payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
    return recoveryAttempt(id, "billing_cancellation_scheduled", {
      scheduledCancellationCutoff: scheduledCutoff,
      scheduledCancellationEventId: eventId,
      scheduledCancellationSubscriptionId: "subscription-current",
      scheduledCancellationStateUpdatedAt: scheduledWatermark,
      ...payloadOverrides,
    }, attemptOverrides);
  }

  function refundRecoveryAttempt(id: string, payloadOverrides: Record<string, unknown> = {}, attemptOverrides: Record<string, unknown> = {}) {
    return recoveryAttempt(id, "billing_refund_revoked", {
      refundPaymentId: currentBillingInfo.dodoPaymentId,
      refundStateUpdatedAt: currentBillingInfo.planUpdatedAt,
      ...payloadOverrides,
    }, attemptOverrides);
  }

  function mutationRecoveryAttempt(id: string, templateName: string, status: string, subscriptionId: string | undefined = "subscription-current", stateUpdatedAt: string | undefined = scheduledWatermark) {
    return recoveryAttempt(id, templateName, {
      billingMutationStatus: status,
      billingMutationSubscriptionId: subscriptionId,
      billingMutationStateUpdatedAt: stateUpdatedAt,
      billingStateFingerprint: null,
      outboxPendingDispatch: true,
    });
  }

  function useRecoveryClock(at = "2026-07-13T09:05:00.000Z") {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
  }

  type Delivery = typeof import("~/lib/delivery.server");
  type PaymentInput = Parameters<Delivery["sendBillingPaymentIssueEmail"]>[1];
  type RefundInput = Parameters<Delivery["sendBillingRefundEmail"]>[1];
  type CancellationInput = Parameters<Delivery["sendBillingCancellationEmail"]>[1];
  const recipient = { userId: "user-1", email: "owner@example.com", name: "Owner" };

  async function sendPaymentIssue(overrides: Partial<PaymentInput> = {}) {
    defaultBillingInfo = paymentIssueBillingInfo;
    const delivery = await import("~/lib/delivery.server");
    return delivery.sendBillingPaymentIssueEmail(emailEnv as never, {
      ...recipient, status: "payment.failed", subscriptionId: "subscription-current",
      stateUpdatedAt: scheduledWatermark,
      ...overrides,
    });
  }

  async function sendRefund(overrides: Partial<RefundInput> & Pick<RefundInput, "eventId">) {
    defaultBillingInfo = refundBillingInfo;
    const delivery = await import("~/lib/delivery.server");
    return delivery.sendBillingRefundEmail(emailEnv as never, {
      ...recipient, paymentId: "payment-current", stateUpdatedAt: scheduledWatermark, ...overrides,
    });
  }

  async function sendCancellation(input: Omit<CancellationInput, "userId" | "email" | "name"> & Partial<Pick<CancellationInput, "userId" | "email" | "name">>) {
    if (input.kind === "ended") defaultBillingInfo = accessEndedBillingInfo;
    const delivery = await import("~/lib/delivery.server");
    return delivery.sendBillingCancellationEmail(emailEnv as never, {
      ...recipient,
      ...(input.kind === "ended" ? {
        status: "subscription.expired", subscriptionId: "subscription-current",
        stateUpdatedAt: scheduledWatermark,
      } : {}),
      ...input,
    });
  }

  function sendScheduledCancellation(eventId: string, overrides: Partial<CancellationInput> = {}) {
    return sendCancellation({ name: "Owner", kind: "scheduled", effectiveAt: scheduledCutoff, eventId, ...overrides });
  }

  async function recoverBilling(env = { ...emailEnv, DB: {} } as never) {
    const delivery = await import("~/lib/delivery.server");
    return delivery.recoverAbandonedBillingLifecycleEmails(env);
  }

  function mockBillingDataServer(overrides: Record<string, unknown> = {}) {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const getDeliveryAttemptByIdempotencyKey = vi.fn().mockResolvedValue(null);
    const listStaleBillingLifecycleEmailAttempts = vi.fn().mockResolvedValue([]);
    const updateDeliveryAttemptResult = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey,
      listStaleBillingLifecycleEmailAttempts,
      updateDeliveryAttemptResult,
      getUserDeliveryProfile: vi.fn().mockResolvedValue({ email: "owner@example.com", emailVerified: true, name: "Owner" }),
      getUserPlanBillingInfo: vi.fn(async () => defaultBillingInfo),
      ...overrides,
    }));
    return {
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey,
      listStaleBillingLifecycleEmailAttempts,
      updateDeliveryAttemptResult,
    };
  }

  function mockRecoveryAttempt(attempt: unknown, overrides: Record<string, unknown> = {}) {
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([attempt]),
      updateDeliveryAttemptResult,
      ...overrides,
    });
    return updateDeliveryAttemptResult;
  }

  function trackAttemptUpdates(attempt: ReturnType<typeof recoveryAttempt>) {
    return vi.fn(async (_env: unknown, _attemptId: string, input: Record<string, unknown>) => {
      if (input.expectedStatus && attempt.status !== input.expectedStatus) return false;
      if (input.expectedWebhookStatus && attempt.webhookStatus !== input.expectedWebhookStatus) return false;
      if (input.expectedUpdatedAt && attempt.updatedAt !== input.expectedUpdatedAt) return false;
      attempt.provider = String(input.provider);
      attempt.status = String(input.status);
      attempt.webhookStatus = String(input.webhookStatus);
      attempt.providerMessageId = (input.providerMessageId as string | null) ?? null;
      attempt.providerStatusLastSeenAt = (input.providerStatusLastSeenAt as string | null) ?? null;
      attempt.errorMessage = (input.errorMessage as string | null) ?? null;
      attempt.sentAt = (input.sentAt as string | null) ?? null;
      attempt.failedAt = (input.failedAt as string | null) ?? null;
      if (input.payloadSnapshot) attempt.payloadSnapshot = input.payloadSnapshot as Record<string, unknown>;
      attempt.targetValue = String(input.targetValue ?? attempt.targetValue);
      attempt.updatedAt = String(input.updatedAt ?? new Date().toISOString());
      return true;
    });
  }

  afterEach(() => {
    defaultBillingInfo = currentBillingInfo;
    vi.doUnmock("~/lib/data.server");
  });

  it("persists scheduled-cancellation cutoff and event watermark in the outbox payload", async () => {
    mockBillingDataServer();
    const { prepareBillingLifecycleEmailOutbox } = await import("~/lib/delivery.server");

    const outbox = prepareBillingLifecycleEmailOutbox(emailEnv as never, {
      kind: "cancellation_scheduled",
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      effectiveAt: scheduledCutoff,
      eventId: "evt-scheduled-identity",
      subscriptionId: "subscription-current",
      stateUpdatedAt: scheduledWatermark,
    });

    expect(outbox.payloadSnapshot).toMatchObject({
      scheduledCancellationCutoff: scheduledCutoff,
      scheduledCancellationEventId: "evt-scheduled-identity",
      scheduledCancellationSubscriptionId: "subscription-current",
      scheduledCancellationStateUpdatedAt: scheduledWatermark,
    });
  });

  it("sends the dunning email with a day-coarse deterministic idempotency key and no unsubscribe header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(scheduledWatermark));
    const sendMock = mockEmailSend("msg_billing_1");
    const mocks = mockBillingDataServer();


    const sent = await sendPaymentIssue({ name: "Owner <script>", });

    expect(sent).toBe(true);
    const payload = emailSendPayload(sendMock);
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toBe("Action needed: a Five to Nine payment didn't go through");
    expect(payload.html).toContain("your plan stays active while the payment processor retries");
    expect(payload.html).toContain("https://0509.io/app/billing");
    expect(payload.html).toContain("Hi Owner &lt;script&gt;,");
    expect(payload.html).not.toContain("<script>");
    expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
    expect(payload.html).not.toContain("Unsubscribe");

    const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.lane).toBe("customer");
    expect(attempt.channel).toBe("email");
    expect(attempt.templateName).toBe("billing_payment_issue");
    expect(attempt.idempotencyKey).toBe("billing-payment-issue:user-1:2026-07-13");
    expect(attempt.status).toBe("pending");
    expect(attempt.webhookStatus).toBe("pending");
    expect(attempt.timestamp).toBe(scheduledWatermark);
    expect(attempt.payloadSnapshot).toEqual(
      expect.objectContaining({
        kind: "billing_payment_issue",
        subject: "Action needed: a Five to Nine payment didn't go through",
        bodyHtml: expect.stringContaining("your plan stays active"),
        tag: "billing-payment-issue",
        billingStateFingerprint: JSON.stringify(paymentIssueBillingInfo),
      }),
    );
  });

  it("short-circuits a duplicate dunning send on the same day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T18:00:00.000Z"));
    const sendMock = mockEmailSend();
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi
        .fn()
        .mockResolvedValue({ id: "attempt-existing", status: "sent" }),
    });


    const sent = await sendPaymentIssue({ name: "Owner", });

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it("retries in place when a prior dunning attempt exists but did not send", async () => {
    const sendMock = mockEmailSend("msg_retry_1");
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi
        .fn()
        .mockResolvedValue({ id: "attempt-failed", status: "failed" }),
    });


    const sent = await sendPaymentIssue({ name: null, });

    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
    expect(mocks.updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "attempt-failed",
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
    expect(mocks.updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "attempt-failed",
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("atomically reclaims a failed dunning attempt so concurrent retries emit once", async () => {
    const sendMock = mockEmailSend("msg_failed_retry_once");
    const updateDeliveryAttemptResult = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "attempt-failed",
        provider: "cloudflare_email",
        status: "failed",
        webhookStatus: "failed",
        providerMessageId: null,
      }),
      updateDeliveryAttemptResult,
    });


    const input = {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
    };
    const results = await Promise.all([
      sendPaymentIssue(input),
      sendPaymentIssue(input),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "attempt-failed",
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "attempt-failed",
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
  });

  it("claims the dunning idempotency key before sending so concurrent handlers emit once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(scheduledWatermark));
    const sendMock = mockEmailSend("msg_concurrent_1");
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "attempt-claimed", status: "pending" });
    const createDeliveryAttempt = vi
      .fn()
      .mockResolvedValueOnce("attempt-claimed")
      .mockRejectedValueOnce(new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key"));
    mockBillingDataServer({ createDeliveryAttempt, getDeliveryAttemptByIdempotencyKey });


    const results = await Promise.all([
      sendPaymentIssue({ name: "Owner", }),
      sendPaymentIssue({ name: "Owner", }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledTimes(2);
  });

  it("does not resend a billing email while a provider-timeout outcome is unknown", async () => {
    const sendMock = mockEmailSend("msg_should_not_send");
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "attempt-pending",
        provider: "cloudflare_email",
        status: "pending",
        webhookStatus: "provider_unknown",
      }),
    });


    const sent = await sendRefund({ name: null,
    eventId: "evt-refund-pending", });

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
    expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
  });

  it("reclaims a stale billing pre-dispatch lease and sends once", async () => {
    useRecoveryClock();
    const sendMock = mockEmailSend("msg_stale_billing");
    const staleAttempt = billingAttempt({
      id: "attempt-stale",
    });
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(staleAttempt),
      updateDeliveryAttemptResult,
    });


    const sent = await sendRefund({ name: null,
    eventId: "evt-stale-refund", });

    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
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
        updatedAt: "2026-07-13T09:05:00.000Z",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      staleAttempt.id,
      expect.objectContaining({
        status: "sent",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: "2026-07-13T09:05:00.000Z",
      }),
    );
  });

  it("claims a freshly-enqueued outbox row and dispatches it immediately", async () => {
    useRecoveryClock();
    const sendMock = mockEmailSend("msg_outbox_dispatch");
    const outboxAttempt = refundRecoveryAttempt(
      "attempt-outbox",
      {
        bodyHtml: "<p>Your workspace moved to Free.</p>",
        billingStateFingerprint: null,
        outboxPendingDispatch: true,
      },
      { updatedAt: "2026-07-13T09:04:59.000Z" },
    );
    const refundedBillingInfo = {
      ...currentBillingInfo,
      plan: "free" as const,
      dodoStatus: "refunded",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(outboxAttempt),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue(refundedBillingInfo),
      updateDeliveryAttemptResult,
    });


    const sent = await sendRefund({ name: null,
    eventId: "evt-outbox-refund", });

    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      outboxAttempt.id,
      expect.objectContaining({
        status: "pending",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: outboxAttempt.updatedAt,
        targetValue: "owner@example.com",
        payloadSnapshot: expect.objectContaining({
          billingStateFingerprint: JSON.stringify(refundedBillingInfo),
        }),
      }),
    );
  });

  it.each([
    ["direct refund A after refund B", false, "payment-new", "2026-07-14T09:00:00.000Z", "payment-current", scheduledWatermark],
    ["failed direct refund A after refund B", true, "payment-new", "2026-07-14T09:00:00.000Z", "payment-current", scheduledWatermark],
    ["missing payment identity", false, "payment-current", scheduledWatermark, "", scheduledWatermark],
    ["missing mutation watermark", false, "payment-current", scheduledWatermark, "payment-current", ""],
  ])("blocks %s at the final provider gate", async (_label, failed, currentPayment, currentAt, paymentId, stateUpdatedAt) => {
    const sendMock = mockEmailSend("msg_stale_refund_must_not_send");
    const duplicate = failed ? refundRecoveryAttempt("attempt-failed-refund-a", {}, {
      status: "failed", webhookStatus: "failed",
    }) : null;
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(duplicate),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...refundBillingInfo, dodoPaymentId: currentPayment, planUpdatedAt: currentAt,
      }),
    });

    await expect(sendRefund({ eventId: "evt-refund-a", paymentId, stateUpdatedAt })).resolves.toBe(false);

    expect(sendMock).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["payment issue", "billing_payment_issue", "payment.failed", "starter", false, null],
    ["failed payment issue", "billing_payment_issue", "payment.failed", "starter", true, null],
    ["access ended", "billing_access_ended", "subscription.expired", "free", false, null],
    ["failed access ended", "billing_access_ended", "subscription.expired", "free", true, null],
    ["payment issue missing identity", "billing_payment_issue", "payment.failed", "starter", false, "identity"],
    ["failed access ended missing watermark", "billing_access_ended", "subscription.expired", "free", true, "watermark"],
  ] as const)("blocks stale direct %s A after state B", async (_label, templateName, status, plan, failed, missing) => {
    const sendMock = mockEmailSend("msg_stale_mutation_must_not_send");
    const duplicate = failed
      ? missing ? recoveryAttempt("attempt-failed-a", templateName, {})
        : mutationRecoveryAttempt("attempt-failed-a", templateName, status, "subscription-a", scheduledWatermark)
      : null;
    if (duplicate) Object.assign(duplicate, { status: "failed", webhookStatus: "failed" });
    const currentSubscription = missing ? "subscription-a" : "subscription-b";
    const currentAt = missing ? scheduledWatermark : "2026-07-14T09:00:00.000Z";
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(duplicate),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo, plan, dodoStatus: status,
        dodoSubscriptionId: currentSubscription, planUpdatedAt: currentAt,
      }),
    });
    const sent = templateName === "billing_payment_issue"
      ? sendPaymentIssue({ status, subscriptionId: missing === "identity" ? null : "subscription-a", stateUpdatedAt: scheduledWatermark })
      : sendCancellation({ kind: "ended", eventId: "evt-ended-a", status, subscriptionId: "subscription-a", stateUpdatedAt: missing === "watermark" ? null : scheduledWatermark });

    await expect(sent).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it("recovers only the exact refund identity and watermark", async () => {
    useRecoveryClock();
    const sendMock = mockEmailSend("msg_refund_identity");
    const refundBAt = "2026-07-14T09:00:00.000Z";
    const attempts = [
      ["exact-b", "payment-new", refundBAt],
      ["stale-a", "payment-current", scheduledWatermark],
      ["missing-payment", undefined, refundBAt],
      ["missing-watermark", "payment-new", undefined],
    ].map(([id, refundPaymentId, refundStateUpdatedAt]) => refundRecoveryAttempt(`attempt-${id}`, {
      billingStateFingerprint: null, outboxPendingDispatch: true, refundPaymentId, refundStateUpdatedAt,
    }));
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue(attempts),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo, plan: "free", dodoStatus: "refunded",
        dodoPaymentId: "payment-new", planUpdatedAt: refundBAt,
      }),
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
    });

    const result = await recoverBilling();

    expect(result).toMatchObject({ scanned: 4, claimed: 4, sent: 1, superseded: 3 });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "passed cutoff", currentPlan: "starter" as const, currentCutoff: "2026-07-13T09:04:00.000Z", currentStateUpdatedAt: scheduledWatermark, expectedSent: false },
    { label: "non-paid effective plan", currentPlan: "free" as const, currentCutoff: scheduledCutoff, currentStateUpdatedAt: scheduledWatermark, expectedSent: false },
    { label: "later cancellation date", currentPlan: "starter" as const, currentCutoff: "2026-09-13T09:00:00.000Z", currentStateUpdatedAt: "2026-07-14T09:00:00.000Z", expectedSent: false },
    { label: "matching future cancellation", currentPlan: "starter" as const, currentCutoff: scheduledCutoff, currentStateUpdatedAt: scheduledWatermark, expectedSent: true },
  ])(
    "validates a batch-enqueued scheduled cancellation with $label before live dispatch",
    async ({ currentPlan, currentCutoff, currentStateUpdatedAt, expectedSent }) => {
      useRecoveryClock();
      const sendMock = mockEmailSend("msg_scheduled_identity");
      const outboxAttempt = scheduledRecoveryAttempt(
        "attempt-scheduled-identity",
        "evt-scheduled-identity",
        {
          bodyHtml: "<p>Your paid plan remains active until the cutoff.</p>",
          billingStateFingerprint: null,
          outboxPendingDispatch: true,
        },
        { updatedAt: "2026-07-13T09:04:59.000Z" },
      );
      const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
      mockBillingDataServer({
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(outboxAttempt),
        getUserPlanBillingInfo: vi.fn().mockResolvedValue({
          ...currentBillingInfo,
          plan: currentPlan,
          dodoStatus: "cancellation_scheduled",
          dodoNextBillingAt: currentCutoff,
          planUpdatedAt: currentStateUpdatedAt,
        }),
        updateDeliveryAttemptResult,
      });


      const sent = await sendScheduledCancellation("evt-scheduled-identity");

      expect(sent).toBe(expectedSent);
      expect(sendMock).toHaveBeenCalledTimes(expectedSent ? 1 : 0);
      if (!expectedSent) {
        expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
        expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
          expect.anything(),
          outboxAttempt.id,
          expect.objectContaining({
            status: "skipped_due_to_dedupe",
            webhookStatus: "provider_unknown",
            expectedUpdatedAt: outboxAttempt.updatedAt,
          }),
        );
        expect(updateDeliveryAttemptResult.mock.calls[0]?.[2]).not.toHaveProperty(
          "payloadSnapshot",
        );
      } else {
        expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
          1,
          expect.anything(),
          outboxAttempt.id,
          expect.objectContaining({
            payloadSnapshot: expect.objectContaining({
              scheduledCancellationCutoff: scheduledCutoff,
              scheduledCancellationEventId: "evt-scheduled-identity",
              scheduledCancellationSubscriptionId: "subscription-current",
              scheduledCancellationStateUpdatedAt: scheduledWatermark,
            }),
          }),
        );
      }
    },
  );

  it("does not revive a failed older scheduled cancellation after a later date wins", async () => {
    useRecoveryClock();
    const sendMock = mockEmailSend("msg_old_scheduled_retry_must_not_send");
    const failedAttempt = scheduledRecoveryAttempt(
      "attempt-old-scheduled-failed",
      "evt-old-scheduled",
      {
        billingStateFingerprint: currentBillingStateFingerprint,
      },
      {
        status: "failed",
        webhookStatus: "failed",
        updatedAt: "2026-07-13T09:04:00.000Z",
      },
    );
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(failedAttempt),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo,
        dodoStatus: "cancellation_scheduled",
        dodoNextBillingAt: "2026-09-13T09:00:00.000Z",
        planUpdatedAt: "2026-07-14T09:00:00.000Z",
      }),
      updateDeliveryAttemptResult,
    });


    const sent = await sendScheduledCancellation("evt-old-scheduled");

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      failedAttempt.id,
      expect.objectContaining({
        status: "skipped_due_to_dedupe",
        webhookStatus: "provider_unknown",
        expectedStatus: "failed",
        expectedWebhookStatus: "failed",
        expectedUpdatedAt: failedAttempt.updatedAt,
      }),
    );
  });

  it.each([
    { label: "replaced state", currentCutoff: "2026-09-13T09:00:00.000Z", currentStateUpdatedAt: "2026-07-14T09:00:00.000Z", expectedSent: false },
    { label: "matching current state", currentCutoff: scheduledCutoff, currentStateUpdatedAt: scheduledWatermark, expectedSent: true },
  ])(
    "validates a no-outbox scheduled-cancellation fallback against $label",
    async ({ currentCutoff, currentStateUpdatedAt, expectedSent }) => {
      useRecoveryClock();
      const sendMock = mockEmailSend("msg_no_outbox_scheduled");
      const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-no-outbox");
      mockBillingDataServer({
        createDeliveryAttempt,
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
        getUserPlanBillingInfo: vi.fn().mockResolvedValue({
          ...currentBillingInfo,
          dodoStatus: "cancellation_scheduled",
          dodoNextBillingAt: currentCutoff,
          planUpdatedAt: currentStateUpdatedAt,
        }),
      });


      const sent = await sendScheduledCancellation("evt-no-outbox", {
        subscriptionId: "subscription-current",
        stateUpdatedAt: scheduledWatermark,
      });

      expect(sent).toBe(expectedSent);
      expect(sendMock).toHaveBeenCalledTimes(expectedSent ? 1 : 0);
      expect(createDeliveryAttempt).toHaveBeenCalledTimes(expectedSent ? 1 : 0);
      if (expectedSent) {
        expect(createDeliveryAttempt).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            payloadSnapshot: expect.objectContaining({
              scheduledCancellationCutoff: scheduledCutoff,
              scheduledCancellationEventId: "evt-no-outbox",
              scheduledCancellationSubscriptionId: "subscription-current",
              scheduledCancellationStateUpdatedAt: scheduledWatermark,
            }),
          }),
        );
      }
    },
  );

  it("retains scheduled-cancellation identity while retrying an explicit failure", async () => {
    useRecoveryClock();
    const sendMock = mockEmailSend("msg_matching_scheduled_retry");
    const failedAttempt = scheduledRecoveryAttempt(
      "attempt-matching-scheduled-failed",
      "evt-matching-scheduled-retry",
      {
        billingStateFingerprint: currentBillingStateFingerprint,
      },
      {
        status: "failed",
        webhookStatus: "failed",
        updatedAt: "2026-07-13T09:04:00.000Z",
      },
    );
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(failedAttempt),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo,
        dodoStatus: "cancellation_scheduled",
      }),
      updateDeliveryAttemptResult,
    });


    const sent = await sendScheduledCancellation("evt-matching-scheduled-retry", {
      subscriptionId: "subscription-current",
      stateUpdatedAt: scheduledWatermark,
    });

    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      failedAttempt.id,
      expect.objectContaining({
        expectedStatus: "failed",
        payloadSnapshot: expect.objectContaining({
          scheduledCancellationCutoff: scheduledCutoff,
          scheduledCancellationEventId: "evt-matching-scheduled-retry",
          scheduledCancellationSubscriptionId: "subscription-current",
          scheduledCancellationStateUpdatedAt: scheduledWatermark,
        }),
      }),
    );
  });

  it.each([
    ["scheduled cancellation", "billing_cancellation_scheduled"],
    ["access ended", "billing_access_ended"],
    ["refund revoked", "billing_refund_revoked"],
  ] as const)(
    "supersedes a stale batch-enqueued %s email before provider dispatch",
    async (_label, templateName) => {
      useRecoveryClock();
      const sendMock = mockEmailSend("msg_stale_outbox_must_not_send");
      const outboxAttempt = recoveryAttempt(
        `attempt-${templateName}`,
        templateName,
        {
          subject: "Stale billing state",
          bodyHtml: "<p>This message no longer describes the account.</p>",
          tag: "billing-lifecycle",
          billingStateFingerprint: null,
          outboxPendingDispatch: true,
        },
        {
          status: "pending" as string,
          webhookStatus: "pending" as string,
          updatedAt: "2026-07-13T09:04:59.000Z",
        },
      );
      const updateDeliveryAttemptResult = vi.fn(
        async (_env: unknown, _attemptId: string, input: Record<string, unknown>) => {
          outboxAttempt.status = String(input.status);
          outboxAttempt.webhookStatus = String(input.webhookStatus);
          return true;
        },
      );
      mockBillingDataServer({
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(outboxAttempt),
        updateDeliveryAttemptResult,
      });

      const dispatch = () =>
        templateName === "billing_refund_revoked"
          ? sendRefund({ name: "Owner",
          eventId: "evt-stale-outbox", })
          : sendCancellation({ name: "Owner",
          kind:
            templateName === "billing_cancellation_scheduled" ? "scheduled" : "ended",
          eventId: "evt-stale-outbox", });

      await expect(dispatch()).resolves.toBe(false);
      await expect(dispatch()).resolves.toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
      expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(1);
      const supersede = updateDeliveryAttemptResult.mock.calls[0]?.[2];
      expect(supersede).toMatchObject({
        status: "skipped_due_to_dedupe",
        webhookStatus: "provider_unknown",
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: outboxAttempt.updatedAt,
      });
      expect(supersede).not.toHaveProperty("payloadSnapshot");
    },
  );

  it("records the current recipient when retrying a failed attempt in place", async () => {
    useRecoveryClock();
    mockEmailSend("msg_retry_new_target");
    const failedAttempt = billingAttempt({
      id: "attempt-failed-old-target",
      status: "failed",
      webhookStatus: "failed",
      targetValue: "old@example.com",
      updatedAt: "2026-07-13T08:00:00.000Z",
    });
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(failedAttempt),
      updateDeliveryAttemptResult,
    });

    const sent = await sendRefund({
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
        status: "sent",
        expectedUpdatedAt: "2026-07-13T09:05:00.000Z",
      }),
    );
  });

  it("retries one provider-confirmed recovery failure on a later sweep and sends once", async () => {
    useRecoveryClock();
    emailSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider explicitly rejected"))
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
        attempt.providerStatusLastSeenAt !== null &&
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

    expect(firstSweep).toMatchObject({ scanned: 1, claimed: 1, failed: 1, sent: 0 });
    expect(secondSweep).toMatchObject({ scanned: 1, claimed: 1, failed: 0, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(attempt.status).toBe("sent");
    expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(2);
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      attempt.id,
      expect.objectContaining({
        expectedStatus: "failed",
        expectedWebhookStatus: "failed",
        payloadSnapshot: expect.objectContaining({ recoveryAttemptCount: 2 }),
      }),
    );
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
    emailSend = vi.fn(() => new Promise(() => undefined));
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
    };
    const failedAttempt = { ...pendingAttempt, status: "failed", webhookStatus: "failed" };
    const getDeliveryAttemptByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(pendingAttempt)
      .mockResolvedValueOnce(failedAttempt);
    const updateDeliveryAttemptResult = vi.fn();
    mockBillingDataServer({ getDeliveryAttemptByIdempotencyKey, updateDeliveryAttemptResult });

    const { reconcileBillingLifecycleEmailDelivery } = await import("~/lib/delivery.server");
    await expect(
      reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
        idempotencyKey: "billing-refund:user-1:evt-refund-retry",
        outcome: "failed",
        reconciledAt: "2026-07-13T09:05:00.000Z",
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
        status: "failed",
        webhookStatus: "failed",
      }),
    );
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
      expect.objectContaining({ expectedStatus: "pending", status: "sent" }),
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
        reconciledAt: "2026-07-13T09:05:00.000Z",
      }),
      reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
        idempotencyKey: "billing-refund:user-1:evt-reconcile-race",
        outcome: "failed",
        reconciledAt: "2026-07-13T09:05:01.000Z",
      }),
    ]);

    expect([sentResult, failedResult].filter(Boolean)).toHaveLength(1);
    expect(durableStatus).toBe("sent");
    expect(updateDeliveryAttemptResult).toHaveBeenCalledTimes(2);
    for (const call of updateDeliveryAttemptResult.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ expectedStatus: "pending" }));
    }
  });

  it("keeps an in-flight pre-dispatch claim separate from provider-unknown reconciliation", async () => {
    let releaseProvider: ((value: { messageId: string }) => void) | undefined;
    let signalProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    emailSend = vi.fn().mockImplementation(
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
        reconciledAt: "2026-07-13T09:05:00.000Z",
        errorMessage: "Provider evidence confirmed no acceptance.",
      }),
    ).resolves.toBe(false);
    releaseProvider?.({ messageId: "msg_arrived_after_reconcile" });

    await expect(sendResult).resolves.toBe(true);
    expect(durableStatus).toBe("sent");
    expect(durableWebhookStatus).toBe("provider_unknown");
    expect(updateDeliveryAttemptResult).toHaveBeenLastCalledWith(
      expect.anything(),
      "attempt-in-flight",
      expect.objectContaining({
        expectedStatus: "pending",
        expectedWebhookStatus: "pending",
        expectedUpdatedAt: durableUpdatedAt,
        status: "sent",
      }),
    );
  });

  it("sends the scheduled-cancellation email with the active-until date and event-keyed idempotency", async () => {
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
    expect(payload.subject).toBe("Your Five to Nine refund has been processed");
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

  it("turns an explicit rejection into one durable retry without duplicate successful mail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(scheduledWatermark));
    emailSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce({ messageId: "msg_retry_succeeded" });

    let attemptStatus: "missing" | "pending" | "failed" | "sent" = "missing";
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
        webhookStatus: attemptStatus === "failed" ? "failed" : "provider_unknown",
        providerMessageId: null,
      };
    });
    const updateDeliveryAttemptResult = vi.fn(
      async (
        _env: unknown,
        _attemptId: string,
        input: { expectedStatus?: string; status: "pending" | "failed" | "sent" },
      ) => {
        if (input.expectedStatus && attemptStatus !== input.expectedStatus) {
          return false;
        }
        attemptStatus = input.status;
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

    await expect(sendPaymentIssue(input)).rejects.toMatchObject({
      code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE",
      idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
    });
    expect(attemptStatus).toBe("failed");

    vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));
    await expect(sendPaymentIssue(input)).resolves.toBe(true);
    await expect(sendPaymentIssue(input)).resolves.toBe(false);

    expect(attemptStatus).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
      }),
    );
  });

  it.each([
    { startingCount: 2, expectedCronScans: [1, 0], expectedProviderCalls: 2 },
    { startingCount: 3, expectedCronScans: [0, 0], expectedProviderCalls: 1 },
  ])(
    "keeps recovery count $startingCount across live redelivery without reopening cron budget",
    async ({ startingCount, expectedCronScans, expectedProviderCalls }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));
      emailSend = vi.fn().mockRejectedValue(new Error("provider explicitly rejected"));

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

      await expect(
        sendRefund({ name: null,
        eventId: "evt-live-redelivery-budget",
        retryWebhookOnExplicitFailure: true, }),
      ).rejects.toMatchObject({ code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE" });

      const firstCron = await recoverBilling();
      const secondCron = await recoverBilling();

      expect([firstCron.scanned, secondCron.scanned]).toEqual(expectedCronScans);
      expect(emailSend).toHaveBeenCalledTimes(expectedProviderCalls);
      expect(attempt.payloadSnapshot.recoveryAttemptCount).toBe(3);
      const persistedCounts = updateDeliveryAttemptResult.mock.calls
        .map((call) => call[2].payloadSnapshot as Record<string, unknown> | undefined)
        .filter((payload): payload is Record<string, unknown> => Boolean(payload))
        .map((payload) => payload.recoveryAttemptCount);
      expect(persistedCounts).toEqual(startingCount === 2 ? [2, 3] : [3]);
    },
  );

  it.each(["2", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "normalizes invalid live-redelivery recovery count %s to zero",
    async (invalidCount) => {
      const sendMock = mockEmailSend("msg_invalid_count_reclaim");
      const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
      mockBillingDataServer({
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(billingAttempt({
          id: "attempt-invalid-recovery-count",
          status: "failed",
          webhookStatus: "failed",
          providerStatusLastSeenAt: "2026-07-14T08:55:00.000Z",
          payloadSnapshot: { recoveryAttemptCount: invalidCount },
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
          payloadSnapshot: expect.objectContaining({ recoveryAttemptCount: 0 }),
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

  it("records a failed attempt without throwing when the provider rejects a billing send", async () => {
    emailSend = vi.fn().mockRejectedValue(new Error("smtp down"));
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
      expect.objectContaining({ status: "failed", webhookStatus: "failed" }),
    );
  });
});
