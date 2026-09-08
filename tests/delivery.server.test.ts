import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveCustomerEvidenceState,
  type CustomerEvidenceState,
} from "~/lib/evidence-render-contract";

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

function mockAtomicEmailProvision() {
  return vi.fn().mockResolvedValue({
    id: "email-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    isPaused: false,
    optedOutAt: null,
  });
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
  vi.doUnmock("~/lib/data/delivery-records-attempts.server");
  vi.doUnmock("~/lib/delivery-attempt-lease");
  vi.doUnmock("~/lib/ga-customer-surface");
  vi.doUnmock("~/lib/slack-webhook.server");
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
  digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
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
        totalEligibleEvents: 3,
        includedEvents: 1,
        omittedEvents: 2,
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
from:{email:"alerts@0509.io",name:"Five to Nine"},
      to: "owner@example.com",
      subject: "boAt watch made a competitor move worth seeing",
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
      "View full brief: https://app.0509.test/app/digests?digest=digest-1",
    );
    expect(emailSendPayload(sendMock).text).toContain("Manage frequency: https://app.0509.test/app/notifications");
    expect(emailSendPayload(sendMock).text).toContain("Unsubscribe: https://app.0509.test/unsubscribe");
    expect(emailSendPayload(sendMock).text).toContain(
      "3 changes found; showing 1, with 2 lower-priority changes omitted.",
    );
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
          subject: "boAt watch made a competitor move worth seeing",
        }),
      }),
    );
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
1,
expect.anything(),
"attempt-1",
expect.objectContaining({
status:"pending",webhookStatus:"provider_unknown",
expectedStatus:"pending",expectedWebhookStatus:"pending",
}),
);
expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
2,
      expect.anything(),
      "attempt-1",
      expect.objectContaining({
        status: "sent",
expectedWebhookStatus:"provider_unknown",
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

  it("uses the Gate C subject and the pre-provider T0 in the durable proof summary", async () => {
    const t0 = "2026-08-01T00:00:00.000Z";
    const t1 = "2026-08-01T00:05:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    emailSend = vi.fn().mockResolvedValue({ messageId: "gate-c-message" });
    const sendMock = emailSend;
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-gate-c");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const upsertDigestDelivery = vi.fn();
    const markInstantDeliveryDispatchStarted = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(t1);
      return t0;
    });
    const target = {
      id: "email-target-gate-c",
      userId: "user-gate-c",
      watchlistId: null,
      channel: "email",
      targetValue: "owner@example.com",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: t0,
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: t0,
      updatedAt: t0,
    };

    vi.doMock("~/lib/delivery-attempt-lease", () => ({
      DIGEST_PROVIDER_CLAIM_PROTOCOL: "digest_preclaim_v1",
      INSTANT_PROVIDER_CLAIM_PROTOCOL: "instant_preclaim_v1",
      hasTrustedDigestProviderRetryEvidence: vi.fn().mockReturnValue(false),
      hasTrustedInstantProviderRetryEvidence: vi.fn().mockReturnValue(false),
      isStalePreDispatchAttempt: vi.fn().mockReturnValue(false),
      markDeliveryAttemptProviderDispatch: vi.fn().mockResolvedValue(t0),
    }));
    vi.doMock("~/lib/data/delivery-records-attempts.server", () => ({
      claimInstantDeliveryAttempt: vi.fn(),
      markInstantDeliveryDispatchStarted,
    }));
    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-gate-c",
        userId: "user-gate-c",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "UTC",
        createdAt: t0,
        updatedAt: t0,
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockResolvedValue([target]),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(
      {
        ...emailEnv,
        DB: {},
        APP_ORIGIN: "https://app.0509.test",
        BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: "https://0509.io",
      } as never,
      {
        userId: "user-gate-c",
        userName: "Owner",
        accountEmail: "owner@example.com",
        digestRunId: "digest-gate-c",
        periodStart: t0,
        periodEnd: "2026-08-01T01:00:00.000Z",
        items: [],
        cadence: "daily",
        lane: "internal",
        proofEmailSubject: "0509 Gate C proof gate-c-worker-v1",
      },
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(emailSendPayload(sendMock).subject).toBe("0509 Gate C proof gate-c-worker-v1");
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payloadSnapshot: expect.objectContaining({
          subject: "0509 Gate C proof gate-c-worker-v1",
        }),
      }),
    );
    const finalUpdate = updateDeliveryAttemptResult.mock.calls.at(-1)?.[2];
    expect(finalUpdate).toEqual(expect.objectContaining({
      payloadSnapshot: expect.objectContaining({ providerDispatchStartedAt: t0 }),
    }));
    expect(markInstantDeliveryDispatchStarted).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-gate-c",
      t0,
    );
    expect(finalUpdate.providerStatusLastSeenAt).toBe(t1);
    expect(result.details[0]).toMatchObject({
      subject: "0509 Gate C proof gate-c-worker-v1",
      providerDispatchStartedAt: t0,
      status: "sent",
    });
  });

  it.each([
    {
      name: "no normalized account-email target",
      targets: [],
    },
    {
      name: "multiple byte-distinct targets normalize to the account email",
      targets: ["OWNER@example.com", " owner@example.com "],
    },
    {
      name: "a saturated target page cannot prove global uniqueness",
      targets: Array.from({ length: 100 }, (_, index) =>
        index === 0 ? "owner@example.com" : `other-${index}@example.com`,
      ),
    },
  ])("fails before Gate C provider I/O for $name", async ({ targets }) => {
    const sendMock = mockEmailSend("must-not-send");
    const createDeliveryAttempt = vi.fn();
    const upsertDeliveryTarget = vi.fn();
    const listDeliveryTargets = vi.fn();
    const migrateAutoProvisionedEmailTargets = vi.fn();
    const now = "2026-08-01T00:00:00.000Z";
    const deliveryTargets = targets.map((targetValue, index) => ({
      id: `email-target-gate-c-${index + 1}`,
      userId: "user-gate-c",
      watchlistId: null,
      channel: "email",
      targetValue,
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "account_email",
      optedInAt: now,
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: false,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }));

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult: vi.fn(),
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-gate-c",
        userId: "user-gate-c",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: listDeliveryTargets.mockResolvedValue(deliveryTargets),
      migrateAutoProvisionedEmailTargets,
      upsertDeliveryTarget,
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({ sendDigestWhatsApp: vi.fn() }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await expect(
      deliverWeeklyDigest(
        {
          ...emailEnv,
          APP_ORIGIN: "https://app.0509.test",
          BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
          BETTER_AUTH_URL: "https://0509.io",
        } as never,
        {
          userId: "user-gate-c",
          userName: "Owner",
          accountEmail: "owner@example.com",
          digestRunId: "digest-gate-c",
          periodStart: now,
          periodEnd: "2026-08-01T01:00:00.000Z",
          items: [],
          cadence: "daily",
          lane: "internal",
          proofEmailSubject: "0509 Gate C proof gate-c-worker-v1",
        },
      ),
    ).rejects.toThrow("Gate C proof email target must resolve uniquely.");

    expect(sendMock).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
    expect(migrateAutoProvisionedEmailTargets).not.toHaveBeenCalled();
    expect(listDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      "user-gate-c",
      { watchlistId: null, channel: "email", limit: 100 },
    );
  });

  it("records an untyped email rejection as failed while provider outcome stays unknown", async () => {
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
  digestCadencePreference: "plan_default",
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
          errorMessage: "Cloudflare Email send outcome is unknown after provider exception: network timeout.",
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
        webhookStatus: "provider_unknown",
        errorMessage: "Cloudflare Email send outcome is unknown after provider exception: network timeout.",
      }),
    );
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "failed",
        recipientEmail: "owner@example.com",
        errorMessage: "Cloudflare Email send outcome is unknown after provider exception: network timeout.",
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
  digestCadencePreference: "plan_default",
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
webhookStatus:"pending",
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
  digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
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
  digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: mockAtomicEmailProvision(),
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
  digestCadencePreference: "plan_default",
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
    const upsertDigestDelivery = vi.fn();
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
          webhookStatus: "provider_unknown",
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
  digestCadencePreference: "plan_default",
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
          status: "sent",
          targetValue: "owner@example.com",
        },
      ],
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "sent",
        deliveredAt: null,
      }),
    );
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
  digestCadencePreference: "plan_default",
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
  digestCadencePreference: "plan_default",
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
    const optedOutWatchlistTarget = {
      id: "email-target-1",
      userId: "user-1",
      watchlistId: "watch-1",
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
    };
    const listDeliveryTargets = vi.fn().mockImplementation(
      async (
        _env: unknown,
        _userId: string,
        options?: { watchlistId?: string | null },
      ) => options?.watchlistId === null ? [] : [optedOutWatchlistTarget],
    );
    const hasSuppressedEmailTargetForUserAndAddress = vi
      .fn()
      .mockResolvedValue(true);

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
  digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets,
      hasSuppressedEmailTargetForUserAndAddress,
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
    expect(hasSuppressedEmailTargetForUserAndAddress).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        targetValue: "owner@example.com",
      },
    );
  });

  it("keeps paused watchlist targets separate from workspace digest preferences", async () => {
    const workspaceTarget = {
      id: "workspace-email-target",
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
      metadata: { autoProvisioned: true },
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    // Digest resolution only reads workspace-scoped targets (watchlistId: null).
    // An empty workspace list must still provision even if a paused watchlist
    // target exists elsewhere; this mock never returns watchlist-scoped rows.
    const listDeliveryTargets = vi.fn().mockResolvedValue([]);
    const upsertDeliveryTarget = vi.fn().mockResolvedValue(workspaceTarget);

    vi.doMock("~/lib/data.server", () => ({
      listDeliveryTargets,
      hasSuppressedEmailTargetForUserAndAddress: vi.fn().mockResolvedValue(false),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
      upsertDeliveryTarget,
    }));

    const { resolveDigestEmailTargets } = await import("~/lib/delivery.server");
    const targets = await resolveDigestEmailTargets(
      emailEnv as never,
      "user-1",
      "owner@example.com",
    );

    expect(targets).toEqual([workspaceTarget]);
    expect(listDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ watchlistId: null }),
    );
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        targetValue: "owner@example.com",
        optInSource: "account_email",
        metadata: { autoProvisioned: true },
      }),
    );
  });

  it("binds auto-provisioned delivery to the current verified account email", async () => {
    const sendMock = mockEmailSend("msg_current_email");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-current-email");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
    const oldTarget = {
      id: "email-target-old",
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "old@example.com",
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
      metadata: { autoProvisioned: true },
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    };
    const currentTarget = { ...oldTarget, id: "email-target-current", targetValue: "new@example.com" };
    let targets = [oldTarget];
    const migrateAutoProvisionedEmailTargets = vi.fn().mockImplementation(async () => {
      targets = [currentTarget];
      return 1;
    });

    vi.doMock("~/lib/data.server", () => ({
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "new@example.com",
        name: "Owner",
        emailVerified: true,
      }),
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
  digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "UTC",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets: vi.fn().mockImplementation(async () => targets),
      migrateAutoProvisionedEmailTargets,
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, {
      userId: "user-1",
      userName: "Owner",
      accountEmail: "old@example.com",
      digestRunId: "digest-current-email",
      periodStart: "2026-04-12T00:00:00.000Z",
      periodEnd: "2026-04-19T00:00:00.000Z",
      items: [],
    });

    expect(migrateAutoProvisionedEmailTargets).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "new@example.com",
    );
    expect(result.details[0]?.targetValue).toBe("new@example.com");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]?.to).toBe("new@example.com");
  });

  it("emits no customer attempts when the current account email is unverified", async () => {
    const sendMock = mockEmailSend("msg_unverified");
    vi.doMock("~/lib/data.server", () => ({
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
        emailVerified: false,
      }),
    }));

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, {
      userId: "user-1",
      userName: "Owner",
      accountEmail: "owner@example.com",
      digestRunId: "digest-unverified",
      periodStart: "2026-04-12T00:00:00.000Z",
      periodEnd: "2026-04-19T00:00:00.000Z",
      items: [],
    });

    expect(result).toMatchObject({ attempts: 0, channels: [], details: [] });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("deliverWatchlistAlerts", () => {
  it("does not reuse an alert target for a globally suppressed email address", async () => {
    const existingTarget = {
      id: "email-target-suppressed",
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
    };
    const hasSuppressedEmailTargetForUserAndAddress = vi
      .fn()
      .mockResolvedValue(true);

    vi.doMock("~/lib/data.server", () => ({
      listDeliveryTargets: vi.fn().mockResolvedValue([existingTarget]),
      hasSuppressedEmailTargetForUserAndAddress,
    }));

    const { resolveAlertEmailTargets } = await import("~/lib/delivery.server");
    const targets = await resolveAlertEmailTargets(
      emailEnv as never,
      "user-1",
      "watch-1",
      "owner@example.com",
    );

    expect(targets).toEqual([]);
    expect(hasSuppressedEmailTargetForUserAndAddress).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        targetValue: "owner@example.com",
      },
    );
  });

  it("sends instant alerts for confirmed watch events that clear delivery policy", async () => {
    const sendMock = mockEmailSend("msg_instant_1");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-instant-1");
    const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
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
  digestCadencePreference: "plan_default",
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
      updateDeliveryAttemptResult,
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
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

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [{
        status: "sent",
        outcome: "provider_accepted",
        claimedByThisRun: true,
        providerAttemptedByThisRun: true,
        duplicate: false,
        source: "current_claim",
      }],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(emailSendPayload(sendMock)).toMatchObject({
from:{email:"alerts@0509.io",name:"Five to Nine"},
      to: "owner@example.com",
      subject: "Nykaa changed a landing page URL",
      html: expect.stringContaining("Instant alert"),
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
        status: "pending",
        webhookStatus: "pending",
        providerStatusLastSeenAt: null,
        sentAt: null,
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "attempt-instant-1",
      expect.objectContaining({
        status: "pending",
        webhookStatus: "provider_unknown",
        expectedWebhookStatus: "pending",
      }),
    );
    expect(updateDeliveryAttemptResult).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "attempt-instant-1",
      expect.objectContaining({
        status: "sent",
        expectedWebhookStatus: "provider_unknown",
      }),
    );
    // The referenced ad had no captured creative, so no image is embedded.
    expect(String(emailSendPayload(sendMock).html)).not.toContain("<img");
  });

  it.each([
    ["sent", "delivered", "provider_accepted"],
    ["pending", "provider_unknown", "pending_provider_unknown"],
    ["skipped_due_to_quiet_hours", "provider_unknown", "quiet_deferral"],
    ["skipped_due_to_dedupe", "provider_unknown", "intentional_dedupe"],
  ] as const)(
    "returns durable duplicate %s truth without claiming or resending it",
    async (status, webhookStatus, outcome) => {
      const sendMock = mockEmailSend("must-not-send");
      const createDeliveryAttempt = vi.fn();
      const updateDeliveryAttemptResult = vi.fn();
      const target = {
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
      };
      const durableAttempt = {
        id: "attempt-existing-1",
        userId: "user-1",
        watchlistId: "watch-1",
        digestRunId: null,
        deliveryTargetId: target.id,
        lane: "customer",
        channel: "email",
        provider: "cloudflare_email",
        status,
        webhookStatus,
        targetValue: target.targetValue,
        providerMessageId: status === "sent" ? "msg-existing" : null,
        providerStatusLastSeenAt: null,
        templateName: null,
        eventIds: ["event-1"],
        payloadSnapshot: {},
        idempotencyKey: "instant:existing",
        errorMessage: null,
        sentAt: status === "sent" ? "2026-04-19T00:00:00.000Z" : null,
        failedAt: null,
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      };

      vi.doMock("~/lib/data.server", () => ({
        listAdsByIds: vi.fn().mockResolvedValue([]),
        createDeliveryAttempt,
        updateDeliveryAttemptResult,
        getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(durableAttempt),
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
          id: "workspace-1",
          userId: "user-1",
          sensitivityMode: "balanced",
          instantEnabled: true,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
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
        provisionVerifiedAccountEmailTargetIfUnsuppressed: vi.fn().mockResolvedValue(target),
        reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
        upsertDeliveryTarget: vi.fn().mockResolvedValue(target),
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
          watchlist: { id: "watch-1", userId: "user-1", name: "Nykaa watch" },
          events: [{
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
          }],
        } as never,
      );

      expect(result).toMatchObject({
        attempts: 1,
        details: [{
          outcome,
          claimedByThisRun: false,
          providerAttemptedByThisRun: false,
          duplicate: true,
          source: "durable_attempt",
        }],
      });
      expect(sendMock).not.toHaveBeenCalled();
      expect(createDeliveryAttempt).not.toHaveBeenCalled();
      expect(updateDeliveryAttemptResult).not.toHaveBeenCalled();
    },
  );

  it("returns durable terminal truth when current provider success loses final ownership", async () => {
    const sendMock = mockEmailSend("msg-current-lost");
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-current");
    const updateDeliveryAttemptResult = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const target = {
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
    };
    const durableFailure = {
      id: "attempt-current",
      userId: "user-1",
      watchlistId: "watch-1",
      digestRunId: null,
      deliveryTargetId: target.id,
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "failed",
      webhookStatus: "failed",
      targetValue: target.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-04-19T00:00:01.000Z",
      templateName: null,
      eventIds: ["event-1"],
      payloadSnapshot: {},
      idempotencyKey: "instant:lost",
      errorMessage: "provider rejected",
      sentAt: null,
      failedAt: "2026-04-19T00:00:01.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:01.000Z",
    };
    let lookupCount = 0;
    const getDeliveryAttemptByIdempotencyKey = vi.fn(async () => {
      lookupCount += 1;
      return lookupCount >= 4 ? durableFailure : null;
    });

    vi.doMock("~/lib/data.server", () => ({
      listAdsByIds: vi.fn().mockResolvedValue([]),
      createDeliveryAttempt,
      updateDeliveryAttemptResult,
      getDeliveryAttemptByIdempotencyKey,
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: vi.fn().mockResolvedValue(target),
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      upsertDeliveryTarget: vi.fn().mockResolvedValue(target),
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
        watchlist: { id: "watch-1", userId: "user-1", name: "Nykaa watch" },
        events: [{
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
        }],
      } as never,
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.details).toEqual([
      expect.objectContaining({
        outcome: "definitive_terminal_failure",
        claimedByThisRun: false,
        providerAttemptedByThisRun: true,
        duplicate: true,
        source: "durable_attempt",
      }),
    ]);
  });

  it.each(["whatsapp", "slack"] as const)(
    "retains the %s provider attempt when final ownership is lost",
    async (channel) => {
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue("agency"),
      }));
      vi.doMock("~/lib/ga-customer-surface", () => ({
        isWhatsAppDeliveryCustomerFacing: () => true,
        isSlackDeliveryCustomerFacing: () => true,
        isSlackWebhookDeliveryCustomerFacing: () => true,
        isTeamsWebhookDeliveryCustomerFacing: () => true,
      }));

      let providerStarted = false;
      const sendInstantWhatsApp = vi.fn(async () => {
        providerStarted = true;
        return {
          provider: "whatsapp_cloud_api",
          status: "sent",
          webhookStatus: "delivered",
          providerMessageId: "wamid.current-lost",
          providerStatusLastSeenAt: "2026-04-19T00:00:01.000Z",
          templateName: "instant_alert",
          errorMessage: null,
        };
      });
      const sendSlackWebhookUrl = vi.fn(async () => {
        providerStarted = true;
        return {
          provider: "slack_incoming_webhook",
          status: "sent",
          webhookStatus: "delivered",
          providerMessageId: null,
          providerStatusLastSeenAt: "2026-04-19T00:00:01.000Z",
          errorMessage: null,
          deliveredAt: "2026-04-19T00:00:01.000Z",
        };
      });
      const providerSend = channel === "whatsapp" ? sendInstantWhatsApp : sendSlackWebhookUrl;
      const target = channel === "whatsapp"
        ? whatsappTarget({
            validationStatus: "validated",
            isValidated: true,
            templateEligible: true,
          })
        : {
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
            metadata: { encryptedWebhookUrl: "encrypted-webhook" },
            createdAt: "2026-04-19T00:00:00.000Z",
            updatedAt: "2026-04-19T00:00:00.000Z",
          };
      const durableFailure = {
        id: `attempt-${channel}-current`,
        userId: "user-1",
        watchlistId: "watch-1",
        digestRunId: null,
        deliveryTargetId: target.id,
        lane: "customer",
        channel,
        provider: channel === "whatsapp" ? "whatsapp_cloud_api" : "slack_incoming_webhook",
        status: "failed",
        webhookStatus: "failed",
        targetValue: target.targetValue,
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:00:02.000Z",
        templateName: null,
        eventIds: ["event-1"],
        payloadSnapshot: {},
        idempotencyKey: `instant:${channel}:lost`,
        errorMessage: "provider rejected",
        sentAt: null,
        failedAt: "2026-04-19T00:00:02.000Z",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:02.000Z",
      };
      const createDeliveryAttempt = vi.fn().mockResolvedValue(durableFailure.id);
      const updateDeliveryAttemptResult = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      vi.doMock("~/lib/data.server", () => ({
        listAdsByIds: vi.fn().mockResolvedValue([]),
        createDeliveryAttempt,
        updateDeliveryAttemptResult,
        getDeliveryAttemptByIdempotencyKey: vi.fn(async () =>
          providerStarted ? durableFailure : null,
        ),
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
          id: "workspace-1",
          userId: "user-1",
          sensitivityMode: "balanced",
          instantEnabled: true,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: false,
          whatsappEnabled: channel === "whatsapp",
          slackEnabled: channel === "slack",
          quietHours: null,
          timezone: "Asia/Kolkata",
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
        }),
        getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
        legacyWorkspaceDeliveryDefaults: vi.fn(),
        listDeliveryTargets: vi.fn().mockImplementation(async (_env, _userId, options) =>
          options?.channel === channel ? [target] : [],
        ),
        reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
        upsertDeliveryTarget: vi.fn(),
        upsertDigestDelivery: vi.fn(),
      }));
      vi.doMock("~/lib/whatsapp.server", () => ({
        prepareDigestWhatsAppTarget: vi.fn(),
        sendDigestWhatsApp: vi.fn(),
        sendInstantWhatsApp,
      }));
      vi.doMock("~/lib/slack-webhook.server", () => ({
        SLACK_PROVIDER: "slack_incoming_webhook",
        prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
          ok: true,
          webhookUrl: "https://hooks.slack.test/services/test",
        }),
        sendSlackWebhookUrl,
      }));

      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
      const result = await deliverWatchlistAlerts(emailEnv as never, {
        userId: "user-1",
        userName: "Owner",
        accountEmail: "owner@example.com",
        watchlist: { id: "watch-1", userId: "user-1", name: "Nykaa watch" },
        events: [{
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
        }],
      } as never);

      expect(providerSend).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        attempts: 1,
        details: [{
          channel,
          outcome: "definitive_terminal_failure",
          claimedByThisRun: false,
          providerAttemptedByThisRun: true,
          duplicate: true,
          source: "durable_attempt",
        }],
      });
    },
  );

  it("sends instant alerts to live Slack but never to dormant WhatsApp targets", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-hidden-channel");
    const sendInstantWhatsApp = vi.fn();
    const sendSlackWebhookUrl = vi.fn().mockResolvedValue({
      provider: "slack_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-04-19T00:00:00.000Z",
      errorMessage: null,
      deliveredAt: "2026-04-19T00:00:00.000Z",
    });
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
  digestCadencePreference: "plan_default",
        emailEnabled: false,
        whatsappEnabled: true,
        slackEnabled: true,
        teamsEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets,
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp,
    }));
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
        ok: true,
        webhookUrl: "https://hooks.slack.test/services/redacted",
      }),
      sendSlackWebhookUrl,
      sendSlackWebhookMessage: vi.fn(),
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
      channels: ["slack"],
      details: [
        {
          channel: "slack",
          claimedByThisRun: true,
          deliveredAt: "2026-04-19T00:00:00.000Z",
          duplicate: false,
          errorMessage: null,
          outcome: "provider_accepted",
          providerAttemptedByThisRun: true,
          providerMessageId: null,
          source: "current_claim",
          status: "sent",
          targetValue: "slack:[redacted]",
        },
      ],
    });
    expect(listDeliveryTargets).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ channel: "whatsapp" }),
    );
    expect(sendSlackWebhookUrl).toHaveBeenCalledTimes(1);
    expect(sendInstantWhatsApp).not.toHaveBeenCalled();
    expect(createDeliveryAttempt).toHaveBeenCalledTimes(1);
  });

  it("sends instant alerts to live Teams webhooks and records the attempt under the Teams provider", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-teams");
    const sendTeamsWebhookUrl = vi.fn().mockResolvedValue({
      provider: "microsoft_teams_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-04-19T00:00:00.000Z",
      errorMessage: null,
      deliveredAt: "2026-04-19T00:00:00.000Z",
    });
    const listDeliveryTargets = vi.fn().mockImplementation(async (_env, _userId, options) => {
      if (options?.channel === "teams") {
        return [
          {
            id: "teams-target-1",
            userId: "user-1",
            watchlistId: null,
            channel: "teams",
            targetValue: "teams:[redacted]",
            validationStatus: "validated",
            isValidated: true,
            isOptedIn: true,
            optInSource: "manual_teams_webhook",
            optedInAt: "2026-04-19T00:00:00.000Z",
            isPaused: false,
            pausedAt: null,
            optedOutAt: null,
            templateEligible: true,
            lastSuccessfulDeliveryAt: null,
            lastSuccessfulAttemptId: null,
            providerIdentifier: "teams-webhook:secret",
            metadata: {
              encryptedWebhookUrl:
                "https://acme.webhook.office.com/webhookb2/id@tenant/IncomingWebhook/id/key",
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
        digestCadencePreference: "plan_default",
        emailEnabled: false,
        whatsappEnabled: false,
        slackEnabled: false,
        teamsEnabled: true,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(),
      listDeliveryTargets,
      reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      upsertDeliveryTarget: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      sendDigestWhatsApp: vi.fn(),
      sendInstantWhatsApp: vi.fn(),
    }));
    vi.doMock("~/lib/slack-webhook.server", () => ({
      SLACK_PROVIDER: "slack_incoming_webhook",
      prepareSlackWebhookTarget: vi.fn(),
      sendSlackWebhookUrl: vi.fn(),
      sendSlackWebhookMessage: vi.fn(),
    }));
    vi.doMock("~/lib/teams-webhook.server", () => ({
      TEAMS_PROVIDER: "microsoft_teams_incoming_webhook",
      prepareTeamsWebhookTarget: vi.fn().mockResolvedValue({
        ok: true,
        webhookUrl: "https://acme.webhook.office.test/webhookb2/redacted",
      }),
      sendTeamsWebhookUrl,
      sendTeamsWebhookMessage: vi.fn(),
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
      channels: ["teams"],
      details: [
        {
          channel: "teams",
          claimedByThisRun: true,
          deliveredAt: "2026-04-19T00:00:00.000Z",
          duplicate: false,
          errorMessage: null,
          outcome: "provider_accepted",
          providerAttemptedByThisRun: true,
          providerMessageId: null,
          source: "current_claim",
          status: "sent",
          targetValue: "teams:[redacted]",
        },
      ],
    });
    expect(sendTeamsWebhookUrl).toHaveBeenCalledTimes(1);
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "teams",
        provider: "microsoft_teams_incoming_webhook",
      }),
    );
    // The Teams deep link must land on the watchlist row for the primary event.
    const teamsPayload = sendTeamsWebhookUrl.mock.calls[0]?.[1];
    expect(String(teamsPayload?.text)).toContain(
      "[View watchlist](https://0509.io/app/watchlists?watchlist=watch-1&event=event-1)",
    );
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
  digestCadencePreference: "plan_default",
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
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: mockAtomicEmailProvision(),
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
            // BET 1: ad_new no longer fires instant alerts (it collapses into
            // a counted digest footnote). Use a landing_page_offer_changed
            // event — still instant-eligible — so this test keeps verifying
            // the creative-image embedding path for instant alerts.
            eventType: "landing_page_offer_changed",
            status: "confirmed",
            importanceScore: 90,
            adId: "meta-1",
            baselineFromRunId: null,
            candidateId: "candidate-1",
            proofCaptureId: "proof-1",
            title: "Landing page offer changed",
            summary: "Nykaa changed their landing page offer.",
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

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [{
        status: "sent",
        outcome: "provider_accepted",
        claimedByThisRun: true,
        providerAttemptedByThisRun: true,
        duplicate: false,
        source: "current_claim",
      }],
    });
    expect(listAdsByIds).toHaveBeenCalledTimes(1);
    expect(listAdsByIds).toHaveBeenCalledWith(expect.anything(), ["meta-1"]);
    const html = String(emailSendPayload(sendMock).html);
    expect(html).toContain(
      '<img src="https://cdn.example.com/creative-1.jpg?sig=&quot;x&quot;&amp;v=1" alt="Ad creative" width="280"',
    );
    expect(html).toContain("max-width: 100%; width: 280px; border-radius: 0; border: 1px solid #e0ddd4; background-color: #fffdf8; margin: 12px 0;");
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
  digestCadencePreference: "plan_default",
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
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: upsertDeliveryTarget,
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

    expect(result).toMatchObject({
      attempts: 1,
      channels: ["email"],
      details: [{
        status: "sent",
        outcome: "provider_accepted",
        claimedByThisRun: true,
        providerAttemptedByThisRun: true,
        duplicate: false,
        source: "current_claim",
      }],
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
        status: "pending",
        webhookStatus: "pending",
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
		const reconcileWhatsAppSetupTargetFromAttempt = vi.fn();

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
			reconcileWhatsAppSetupTargetFromAttempt,
			upsertDeliveryTarget: vi.fn(),
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
		expect(reconcileWhatsAppSetupTargetFromAttempt).toHaveBeenCalledWith(
      expect.anything(),
			{
        userId: "user-1",
				targetId: "whatsapp-target-1",
				attemptId: "attempt-setup-1",
				providerMessageId: "wamid.setup-1",
				validationGeneration: null,
				webhookStatus: "delivered",
				providerStatusLastSeenAt: "2026-06-07T00:00:00.000Z",
				errorMessage: null,
			},
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
		const reconcileWhatsAppSetupTargetFromAttempt = vi.fn();

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
			reconcileWhatsAppSetupTargetFromAttempt,
			upsertDeliveryTarget: vi.fn(),
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

		expect(reconcileWhatsAppSetupTargetFromAttempt).toHaveBeenCalledWith(
      expect.anything(),
			{
				userId: "user-1",
				targetId: "whatsapp-target-1",
				attemptId: "attempt-setup-2",
				providerMessageId: "wamid.setup-2",
				validationGeneration: null,
				webhookStatus: "failed",
				providerStatusLastSeenAt: "2026-06-07T01:00:00.000Z",
				errorMessage: "Recipient blocked delivery.",
			},
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

	it("delegates stale WhatsApp setup webhooks to generation-aware reconciliation", async () => {
		const reconcileWhatsAppSetupTargetFromAttempt = vi.fn();

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
			reconcileWhatsAppSetupTargetFromAttempt,
			upsertDeliveryTarget: vi.fn(),
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

		expect(reconcileWhatsAppSetupTargetFromAttempt).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				targetId: "whatsapp-target-1",
				attemptId: "attempt-setup-old",
				providerMessageId: "wamid.setup-old",
				webhookStatus: "failed",
			}),
		);
  });

  it("validates WhatsApp setup targets by provider id when the attempt is not found yet", async () => {
    const upsertDeliveryTarget = vi.fn();
const reconcileWhatsAppSetupTargetByProviderMessageId=vi.fn();

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
reconcileWhatsAppSetupTargetByProviderMessageId,
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
expect(reconcileWhatsAppSetupTargetByProviderMessageId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
providerMessageId:"wamid.setup-1",webhookStatus:"delivered",
providerStatusLastSeenAt:"2026-06-07T04:00:00.000Z",
      }),
    );
expect(upsertDeliveryTarget).not.toHaveBeenCalled();
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
  digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: mockAtomicEmailProvision(),
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
    expect(result.details).toEqual([
      expect.objectContaining({
        outcome: "provider_accepted",
        claimedByThisRun: true,
        providerAttemptedByThisRun: true,
        duplicate: false,
        source: "current_claim",
      }),
    ]);
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
      // P1 evidence truth: the confirmed headline event carries a succeeded,
      // correctly ordered capture pair, so its materiality may claim a
      // verified (cosmetic-class) change rather than degrading to provisional.
      listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([
        {
          eventId: "event-1",
          current: {
            id: "proof-1",
            status: "succeeded",
            attemptedAt: "2026-04-19T00:00:00.000Z",
            succeededAt: "2026-04-19T00:00:00.000Z",
          },
          previous: {
            id: "proof-0",
            status: "succeeded",
            attemptedAt: "2026-04-18T00:00:00.000Z",
            succeededAt: "2026-04-18T00:00:00.000Z",
          },
        },
      ]),
      createDeliveryAttempt: vi.fn().mockResolvedValue("attempt-1"),
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
  digestCadencePreference: "plan_default",
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
      provisionVerifiedAccountEmailTargetIfUnsuppressed: mockAtomicEmailProvision(),
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
              beforeCapturedAt: "2026-04-18T00:00:00.000Z",
              capturedAt: "2026-04-19T00:00:00.000Z",
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
    expect(payload.html).toContain("Captured 18 Apr 2026");
    expect(payload.html).toContain("Captured 19 Apr 2026");
    expect(payload.html).toContain("See the evidence");
    // WP-24: evidence link deep-links to the event row.
    expect(payload.html).toContain("/app/watchlists?watchlist=watch-1&event=event-1");
    // E2 alert increment: every delivered alert names an accountable reviewer
    // and a materiality reason before delivery.
    expect(payload.html).toContain("<strong>Why this matters:</strong>");
    expect(payload.html).toContain(
      "A tracked page changed its headline, form, or creative (1 update) — the competitor is iterating, and nothing in this alert touched pricing or CTA.",
    );
    expect(payload.html).toContain("<strong>Accountable reviewer:</strong> Owner");
    // Alerts already carry per-event "Suggested next action" lines; the
    // accountability block must not duplicate a block-level next action.
    expect(payload.html).not.toContain("<strong>Next action:</strong>");
  });

  it("does not label changed values Before/Now when capture times are missing", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: "meta-1",
      baselineFromRunId: null,
      candidateId: "candidate-1",
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const single = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
    );
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event, { ...event, id: "event-2" }],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
    );

    expect(single.html).toContain(
      "Before/Now comparison not shown because one or both capture times were unavailable or invalid.",
    );
    expect(content.html).toContain(
      "changed values were recorded, but one or both capture times were unavailable or invalid.",
    );
    expect(single.html).not.toContain(">Before<");
    expect(single.html).not.toContain(">Now<");
    // E2 alert increment: even a bare content build names a materiality reason
    // and the truthful default owner before anything is delivered. P1: a
    // confirmed status without capture evidence is NOT a verified change, so
    // the block must say the alert is provisional — never claim a verified
    // pricing move from missing capture timestamps.
    expect(single.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
    expect(single.reviewerLabel).toBe("Workspace owner");
    expect(single.html).toContain("<strong>Why this matters:</strong>");
    expect(single.html).toContain(
      "<strong>Accountable reviewer:</strong> Workspace owner",
    );
    expect(content.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
    expect(content.html).toContain(
      "<strong>Accountable reviewer:</strong> Workspace owner",
    );
  });

  it("keeps a confirmed alert provisional when its proof capture is missing (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: null,
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    // The batch itself is not provisional (policy sees status "confirmed"),
    // but the evidence map holds no entry for the event — fail closed.
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      new Map<string, CustomerEvidenceState>(),
    );
    expect(content.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
    expect(content.materialityReason).not.toContain("pricing or offers moved");
  });

  it("keeps a confirmed alert provisional when its proof capture failed (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const evidence = new Map<string, CustomerEvidenceState>([
      [
        "event-1",
        resolveCustomerEvidenceState({
          event,
          proofCapture: {
            id: "proof-1",
            status: "failed",
            attemptedAt: "2026-04-19T00:00:00.000Z",
            succeededAt: null,
          } as never,
          beforeCapturedAt: "2026-04-18T00:00:00.000Z",
          nowCapturedAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
    ]);
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      evidence,
    );
    expect(evidence.get("event-1")).toBe("provisional_signal");
    expect(content.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
    expect(content.materialityReason).not.toContain("pricing or offers moved");
  });

  it("keeps a confirmed alert provisional when its capture pair is unordered (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const evidence = new Map<string, CustomerEvidenceState>([
      [
        "event-1",
        resolveCustomerEvidenceState({
          event,
          proofCapture: {
            id: "proof-1",
            status: "succeeded",
            attemptedAt: "2026-04-19T00:00:00.000Z",
            succeededAt: "2026-04-19T00:00:00.000Z",
          } as never,
          // Corrupt evidence: the "before" capture is NEWER than the "now".
          beforeCapturedAt: "2026-04-20T00:00:00.000Z",
          nowCapturedAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
    ]);
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      evidence,
    );
    expect(evidence.get("event-1")).toBe("provisional_signal");
    expect(content.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
    expect(content.materialityReason).not.toContain("pricing or offers moved");
  });

  it("renders confirmed materiality only for a succeeded ordered capture pair (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const evidence = new Map<string, CustomerEvidenceState>([
      [
        "event-1",
        resolveCustomerEvidenceState({
          event,
          proofCapture: {
            id: "proof-1",
            status: "succeeded",
            attemptedAt: "2026-04-19T00:00:00.000Z",
            succeededAt: "2026-04-19T00:00:00.000Z",
          } as never,
          beforeCapturedAt: "2026-04-18T00:00:00.000Z",
          nowCapturedAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
    ]);
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      evidence,
    );
    expect(evidence.get("event-1")).toBe("verified_change");
    expect(content.materialityReason).toBe(
      "This alert matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
    );
  });

  it("never marks a mixed batch verified when only one event has evidence (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const offerEvent = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const headlineEvent = {
      ...offerEvent,
      id: "event-2",
      eventType: "landing_page_headline_changed",
      proofCaptureId: null,
      title: "Headline changed",
      summary: "The headline changed.",
      metadata: { from: "Glow Serum Sale", to: "Glow Serum Weekend Sale" },
    } as const;
    const evidence = new Map<string, CustomerEvidenceState>([
      [
        "event-1",
        resolveCustomerEvidenceState({
          event: offerEvent,
          proofCapture: {
            id: "proof-1",
            status: "succeeded",
            attemptedAt: "2026-04-19T00:00:00.000Z",
            succeededAt: "2026-04-19T00:00:00.000Z",
          } as never,
          beforeCapturedAt: "2026-04-18T00:00:00.000Z",
          nowCapturedAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
    ]);
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [offerEvent, headlineEvent],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      evidence,
    );
    // The headline event has no evidence entry, so the batch is a mixed
    // verified/unverified batch: copy counts ONLY the verified offer change
    // and never claims a second verified update. (The "made 2 changes"
    // subject counts filed events — delivery semantics — while the derived
    // materiality block stays verified-only.)
    expect(content.materialityReason).toBe(
      "This alert matters because pricing or offers moved (1 change) — compare before your next campaign decision.",
    );
    expect(content.materialityReason).not.toContain("2 changes");
    expect(content.html).toContain("<strong>Why this matters:</strong>");
    expect(content.html).not.toContain("headline, form, or creative (2 updates)");
  });

  it("says the alert is provisional when no event in the batch is verified (P1)", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: { from: "20% off", to: "40% off" },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    // Two confirmed events, neither verified (both resolve provisional).
    const evidence = new Map<string, CustomerEvidenceState>([
      ["event-1", "provisional_signal"],
      ["event-2", "provisional_signal"],
    ]);
    const content = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event, { ...event, id: "event-2" }],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      evidence,
    );
    expect(content.materialityReason).toBe(
      "This alert is provisional — the change is not yet confirmed by a fresh proof capture, so verify the source before acting.",
    );
  });

  it("renders the before/after screenshot pair in single-event instant alerts when both screenshots are stored", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: {
        from: "20% off",
        to: "40% off",
        beforeCapturedAt: "2026-04-18T00:00:00.000Z",
        capturedAt: "2026-04-19T00:00:00.000Z",
      },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const screenshotPairs = new Map([
      [
        "event-1",
        {
          beforeUrl:
            "https://0509.io/artifacts/proof/landing-pages%2F2026-04-18%2Fprev.jpeg",
          afterUrl:
            "https://0509.io/artifacts/proof/landing-pages%2F2026-04-19%2Fcurr.jpeg",
        },
      ],
    ]);
    const single = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      null,
      screenshotPairs,
    );
    expect(single.html).toContain(
      'src="https://0509.io/artifacts/proof/landing-pages%2F2026-04-18%2Fprev.jpeg"',
    );
    expect(single.html).toContain(
      'src="https://0509.io/artifacts/proof/landing-pages%2F2026-04-19%2Fcurr.jpeg"',
    );
    expect(single.html).toContain("Before");
    expect(single.html).toContain("Now");
  });

  it("keeps the alert text-only when no screenshot pair is resolved", async () => {
    const { buildInstantAlertContent } = await import("~/lib/delivery.server");
    const event = {
      id: "event-1",
      watchlistId: "watch-1",
      runId: "run-1",
      eventType: "landing_page_offer_changed",
      status: "confirmed",
      importanceScore: 90,
      adId: null,
      baselineFromRunId: null,
      candidateId: null,
      proofCaptureId: "proof-1",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: {
        from: "20% off",
        to: "40% off",
        beforeCapturedAt: "2026-04-18T00:00:00.000Z",
        capturedAt: "2026-04-19T00:00:00.000Z",
      },
      confirmedAt: "2026-04-19T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
    } as const;
    const single = buildInstantAlertContent(
      { id: "watch-1", name: "Nykaa watch" },
      [event],
      false,
      { APP_ORIGIN: "https://0509.io" } as never,
      undefined,
      null,
      null,
      new Map(),
    );
    expect(single.html).not.toContain("/artifacts/proof/");
    // The text-only before/now comparison still renders.
    expect(single.html).toContain("20% off");
    expect(single.html).toContain("40% off");
  });
});