import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let emailSend = vi.fn();

const configuredEmailEnv = {
  get EMAIL() {
    return { send: emailSend };
  },
  EMAIL_FROM_EMAIL: "alerts@0509.io",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://0509.io",
};

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
  optedInAt: "2026-07-15T00:00:00.000Z",
  isPaused: false,
  pausedAt: null,
  optedOutAt: null,
  templateEligible: false,
  lastSuccessfulDeliveryAt: null,
  lastSuccessfulAttemptId: null,
  providerIdentifier: null,
  metadata: {},
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const alertInput = {
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
      metadata: { advertiser: "Nykaa" },
      confirmedAt: "2026-07-15T00:00:00.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-07-15T00:00:00.000Z",
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ],
};

type Attempt = Record<string, unknown> & {
  id: string;
  idempotencyKey: string;
  status: string;
  webhookStatus: string;
  updatedAt: string;
};

function installDeliveryMocks(options: {
  initialAttempt?: Attempt | null;
  failMarkOnce?: boolean;
  failFinalizeOnce?: boolean;
} = {}) {
  let attempt = options.initialAttempt ?? null;
  let failMarkOnce = options.failMarkOnce === true;
  let failFinalizeOnce = options.failFinalizeOnce === true;

  const getDeliveryAttemptByIdempotencyKey = vi.fn(async (_env: unknown, key: string) =>
    attempt?.idempotencyKey === key ? { ...attempt } : null,
  );
  const createDeliveryAttempt = vi.fn(async (_env: unknown, input: Record<string, unknown>) => {
    if (attempt) throw new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key");
    const timestamp = String(input.timestamp ?? new Date().toISOString());
    attempt = {
      id: "attempt-1",
      userId: "user-1",
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTargetId,
      lane: input.lane,
      channel: input.channel,
      provider: input.provider,
      status: String(input.status),
      webhookStatus: String(input.webhookStatus),
      targetValue: input.targetValue,
      providerMessageId: input.providerMessageId ?? null,
      providerStatusLastSeenAt: input.providerStatusLastSeenAt ?? null,
      templateName: input.templateName ?? null,
      eventIds: input.eventIds,
      payloadSnapshot: input.payloadSnapshot,
      idempotencyKey: String(input.idempotencyKey),
      errorMessage: input.errorMessage ?? null,
      sentAt: input.sentAt ?? null,
      failedAt: input.failedAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return attempt.id;
  });
  const updateDeliveryAttemptResult = vi.fn(
    async (_env: unknown, id: string, update: Record<string, unknown>) => {
      if (!attempt || attempt.id !== id) return false;
      if (update.expectedStatus && attempt.status !== update.expectedStatus) return false;
      if (update.expectedWebhookStatus && attempt.webhookStatus !== update.expectedWebhookStatus) {
        return false;
      }
      if (update.expectedUpdatedAt && attempt.updatedAt !== update.expectedUpdatedAt) return false;
      const isDispatchMark =
        update.status === "pending" &&
        update.webhookStatus === "provider_unknown" &&
        update.expectedWebhookStatus === "pending";
      const isFinalization = update.expectedWebhookStatus === "provider_unknown";
      if (isDispatchMark && failMarkOnce) {
        failMarkOnce = false;
        throw new Error("injected pre-dispatch D1 failure");
      }
      if (isFinalization && failFinalizeOnce) {
        failFinalizeOnce = false;
        throw new Error("injected post-provider D1 failure");
      }
      attempt = {
        ...attempt,
        provider: update.provider,
        status: String(update.status),
        webhookStatus: String(update.webhookStatus),
        providerMessageId: update.providerMessageId ?? null,
        providerStatusLastSeenAt: update.providerStatusLastSeenAt ?? null,
        errorMessage: update.errorMessage ?? null,
        sentAt: update.sentAt ?? null,
        failedAt: update.failedAt ?? null,
        payloadSnapshot: update.payloadSnapshot ?? attempt.payloadSnapshot,
        updatedAt: String(update.updatedAt ?? new Date().toISOString()),
      };
      return true;
    },
  );

  vi.doMock("~/lib/data.server", () => ({
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
      quietHours: null,
      timezone: "Asia/Kolkata",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    }),
    getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
    legacyWorkspaceDeliveryDefaults: vi.fn(),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
    updateDeliveryAttemptResult,
    provisionVerifiedAccountEmailTargetIfUnsuppressed: vi.fn().mockResolvedValue(target),
    upsertDeliveryTarget: vi.fn().mockResolvedValue(target),
    upsertDigestDelivery: vi.fn(),
  }));
  vi.doMock("~/lib/whatsapp.server", () => ({
    sendDigestWhatsApp: vi.fn(),
    sendInstantWhatsApp: vi.fn(),
  }));

  return {
    createDeliveryAttempt,
    get attempt() {
      return attempt;
    },
    setAttemptUpdatedAt(value: string) {
      if (attempt) attempt = { ...attempt, updatedAt: value };
    },
    updateDeliveryAttemptResult,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
  emailSend = vi.fn().mockResolvedValue({ messageId: "msg-instant-1" });
  vi.doMock("~/lib/plan.server", () => ({ getUserPlan: vi.fn().mockResolvedValue("starter") }));
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  vi.doUnmock("~/lib/unsubscribe.server");
});

