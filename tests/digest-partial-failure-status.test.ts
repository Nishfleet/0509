import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIGEST_PROVIDER_CLAIM_PROTOCOL } from "~/lib/delivery-attempt-lease";

/**
 * Issue #2450 — partial multi-channel digest failure was recorded as "sent".
 *
 * `selectDigestStatusAttempt` used to scan channels in priority order for ANY
 * `sent` attempt first, so a failed email + a sent Slack recorded the digest run
 * as `sent`. `runDigestForUser` short-circuits on a `sent` delivery, so the
 * failed channel was never retried. These tests pin the honest aggregate:
 * a definitively failed attempt wins over a sent one.
 *
 * RED before the fix: "records the digest as failed when email failed and Slack
 * was sent" (that one fails on origin/main; the others pass there and pin the
 * behaviour the fix must not break).
 *
 * Retry re-dispatch is demonstrated by "re-dispatches a definitively failed
 * email attempt on the second run", which drives `deliverWeeklyDigest` twice
 * against one durable attempt row and asserts the provider is called again.
 */

let emailSend = vi.fn();

const emailEnv = {
  get EMAIL() {
    return { send: emailSend };
  },
  EMAIL_FROM_EMAIL: "alerts@0509.io",
};

const PERIOD_START = "2026-04-12T00:00:00.000Z";
const PERIOD_END = "2026-04-19T00:00:00.000Z";

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

function emailTarget() {
  return {
    id: "email-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "account_email",
    optedInAt: "2026-04-12T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: false,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
  };
}

function slackTarget() {
  return {
    ...emailTarget(),
    id: "slack-target-1",
    channel: "slack",
    targetValue: "slack:abc123",
    optInSource: "manual_slack_webhook",
    providerIdentifier: "abc123",
  };
}

function mockDataServer(options: {
  targets: unknown[];
  upsertDigestDelivery: ReturnType<typeof vi.fn>;
  existingAttempt?: unknown;
}) {
  const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
  const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);

  vi.doMock("~/lib/data.server", () => ({
    listAdsByIds: vi.fn().mockResolvedValue([]),
    createDeliveryAttempt,
    updateDeliveryAttemptResult,
    getDeliveryAttemptByIdempotencyKey: vi
      .fn()
      .mockResolvedValue(options.existingAttempt ?? null),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
      id: "workspace-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: true,
      quietHours: null,
      timezone: "Asia/Kolkata",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    }),
    legacyWorkspaceDeliveryDefaults: vi.fn(),
    listDeliveryTargets: vi.fn(
      async (_env: unknown, _userId: string, filters?: { channel?: string }) =>
        filters?.channel
          ? options.targets.filter(
              (target) =>
                (target as { channel?: string }).channel === filters.channel,
            )
          : options.targets,
    ),
    provisionVerifiedAccountEmailTargetIfUnsuppressed: vi.fn(),
    upsertDeliveryTarget: vi.fn(),
    upsertDigestDelivery: options.upsertDigestDelivery,
  }));

  return { createDeliveryAttempt, updateDeliveryAttemptResult };
}

function mockSlack(sendSlackWebhookMessage: ReturnType<typeof vi.fn>) {
  vi.doMock("~/lib/slack-webhook.server", () => ({
    SLACK_PROVIDER: "slack_incoming_webhook",
    prepareSlackWebhookTarget: vi.fn().mockResolvedValue({
      ok: true,
      webhookUrl: "https://hooks.slack.test/1",
    }),
    sendSlackWebhookUrl: sendSlackWebhookMessage,
    sendSlackWebhookMessage,
  }));
}

const PLAN_LIMITS_FIXTURE = {
  free: { digests: false, digestCadence: "none" },
  scout: { digests: true, digestCadence: "weekly" },
  starter: { digests: true, digestCadence: "weekly" },
  agency: { digests: true, digestCadence: "daily_and_weekly" },
};
const planServerMock = {
  getUserPlan: vi.fn(),
  PLAN_LIMITS: PLAN_LIMITS_FIXTURE,
};

