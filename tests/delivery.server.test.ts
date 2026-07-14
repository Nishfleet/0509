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
  const currentBillingInfo = {
    plan: "starter" as const,
    dodoStatus: "active",
    dodoPaymentId: "payment-current",
    dodoProductId: "product-current",
    dodoPlanChangeProductId: null,
    billingInterval: "monthly" as const,
    dodoSubscriptionId: "subscription-current",
    dodoCustomerId: "customer-current",
    dodoNextBillingAt: "2026-08-13T09:00:00.000Z",
    planUpdatedAt: "2026-07-13T09:00:00.000Z",
  };
  const currentBillingStateFingerprint = JSON.stringify(currentBillingInfo);

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
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        email: "owner@example.com",
        name: "Owner",
      }),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue(currentBillingInfo),
      getDeliveryTargetById: vi.fn(),
      getDeliveryTargetByProviderIdentifier: vi.fn(),
      getOldestUserId: vi.fn(),
      getUserIdByEmail: vi.fn(),
      getWatchlistDeliveryConfig: vi.fn(),
      getWorkspaceDeliveryConfig: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
      ...overrides,
    }));
    return {
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey,
      listStaleBillingLifecycleEmailAttempts,
      updateDeliveryAttemptResult,
    };
  }

  afterEach(() => {
    vi.doUnmock("~/lib/data.server");
  });

  it("sends the dunning email with a day-coarse deterministic idempotency key and no unsubscribe header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:00:00.000Z"));
    const sendMock = mockEmailSend("msg_billing_1");
    const mocks = mockBillingDataServer();

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingPaymentIssueEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner <script>",
    });

    expect(sent).toBe(true);
    const payload = emailSendPayload(sendMock);
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toBe("Action needed: a Five to Nine payment didn't go through");
    expect(payload.html).toContain("your plan stays active while the payment processor retries");
    expect(payload.html).toContain("https://0509.io/app/billing");
    expect(payload.html).toContain("Hi Owner &lt;script&gt;,");
    expect(payload.html).not.toContain("<script>");
    // transactional: must reach unsubscribed addresses — no unsubscribe header
    expect(payload.headers["List-Unsubscribe"]).toBeUndefined();
    expect(payload.html).not.toContain("Unsubscribe");

    const attempt = mocks.createDeliveryAttempt.mock.calls[0]?.[1];
    expect(attempt.lane).toBe("customer");
    expect(attempt.channel).toBe("email");
    expect(attempt.templateName).toBe("billing_payment_issue");
    expect(attempt.idempotencyKey).toBe("billing-payment-issue:user-1:2026-07-13");
    expect(attempt.status).toBe("pending");
    expect(attempt.webhookStatus).toBe("pending");
    expect(attempt.timestamp).toBe("2026-07-13T09:00:00.000Z");
    expect(attempt.payloadSnapshot).toEqual(
      expect.objectContaining({
        kind: "billing_payment_issue",
        subject: "Action needed: a Five to Nine payment didn't go through",
        bodyHtml: expect.stringContaining("your plan stays active"),
        tag: "billing-payment-issue",
        billingStateFingerprint: currentBillingStateFingerprint,
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

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingPaymentIssueEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
    });

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

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingPaymentIssueEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
    });

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

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const input = {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
    };
    const results = await Promise.all([
      sendBillingPaymentIssueEmail(emailEnv as never, input),
      sendBillingPaymentIssueEmail(emailEnv as never, input),
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
    vi.setSystemTime(new Date("2026-07-13T09:00:00.000Z"));
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

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const results = await Promise.all([
      sendBillingPaymentIssueEmail(emailEnv as never, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      sendBillingPaymentIssueEmail(emailEnv as never, {
        userId: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
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

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-refund-pending",
    });

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
    expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
  });

  it("reclaims a stale billing pre-dispatch lease and sends once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_stale_billing");
    const staleAttempt = {
      id: "attempt-stale",
      provider: "cloudflare_email",
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(staleAttempt),
      updateDeliveryAttemptResult,
    });

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-stale-refund",
    });

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
    // The webhook batch inserted this pending row atomically with the ledger
    // finalize moments ago (NOT stale). The live send path must claim it via
    // compare-and-set instead of backing off — otherwise every lifecycle
    // email would wait for the next recovery cron.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_outbox_dispatch");
    const outboxAttempt = {
      id: "attempt-outbox",
      provider: "cloudflare_email",
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      payloadSnapshot: { outboxPendingDispatch: true },
      updatedAt: "2026-07-13T09:04:59.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(outboxAttempt),
      updateDeliveryAttemptResult,
    });

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-outbox-refund",
    });

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
        // The claim rewrites the payload: marker cleared, post-mutation
        // fingerprint recorded for any later fingerprint-based recovery.
        payloadSnapshot: expect.objectContaining({
          billingStateFingerprint: currentBillingStateFingerprint,
        }),
      }),
    );
  });

  it("records the current recipient when retrying a failed attempt in place", async () => {
    // The account email changed between the failed attempt and this retry.
    // The claim must move target_value to the address actually being sent
    // to, or the ledger and recovery payload keep the stale recipient.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    mockEmailSend("msg_retry_new_target");
    const failedAttempt = {
      id: "attempt-failed-old-target",
      provider: "cloudflare_email",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      targetValue: "old@example.com",
      updatedAt: "2026-07-13T08:00:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(failedAttempt),
      updateDeliveryAttemptResult,
    });

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
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
      }),
    );
  });

  it("recovers a marker outbox row when the billing state still matches its kind", async () => {
    // Crash after the webhook batch, before dispatch: the row has no
    // post-mutation fingerprint (marker instead). Recovery validates by kind
    // against the CURRENT billing state and replays.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_marker_recovered");
    const markerAttempt = {
      id: "attempt-marker",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_payment_issue",
      payloadSnapshot: {
        kind: "billing_payment_issue",
        subject: "Action needed: payment failed",
        bodyHtml: "<p>Please update your payment method.</p>",
        tag: "billing-payment-issue",
        billingStateFingerprint: null,
        outboxPendingDispatch: true,
      },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([markerAttempt]),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo,
        dodoStatus: "payment.failed",
      }),
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const result = await recoverAbandonedBillingLifecycleEmails({
      ...emailEnv,
      DB: {},
    } as never);

    expect(result).toMatchObject({ scanned: 1, claimed: 1, sent: 1, superseded: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    // The recovery claim must clear the outbox marker and record a current
    // fingerprint — a recovery-claimed row that still looks never-dispatched
    // could be seized by a live sibling webhook mid-provider-call (double
    // send).
    const claimCall = updateDeliveryAttemptResult.mock.calls[0]!;
    expect(claimCall[1]).toBe(markerAttempt.id);
    expect(claimCall[2].payloadSnapshot).toBeDefined();
    expect(claimCall[2].payloadSnapshot.outboxPendingDispatch).toBeUndefined();
    expect(typeof claimCall[2].payloadSnapshot.billingStateFingerprint).toBe("string");
  });

  it("supersedes a marker outbox row when the billing state moved past its kind", async () => {
    // Same crash shape, but the customer's payment recovered before the
    // sweep ran — dodoStatus is healthy again, so the dunning email must not
    // send. It finalizes as retryable 'failed', keeping the day slot open.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_marker_superseded");
    const markerAttempt = {
      id: "attempt-marker-superseded",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_payment_issue",
      payloadSnapshot: {
        kind: "billing_payment_issue",
        subject: "Action needed: payment failed",
        bodyHtml: "<p>Please update your payment method.</p>",
        tag: "billing-payment-issue",
        billingStateFingerprint: null,
        outboxPendingDispatch: true,
      },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([markerAttempt]),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo,
        dodoStatus: "active",
      }),
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const result = await recoverAbandonedBillingLifecycleEmails({
      ...emailEnv,
      DB: {},
    } as never);

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

  it("recovers a stale billing outbox row from its durable payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_recovered_billing");
    const staleAttempt = {
      id: "attempt-recovery",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_refund",
      payloadSnapshot: {
        kind: "billing_refund",
        subject: "Your refund has been processed",
        bodyHtml: "<p>Your refund is complete.</p>",
        tag: "billing-refund",
        billingStateFingerprint: currentBillingStateFingerprint,
      },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const listStaleBillingLifecycleEmailAttempts = vi.fn().mockResolvedValue([staleAttempt]);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts,
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const result = await recoverAbandonedBillingLifecycleEmails({
      ...emailEnv,
      DB: {},
    } as never);

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    emailSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider explicitly rejected"))
      .mockResolvedValueOnce({ messageId: "msg_recovery_retry" });

    const attempt = {
      id: "attempt-recovery-two-sweep",
      userId: "user-1",
      provider: "cloudflare_email",
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null as string | null,
      providerStatusLastSeenAt: null as string | null,
      targetValue: "owner@example.com",
      templateName: "billing_refund",
      payloadSnapshot: {
        kind: "billing_refund",
        subject: "Your refund has been processed",
        bodyHtml: "<p>Your refund is complete.</p>",
        tag: "billing-refund",
        billingStateFingerprint: currentBillingStateFingerprint,
      } as Record<string, unknown>,
      errorMessage: null as string | null,
      sentAt: null as string | null,
      failedAt: null as string | null,
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
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
    const updateDeliveryAttemptResult = vi.fn(async (
      _env: unknown,
      _attemptId: string,
      input: Record<string, unknown>,
    ) => {
      if (input.expectedStatus && attempt.status !== input.expectedStatus) return false;
      if (input.expectedWebhookStatus && attempt.webhookStatus !== input.expectedWebhookStatus) {
        return false;
      }
      if (input.expectedUpdatedAt && attempt.updatedAt !== input.expectedUpdatedAt) return false;
      attempt.provider = String(input.provider);
      attempt.status = String(input.status);
      attempt.webhookStatus = String(input.webhookStatus);
      attempt.providerMessageId = (input.providerMessageId as string | null) ?? null;
      attempt.providerStatusLastSeenAt =
        (input.providerStatusLastSeenAt as string | null) ?? null;
      attempt.errorMessage = (input.errorMessage as string | null) ?? null;
      attempt.sentAt = (input.sentAt as string | null) ?? null;
      attempt.failedAt = (input.failedAt as string | null) ?? null;
      if (input.payloadSnapshot) {
        attempt.payloadSnapshot = input.payloadSnapshot as Record<string, unknown>;
      }
      attempt.updatedAt = String(input.updatedAt ?? new Date().toISOString());
      return true;
    });
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts,
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const env = { ...emailEnv, DB: {} } as never;
    const firstSweep = await recoverAbandonedBillingLifecycleEmails(env);
    const secondSweep = await recoverAbandonedBillingLifecycleEmails(env);

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_superseded_must_not_send");
    const staleAttempt = {
      id: "attempt-superseded",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_payment_issue",
      payloadSnapshot: {
        kind: "billing_payment_issue",
        subject: "Action needed: payment failed",
        bodyHtml: "<p>Please update your payment method.</p>",
        tag: "billing-payment-issue",
        billingStateFingerprint: currentBillingStateFingerprint,
      },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([staleAttempt]),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        ...currentBillingInfo,
        dodoStatus: "active_after_recovery",
        planUpdatedAt: "2026-07-13T09:04:00.000Z",
      }),
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const result = await recoverAbandonedBillingLifecycleEmails({
      ...emailEnv,
      DB: {},
    } as never);

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
    // Superseded rows finalize as skipped (an intentional non-send that must
    // not inflate operator failure counts) — but the slot stays claimable:
    // sendBillingLifecycleEmail retries skipped+provider_unknown rows in
    // place, so a later same-day payment.failed webhook can still send.
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
    // The recovery sweep refused to replay stale content and skipped the
    // row; a NEW same-day payment event must still be able to take the
    // day-keyed slot and email content built from the current event.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_superseded_reclaim");
    const supersededAttempt = {
      id: "attempt-superseded-slot",
      provider: "cloudflare_email",
      status: "skipped_due_to_dedupe",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      targetValue: "owner@example.com",
      updatedAt: "2026-07-13T08:30:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const mocks = mockBillingDataServer({
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(supersededAttempt),
      updateDeliveryAttemptResult,
    });

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingPaymentIssueEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      occurredAt: "2026-07-13T09:00:00.000Z",
    });

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    emailSend = vi.fn(() => new Promise(() => undefined));
    const staleAttempt = {
      id: "attempt-recovery-timeout",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_refund",
      payloadSnapshot: {
        kind: "billing_refund",
        subject: "Your refund has been processed",
        bodyHtml: "<p>Your refund is complete.</p>",
        tag: "billing-refund",
        billingStateFingerprint: currentBillingStateFingerprint,
      },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([staleAttempt]),
      updateDeliveryAttemptResult,
    });

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:05:00.000Z"));
    const sendMock = mockEmailSend("msg_should_not_send");
    const staleAttempt = {
      id: "attempt-malformed",
      userId: "user-1",
      targetValue: "owner@example.com",
      templateName: "billing_refund",
      payloadSnapshot: { kind: "billing_refund" },
      updatedAt: "2026-07-13T09:03:00.000Z",
    };
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    mockBillingDataServer({
      listStaleBillingLifecycleEmailAttempts: vi.fn().mockResolvedValue([staleAttempt]),
      updateDeliveryAttemptResult,
    });

    const { recoverAbandonedBillingLifecycleEmails } = await import("~/lib/delivery.server");
    const result = await recoverAbandonedBillingLifecycleEmails({
      ...emailEnv,
      DB: {},
    } as never);

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

    const { reconcileBillingLifecycleEmailDelivery, sendBillingRefundEmail } = await import(
      "~/lib/delivery.server"
    );
    await expect(
      reconcileBillingLifecycleEmailDelivery(emailEnv as never, {
        idempotencyKey: "billing-refund:user-1:evt-refund-retry",
        outcome: "failed",
        reconciledAt: "2026-07-13T09:05:00.000Z",
        errorMessage: "Provider confirmed the timed-out send was not accepted.",
      }),
    ).resolves.toBe(true);

    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-refund-retry",
    });

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

    const { reconcileBillingLifecycleEmailDelivery, sendBillingRefundEmail } = await import(
      "~/lib/delivery.server"
    );
    const sendResult = sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-in-flight-reconcile",
    });
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
    const mocks = mockBillingDataServer();

    const { sendBillingCancellationEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingCancellationEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      kind: "scheduled",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      eventId: "evt-cancel-1",
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

  it("falls back to period-end copy when the scheduled cancellation has no parseable date", async () => {
    const sendMock = mockEmailSend();
    mockBillingDataServer();

    const { sendBillingCancellationEmail } = await import("~/lib/delivery.server");
    await sendBillingCancellationEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      kind: "scheduled",
      effectiveAt: null,
      eventId: "evt-cancel-2",
    });

    const payload = emailSendPayload(sendMock);
    expect(payload.html).toContain("until the end of the period you already paid for");
  });

  it("sends the access-ended email describing the real Free-plan downgrade behavior", async () => {
    const sendMock = mockEmailSend();
    const mocks = mockBillingDataServer();

    const { sendBillingCancellationEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingCancellationEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      kind: "ended",
      eventId: "evt-expired-1",
    });

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

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      eventId: "evt-refund-1",
    });

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
  });

  it("turns an explicit rejection into one durable retry without duplicate successful mail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:00:00.000Z"));
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

    const { sendBillingPaymentIssueEmail } = await import("~/lib/delivery.server");
    const input = {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      occurredAt: "2026-07-01T08:00:00.000Z",
      retryWebhookOnExplicitFailure: true,
    };

    await expect(sendBillingPaymentIssueEmail(emailEnv as never, input)).rejects.toMatchObject({
      code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE",
      idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
    });
    expect(attemptStatus).toBe("failed");

    // Dodo can redeliver on a later date; the provider event time keeps the
    // retry on the same durable attempt instead of creating a second key.
    vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));
    await expect(sendBillingPaymentIssueEmail(emailEnv as never, input)).resolves.toBe(true);
    await expect(sendBillingPaymentIssueEmail(emailEnv as never, input)).resolves.toBe(false);

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

      const attempt = {
        id: "attempt-live-redelivery-budget",
        userId: "user-1",
        provider: "cloudflare_email",
        status: "failed" as "pending" | "failed" | "sent",
        webhookStatus: "failed" as "pending" | "failed" | "provider_unknown",
        providerMessageId: null as string | null,
        providerStatusLastSeenAt: "2026-07-14T08:55:00.000Z" as string | null,
        targetValue: "owner@example.com",
        templateName: "billing_refund_revoked",
        payloadSnapshot: {
          kind: "billing_refund_revoked",
          subject: "Your refund has been processed",
          bodyHtml: "<p>Your refund is complete.</p>",
          tag: "billing-refund",
          billingStateFingerprint: currentBillingStateFingerprint,
          recoveryAttemptCount: startingCount,
        } as Record<string, unknown>,
        errorMessage: "Earlier explicit rejection." as string | null,
        sentAt: null as string | null,
        failedAt: "2026-07-14T08:55:00.000Z" as string | null,
        updatedAt: "2026-07-14T08:55:00.000Z",
      };
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
      const updateDeliveryAttemptResult = vi.fn(async (
        _env: unknown,
        _attemptId: string,
        input: Record<string, unknown>,
      ) => {
        if (input.expectedStatus && attempt.status !== input.expectedStatus) return false;
        if (input.expectedWebhookStatus && attempt.webhookStatus !== input.expectedWebhookStatus) {
          return false;
        }
        if (input.expectedUpdatedAt && attempt.updatedAt !== input.expectedUpdatedAt) return false;
        attempt.provider = String(input.provider);
        attempt.status = String(input.status) as typeof attempt.status;
        attempt.webhookStatus = String(input.webhookStatus) as typeof attempt.webhookStatus;
        attempt.providerMessageId = (input.providerMessageId as string | null) ?? null;
        attempt.providerStatusLastSeenAt =
          (input.providerStatusLastSeenAt as string | null) ?? null;
        attempt.errorMessage = (input.errorMessage as string | null) ?? null;
        attempt.sentAt = (input.sentAt as string | null) ?? null;
        attempt.failedAt = (input.failedAt as string | null) ?? null;
        if (input.payloadSnapshot) {
          attempt.payloadSnapshot = input.payloadSnapshot as Record<string, unknown>;
        }
        attempt.targetValue = String(input.targetValue ?? attempt.targetValue);
        attempt.updatedAt = String(input.updatedAt ?? new Date().toISOString());
        return true;
      });
      mockBillingDataServer({
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(attempt),
        listStaleBillingLifecycleEmailAttempts,
        updateDeliveryAttemptResult,
      });

      const {
        recoverAbandonedBillingLifecycleEmails,
        sendBillingRefundEmail,
      } = await import("~/lib/delivery.server");
      await expect(
        sendBillingRefundEmail(emailEnv as never, {
          userId: "user-1",
          email: "owner@example.com",
          name: null,
          eventId: "evt-live-redelivery-budget",
          retryWebhookOnExplicitFailure: true,
        }),
      ).rejects.toMatchObject({ code: "BILLING_LIFECYCLE_EMAIL_EXPLICIT_FAILURE" });

      const firstCron = await recoverAbandonedBillingLifecycleEmails({
        ...emailEnv,
        DB: {},
      } as never);
      const secondCron = await recoverAbandonedBillingLifecycleEmails({
        ...emailEnv,
        DB: {},
      } as never);

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
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
          id: "attempt-invalid-recovery-count",
          provider: "cloudflare_email",
          status: "failed",
          webhookStatus: "failed",
          providerMessageId: null,
          providerStatusLastSeenAt: "2026-07-14T08:55:00.000Z",
          targetValue: "owner@example.com",
          payloadSnapshot: { recoveryAttemptCount: invalidCount },
        }),
        updateDeliveryAttemptResult,
      });

      const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
      await expect(
        sendBillingRefundEmail(emailEnv as never, {
          userId: "user-1",
          email: "owner@example.com",
          name: null,
          eventId: "evt-invalid-recovery-count",
        }),
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
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue({
          id: "attempt-terminal-or-unknown",
          provider: "cloudflare_email",
          status,
          webhookStatus,
          providerMessageId: status === "sent" ? "msg_existing" : null,
        }),
      });

      const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
      await expect(
        sendBillingRefundEmail(emailEnv as never, {
          userId: "user-1",
          email: "owner@example.com",
          name: null,
          eventId: "evt-suppressed-redelivery",
          retryWebhookOnExplicitFailure: true,
        }),
      ).resolves.toBe(false);

      expect(sendMock).not.toHaveBeenCalled();
      expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
      expect(mocks.updateDeliveryAttemptResult).not.toHaveBeenCalled();
    },
  );

  it("records a failed attempt without throwing when the provider rejects a billing send", async () => {
    emailSend = vi.fn().mockRejectedValue(new Error("smtp down"));
    const mocks = mockBillingDataServer();

    const { sendBillingRefundEmail } = await import("~/lib/delivery.server");
    const sent = await sendBillingRefundEmail(emailEnv as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      eventId: "evt-refund-2",
    });

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
