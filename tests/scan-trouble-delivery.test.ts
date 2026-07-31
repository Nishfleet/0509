import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("deliverScanTroubleNotice", () => {
  it("treats an already accepted duplicate as completed without sending twice", async () => {
    const send = vi.fn();
    const target = {
      id: "target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: "2026-07-30T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    };

    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
      listDeliveryTargets: vi.fn().mockResolvedValue([target]),
      upsertDeliveryTarget: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
    }));
    vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
      claimInstantDeliveryAttempt: vi.fn().mockResolvedValue({
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: {
          id: "attempt-1",
          status: "sent",
          webhookStatus: "provider_unknown",
        },
        reclaimed: false,
      }),
      markInstantDeliveryDispatchStarted: vi.fn(),
    }));
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl: vi
        .fn()
        .mockResolvedValue("https://0509.io/unsubscribe"),
    }));

    const { deliverScanTroubleNotice } = await import("~/lib/delivery.server");
    const result = await deliverScanTroubleNotice(
      {
        EMAIL: { send },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        APP_ORIGIN: "https://0509.io",
      } as never,
      {
        userId: "user-1",
        accountEmail: "owner@example.com",
        watchlistNames: ["Acme"],
        periodKey: "2026-W31",
      },
    );

    expect(result).toEqual({ sent: true, reason: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"] as const)(
    "treats a %s/provider-unknown duplicate as terminal without sending twice",
    async (status) => {
      const send = vi.fn();
      const target = {
        id: "target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "account_email",
        optedInAt: "2026-07-30T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: false,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: null,
        metadata: {},
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      };

      vi.doMock("~/lib/email-verification.server", () => ({
        isUserEmailVerified: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue("starter"),
      }));
      vi.doMock("~/lib/data.server", () => ({
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
          id: "workspace-1",
          userId: "user-1",
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "Asia/Kolkata",
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        }),
        listDeliveryTargets: vi.fn().mockResolvedValue([target]),
        upsertDeliveryTarget: vi.fn(),
        legacyWorkspaceDeliveryDefaults: vi.fn(),
      }));
      vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
        claimInstantDeliveryAttempt: vi.fn().mockResolvedValue({
          attemptId: null,
          claimUpdatedAt: null,
          duplicate: {
            id: "attempt-1",
            status,
            webhookStatus: "provider_unknown",
          },
          reclaimed: false,
        }),
        markInstantDeliveryDispatchStarted: vi.fn(),
      }));
      vi.doMock("~/lib/unsubscribe.server", () => ({
        buildUnsubscribeUrl: vi
          .fn()
          .mockResolvedValue("https://0509.io/unsubscribe"),
      }));

      const { deliverScanTroubleNotice } =
        await import("~/lib/delivery.server");
      const result = await deliverScanTroubleNotice(
        {
          EMAIL: { send },
          EMAIL_FROM_EMAIL: "alerts@0509.io",
          APP_ORIGIN: "https://0509.io",
        } as never,
        {
          userId: "user-1",
          accountEmail: "owner@example.com",
          watchlistNames: ["Acme"],
          periodKey: "2026-W31",
        },
      );

      expect(result).toEqual({ sent: false, reason: "provider_unknown" });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["provider exception", false, true, "failed"],
    ["finalization loss after provider acceptance", true, false, "sent"],
  ] as const)(
    "terminalizes %s as provider-unknown after dispatch",
    async (_scenario, providerAccepted, finalized, persistedStatus) => {
      const send = providerAccepted
        ? vi.fn().mockResolvedValue({ messageId: "provider-message-1" })
        : vi.fn().mockRejectedValue(new Error("provider connection closed"));
      const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(finalized);
      const target = {
        id: "target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "account_email",
        optedInAt: "2026-07-30T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: false,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: null,
        metadata: {},
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      };

      vi.doMock("~/lib/email-verification.server", () => ({
        isUserEmailVerified: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue("starter"),
      }));
      vi.doMock("~/lib/data.server", () => ({
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
          id: "workspace-1",
          userId: "user-1",
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "Asia/Kolkata",
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        }),
        listDeliveryTargets: vi.fn().mockResolvedValue([target]),
        upsertDeliveryTarget: vi.fn(),
        legacyWorkspaceDeliveryDefaults: vi.fn(),
        updateDeliveryAttemptResult,
      }));
      vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
        claimInstantDeliveryAttempt: vi.fn().mockResolvedValue({
          attemptId: "attempt-1",
          claimUpdatedAt: "2026-07-31T00:00:00.000Z",
          duplicate: null,
          reclaimed: false,
        }),
        markInstantDeliveryDispatchStarted: vi
          .fn()
          .mockResolvedValue("2026-07-31T00:00:01.000Z"),
      }));
      vi.doMock("~/lib/unsubscribe.server", () => ({
        buildUnsubscribeUrl: vi
          .fn()
          .mockResolvedValue("https://0509.io/unsubscribe"),
      }));

      const { deliverScanTroubleNotice } =
        await import("~/lib/delivery.server");
      const result = await deliverScanTroubleNotice(
        {
          EMAIL: { send },
          EMAIL_FROM_EMAIL: "alerts@0509.io",
          APP_ORIGIN: "https://0509.io",
        } as never,
        {
          userId: "user-1",
          accountEmail: "owner@example.com",
          watchlistNames: ["Acme"],
          periodKey: "2026-W31",
        },
      );

      expect(result).toEqual({ sent: false, reason: "provider_unknown" });
      expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
        {
          EMAIL: { send },
          EMAIL_FROM_EMAIL: "alerts@0509.io",
          APP_ORIGIN: "https://0509.io",
        },
        "attempt-1",
        expect.objectContaining({
          status: persistedStatus,
          webhookStatus: "provider_unknown",
          expectedStatus: "pending",
          expectedWebhookStatus: "provider_unknown",
        }),
      );
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("treats an opted-out account target as terminal suppression", async () => {
    const send = vi.fn();
    const claimInstantDeliveryAttempt = vi.fn();
    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
      listDeliveryTargets: vi.fn().mockResolvedValue([
        {
          id: "target-1",
          userId: "user-1",
          watchlistId: null,
          channel: "email",
          targetValue: "owner@example.com",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: false,
          optInSource: "account_email",
          optedInAt: "2026-07-30T00:00:00.000Z",
          isPaused: false,
          pausedAt: null,
          optedOutAt: "2026-07-31T00:00:00.000Z",
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: null,
          metadata: {},
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:00.000Z",
        },
      ]),
      upsertDeliveryTarget: vi.fn(),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
    }));
    vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted: vi.fn(),
    }));

    const { deliverScanTroubleNotice } = await import("~/lib/delivery.server");
    const result = await deliverScanTroubleNotice(
      {
        EMAIL: { send },
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        APP_ORIGIN: "https://0509.io",
      } as never,
      {
        userId: "user-1",
        accountEmail: "owner@example.com",
        watchlistNames: ["Acme"],
        periodKey: "2026-W31",
      },
    );

    expect(result).toEqual({ sent: false, reason: "suppressed" });
    expect(claimInstantDeliveryAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
