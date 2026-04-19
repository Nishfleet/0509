import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("deliverWeeklyDigest", () => {
  it("auto-provisions the account email target and records the email attempt", async () => {
    const resendSend = vi.fn().mockResolvedValue({
      data: {
        id: "msg_1",
      },
      error: null,
    });
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

    vi.doMock("resend", () => ({
      Resend: vi.fn(() => ({
        emails: {
          send: resendSend,
        },
      })),
    }));
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
        RESEND_API_KEY: "re_123",
        RESEND_FROM_EMAIL: "alerts@0509.in",
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
          },
        ],
      },
    );

    expect(result).toEqual({
      attempts: 1,
      channels: ["email"],
    });
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "0509 weekly digest: 1 competitor changes",
      }),
    );
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

  it("keeps email as the baseline when customer WhatsApp fails readiness checks", async () => {
    const resendSend = vi.fn().mockResolvedValue({
      data: {
        id: "msg_1",
      },
      error: null,
    });
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

    vi.doMock("resend", () => ({
      Resend: vi.fn(() => ({
        emails: {
          send: resendSend,
        },
      })),
    }));
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
      {
        RESEND_API_KEY: "re_123",
        RESEND_FROM_EMAIL: "alerts@0509.in",
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
          },
        ],
      },
    );

    expect(result).toEqual({
      attempts: 2,
      channels: ["email", "whatsapp"],
    });
    expect(resendSend).toHaveBeenCalledTimes(1);
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

  it("reuses an existing idempotent email attempt instead of sending twice", async () => {
    const resendSend = vi.fn();

    vi.doMock("resend", () => ({
      Resend: vi.fn(() => ({
        emails: {
          send: resendSend,
        },
      })),
    }));
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
          provider: "resend",
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
      {
        RESEND_API_KEY: "re_123",
        RESEND_FROM_EMAIL: "alerts@0509.in",
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
          },
        ],
      },
    );

    expect(result).toEqual({
      attempts: 1,
      channels: ["email"],
    });
    expect(resendSend).not.toHaveBeenCalled();
  });
});