beforeEach(() => {
  vi.resetModules();
  emailSend = vi.fn();
  // One plan.server mock for the whole file. The orchestration re-entry
  // tests used to register a second factory for the same module; under CI
  // load the dynamic import sometimes resolved the first one, which carried
  // no PLAN_LIMITS, and the job died before delivery ("No PLAN_LIMITS export
  // is defined on the mock" — the digest-partial-failure flake retriggered
  // five times on main). Tests change the resolved plan on the shared spy
  // instead of re-registering the module.
  planServerMock.getUserPlan.mockReset();
  planServerMock.getUserPlan.mockResolvedValue("starter");
  vi.doMock("~/lib/plan.server", () => planServerMock);
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("~/lib/ga-customer-surface", () => ({
    isSlackDeliveryCustomerFacing: () => true,
    isSlackWebhookDeliveryCustomerFacing: () => true,
    isTeamsWebhookDeliveryCustomerFacing: () => true,
    isWhatsAppDeliveryCustomerFacing: () => true,
  }));
  vi.doMock("~/lib/whatsapp.server", () => ({
    sendDigestWhatsApp: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/ga-customer-surface");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/slack-webhook.server");
  vi.doUnmock("~/lib/whatsapp.server");
  vi.doUnmock("~/lib/auth.server");
});

describe("issue #2450 — partial digest failure aggregate status", () => {
  it("records the digest as failed when email failed and Slack was sent", async () => {
    emailSend = vi.fn().mockRejectedValue(new Error("network timeout"));
    const upsertDigestDelivery = vi.fn();
    mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
    });
    mockSlack(
      vi.fn().mockResolvedValue({
        provider: "slack_incoming_webhook",
        status: "sent",
        webhookStatus: "delivered",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
        errorMessage: null,
        deliveredAt: "2026-04-19T00:01:00.000Z",
      }),
    );

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const result = await deliverWeeklyDigest(emailEnv as never, digestInput());

    expect(result.details.map((attempt) => [attempt.channel, attempt.status])).toEqual([
      ["email", "failed"],
      ["slack", "sent"],
    ]);
    // The failed channel must win the aggregate, or the orchestration
    // short-circuit on "sent" kills the retry of the email channel forever.
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "failed",
        recipientEmail: "owner@example.com",
        errorMessage:
          "Cloudflare Email send outcome is unknown after provider exception: network timeout.",
      }),
    );
  });

  it("records the digest as failed when every channel failed", async () => {
    emailSend = vi.fn().mockRejectedValue(new Error("network timeout"));
    const upsertDigestDelivery = vi.fn();
    mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
    });
    mockSlack(
      vi.fn().mockResolvedValue({
        provider: "slack_incoming_webhook",
        status: "failed",
        webhookStatus: "failed",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
        errorMessage: "Slack rejected the digest payload.",
        deliveredAt: null,
      }),
    );

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest(emailEnv as never, digestInput());

    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("still records the digest as sent when every channel succeeded", async () => {
    emailSend = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    const upsertDigestDelivery = vi.fn();
    mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
    });
    mockSlack(
      vi.fn().mockResolvedValue({
        provider: "slack_incoming_webhook",
        status: "sent",
        webhookStatus: "delivered",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
        errorMessage: null,
        deliveredAt: "2026-04-19T00:01:00.000Z",
      }),
    );

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest(emailEnv as never, digestInput());

    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("keeps a pending channel as the aggregate when another channel failed", async () => {
    // Scope guard, per the reviewer round: the fix changes exactly one rule
    // (sent + failed). A pending channel with no sent attempt anywhere keeps
    // its previous outcome — the first attempted channel in priority order.
    vi.useFakeTimers();
    emailSend = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const upsertDigestDelivery = vi.fn();
    mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
    });
    mockSlack(
      vi.fn().mockResolvedValue({
        provider: "slack_incoming_webhook",
        status: "failed",
        webhookStatus: "failed",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
        errorMessage: "Slack rejected the digest payload.",
        deliveredAt: null,
      }),
    );

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const resultPromise = deliverWeeklyDigest(emailEnv as never, digestInput());
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    await resultPromise;

    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        status: "pending",
        recipientEmail: "owner@example.com",
      }),
    );
  });

  it("records a sent channel as the aggregate when the other channel is only pending", async () => {
    // Unchanged by this fix, and deliberate: a provider-unknown "pending"
    // attempt is not a definitive failure, so it does not override a sent
    // channel. The run still cannot pass the orchestration gate —
    // `countAcceptedDigestDelivery` throws on any non-sent detail — so the
    // retry sweep still re-enters for the pending channel.
    vi.useFakeTimers();
    emailSend = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const upsertDigestDelivery = vi.fn();
    mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
    });
    mockSlack(
      vi.fn().mockResolvedValue({
        provider: "slack_incoming_webhook",
        status: "sent",
        webhookStatus: "delivered",
        providerMessageId: null,
        providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
        errorMessage: null,
        deliveredAt: "2026-04-19T00:01:00.000Z",
      }),
    );

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    const resultPromise = deliverWeeklyDigest(emailEnv as never, digestInput());
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.details.map((attempt) => [attempt.channel, attempt.status])).toEqual([
      ["email", "pending"],
      ["slack", "sent"],
    ]);
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("re-dispatches a definitively failed email attempt on the second run", async () => {
    // The end-to-end retry the issue describes: one durable email attempt row
    // already marked failed/failed (a definitive provider rejection, which is
    // the reclaimable shape), plus a sent Slack attempt. Before the fix the
    // run's aggregate was "sent" and the second pass short-circuited; now the
    // aggregate is "failed", so the second pass re-enters and the failed
    // channel is dispatched again while the sent channel stays deduped.
    emailSend = vi.fn().mockResolvedValue({ messageId: "msg_2" });
    const durableFailedEmailAttempt = {
      id: "attempt-email-1",
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
      providerStatusLastSeenAt: "2026-04-19T00:00:30.000Z",
      templateName: null,
      eventIds: ["event-1"],
      payloadSnapshot: {
        deliveryClaimProtocol: DIGEST_PROVIDER_CLAIM_PROTOCOL,
      },
      idempotencyKey:
        "digest:digest-1:customer:email:owner@example.com",
      errorMessage: "Provider rejected the message.",
      sentAt: null,
      failedAt: "2026-04-19T00:00:30.000Z",
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:30.000Z",
    };
    const upsertDigestDelivery = vi.fn();
    const { createDeliveryAttempt, updateDeliveryAttemptResult } = mockDataServer({
      targets: [emailTarget(), slackTarget()],
      upsertDigestDelivery,
      existingAttempt: durableFailedEmailAttempt,
    });
    const sendSlackWebhookMessage = vi.fn().mockResolvedValue({
      provider: "slack_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      providerMessageId: null,
      providerStatusLastSeenAt: "2026-04-19T00:01:00.000Z",
      errorMessage: null,
      deliveredAt: "2026-04-19T00:01:00.000Z",
    });
    mockSlack(sendSlackWebhookMessage);

    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
    await deliverWeeklyDigest(emailEnv as never, digestInput());

    // The reclaim CAS (failed -> pending) runs against the durable row, then
    // the provider is called again for the previously failed channel.
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      durableFailedEmailAttempt.id,
      expect.objectContaining({ expectedStatus: "failed", status: "pending" }),
    );
    expect(emailSend).toHaveBeenCalledTimes(1);
    // No second attempt row is created for the reclaim path.
    expect(createDeliveryAttempt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: "email" }),
    );
    // The aggregate is still honest after the retry write.
    expect(upsertDigestDelivery).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({ status: "sent" }),
    );
  });

  //
  // The orchestration short-circuit itself: these tests mock the delivery
  // module and feed the aggregate fixture, so they prove the `status ===
  // "sent"` gate that the aggregate above controls. That gate is the reason
  // an honest "failed" aggregate matters.
  //
  describe("orchestration re-entry", () => {
    const DIGEST_ID = "digest-1";
    const JOB_ID = "job-1";

    function scheduledDataServer(deliveryStatus: "sent" | "failed" | null) {
      return {
        addDigestItem: vi.fn(),
        claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
        clearDigestItems: vi.fn(),
        completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
        createDigestRun: vi
          .fn()
          .mockResolvedValue({ digestRunId: DIGEST_ID, created: true }),
        getDigest: vi.fn().mockResolvedValue(null),
        getDigestByPeriod: vi.fn().mockResolvedValue({
          id: DIGEST_ID,
          userId: "user-1",
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          summary: { digestItemSetProvenance: "atomic-v2", totalEvents: 0 },
          createdAt: PERIOD_END,
          items: [],
          delivery: deliveryStatus ? { status: deliveryStatus } : null,
        }),
        getSuccessfulRunStatsForUserBetween: vi
          .fn()
          .mockResolvedValue({ runs: 1, watchlistsChecked: 1, adsSeen: 1 }),
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
        listAdsByIds: vi.fn().mockResolvedValue([]),
        listDigests: vi.fn().mockResolvedValue([]),
        listEventCandidates: vi.fn().mockResolvedValue([]),
        listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
        listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
        listWatchEventsBetween: vi.fn().mockResolvedValue([]),
        listWatchlists: vi.fn().mockResolvedValue([]),
        updateDigestRunSummary: vi.fn(),
        upsertDigestDelivery: vi.fn(),
        enqueueDigestScheduleJobs: vi.fn().mockResolvedValue(0),
        exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
        listRetryableDigestScheduleJobs: vi
          .fn()
          .mockResolvedValue([
            {
              id: JOB_ID,
              userId: "user-1",
              userEmail: "owner@example.com",
              userName: "Owner",
              cadence: "weekly",
              periodStart: PERIOD_START,
              periodEnd: PERIOD_END,
              attemptCount: 1,
            },
          ]),
        claimDigestScheduleJob: vi.fn().mockResolvedValue({
          id: JOB_ID,
          userId: "user-1",
          userEmail: "owner@example.com",
          userName: "Owner",
          cadence: "weekly",
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          attemptCount: 1,
        }),
        completeDigestScheduleJob: vi.fn().mockResolvedValue(true),
        failDigestScheduleJob: vi.fn().mockResolvedValue(true),
      };
    }

    async function runScheduledCycle(deliveryStatus: "sent" | "failed" | null) {
      vi.resetModules();
      const data = scheduledDataServer(deliveryStatus);
      const deliverWeeklyDigest = vi
        .fn()
        .mockResolvedValue({ attempts: 2, channels: ["email", "slack"], details: [] });
      vi.doMock("~/lib/auth.server", () => ({}));
      vi.doMock("~/lib/data.server", () => data);
      vi.doMock("~/lib/delivery.server", () => ({
        deliverWeeklyDigest,
        deliverScanTroubleNotice: vi.fn(),
      }));
      planServerMock.getUserPlan.mockResolvedValue("agency");
      vi.doMock("~/lib/digest-strategy-generation.server", () => ({
        createDigestStrategyGenerationDeadline: () => Date.now() + 60_000,
        createDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
        recoverDigestStrategyGeneration: vi.fn().mockResolvedValue({
          outcome: "complete",
          digest: null,
        }),
        settleDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
      }));

      const { runDigestDeliveryCycleDetailed } = await import(
        "~/lib/digest-orchestration.server"
      );
      await runDigestDeliveryCycleDetailed({ DB: {} } as never, {
        cadence: "weekly",
        periodEnd: PERIOD_END,
      });
      vi.doUnmock("~/lib/auth.server");
      vi.doUnmock("~/lib/data.server");
      vi.doUnmock("~/lib/delivery.server");
      vi.doUnmock("~/lib/digest-strategy-generation.server");
      return deliverWeeklyDigest;
    }

    it("re-attempts the digest run when the aggregate is failed", async () => {
      const deliverWeeklyDigest = await runScheduledCycle("failed");
      expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    });

    it("re-attempts the digest run when no delivery row exists yet", async () => {
      const deliverWeeklyDigest = await runScheduledCycle(null);
      expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);
    });

    it("short-circuits the digest run when the aggregate is sent", async () => {
      // This is the short-circuit the issue names. It is only safe once the
      // aggregate is honest about partial failure (the tests above).
      const deliverWeeklyDigest = await runScheduledCycle("sent");
      expect(deliverWeeklyDigest).not.toHaveBeenCalled();
    });
  });
});