describe("instant alert email delivery claims", () => {
  it("lets concurrent identical batches call the provider exactly once", async () => {
    const state = installDeliveryMocks();
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const results = await Promise.all([
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ]);

    expect(results).toHaveLength(2);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(state.createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(state.attempt).toMatchObject({ status: "sent", webhookStatus: "provider_unknown" });
  });

  it("keeps provider acceptance time out of a duplicate delivery summary", async () => {
    installDeliveryMocks({
      initialAttempt: {
        id: "attempt-accepted-1",
        idempotencyKey:
          "instant:watch-1:customer:email:owner@example.com:watch-1:nykaa:1982304:send",
        status: "sent",
        webhookStatus: "provider_unknown",
        channel: "email",
        targetValue: "owner@example.com",
        providerMessageId: "msg-instant-accepted",
        providerStatusLastSeenAt: "2026-07-15T11:59:00.000Z",
        errorMessage: null,
        sentAt: "2026-07-15T11:59:00.000Z",
        updatedAt: "2026-07-15T11:59:00.000Z",
      },
    });
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      configuredEmailEnv as never,
      alertInput as never,
    );

    expect(result).toMatchObject({
      details: [{ channel: "email", status: "sent", deliveredAt: null }],
    });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("uses genuine receipt time for an already-delivered duplicate", async () => {
    installDeliveryMocks({
      initialAttempt: {
        id: "attempt-delivered-1",
        idempotencyKey:
          "instant:watch-1:customer:email:owner@example.com:watch-1:nykaa:1982304:send",
        status: "sent",
        webhookStatus: "delivered",
        channel: "email",
        targetValue: "owner@example.com",
        providerMessageId: "msg-instant-delivered",
        providerStatusLastSeenAt: "2026-07-15T12:00:00.000Z",
        errorMessage: null,
        sentAt: "2026-07-15T11:59:00.000Z",
        updatedAt: "2026-07-15T12:00:00.000Z",
      },
    });
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    const result = await deliverWatchlistAlerts(
      configuredEmailEnv as never,
      alertInput as never,
    );

    expect(result).toMatchObject({
      details: [
        {
          channel: "email",
          status: "sent",
          deliveredAt: "2026-07-15T12:00:00.000Z",
        },
      ],
    });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("reclaims only a stale pre-dispatch lease after an injected local failure", async () => {
    const state = installDeliveryMocks({ failMarkOnce: true });
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).rejects.toThrow("injected pre-dispatch D1 failure");
    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(state.attempt).toMatchObject({ status: "pending", webhookStatus: "pending" });

    state.setAttemptUpdatedAt("2026-07-15T11:58:00.000Z");
    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(state.attempt).toMatchObject({ status: "sent", webhookStatus: "provider_unknown" });
  });

  it("does not resend after provider acceptance when result persistence fails", async () => {
    const state = installDeliveryMocks({ failFinalizeOnce: true });
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).rejects.toThrow("injected post-provider D1 failure");
    expect(state.attempt).toMatchObject({ status: "pending", webhookStatus: "provider_unknown" });

    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("keeps fallible local work before the dispatch boundary and safely reclaims it", async () => {
    const state = installDeliveryMocks();
    const buildUnsubscribeUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error("injected unsubscribe signing failure"))
      .mockResolvedValue("https://0509.io/unsubscribe?token=test");
    vi.doMock("~/lib/unsubscribe.server", () => ({
      buildUnsubscribeUrl,
    }));
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).rejects.toThrow("injected unsubscribe signing failure");
    expect(emailSend).not.toHaveBeenCalled();
    expect(state.attempt).toMatchObject({ status: "pending", webhookStatus: "pending" });

    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(emailSend).not.toHaveBeenCalled();

    state.setAttemptUpdatedAt("2026-07-15T11:58:00.000Z");
    await expect(
      deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(state.attempt).toMatchObject({ status: "sent", webhookStatus: "provider_unknown" });
  });

  it("keeps a provider exception ambiguous and retries a definite pre-dispatch failure once", async () => {
    const ambiguousState = installDeliveryMocks();
    emailSend.mockRejectedValueOnce(new Error("accepted then connection reset"));
    let loaded = await import("~/lib/delivery.server");

    await expect(
      loaded.deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(ambiguousState.attempt).toMatchObject({ status: "failed", webhookStatus: "provider_unknown" });
    await loaded.deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never);
    expect(emailSend).toHaveBeenCalledTimes(1);

    vi.resetModules();
    emailSend = vi.fn().mockResolvedValue({ messageId: "msg-after-config" });
    const definiteState = installDeliveryMocks();
    vi.doMock("~/lib/plan.server", () => ({ getUserPlan: vi.fn().mockResolvedValue("starter") }));
    loaded = await import("~/lib/delivery.server");
    await loaded.deliverWatchlistAlerts(
      {
        EMAIL_FROM_EMAIL: "alerts@0509.io",
        BETTER_AUTH_SECRET: configuredEmailEnv.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: configuredEmailEnv.BETTER_AUTH_URL,
      } as never,
      alertInput as never,
    );
    expect(definiteState.attempt).toMatchObject({ status: "failed", webhookStatus: "failed" });
    expect(emailSend).not.toHaveBeenCalled();

    await loaded.deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never);
    await loaded.deliverWatchlistAlerts(configuredEmailEnv as never, alertInput as never);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(definiteState.attempt).toMatchObject({ status: "sent", webhookStatus: "provider_unknown" });
  });
});
