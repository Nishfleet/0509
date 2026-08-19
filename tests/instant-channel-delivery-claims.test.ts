import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InstantChannel = "whatsapp" | "slack" | "teams";

type Attempt = Record<string, unknown> & {
  id: string;
  idempotencyKey: string;
  status: string;
  webhookStatus: string;
  updatedAt: string;
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

function target(channel: InstantChannel) {
  return {
    id: `${channel}-target-1`,
    userId: "user-1",
    watchlistId: null,
    channel,
    targetValue:
      channel === "whatsapp"
        ? "919876543210"
        : channel === "slack"
          ? "slack:workspace/channel"
          : "teams:workspace/channel",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource:
      channel === "whatsapp"
        ? "manual_whatsapp_setup"
        : channel === "slack"
          ? "manual_slack_webhook"
          : "manual_teams_webhook",
    optedInAt: "2026-07-15T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: channel === "whatsapp" ? "wamid.setup" : "workspace/channel",
    metadata: {},
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function providerSuccess(channel: InstantChannel) {
  return channel === "whatsapp"
    ? {
        provider: "whatsapp_cloud_api",
        status: "sent" as const,
        webhookStatus: "pending" as const,
        providerMessageId: "wamid.instant-1",
        providerStatusLastSeenAt: "2026-07-15T12:00:00.000Z",
        templateName: "confirmed_instant_customer_v1",
        errorMessage: null,
      }
    : channel === "teams"
      ? {
          provider: "microsoft_teams_incoming_webhook" as const,
          status: "sent" as const,
          webhookStatus: "delivered" as const,
          providerMessageId: null,
          providerStatusLastSeenAt: "2026-07-15T12:00:00.000Z",
          errorMessage: null,
          deliveredAt: "2026-07-15T12:00:00.000Z",
        }
      : {
          provider: "slack_incoming_webhook" as const,
          status: "sent" as const,
          webhookStatus: "delivered" as const,
          providerMessageId: null,
          providerStatusLastSeenAt: "2026-07-15T12:00:00.000Z",
          errorMessage: null,
          deliveredAt: "2026-07-15T12:00:00.000Z",
        };
}

function providerAmbiguous(channel: InstantChannel) {
  return {
    ...providerSuccess(channel),
    status: "failed" as const,
    webhookStatus: "provider_unknown" as const,
    providerMessageId: null,
    errorMessage: `${channel} transport outcome is unknown.`,
    ...(channel === "whatsapp" ? {} : { deliveredAt: null }),
  };
}

function installMocks(
  channel: InstantChannel,
  options: {
    initialAttempt?: Attempt | null;
    forceFirstTwoReads?: boolean;
    failDispatchMarkOnce?: boolean;
    failFinalizeOnce?: boolean;
    providerResults?: Array<Record<string, unknown>>;
    slackPreparationFailure?: boolean;
  } = {},
) {
  let attempt = options.initialAttempt ?? null;
  const initialAttempt = attempt ? { ...attempt } : null;
  let reads = 0;
  let failDispatchMarkOnce = options.failDispatchMarkOnce === true;
  let failFinalizeOnce = options.failFinalizeOnce === true;
  const deliveryTarget = target(channel);
  const provider =
    channel === "whatsapp"
      ? "whatsapp_cloud_api"
      : channel === "slack"
        ? "slack_incoming_webhook"
        : "microsoft_teams_incoming_webhook";
  const providerSend = vi.fn();
  for (const result of options.providerResults ?? [providerSuccess(channel)]) {
    providerSend.mockResolvedValueOnce(result);
  }
  providerSend.mockResolvedValue(providerSuccess(channel));
  const prepareSlackWebhookTarget = vi.fn().mockResolvedValue(
    options.slackPreparationFailure
      ? {
          ok: false,
          result: {
            ...providerSuccess("slack"),
            status: "failed",
            webhookStatus: "failed",
            providerStatusLastSeenAt: null,
            errorMessage: "Slack webhook could not be decrypted.",
            deliveredAt: null,
          },
        }
      : { ok: true, webhookUrl: "https://hooks.slack.test/services/redacted" },
  );
  const prepareTeamsWebhookTarget = vi.fn().mockResolvedValue(
    options.slackPreparationFailure
      ? {
          ok: false,
          result: {
            ...providerSuccess("teams"),
            status: "failed",
            webhookStatus: "failed",
            providerStatusLastSeenAt: null,
            errorMessage: "Teams webhook could not be decrypted.",
            deliveredAt: null,
          },
        }
      : { ok: true, webhookUrl: "https://acme.webhook.office.test/webhookb2/redacted" },
  );

  const getDeliveryAttemptByIdempotencyKey = vi.fn(async (_env: unknown, key: string) => {
    reads += 1;
    if (options.forceFirstTwoReads && reads <= 2) {
      return initialAttempt?.idempotencyKey === key ? { ...initialAttempt } : null;
    }
    return attempt?.idempotencyKey === key ? { ...attempt } : null;
  });
  const createDeliveryAttempt = vi.fn(async (_env: unknown, input: Record<string, unknown>) => {
    if (attempt) throw new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key");
    const timestamp = String(input.timestamp ?? new Date().toISOString());
    attempt = {
      id: "attempt-1",
      ...input,
      idempotencyKey: String(input.idempotencyKey),
      status: String(input.status),
      webhookStatus: String(input.webhookStatus),
      updatedAt: timestamp,
      createdAt: timestamp,
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
      if (isDispatchMark && failDispatchMarkOnce) {
        failDispatchMarkOnce = false;
        throw new Error("injected pre-provider D1 failure");
      }
      if (isFinalization && failFinalizeOnce) {
        failFinalizeOnce = false;
        throw new Error("injected post-provider D1 failure");
      }
      attempt = {
        ...attempt,
        ...update,
        status: String(update.status),
        webhookStatus: String(update.webhookStatus),
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
      emailEnabled: false,
      whatsappEnabled: channel === "whatsapp",
      slackEnabled: channel === "slack",
      teamsEnabled: channel === "teams",
      quietHours: null,
      timezone: "Asia/Kolkata",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    }),
    getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
    legacyWorkspaceDeliveryDefaults: vi.fn(),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn(async (
      _env: unknown,
      _userId: string,
      input?: { channel?: string },
    ) => input?.channel === channel ? [deliveryTarget] : []),
    reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
    updateDeliveryAttemptResult,
    upsertDeliveryTarget: vi.fn().mockResolvedValue(deliveryTarget),
    upsertDigestDelivery: vi.fn(),
  }));
  vi.doMock("~/lib/whatsapp.server", () => ({
    sendDigestWhatsApp: vi.fn(),
    sendInstantWhatsApp: channel === "whatsapp" ? providerSend : vi.fn(),
  }));
  vi.doMock("~/lib/slack-webhook.server", () => ({
    SLACK_PROVIDER: "slack_incoming_webhook",
    prepareSlackWebhookTarget,
    sendSlackWebhookUrl: channel === "slack" ? providerSend : vi.fn(),
    sendSlackWebhookMessage: channel === "slack" ? providerSend : vi.fn(),
  }));
  vi.doMock("~/lib/teams-webhook.server", () => ({
    TEAMS_PROVIDER: "microsoft_teams_incoming_webhook",
    prepareTeamsWebhookTarget,
    sendTeamsWebhookUrl: channel === "teams" ? providerSend : vi.fn(),
    sendTeamsWebhookMessage: channel === "teams" ? providerSend : vi.fn(),
  }));

  return {
    createDeliveryAttempt,
    get attempt() {
      return attempt;
    },
    providerSend,
    prepareSlackWebhookTarget,
    prepareTeamsWebhookTarget,
    setAttemptUpdatedAt(value: string) {
      if (attempt) attempt = { ...attempt, updatedAt: value };
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
  vi.doMock("~/lib/plan.server", () => ({ getUserPlan: vi.fn().mockResolvedValue("starter") }));
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
  vi.resetModules();
  vi.useRealTimers();
});

describe.each<InstantChannel>(["whatsapp", "slack", "teams"])(
  "instant %s delivery claims",
  (channel) => {
    it("lets concurrent first workers invoke the provider at most once", async () => {
      const state = installMocks(channel, { forceFirstTwoReads: true });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await expect(Promise.all([
        deliverWatchlistAlerts({} as never, alertInput as never),
        deliverWatchlistAlerts({} as never, alertInput as never),
      ])).resolves.toHaveLength(2);

      expect(state.providerSend).toHaveBeenCalledTimes(1);
      expect(state.createDeliveryAttempt).toHaveBeenCalledTimes(1);
      expect(state.attempt).toMatchObject({ status: "sent" });
    });

    it("lets concurrent definite-failure retries invoke the provider at most once", async () => {
      const targetValue = target(channel).targetValue;
      const state = installMocks(channel, {
        forceFirstTwoReads: true,
        initialAttempt: {
          id: "attempt-1",
          idempotencyKey: `instant:watch-1:customer:${channel}:${targetValue}:watch-1:nykaa:1982304:send`,
          status: "failed",
          webhookStatus: "failed",
          payloadSnapshot: { deliveryClaimProtocol: "instant_preclaim_v1" },
          updatedAt: "2026-07-15T11:59:00.000Z",
        },
      });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await expect(Promise.all([
        deliverWatchlistAlerts({} as never, alertInput as never),
        deliverWatchlistAlerts({} as never, alertInput as never),
      ])).resolves.toHaveLength(2);

      expect(state.providerSend).toHaveBeenCalledTimes(1);
      expect(state.attempt).toMatchObject({ status: "sent" });
    });

    it("reclaims a definite pre-provider failure without risking an immediate duplicate", async () => {
      const state = installMocks(channel, { failDispatchMarkOnce: true });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await expect(
        deliverWatchlistAlerts({} as never, alertInput as never),
      ).rejects.toThrow("injected pre-provider D1 failure");
      await deliverWatchlistAlerts({} as never, alertInput as never);
      expect(state.providerSend).not.toHaveBeenCalled();

      state.setAttemptUpdatedAt("2026-07-15T11:58:00.000Z");
      await deliverWatchlistAlerts({} as never, alertInput as never);
      expect(state.providerSend).toHaveBeenCalledTimes(1);
    });

    it("does not resend after provider acceptance when final persistence fails", async () => {
      const state = installMocks(channel, { failFinalizeOnce: true });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await expect(
        deliverWatchlistAlerts({} as never, alertInput as never),
      ).rejects.toThrow("injected post-provider D1 failure");
      expect(state.attempt).toMatchObject({ status: "pending", webhookStatus: "provider_unknown" });

      await deliverWatchlistAlerts({} as never, alertInput as never);
      expect(state.providerSend).toHaveBeenCalledTimes(1);
    });

    it("does not auto-resend an ambiguous provider outcome", async () => {
      const state = installMocks(channel, { providerResults: [providerAmbiguous(channel)] });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await deliverWatchlistAlerts({} as never, alertInput as never);
      expect(state.attempt).toMatchObject({ status: "failed", webhookStatus: "provider_unknown" });
      await deliverWatchlistAlerts({} as never, alertInput as never);

      expect(state.providerSend).toHaveBeenCalledTimes(1);
    });

    it("does not auto-resend an unclassified failure written before durable preclaims", async () => {
      const targetValue = target(channel).targetValue;
      const state = installMocks(channel, {
        initialAttempt: {
          id: "attempt-1",
          idempotencyKey: `instant:watch-1:customer:${channel}:${targetValue}:watch-1:nykaa:1982304:send`,
          status: "failed",
          webhookStatus: "failed",
          payloadSnapshot: { kind: "instant_alert" },
          updatedAt: "2026-07-15T11:59:00.000Z",
        },
      });
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

      await deliverWatchlistAlerts({} as never, alertInput as never);

      expect(state.providerSend).not.toHaveBeenCalled();
      expect(state.attempt).toMatchObject({ status: "failed", webhookStatus: "failed" });
    });
  },
);

it("fails Teams local preparation before crossing the provider boundary", async () => {
  const state = installMocks("teams", { slackPreparationFailure: true });
  const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

  await deliverWatchlistAlerts({} as never, alertInput as never);

  expect(state.prepareTeamsWebhookTarget).toHaveBeenCalledTimes(1);
  expect(state.providerSend).not.toHaveBeenCalled();
  expect(state.attempt).toMatchObject({
    status: "failed",
    webhookStatus: "failed",
  });
});

it("fails Slack local preparation before crossing the provider boundary", async () => {
  const state = installMocks("slack", { slackPreparationFailure: true });
  const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");

  await deliverWatchlistAlerts({} as never, alertInput as never);

  expect(state.prepareSlackWebhookTarget).toHaveBeenCalledTimes(1);
  expect(state.providerSend).not.toHaveBeenCalled();
  expect(state.attempt).toMatchObject({
    status: "failed",
    webhookStatus: "failed",
    providerStatusLastSeenAt: null,
    errorMessage: "Slack webhook could not be decrypted.",
  });
});
