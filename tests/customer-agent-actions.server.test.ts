import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApprovedReportSnapshot } from "~/lib/report-approval";
import type { AgentActionAuditRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watchlist-1",
  userId: "user-1",
  name: "Glossier watch",
  targetType: "advertiser",
  targetId: "https://glossier.com",
  targetFingerprint: "fp-glossier",
  targetLabel: "Glossier",
  targetCountry: "all",
  trackingRole: "competitor",
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
};

const collection = {
  id: "collection-1",
  userId: "user-1",
  name: "Client proof",
  description: "Proof for the weekly review.",
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
};

const deliveryTarget = {
  id: "target-1",
  userId: "user-1",
  watchlistId: "watchlist-1",
  channel: "slack",
  targetValue: "slack:abc123",
  validationStatus: "validated",
  isValidated: true,
  isOptedIn: true,
  optInSource: "slack_webhook",
  optedInAt: "2026-06-19T00:00:00.000Z",
  isPaused: false,
  pausedAt: null,
  optedOutAt: null,
  templateEligible: false,
  lastSuccessfulDeliveryAt: null,
  lastSuccessfulAttemptId: null,
  providerIdentifier: "slack-webhook:secret",
  metadata: {
    displayName: "#growth",
    encryptedWebhookUrl: "https://hooks.slack.com/services/team/channel/token",
  },
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
} as const;

const customerMetaConnection = {
  id: "meta-connection-1",
  userId: "user-1",
  encryptedAccessToken: "encrypted-meta-token",
  tokenLastFour: "1234",
  tokenFingerprint: "meta-token-fingerprint",
  status: "healthy",
  summary: "Connected. Five to Nine can use this customer-owned token for Meta Ad Library API fallback.",
  lastCheckedAt: "2026-06-20T00:00:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: "Raw Meta response that should not leave the server.",
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
} as const;

const externalAd = {
  metaAdId: "external:linkedin:proof-1",
  advertiser: "Glossier",
  body: "Creator hook",
  previewHeadline: "Creator hook",
  previewSubhead: "LinkedIn",
  hook: "Creator hook",
  offer: "",
  cta: "",
  format: "unknown",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: null,
  countries: [],
  platforms: ["LinkedIn"],
  firstSeenAt: "2026-06-19T00:00:00.000Z",
  lastSeenAt: null,
  active: false,
  researchSummary: "Manual proof.",
  source: "external",
  analysisFields: [],
};

const watchEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watchlist-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 90,
  adId: "external:linkedin:proof-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Offer changed",
  summary: "The offer changed.",
  metadata: {
    from: "Starting at ₹499",
    to: "Starting at ₹799",
  },
  confirmedAt: "2026-06-19T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-06-19T00:00:00.000Z",
  createdAt: "2026-06-19T00:00:00.000Z",
};

function auditRecord(input: Partial<AgentActionAuditRecord> = {}): AgentActionAuditRecord {
  return {
    id: "audit-1",
    userId: "user-1",
    apiKeyId: "api-key-1",
    actionName: "watchlist.create",
    resourceType: null,
    resourceId: null,
    idempotencyKey: "idem-1",
    status: "started",
    result: null,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...input,
  };
}

/**
 * Stand-in for `runAtomicAgentAction`. Tests that need a different atomic
 * runner must pass it through `setupMocks`, never re-register
 * `~/lib/agent-actions.server` with a second `vi.doMock`: Vitest resolves
 * consecutively queued mock registrations in parallel and registers them in
 * settle order, so a second registration of an already-queued path races with
 * this helper and intermittently loses.
 */
type AtomicAgentActionRunner = (
  env: never,
  context: { actionName: string },
  options: {
    prepare: (
      db: never,
      auditId: string,
    ) => Promise<{ result: Record<string, unknown> }> | { result: Record<string, unknown> };
  },
) => Promise<{ audit: AgentActionAuditRecord; replayed: boolean; result: unknown }>;

function setupMocks(
  options: {
    planLimitAllowed?: boolean;
    plan?: string;
    runAtomicAgentAction?: AtomicAgentActionRunner;
  } = {},
) {
  const mocks = {
    checkPlanLimit: vi.fn().mockResolvedValue({
      allowed: options.planLimitAllowed ?? true,
      limit: 10,
      current: options.planLimitAllowed === false ? 10 : 1,
    }),
    getUserPlan: vi.fn().mockResolvedValue(options.plan ?? "agency"),
    createCollection: vi.fn().mockResolvedValue(collection),
    createCollectionWithinLimit: vi.fn().mockResolvedValue(options.planLimitAllowed === false
      ? {
        status: "over_cap",
        collection: null,
        limit: 10,
        current: 10,
      }
      : {
        status: "created",
        collection,
        limit: 10,
        current: 2,
      }),
    createWatchlist: vi.fn().mockResolvedValue(watchlist),
    createWatchlistWithinLimit: vi.fn().mockResolvedValue(options.planLimitAllowed === false
      ? {
        status: "over_cap",
        watchlist: null,
        limit: 10,
        current: 10,
      }
      : {
        status: "created",
        watchlist,
        limit: 10,
        current: 2,
      }),
    deleteUnscannedWatchlistCreatedByFailedAgentAction: vi.fn().mockResolvedValue(true),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    updateWatchlist: vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Glossier retained watch",
      targetLabel: "Glossier",
      trackingRole: "self",
    }),
    setWatchlistActive: vi.fn().mockResolvedValue(true),
    queueFirstWatchlistScan: vi.fn(),
    runWatchlistManual: vi.fn().mockResolvedValue({ status: "succeeded" }),
    addExternalProofToCollection: vi.fn().mockResolvedValue(externalAd),
    getCollection: vi.fn().mockResolvedValue(collection),
    getClientRoom: vi.fn().mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Beauty client",
      clientLabel: "Nykaa",
      status: "active",
      resourceRefs: [],
      notes: {},
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }),
    getClientRoomByName: vi.fn().mockResolvedValue(null),
    getDigest: vi.fn().mockResolvedValue({
      id: "digest-1",
      userId: "user-1",
    }),
    getLatestDigestRunSummaryForWatchlist: vi.fn().mockResolvedValue({
      paragraph: "Glossier raised the offer threshold while the rest of the watch stayed quiet.",
      generatedAt: "2026-06-19T05:05:00.000Z",
      periodEnd: "2026-06-19T05:00:00.000Z",
    }),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listCollectionItems: vi.fn().mockResolvedValue([]),
    listProofCapturePairsForEventIds: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([deliveryTarget]),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
      id: "workspace-delivery-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
  digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      quietHours: null,
      timezone: null,
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }),
    getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
    upsertWatchlistDeliveryConfig: vi.fn().mockResolvedValue({
      id: "watchlist-delivery-1",
      watchlistId: "watchlist-1",
      userId: "user-1",
      sensitivityMode: "aggressive",
      instantEnabled: true,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      quietHours: { startHour: 21, endHour: 8 },
      timezone: "Asia/Kolkata",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }),
    getDeliveryTargetById: vi.fn().mockResolvedValue(deliveryTarget),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    }),
    getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
    upsertDeliveryTarget: vi.fn().mockResolvedValue({
      ...deliveryTarget,
      isPaused: true,
    }),
    listWebMentionTargets: vi.fn().mockResolvedValue([
      {
        id: "web-target-1",
        userId: "user-1",
        watchlistId: "watchlist-1",
        trackingRole: "competitor",
        label: "Glossier",
        queryText: "Glossier",
        domain: null,
        sources: ["reddit", "x", "blog", "youtube", "substack", "web"],
        isActive: true,
        lastCheckedAt: null,
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ]),
    listWebMentionObservations: vi.fn().mockResolvedValue([
      {
        id: "web-obs-1",
        targetId: "web-target-1",
        userId: "user-1",
        source: "blog",
        sourceId: "post-1",
        url: "https://glossier.com/blog/launch",
        title: "Glossier launch",
        author: "user",
        excerpt: "Proof-backed mention",
        publishedAt: "2026-06-18T00:00:00.000Z",
        observedAt: "2026-06-19T00:00:00.000Z",
        sentiment: "neutral",
        engagement: { comments: 4 },
        createdAt: "2026-06-19T00:00:00.000Z",
      },
    ]),
    retestSavedCustomerMetaToken: vi.fn().mockResolvedValue({
      ok: true,
      connection: customerMetaConnection,
      testResult: {
        ok: true,
        status: "healthy",
        summary: customerMetaConnection.summary,
        errorCode: null,
        errorMessage: customerMetaConnection.lastErrorMessage,
      },
    }),
    createShareLink: vi.fn().mockResolvedValue({
      id: "share-1",
      token: "sharetoken1",
      expiresAt: "2026-09-19T00:00:00.000Z",
    }),
    getShareLinkById: vi.fn().mockResolvedValue({
      id: "share-1",
      token: "sharetoken1",
      userId: "user-1",
      resourceType: "collection",
      resourceId: "collection-1",
      isSnapshot: false,
      snapshotPayload: null,
      createdAt: "2026-06-19T00:00:00.000Z",
      expiresAt: "2026-09-19T00:00:00.000Z",
      revokedAt: null,
    }),
    upsertAgentMemory: vi.fn().mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      scope: "brand",
      key: "voice",
      watchlistId: null,
      clientRoomId: null,
      value: { tone: "plainspoken" },
      source: "api_v1",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }),
    listAgentMemory: vi.fn().mockResolvedValue([
      {
        id: "memory-1",
        userId: "user-1",
        scope: "brand",
        key: "voice",
        watchlistId: null,
        clientRoomId: null,
        value: { tone: "plainspoken" },
        source: "api_v1",
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ]),
    upsertClientRoom: vi.fn().mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Beauty client",
      clientLabel: "Nykaa",
      status: "active",
      resourceRefs: [
        {
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          label: "Nykaa watch",
        },
      ],
      notes: {
        goal: "Weekly proof review",
      },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }),
    listClientRooms: vi.fn().mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "Beauty client",
        clientLabel: "Nykaa",
        status: "active",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Nykaa watch",
          },
        ],
        notes: {
          goal: "Weekly proof review",
        },
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ]),
    createSupportCase: vi.fn().mockResolvedValue({
      id: "case-1",
      userId: "user-1",
      requestKey: "support-1",
      category: "delivery",
      priority: "normal",
      status: "open",
      subject: "Digest did not arrive",
      detail: "Private support detail should not return to the agent.",
      context: {
        apiKeyId: "api-key-1",
        createdFrom: "agent_action",
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
    listSupportCases: vi.fn().mockResolvedValue([
      {
        id: "case-1",
        userId: "user-1",
        requestKey: "support-1",
        category: "delivery",
        priority: "normal",
        status: "open",
        subject: "Digest did not arrive",
        detail: "Private support detail should not return to the agent.",
        context: {
          apiKeyId: "api-key-1",
          createdFrom: "agent_action",
        },
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    ]),
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    claimAgentActionAudit: vi.fn().mockResolvedValue({
      audit: auditRecord(),
      claimed: true,
    }),
    reclaimRetryableAgentActionAudit: vi.fn().mockImplementation((_, input: { auditId: string }) =>
      Promise.resolve(auditRecord({
        id: input.auditId,
        apiKeyId: "api-key-1",
        actionName: "support_case.create",
        status: "started",
      })),
    ),
    finishAgentActionAudit: vi.fn().mockImplementation((_, auditId: string, input: Record<string, unknown>) =>
      Promise.resolve(auditRecord({
        id: auditId,
        status: input.status as AgentActionAuditRecord["status"],
        resourceType: input.resourceType as string | null,
        resourceId: input.resourceId as string | null,
        result: input.result as Record<string, unknown> | null,
        metadata: input.metadata as Record<string, unknown>,
      })),
    ),
    sendOperatorAlertEmail: vi.fn().mockResolvedValue(true),
  };

  vi.doMock("~/lib/plan.server", () => ({
    checkPlanLimit: mocks.checkPlanLimit,
    getUserPlan: mocks.getUserPlan,
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
  vi.doMock("~/lib/data.server", () => ({
    addExternalProofToCollection: mocks.addExternalProofToCollection,
    createCollection: mocks.createCollection,
    createCollectionWithinLimit: mocks.createCollectionWithinLimit,
    createShareLink: mocks.createShareLink,
    createSupportCase: mocks.createSupportCase,
    createWatchlist: mocks.createWatchlist,
    createWatchlistWithinLimit: mocks.createWatchlistWithinLimit,
    deleteUnscannedWatchlistCreatedByFailedAgentAction:
      mocks.deleteUnscannedWatchlistCreatedByFailedAgentAction,
    getDeliveryTargetById: mocks.getDeliveryTargetById,
    getClientRoom: mocks.getClientRoom,
    getClientRoomByName: mocks.getClientRoomByName,
    getCollection: mocks.getCollection,
    getDigest: mocks.getDigest,
    getLatestDigestRunSummaryForWatchlist: mocks.getLatestDigestRunSummaryForWatchlist,
    getShareLinkById: mocks.getShareLinkById,
    getWatchlist: mocks.getWatchlist,
    getWatchlistDeliveryConfig: mocks.getWatchlistDeliveryConfig,
    getUserDeliveryProfile: mocks.getUserDeliveryProfile,
    getDeliveryAttemptByIdempotencyKey: mocks.getDeliveryAttemptByIdempotencyKey,
    getWorkspaceDeliveryConfig: mocks.getWorkspaceDeliveryConfig,
    listAdsByIds: mocks.listAdsByIds,
    listAgentMemory: mocks.listAgentMemory,
    listClientRooms: mocks.listClientRooms,
    listCollectionItems: mocks.listCollectionItems,
    listProofCapturePairsForEventIds: mocks.listProofCapturePairsForEventIds,
    listDeliveryTargets: mocks.listDeliveryTargets,
    listSupportCases: mocks.listSupportCases,
    listWatchEvents: mocks.listWatchEvents,
    listWebMentionObservations: mocks.listWebMentionObservations,
    listWebMentionTargets: mocks.listWebMentionTargets,
    setWatchlistActive: mocks.setWatchlistActive,
    updateWatchlist: mocks.updateWatchlist,
    upsertClientRoom: mocks.upsertClientRoom,
    upsertDeliveryTarget: mocks.upsertDeliveryTarget,
    upsertWatchlistDeliveryConfig: mocks.upsertWatchlistDeliveryConfig,
    upsertAgentMemory: mocks.upsertAgentMemory,
    findAgentActionAuditByIdempotencyKey: mocks.findAgentActionAuditByIdempotencyKey,
    claimAgentActionAudit: mocks.claimAgentActionAudit,
    reclaimRetryableAgentActionAudit: mocks.reclaimRetryableAgentActionAudit,
    finishAgentActionAudit: mocks.finishAgentActionAudit,
  }));
  vi.doMock("~/lib/delivery.server", () => ({
    sendOperatorAlertEmail: mocks.sendOperatorAlertEmail,
  }));
  vi.doMock("~/lib/monitoring.server", () => ({
    queueFirstWatchlistScan: mocks.queueFirstWatchlistScan,
    runWatchlistManual: mocks.runWatchlistManual,
  }));
  vi.doMock("~/lib/customer-meta.server", () => ({
    retestSavedCustomerMetaToken: mocks.retestSavedCustomerMetaToken,
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
  }));
  const defaultRunAtomicAgentAction: AtomicAgentActionRunner = async (_env, context, atomicOptions) => {
    const prepared = await atomicOptions.prepare(
      { prepare: () => ({ bind: () => ({}) }) } as never,
      "audit-atomic",
    );
    return {
      audit: auditRecord({ actionName: context.actionName, status: "succeeded", result: prepared.result }),
      replayed: false,
      result: prepared.result,
    };
  };
  const runAtomicAgentAction = options.runAtomicAgentAction ?? defaultRunAtomicAgentAction;
  vi.doMock("~/lib/agent-actions.server", async () => {
    const actual = await vi.importActual<typeof import("~/lib/agent-actions.server")>("~/lib/agent-actions.server");
    return {
      ...actual,
      runAtomicAgentAction: vi.fn(runAtomicAgentAction),
    };
  });

  return mocks;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/agent-actions.server");
  vi.doUnmock("~/lib/workspace.server");
});

describe("customerAgentActionErrorPayload", () => {
  it("does not expose unexpected exception messages to API clients", async () => {
    const { customerAgentActionErrorPayload } = await import("~/lib/customer-agent-actions.server");

    expect(customerAgentActionErrorPayload(new Error("SQLITE_CONSTRAINT: private table detail"))).toEqual({
      status: 500,
      body: {
        ok: false,
        error: "agent_action_failed",
        message: "Agent action failed.",
      },
    });
  });
});

describe("runCustomerAgentAction", () => {
  it("retests saved Meta source access without exposing credential material", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "retest-meta-source-1",
        source: "api_v1",
      },
      "source.meta.retest",
      {},
    );

    const result = outcome.result as {
      ok: boolean;
      action: string;
      source: string;
      connection: {
        status: string;
        summary: string;
        lastErrorCode: string | null;
      };
      testResult: {
        ok: boolean;
        errorCode: string | null;
      };
    };
    expect(result).toMatchObject({
      ok: true,
      action: "source.meta.retest",
      source: "meta_ad_library",
      connection: {
        status: "healthy",
        lastErrorCode: null,
      },
      testResult: {
        ok: true,
        errorCode: null,
      },
    });
    expect(mocks.retestSavedCustomerMetaToken).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(outcome.audit.metadata).toMatchObject({
      source: "meta_ad_library",
      ok: true,
      status: "healthy",
      errorCode: null,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("encrypted-meta-token");
    expect(serialized).not.toContain(customerMetaConnection.tokenLastFour);
    expect(serialized).not.toContain(customerMetaConnection.lastErrorMessage);
    expect(serialized).not.toContain("tokenFingerprint");
  });

  it("rechecks API-key authority immediately before a Meta provider retest", async () => {
    const mocks = setupMocks();
    const authorizeExternalEffect = vi.fn().mockRejectedValue(
      Response.json(
        { error: "invalid_api_key", message: "Use an active Five to Nine API key." },
        { status: 401 },
      ),
    );
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "retest-meta-source-revoked",
        source: "api_v1",
        authorizeExternalEffect,
      },
      "source.meta.retest",
      {},
    )).rejects.toMatchObject({
      code: "invalid_api_key",
      status: 401,
    });

    expect(authorizeExternalEffect).toHaveBeenCalledTimes(1);
    expect(mocks.retestSavedCustomerMetaToken).not.toHaveBeenCalled();
  });

  it("reports missing Meta source setup without treating secret setup as agent-owned", async () => {
    const mocks = setupMocks();
    mocks.retestSavedCustomerMetaToken.mockResolvedValue({
      ok: false,
      connection: null,
      testResult: {
        ok: false,
        status: "degraded",
        summary: "No Meta token is connected yet.",
        errorCode: "missing_connection",
        errorMessage: null,
      },
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "retest-meta-source-missing",
        source: "api_v1",
      },
      "source.meta.retest",
      {},
    )).rejects.toMatchObject({
      code: "source_connection_missing",
      status: 404,
      details: {
        source: "meta_ad_library",
      },
    });
  });

  it("requires idempotency for counter-move brief creation", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        source: "api_v1",
      },
      "counter_move_brief.create",
      {
        watchlistId: "watchlist-1",
      },
    )).rejects.toMatchObject({
      code: "missing_idempotency_key",
      status: 400,
    });
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
  });

  it("creates an audited competitor watchlist with normalized website targeting", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "idem-1",
        source: "api_v1",
      },
      "watchlist.create",
      {
        targetLabel: "Glossier",
        competitorWebsite: "glossier.com",
        queueFirstScan: false,
      },
    );

    const result = outcome.result as {
      watchlist: { id: string };
      reversal: {
        action: string;
        input: { watchlistId: string };
        requiresNewIdempotencyKey: boolean;
      };
    };
    expect(result.watchlist.id).toBe("watchlist-1");
    expect(result.reversal).toMatchObject({
      action: "watchlist.pause",
      input: { watchlistId: "watchlist-1" },
      requiresNewIdempotencyKey: true,
    });
    expect(mocks.checkPlanLimit).toHaveBeenCalledWith(expect.anything(), "user-1", "watchlists");
    expect(mocks.createWatchlistWithinLimit).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        name: "Glossier watch",
        targetType: "advertiser",
        targetId: "https://glossier.com",
        targetLabel: "Glossier",
        targetCountry: "all",
        trackingRole: "competitor",
      }),
      10,
    );
    expect(mocks.queueFirstWatchlistScan).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "succeeded",
        resourceType: "watchlist",
        resourceId: "watchlist-1",
      }),
    );
  });

  it("rechecks API-key authority before first-scan Workflow dispatch", async () => {
    const mocks = setupMocks();
    const authorizeExternalEffect = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Response.json(
          { error: "invalid_api_key", message: "Use an active Five to Nine API key." },
          { status: 401 },
        ),
      );
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "create-revoked-before-dispatch",
        source: "api_v1",
        authorizeExternalEffect,
      },
      "watchlist.create",
      { targetLabel: "Glossier", queueFirstScan: true },
    )).rejects.toMatchObject({
      code: "invalid_api_key",
      status: 401,
    });

    expect(authorizeExternalEffect).toHaveBeenCalledTimes(2);
    expect(mocks.queueFirstWatchlistScan).not.toHaveBeenCalled();
    expect(mocks.deleteUnscannedWatchlistCreatedByFailedAgentAction).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watchlist-1",
    );
  });

  it("returns reversal hints for pausing and resuming watchlists", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const pauseOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "pause-watchlist-1",
        source: "api_v1",
      },
      "watchlist.pause",
      {
        watchlistId: "watchlist-1",
      },
    );

    expect(pauseOutcome.result).toMatchObject({
      action: "watchlist.pause",
      watchlist: {
        id: "watchlist-1",
        isActive: false,
      },
      reversal: {
        action: "watchlist.resume",
        input: { watchlistId: "watchlist-1" },
        requiresNewIdempotencyKey: true,
        requiresExplicitApproval: false,
      },
    });
    expect(mocks.setWatchlistActive).toHaveBeenCalledWith(expect.anything(), "user-1", "watchlist-1", false);

    mocks.getWatchlist.mockResolvedValueOnce({
      ...watchlist,
      isActive: false,
    });

    const resumeOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "resume-watchlist-1",
        source: "api_v1",
      },
      "watchlist.resume",
      {
        watchlistId: "watchlist-1",
      },
    );

    expect(resumeOutcome.result).toMatchObject({
      action: "watchlist.resume",
      watchlist: {
        id: "watchlist-1",
        isActive: true,
      },
      reversal: {
        action: "watchlist.pause",
        input: { watchlistId: "watchlist-1" },
        requiresNewIdempotencyKey: true,
        requiresExplicitApproval: false,
      },
    });
    expect(mocks.setWatchlistActive).toHaveBeenCalledWith(expect.anything(), "user-1", "watchlist-1", true);
  });

  it("does not return reversal hints for no-op watchlist pause or resume requests", async () => {
    const resumeMocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const resumeOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "resume-watchlist-noop",
        source: "api_v1",
      },
      "watchlist.resume",
      {
        watchlistId: "watchlist-1",
      },
    );

    expect(resumeOutcome.result).toMatchObject({
      action: "watchlist.resume",
      watchlist: {
        id: "watchlist-1",
        isActive: true,
      },
      message: "Watchlist was already active. No change was made.",
    });
    expect(resumeOutcome.result).not.toHaveProperty("reversal");
    expect(resumeMocks.setWatchlistActive).not.toHaveBeenCalled();
    expect(resumeMocks.checkPlanLimit).not.toHaveBeenCalled();

    vi.resetModules();
    const pauseMocks = setupMocks();
    pauseMocks.getWatchlist.mockResolvedValue({
      ...watchlist,
      isActive: false,
    });
    const { runCustomerAgentAction: runPauseAction } = await import("~/lib/customer-agent-actions.server");

    const pauseOutcome = await runPauseAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "pause-watchlist-noop",
        source: "api_v1",
      },
      "watchlist.pause",
      {
        watchlistId: "watchlist-1",
      },
    );

    expect(pauseOutcome.result).toMatchObject({
      action: "watchlist.pause",
      watchlist: {
        id: "watchlist-1",
        isActive: false,
      },
      message: "Watchlist was already paused. No change was made.",
    });
    expect(pauseOutcome.result).not.toHaveProperty("reversal");
    expect(pauseMocks.setWatchlistActive).not.toHaveBeenCalled();
  });

  it("audits plan-limit failures for watchlist creation", async () => {
    const mocks = setupMocks({ planLimitAllowed: false });
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "idem-1",
          source: "api_v1",
        },
        "watchlist.create",
        {
          targetLabel: "Glossier",
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.createWatchlistWithinLimit).toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "action_failed",
      }),
    );
  });

  it("updates audited watchlist tuning without creating duplicate targets", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "update-watchlist-1",
        source: "api_v1",
      },
      "watchlist.update",
      {
        watchlistId: "watchlist-1",
        name: "Glossier retained watch",
        targetLabel: "Glossier",
        competitorWebsite: "glossier.com",
        trackingRole: "self",
      },
    );

    const result = outcome.result as { watchlist: { trackingRole: string } };
    expect(result.watchlist.trackingRole).toBe("self");
    expect(mocks.updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watchlist-1",
      expect.objectContaining({
        name: "Glossier retained watch",
        targetType: "advertiser",
        targetId: "https://glossier.com",
        targetLabel: "Glossier",
        trackingRole: "self",
      }),
    );
  });

  it("infers website-only retarget labels and preserves legacy null countries", async () => {
    const mocks = setupMocks();
    mocks.getWatchlist.mockResolvedValue({
      ...watchlist,
      targetId: "glossier",
      targetCountry: null,
      targetFingerprint: "legacy-india-fingerprint",
    });
    mocks.updateWatchlist.mockResolvedValue({
      ...watchlist,
      targetId: "https://rhode.com",
      targetLabel: "rhode",
      targetCountry: null,
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "update-watchlist-website-only",
        source: "api_v1",
      },
      "watchlist.update",
      {
        watchlistId: "watchlist-1",
        competitorWebsite: "rhode.com",
      },
    );

    expect(mocks.updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watchlist-1",
      expect.objectContaining({
        targetId: "https://rhode.com",
        targetLabel: "Rhode",
        targetCountry: null,
      }),
    );
  });

  it("rejects null competitorWebsite values instead of clearing URL-backed targets", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "update-watchlist-null-website",
          source: "api_v1",
        },
        "watchlist.update",
        {
          watchlistId: "watchlist-1",
          competitorWebsite: null,
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.updateWatchlist).not.toHaveBeenCalled();
  });

  it("preserves advertiser target fields on name-only updates", async () => {
    const mocks = setupMocks();
    mocks.getWatchlist.mockResolvedValue({
      ...watchlist,
      name: "HTTPie watch",
      targetId: "HTTPie",
      targetLabel: "HTTPie",
      targetCountry: null,
      targetFingerprint: "legacy-httpie-fingerprint",
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "update-watchlist-name-only",
        source: "api_v1",
      },
      "watchlist.update",
      {
        watchlistId: "watchlist-1",
        name: "HTTPie competitor watch",
      },
    );

    expect(mocks.updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watchlist-1",
      expect.objectContaining({
        name: "HTTPie competitor watch",
        targetId: "HTTPie",
        targetLabel: "HTTPie",
        targetCountry: null,
        targetFingerprint: "legacy-httpie-fingerprint",
      }),
    );
  });

  it("creates audited collections after checking collection limits", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "collection-1",
        source: "api_v1",
      },
      "collection.create",
      {
        name: "Client proof",
        description: "Proof for the weekly review.",
      },
    );

    const result = outcome.result as { collection: { id: string } };
    expect(result.collection.id).toBe("collection-1");
    expect(mocks.checkPlanLimit).toHaveBeenCalledWith(expect.anything(), "user-1", "collections");
    expect(mocks.createCollectionWithinLimit).toHaveBeenCalledWith(expect.anything(), "user-1", {
      name: "Client proof",
      description: "Proof for the weekly review.",
    }, 10);
  });

  it("blocks free-plan manual refreshes before running scans", async () => {
    const mocks = setupMocks({ plan: "free" });
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "refresh-1",
          source: "api_v1",
        },
        "watchlist.refresh",
        {
          watchlistId: "watchlist-1",
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.runWatchlistManual).not.toHaveBeenCalled();
  });

  it("rechecks API-key authority immediately before a manual provider refresh", async () => {
    const mocks = setupMocks();
    const authorizeExternalEffect = vi.fn().mockRejectedValue(
      Response.json(
        { error: "invalid_api_key", message: "Use an active Five to Nine API key." },
        { status: 401 },
      ),
    );
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "refresh-revoked",
        source: "api_v1",
        authorizeExternalEffect,
      },
      "watchlist.refresh",
      { watchlistId: "watchlist-1" },
    )).rejects.toMatchObject({
      code: "invalid_api_key",
      status: 401,
    });

    expect(authorizeExternalEffect).toHaveBeenCalledTimes(1);
    expect(mocks.runWatchlistManual).not.toHaveBeenCalled();
  });

  it("adds audited external proof to an owned collection", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "proof-1",
        source: "api_v1",
      },
      "proof.add_external",
      {
        collectionId: "collection-1",
        advertiser: "Glossier",
        proofUrl: "https://www.linkedin.com/posts/glossier",
        channel: "LinkedIn",
        hook: "Creator hook",
        tags: ["launch"],
      },
    );

    const result = outcome.result as { collectionId: string; ad: { metaAdId: string } };
    expect(result.collectionId).toBe("collection-1");
    expect(result.ad.metaAdId).toBe("external:linkedin:proof-1");
    expect(mocks.addExternalProofToCollection).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "collection-1",
      expect.objectContaining({
        advertiser: "Glossier",
        channel: "LinkedIn",
        tags: ["launch"],
      }),
    );
  });

  it("creates report snapshot share links from owned resources", async () => {
    let persistedSnapshot: unknown;
    const mocks = setupMocks({
      runAtomicAgentAction: async (_env, _context, atomicOptions) => {
        const prepared = await atomicOptions.prepare(
          {
            prepare: () => ({
              bind: (...bindings: unknown[]) => {
                persistedSnapshot = JSON.parse(String(bindings[6]));
                return {};
              },
            }),
          } as never,
          "audit-atomic",
        );
        return {
          audit: auditRecord({ actionName: "report.share", status: "succeeded", result: prepared.result }),
          replayed: false,
          result: prepared.result,
        };
      },
    });
    mocks.listCollectionItems.mockResolvedValue([{
      id: "item-1",
      collectionId: "collection-1",
      adId: externalAd.metaAdId,
      note: "Saved evidence",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      tags: ["evidence"],
      ad: {
        ...externalAd,
        landingPageUrl: "https://glossier.com/offer",
        landingPage: {
          rawUrl: "https://glossier.com/offer",
          canonicalUrl: "https://glossier.com/offer",
          rawHeadline: "Current offer",
          normalizedHeadline: "current offer",
          normalizedHeadlineHash: "current-offer",
          captureMethod: "browser_render",
          capturedAt: "2026-07-15T00:00:00.000Z",
        },
      },
    }]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "report-share-1",
        source: "api_v1",
        origin: "https://0509.io",
      },
      "report.share",
      {
        resourceType: "collection",
        resourceId: "collection-1",
        reviewed: true,
      },
    );

    const result = outcome.result as {
      report: { reportId: string };
      shareUrl: string;
      share: { id: string; token: string; expiresAt: string };
    };
    expect(result.report.reportId).toBe("collection:collection-1");
    expect(result.shareUrl).toMatch(/^https:\/\/0509\.io\/share\//);
    expect(mocks.createShareLink).not.toHaveBeenCalled();
    expect(result.share).toEqual({
      id: expect.any(String),
      token: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(isApprovedReportSnapshot(persistedSnapshot)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("evidenceFingerprint");
  });

  it("requires reviewed=true before preparing an atomic report share", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "report-share-review-required",
          source: "api_v1",
        },
        "report.share",
        {
          resourceType: "collection",
          resourceId: "collection-1",
        },
      ),
    ).rejects.toMatchObject({
      code: "review_required",
      message: "Set reviewed to true before sharing the current report.",
    } satisfies Partial<InstanceType<typeof CustomerAgentActionError>>);
    expect(mocks.getCollection).not.toHaveBeenCalled();
  });

  it("uses the workspace owner for member report and client-room resource access", async () => {
    const mocks = setupMocks();
    mocks.listCollectionItems.mockResolvedValue([{
      id: "item-1",
      collectionId: "collection-1",
      adId: externalAd.metaAdId,
      note: "Saved evidence",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      tags: ["evidence"],
      ad: {
        ...externalAd,
        landingPageUrl: "https://glossier.com/offer",
        landingPage: {
          rawUrl: "https://glossier.com/offer",
          canonicalUrl: "https://glossier.com/offer",
          rawHeadline: "Current offer",
          normalizedHeadline: "current offer",
          normalizedHeadlineHash: "current-offer",
          captureMethod: "browser_render",
          capturedAt: "2026-07-15T00:00:00.000Z",
        },
      },
    }]);
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspaceDataUserId: vi.fn().mockResolvedValue("owner-1"),
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const reportOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      { userId: "member-2", apiKeyId: "member-key", idempotencyKey: "member-report-share", source: "api_v1" },
      "report.share",
      { resourceType: "collection", resourceId: "collection-1", reviewed: true },
    );
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "owner-1");
    expect((reportOutcome.result as { report: { resourceId: string } }).report.resourceId).toBe("collection-1");

    const roomOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      { userId: "member-2", apiKeyId: "member-key", idempotencyKey: "member-room", source: "api_v1" },
      "client_room.upsert",
      {
        name: "Beauty client",
        resourceRefs: [{ resourceType: "report", resourceId: "collection:collection-1" }],
      },
    );
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "owner-1");
    expect((roomOutcome.result as { room: { userId: string } }).room.userId).toBe("owner-1");
  });

  it("keeps stored weekly strategy evidence in agent-created and shared watchlist reports", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([watchEvent]);
    mocks.listAdsByIds.mockResolvedValue([externalAd]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const created = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "report-create-watchlist-1",
        source: "api_v1",
      },
      "report.create",
      { resourceType: "watchlist", resourceId: "watchlist-1" },
    );
    const shared = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "report-share-watchlist-1",
        source: "api_v1",
        origin: "https://0509.io",
      },
      "report.share",
      { resourceType: "watchlist", resourceId: "watchlist-1", reviewed: true },
    );

    const createdResult = created.result as {
      report: { aiWeeklySummary?: { paragraph: string } };
    };
    const sharedResult = shared.result as {
      report: { aiWeeklySummary?: { paragraph: string } };
    };
    expect(createdResult.report.aiWeeklySummary?.paragraph).toContain("Glossier raised");
    expect(sharedResult.report.aiWeeklySummary).toEqual(createdResult.report.aiWeeklySummary);
    expect(mocks.createShareLink).not.toHaveBeenCalled();
    expect(mocks.getLatestDigestRunSummaryForWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watchlist-1",
    );
  });

  it("replays report share actions with a reconstructed share URL", async () => {
    const replayedResult = {
      ok: true,
      action: "report.share",
      report: { reportId: "collection:collection-1" },
      share: { id: "share-1", token: "sharetoken1", expiresAt: "2026-09-19T00:00:00.000Z" },
      shareUrl: "https://0509.io/share/sharetoken1",
    };
    const mocks = setupMocks({
      runAtomicAgentAction: async () => ({
        audit: auditRecord({ actionName: "report.share", status: "succeeded", result: replayedResult }),
        replayed: true,
        result: replayedResult,
      }),
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "report-share-1",
        source: "api_v1",
        origin: "https://0509.io",
      },
      "report.share",
      {
        resourceType: "collection",
        resourceId: "collection-1",
        reviewed: true,
      },
    );

    const result = outcome.result as { shareUrl: string; share: { token: string } };
    expect(outcome.replayed).toBe(true);
    expect(result.shareUrl).toBe("https://0509.io/share/sharetoken1");
    expect(result.share.token).toBe("sharetoken1");
    expect(mocks.createShareLink).not.toHaveBeenCalled();
    expect(mocks.getShareLinkById).not.toHaveBeenCalled();
  });

  it("builds audited counter-move briefs from owned watchlists", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([
      {
        ...watchEvent,
        id: "event-unconfirmed",
        status: "detected",
        adId: "external:linkedin:unconfirmed",
        title: "Unconfirmed change",
      },
      watchEvent,
    ]);
    mocks.listAdsByIds.mockResolvedValue([externalAd]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "brief-1",
        source: "api_v1",
      },
      "counter_move_brief.create",
      {
        watchlistId: "watchlist-1",
        limit: 3,
        timeZone: "Asia/Kolkata",
        ownerLabel: "Growth lead",
        followUpChannel: "client_room",
        expiryDays: 10,
      },
    );

    const result = outcome.result as {
      brief: {
        watchlistId: string;
        moves: Array<{ counterMove: string; priorityBand: string }>;
        workflow: {
          ownerLabel: string;
          channel: string;
          status: string;
          openCount: number;
          followUps: Array<{ eventId: string; status: string; ownerLabel: string; channel: string }>;
        };
      };
    };
    expect(result.brief.watchlistId).toBe("watchlist-1");
    expect(result.brief.moves[0]).toMatchObject({
      priorityBand: "High priority",
      counterMove: expect.stringContaining("offer shift"),
    });
    expect(result.brief.workflow).toMatchObject({
      ownerLabel: "Growth lead",
      channel: "client_room",
      status: "needs_review",
      openCount: 1,
    });
    expect(result.brief.workflow.followUps[0]).toMatchObject({
      eventId: "event-1",
      status: "open",
      ownerLabel: "Growth lead",
      channel: "client_room",
    });
    expect(mocks.listWatchEvents).toHaveBeenCalledWith(expect.anything(), "watchlist-1", 9);
    expect(mocks.listAdsByIds).toHaveBeenCalledWith(expect.anything(), ["external:linkedin:proof-1"]);
    expect(outcome.audit.metadata).toMatchObject({
      workflowStatus: "needs_review",
      followUpOpenCount: 1,
      followUpChannel: "client_room",
      followUpExpiresAt: expect.any(String),
    });
  });

  it("rejects unsafe counter-move workflow hints", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const unsafeOwnerLabels = [
      "apiKey=f9_live_secret",
      "hooks.slack.com/services/T/B/C",
      "growth@example.com",
      "https://hooks.example.com/follow-up",
      "+1 (555) 123-4567",
    ];

    for (const [index, ownerLabel] of unsafeOwnerLabels.entries()) {
      await expect(runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: `brief-unsafe-${index}`,
          source: "api_v1",
        },
        "counter_move_brief.create",
        {
          watchlistId: "watchlist-1",
          ownerLabel,
        },
      )).rejects.toMatchObject({
        code: "secret_workflow_owner_rejected",
      });
    }

    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "action_failed",
      }),
    );
  });

  it("allows Slack counter-move follow-up channels on Starter+ (webhook delivery is live)", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([watchEvent]);
    mocks.listAdsByIds.mockResolvedValue([externalAd]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "brief-slack-follow-up-allowed",
        source: "api_v1",
      },
      "counter_move_brief.create",
      {
        watchlistId: "watchlist-1",
        followUpChannel: "slack",
      },
    );

    const result = outcome.result as { brief: { workflow: { channel: string } } };
    expect(result.brief.workflow.channel).toBe("slack");
  });

  it("allows ordinary counter-move owner labels with security-adjacent words", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([watchEvent]);
    mocks.listAdsByIds.mockResolvedValue([externalAd]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "brief-safe-owner-keywords",
        source: "api_v1",
      },
      "counter_move_brief.create",
      {
        watchlistId: "watchlist-1",
        ownerLabel: "Webhook QA",
      },
    );

    const result = outcome.result as {
      brief: {
        workflow: {
          ownerLabel: string;
        };
      };
    };
    expect(result.brief.workflow.ownerLabel).toBe("Webhook QA");
  });

  it("allows Slack delivery target list filters now that webhook delivery is live", async () => {
    setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "delivery-targets-list-slack",
        source: "api_v1",
      },
      "delivery_targets.list",
      {
        watchlistId: "watchlist-1",
        channel: "slack",
      },
    );

    const result = outcome.result as { targets: Array<{ channel: string }> };
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].channel).toBe("slack");
  });

  it("rejects WhatsApp delivery target list filters while WhatsApp is not customer-facing", async () => {
    setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "delivery-targets-list-whatsapp",
          source: "api_v1",
        },
        "delivery_targets.list",
        {
          watchlistId: "watchlist-1",
          channel: "whatsapp",
        },
      ),
    ).rejects.toMatchObject({
      code: "whatsapp_delivery_unavailable",
      status: 403,
    });
  });

  it("filters dormant WhatsApp targets from unfiltered agent lists", async () => {
    const mocks = setupMocks();
    mocks.listDeliveryTargets.mockImplementation(async (_env, _userId, options?: { channel?: string }) => {
      if (options?.channel === "email") {
        return [
          {
            ...deliveryTarget,
            id: "email-target-1",
            channel: "email",
            targetValue: "owner@example.com",
            providerIdentifier: "email:owner@example.com",
            metadata: { displayName: "Owner email" },
          },
        ];
      }
      if (options?.channel === "slack") {
        return [deliveryTarget];
      }
      return [];
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "delivery-targets-list-visible",
        source: "api_v1",
      },
      "delivery_targets.list",
      {},
    );

    const result = outcome.result as { targets: Array<{ channel: string; targetValue: string }> };
    // WhatsApp stays dormant and is never queried; Slack and Teams are live.
    expect(result.targets.map((target) => target.channel).sort()).toEqual(["email", "slack"]);
    expect(mocks.listDeliveryTargets).not.toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ channel: "whatsapp" }),
    );
    // The encrypted webhook URL never leaves the workspace.
    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
  });

  it("redacts destination-like delivery display names and clamps list limits", async () => {
    const mocks = setupMocks();
    mocks.listDeliveryTargets.mockResolvedValue([
      {
        ...deliveryTarget,
        channel: "email",
        targetValue: "person@example.com",
        metadata: {
          displayName: "person@example.com",
        },
      },
    ]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        source: "api_v1",
      },
      "delivery_targets.list",
      {
        channel: "email",
        limit: -50,
      },
    );

    const result = outcome.result as {
      targets: Array<{ targetValue: string; displayName: string; metadata: Record<string, unknown> }>;
    };
    expect(result.targets[0]).toMatchObject({
      targetValue: "p***@example.com",
      displayName: "p***@example.com",
      metadata: {},
    });
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(mocks.listDeliveryTargets).toHaveBeenCalledWith(expect.anything(), "user-1", {
      channel: "email",
      limit: 1,
    });
  });

  it("updates delivery settings only after explicit approval", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "delivery-settings-missing-approval",
          source: "api_v1",
        },
        "delivery_settings.update",
        {
          watchlistId: "watchlist-1",
          slackEnabled: true,
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "delivery-settings-whatsapp-blocked",
          source: "api_v1",
        },
        "delivery_settings.update",
        {
          watchlistId: "watchlist-1",
          explicitApproval: true,
          whatsappEnabled: true,
        },
      ),
    ).rejects.toMatchObject({
      code: "whatsapp_delivery_unavailable",
      status: 403,
    });

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "delivery-settings-approved",
        source: "api_v1",
      },
      "delivery_settings.update",
      {
        watchlistId: "watchlist-1",
        explicitApproval: true,
        sensitivityMode: "aggressive",
        instantEnabled: true,
        quietHours: { startHour: 21, endHour: 8 },
        timezone: "Asia/Kolkata",
      },
    );

    const result = outcome.result as {
      config: Record<string, unknown>;
      reversal: {
        action: string;
        input: Record<string, unknown>;
        requiresExplicitApproval: boolean;
        requiresNewIdempotencyKey: boolean;
      };
    };
    expect(result.config).toMatchObject({
      emailEnabled: true,
      instantEnabled: true,
      sensitivityMode: "aggressive",
    });
    expect(result.config).not.toHaveProperty("whatsappEnabled");
    // Slack and Teams webhook delivery are live surfaces for Starter+.
    expect(result.config).toHaveProperty("slackEnabled");
    expect(result.config).toHaveProperty("teamsEnabled");
    expect(result.reversal).toMatchObject({
      action: "delivery_settings.update",
      requiresExplicitApproval: true,
      requiresNewIdempotencyKey: true,
      input: {
        watchlistId: "watchlist-1",
        explicitApproval: true,
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        quietHours: null,
        timezone: null,
      },
    });
    expect(result.reversal.input).not.toHaveProperty("whatsappEnabled");
    expect(result.reversal.input).toHaveProperty("slackEnabled");
    expect(mocks.upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(expect.anything(), {
      watchlistId: "watchlist-1",
      userId: "user-1",
      sensitivityMode: "aggressive",
      instantEnabled: true,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      teamsEnabled: false,
      quietHours: { startHour: 21, endHour: 8 },
      timezone: "Asia/Kolkata",
    });
  });

  it("rejects an invalid IANA timezone before an API or MCP delivery update", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "delivery-settings-invalid-timezone",
          source: "api_v1",
        },
        "delivery_settings.update",
        {
          watchlistId: "watchlist-1",
          explicitApproval: true,
          timezone: "Not/AZone",
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_timezone",
      status: 400,
    });
    expect(mocks.upsertWatchlistDeliveryConfig).not.toHaveBeenCalled();
  });

  it("preserves hidden WhatsApp settings while applying live Slack/Teams fields", async () => {
    const mocks = setupMocks();
    mocks.getWorkspaceDeliveryConfig.mockResolvedValueOnce({
      id: "workspace-delivery-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: true,
      slackEnabled: true,
      teamsEnabled: true,
      quietHours: null,
      timezone: null,
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    });
    mocks.upsertWatchlistDeliveryConfig.mockImplementationOnce((_, config) => Promise.resolve({
      id: "watchlist-delivery-1",
      ...config,
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "delivery-settings-preserve-hidden",
        source: "api_v1",
      },
      "delivery_settings.update",
      {
        watchlistId: "watchlist-1",
        explicitApproval: true,
        emailEnabled: false,
        whatsappEnabled: false,
        slackEnabled: false,
        teamsEnabled: false,
      },
    );

    expect(mocks.upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(expect.anything(), {
      watchlistId: "watchlist-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: false,
      // WhatsApp stays dormant: its stored value is preserved even when the
      // agent asks to disable it.
      whatsappEnabled: true,
      // Slack and Teams are live: the agent's values apply.
      slackEnabled: false,
      teamsEnabled: false,
      quietHours: null,
      timezone: null,
    });
    expect(outcome.result).toMatchObject({
      config: {
        emailEnabled: false,
      },
    });
    expect(JSON.stringify(outcome.result)).not.toContain('"whatsappEnabled"');
    expect(JSON.stringify(outcome.result)).toContain('"slackEnabled"');
    const result = outcome.result as { reversal: { input: Record<string, unknown> } };
    expect(result.reversal.input).toMatchObject({ emailEnabled: true });
    expect(result.reversal.input).not.toHaveProperty("whatsappEnabled");
    expect(result.reversal.input).toHaveProperty("slackEnabled");
  });

  it("pauses a Slack delivery target now that webhook delivery is live", async () => {
    const mocks = setupMocks();
    mocks.getDeliveryTargetById.mockResolvedValue(deliveryTarget);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "pause-slack-target-1",
        source: "api_v1",
      },
      "delivery_target.update",
      {
        targetId: "target-1",
        isPaused: true,
        explicitApproval: true,
      },
    );

    expect(outcome.audit.status).toBe("succeeded");
    expect(mocks.upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "slack",
        isPaused: true,
      }),
    );
  });

  it("blocks WhatsApp delivery target mutation while WhatsApp is not customer-facing", async () => {
    const mocks = setupMocks();
    mocks.getDeliveryTargetById.mockResolvedValue({
      ...deliveryTarget,
      channel: "whatsapp",
      targetValue: "+919999999999",
      providerIdentifier: "whatsapp:+919999999999",
      metadata: { displayName: "Founder phone" },
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "pause-whatsapp-target-1",
          source: "api_v1",
        },
        "delivery_target.update",
        {
          targetId: "target-1",
          isPaused: true,
          explicitApproval: true,
        },
      ),
    ).rejects.toMatchObject({
      code: "whatsapp_delivery_unavailable",
      status: 403,
    });
    expect(mocks.upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses non-Slack delivery targets without exposing destination secrets", async () => {
    const mocks = setupMocks();
    const emailTarget = {
      ...deliveryTarget,
      channel: "email",
      targetValue: "owner@example.com",
      providerIdentifier: null,
      metadata: { displayName: "owner@example.com" },
    };
    mocks.getDeliveryTargetById
      .mockResolvedValueOnce(emailTarget)
      .mockResolvedValueOnce({ ...emailTarget, isPaused: true, pausedAt: "2026-06-19T00:00:00.000Z" });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "pause-target-1",
        source: "api_v1",
      },
      "delivery_target.update",
      {
        targetId: "target-1",
        isPaused: true,
        explicitApproval: true,
      },
    );

    const result = outcome.result as {
      target: { targetValue: string; isPaused: boolean };
      reversal: {
        action: string;
        input: { targetId: string; isPaused: boolean; explicitApproval: boolean };
        requiresExplicitApproval: boolean;
        requiresNewIdempotencyKey: boolean;
      };
    };
    expect(result.target.targetValue).toBe("o***@example.com");
    expect(result.target.isPaused).toBe(true);
    expect(result.reversal).toMatchObject({
      action: "delivery_target.update",
      input: {
        targetId: "target-1",
        isPaused: false,
        explicitApproval: true,
      },
      requiresExplicitApproval: true,
      requiresNewIdempotencyKey: true,
    });
    expect(JSON.stringify(result.reversal)).not.toContain("owner@example.com");
    expect(mocks.upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetValue: "owner@example.com",
        isPaused: true,
      }),
    );
  });

  it("does not return reversal hints for no-op delivery target updates", async () => {
    const mocks = setupMocks();
    mocks.getDeliveryTargetById.mockResolvedValue({
      ...deliveryTarget,
      channel: "email",
      targetValue: "owner@example.com",
      optInSource: "manual_email",
      providerIdentifier: "email:owner@example.com",
      metadata: {
        displayName: "Owner",
      },
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "resume-target-no-op-1",
        source: "api_v1",
      },
      "delivery_target.update",
      {
        targetId: "target-1",
        isPaused: false,
        explicitApproval: true,
      },
    );

    expect(outcome.result).toMatchObject({
      ok: true,
      action: "delivery_target.update",
      message: "Delivery target was already active. No change was made.",
      target: {
        id: "target-1",
        targetValue: "o***@example.com",
        isPaused: false,
      },
    });
    expect(outcome.result).not.toHaveProperty("reversal");
    expect(mocks.upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("lists only website blog and Substack presence observation sources", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "web-mentions-list-1",
        source: "api_v1",
      },
      "web_mentions.list",
      {
        watchlistId: "watchlist-1",
        sources: ["blog"],
      },
    );

    const result = outcome.result as {
      supportedSources: string[];
      targets: Array<{ sources: string[] }>;
      observations: Array<{ source: string }>;
    };
    expect(result).toMatchObject({
      status: "available",
      boundary: "Returns existing source-backed website, blog, and Substack observations only. X, Reddit, YouTube, LinkedIn, and broad social listening are not live.",
    });
    expect(result.supportedSources).toEqual(["blog", "substack", "web"]);
    expect(result.targets[0]?.sources).toEqual(["blog", "substack", "web"]);
    expect(result.observations[0]?.source).toBe("blog");
    expect(mocks.listWebMentionObservations).toHaveBeenCalledWith(expect.anything(), "user-1", {
      watchlistId: "watchlist-1",
      sources: ["blog"],
      includeInactive: false,
      limit: 50,
    });
    expect(mocks.claimAgentActionAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionName: "web_mentions.list",
        idempotencyKey: null,
      }),
    );
  });

  it("saves and lists sanitized scoped agent memory", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "memory-1",
        source: "api_v1",
      },
      "memory.upsert",
      {
        scope: "brand",
        key: "voice",
        value: {
          tone: "plainspoken",
        },
      },
    );

    expect(mocks.upsertAgentMemory).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      {
        scope: "brand",
        key: "voice",
        watchlistId: null,
        clientRoomId: null,
        value: { tone: "plainspoken" },
        source: "api_v1",
      },
    );

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "memory-list-1",
        source: "api_v1",
      },
      "memory.list",
      {
        scope: "brand",
        limit: 5,
      },
    );
    const result = outcome.result as { memories: Array<{ key: string }> };

    expect(result.memories[0]?.key).toBe("voice");
    expect(mocks.listAgentMemory).toHaveBeenCalledWith(expect.anything(), "user-1", {
      scope: "brand",
      limit: 5,
    });
    expect(mocks.claimAgentActionAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionName: "memory.list",
        idempotencyKey: null,
      }),
    );
  });

  it("redacts legacy secret-looking keys and values from agent memory list responses", async () => {
    const mocks = setupMocks();
    const liveKey = ["f9", "live", "abc123"].join("_");
    mocks.listAgentMemory.mockResolvedValueOnce([
      {
        id: "memory-1",
        userId: "user-1",
        scope: "brand",
        key: liveKey,
        watchlistId: null,
        clientRoomId: null,
        value: {
          value: `API key: ${liveKey}`,
          nested: {
            [liveKey]: "do-not-return",
            tone: "plainspoken",
          },
        },
        source: `owner ${liveKey}`,
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "memory-list-redacted",
        source: "api_v1",
      },
      "memory.list",
      {
        scope: "brand",
        limit: 5,
      },
    );
    const result = outcome.result as { memories: Array<{ key: string; source: string | null; value: unknown }> };
    const serialized = JSON.stringify(result);

    expect(result.memories[0]).toMatchObject({
      key: "[redacted]",
      source: null,
      value: {
        value: "[redacted]",
        nested: {
          "[redacted]": "[redacted]",
          tone: "plainspoken",
        },
      },
    });
    expect(serialized).not.toContain(liveKey);
    expect(serialized).not.toContain("do-not-return");
  });

  it("includes the memory key in idempotency fingerprints", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "memory-fingerprint-1",
        source: "api_v1",
      },
      "memory.upsert",
      {
        scope: "brand",
        key: "voice",
        value: { tone: "plainspoken" },
      },
    );
    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "memory-fingerprint-2",
        source: "api_v1",
      },
      "memory.upsert",
      {
        scope: "brand",
        key: "positioning",
        value: { tone: "plainspoken" },
      },
    );

    const fingerprints = mocks.claimAgentActionAudit.mock.calls
      .map((call) => call[1].metadata.requestFingerprint);
    expect(fingerprints[0]).toMatch(/^fnv1a:/);
    expect(fingerprints[1]).toMatch(/^fnv1a:/);
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it("rejects secret-like agent memory writes before persistence", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "memory-secret-1",
          source: "api_v1",
        },
        "memory.upsert",
        {
          scope: "brand",
          key: "voice",
          value: {
            apiKey: "should-not-store",
          },
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.upsertAgentMemory).not.toHaveBeenCalled();
  });

  it("creates and lists support cases as agent-accessible summaries", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const createOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-1",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Private support detail should not return to the agent.",
      },
    );
    const createResult = createOutcome.result as {
      supportCase: { id: string; subject: string; detail?: string; context?: unknown };
    };

    expect(createResult.supportCase).toMatchObject({
      id: "case-1",
      subject: "Digest did not arrive",
    });
    expect(createResult.supportCase).not.toHaveProperty("detail");
    expect(createResult.supportCase).not.toHaveProperty("context");
    expect(mocks.createSupportCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      category: "delivery",
      priority: "normal",
      subject: "Digest did not arrive",
      detail: "Private support detail should not return to the agent.",
      requestKey: "support-1",
      context: {
        createdFrom: "agent_action",
        source: "api_v1",
        apiKeyId: "api-key-1",
        requesterUserId: "user-1",
        workspaceUserId: "user-1",
      },
    });
    expect(mocks.sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subject: "0509 support case: Digest did not arrive",
      idempotencyKey: "support-case:case-1",
      lines: expect.arrayContaining([
        "Case: case-1",
        "Requester: owner@example.com",
        "Source: api_v1",
        "Category: Digest or email delivery",
        "Details: Private support detail should not return to the agent.",
      ]),
    }));

    const listOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-list-1",
        source: "api_v1",
      },
      "support_case.list",
      {
        status: "all",
        limit: 5,
      },
    );
    const listResult = listOutcome.result as { cases: Array<{ id: string; detail?: string; context?: unknown }> };

    expect(listResult.cases[0]).toMatchObject({
      id: "case-1",
      subject: "Digest did not arrive",
      status: "open",
    });
    expect(listResult.cases[0]).not.toHaveProperty("detail");
    expect(listResult.cases[0]).not.toHaveProperty("context");
    expect(mocks.listSupportCases).toHaveBeenCalledWith(expect.anything(), "user-1", {
      status: "all",
      limit: 5,
    });
    expect(mocks.claimAgentActionAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionName: "support_case.list",
        idempotencyKey: null,
      }),
    );
  });

  it("requires idempotency for agent-created support cases", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the digest delivery trail.",
      },
    )).rejects.toMatchObject({
      code: "missing_idempotency_key",
      status: 400,
    });
    expect(mocks.createSupportCase).not.toHaveBeenCalled();
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
  });

  it("stores member memory under the workspace owner and support cases under the member actor", async () => {
    const mocks = setupMocks();
    mocks.upsertAgentMemory.mockResolvedValueOnce({
      id: "memory-member-1",
      userId: "owner-1",
      scope: "brand",
      key: "voice",
      watchlistId: null,
      clientRoomId: null,
      value: { tone: "plainspoken" },
      source: "api_v1",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    mocks.createSupportCase.mockResolvedValueOnce({
      id: "case-member-1",
      userId: "member-2",
      requestKey: "member-request",
      category: "delivery",
      priority: "normal",
      status: "open",
      subject: "Member digest did not arrive",
      detail: "Please check the workspace delivery trail.",
      context: {},
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn().mockResolvedValue({
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
      resolveWorkspaceDataUserId: vi.fn().mockResolvedValue("owner-1"),
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "member-2",
        apiKeyId: "member-key",
        idempotencyKey: "member-memory",
        source: "api_v1",
      },
      "memory.upsert",
      { scope: "brand", key: "voice", value: { tone: "plainspoken" } },
    );
    expect(mocks.upsertAgentMemory).toHaveBeenCalledWith(
      expect.anything(),
      "owner-1",
      expect.objectContaining({ key: "voice" }),
    );

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "member-2",
        apiKeyId: "member-key",
        idempotencyKey: "member-support",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Member digest did not arrive",
        detail: "Please check the workspace delivery trail.",
      },
    );

    expect(mocks.createSupportCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "member-2",
      requestKey: "member-support",
      context: expect.objectContaining({
        requesterUserId: "member-2",
        apiKeyId: "member-key",
        workspaceUserId: "owner-1",
      }),
    }));
    expect(mocks.getUserDeliveryProfile).toHaveBeenCalledWith(expect.anything(), "member-2");
    expect(mocks.claimAgentActionAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "member-2",
    }));

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "member-2",
        apiKeyId: "member-key",
        source: "api_v1",
      },
      "support_case.list",
      { status: "all" },
    );
    expect(mocks.listSupportCases).toHaveBeenCalledWith(expect.anything(), "member-2", {
      status: "all",
      limit: 20,
    });
  });

  it("scopes the same member support request key by actor inside one owner workspace", async () => {
    const mocks = setupMocks();
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn().mockResolvedValue({
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const input = {
      category: "delivery",
      subject: "Digest did not arrive",
      detail: "Please check the workspace delivery trail.",
    };

    await runCustomerAgentAction(
      { DB: {} } as never,
      { userId: "member-2", apiKeyId: "member-key-2", idempotencyKey: "shared-key", source: "api_v1" },
      "support_case.create",
      input,
    );
    await runCustomerAgentAction(
      { DB: {} } as never,
      { userId: "member-3", apiKeyId: "member-key-3", idempotencyKey: "shared-key", source: "api_v1" },
      "support_case.create",
      input,
    );

    expect(mocks.createSupportCase.mock.calls.map(([, request]) => ({
      userId: request.userId,
      requestKey: request.requestKey,
    }))).toEqual([
      { userId: "member-2", requestKey: "shared-key" },
      { userId: "member-3", requestKey: "shared-key" },
    ]);
  });

  it.each([
    ["source.meta.retest", {}],
    ["delivery_targets.list", {}],
    ["delivery_settings.update", { watchlistId: "watchlist-1", emailEnabled: true }],
    ["delivery_target.update", { targetId: "target-1", isPaused: true }],
  ] as const)("rejects member %s agent actions before owner data or providers are reached", async (actionName, input) => {
    const mocks = setupMocks();
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn().mockResolvedValue({
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "member-2",
        apiKeyId: "member-key",
        idempotencyKey: `member-owner-action-${actionName}`,
        source: "api_v1",
      },
      actionName,
      input,
    )).rejects.toMatchObject({
      code: "workspace_owner_required",
      status: 403,
    });

    expect(mocks.retestSavedCustomerMetaToken).not.toHaveBeenCalled();
    expect(mocks.listDeliveryTargets).not.toHaveBeenCalled();
    expect(mocks.upsertWatchlistDeliveryConfig).not.toHaveBeenCalled();
    expect(mocks.upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it.each([
    [{ category: "team", subject: "Add a teammate", detail: "Please add another teammate." }],
    [{
      category: "billing",
      subject: "Cancel the workspace plan",
      detail: "Please cancel the Agency workspace subscription.",
    }],
  ])("rejects member support requests that require workspace-owner authority", async (input) => {
    const mocks = setupMocks();
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn().mockResolvedValue({
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "member-2",
        apiKeyId: "member-key",
        idempotencyKey: `member-sensitive-support-${input.category}`,
        source: "api_v1",
      },
      "support_case.create",
      input,
    )).rejects.toMatchObject({
      code: "workspace_owner_required",
      status: 403,
    });
    expect(mocks.createSupportCase).not.toHaveBeenCalled();
    expect(mocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("returns a support fallback when agent operator notification resolves false", async () => {
    const mocks = setupMocks();
    mocks.sendOperatorAlertEmail.mockResolvedValueOnce(false);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-operator-false",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the digest delivery trail.",
      },
    );
    const result = outcome.result as {
      ok: boolean;
      message: string;
      supportCase: { id: string; detail?: string; context?: unknown };
    };

    expect(result).toMatchObject({
      ok: false,
      message: "Support case saved, but support could not be notified. Email support@0509.io now so we can reply.",
      supportCase: { id: "case-1" },
    });
    expect(result.supportCase).not.toHaveProperty("detail");
    expect(result.supportCase).not.toHaveProperty("context");
    expect(mocks.createSupportCase).toHaveBeenCalled();
    expect(outcome.audit.status).toBe("failed");
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "support_notification_failed",
        resourceType: "support_case",
        resourceId: "case-1",
      }),
    );
  });

  it("returns a support fallback when agent operator notification rejects", async () => {
    const mocks = setupMocks();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sendOperatorAlertEmail.mockRejectedValueOnce(new Error("operator email down"));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-operator-reject",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the digest delivery trail.",
      },
    );
    const result = outcome.result as { ok: boolean; message: string; supportCase: { id: string } };

    expect(result).toMatchObject({
      ok: false,
      message: "Support case saved, but support could not be notified. Email support@0509.io now so we can reply.",
      supportCase: { id: "case-1" },
    });
    consoleError.mockRestore();
  });

  it("retries notification for the same support case after a failed audited attempt", async () => {
    const mocks = setupMocks();
    mocks.sendOperatorAlertEmail
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const context = {
      userId: "user-1",
      apiKeyId: "api-key-1",
      idempotencyKey: "support-notification-retry",
      source: "api_v1" as const,
    };
    const input = {
      category: "delivery",
      subject: "Digest did not arrive",
      detail: "Please check the digest delivery trail.",
    };

    const first = await runCustomerAgentAction(
      { DB: {} } as never,
      context,
      "support_case.create",
      input,
    );
    mocks.findAgentActionAuditByIdempotencyKey.mockResolvedValue({
      ...first.audit,
      actionName: "support_case.create",
      idempotencyKey: "support-notification-retry",
    });

    const retried = await runCustomerAgentAction(
      { DB: {} } as never,
      context,
      "support_case.create",
      input,
    );

    expect(first.audit.status).toBe("failed");
    expect(retried).toMatchObject({
      replayed: false,
      audit: { status: "succeeded" },
      result: { ok: true, supportCase: { id: "case-1" } },
    });
    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auditId: "audit-1", apiKeyId: "api-key-1" }),
    );
    expect(mocks.createSupportCase).toHaveBeenCalledTimes(2);
    expect(mocks.createSupportCase.mock.calls.map((call) => call[1].requestKey)).toEqual([
      "support-notification-retry",
      "support-notification-retry",
    ]);
    expect(mocks.sendOperatorAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("rejects support idempotency keys that cannot be persisted for case dedupe", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: `support-${"x".repeat(113)}`,
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the digest delivery trail.",
      },
    )).rejects.toMatchObject({
      code: "invalid_idempotency_key",
      status: 400,
    });

    expect(mocks.createSupportCase).not.toHaveBeenCalled();
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
  });

  it("saves support but does not email the operator after API-key authority is lost", async () => {
    const mocks = setupMocks();
    const authorizeExternalEffect = vi.fn().mockRejectedValue(
      Response.json(
        { error: "invalid_api_key", message: "Use an active Five to Nine API key." },
        { status: 401 },
      ),
    );
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-revoked-before-email",
        source: "api_v1",
        authorizeExternalEffect,
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the delivery trail.",
      },
    );

    expect(outcome.result).toMatchObject({ ok: false, action: "support_case.create" });
    expect(authorizeExternalEffect).toHaveBeenCalledTimes(1);
    expect(mocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("opens an agent support case when requester profile lookup fails", async () => {
    const mocks = setupMocks();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getUserDeliveryProfile.mockRejectedValueOnce(new Error("profile lookup down"));
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-profile-fallback",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Please check the digest delivery trail.",
      },
    );
    const result = outcome.result as { ok: boolean; supportCase: { id: string } };

    expect(result).toMatchObject({
      ok: true,
      supportCase: { id: "case-1" },
    });
    expect(mocks.sendOperatorAlertEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lines: expect.arrayContaining(["Requester: unknown"]),
    }));
    consoleError.mockRestore();
  });

  it("does not resend agent support alerts after a sent delivery attempt", async () => {
    const mocks = setupMocks();
    mocks.findAgentActionAuditByIdempotencyKey.mockResolvedValueOnce(auditRecord({
      apiKeyId: "api-key-1",
      actionName: "support_case.create",
      idempotencyKey: "support-1",
      status: "started",
      updatedAt: "2026-06-19T00:00:00.000Z",
    }));
    mocks.createSupportCase.mockResolvedValueOnce({
      id: "case-1",
      userId: "user-1",
      requestKey: "support-1",
      category: "delivery",
      priority: "normal",
      status: "open",
      subject: "Digest did not arrive",
      detail: "Private support detail should not return to the agent.",
      context: {},
      alreadyExists: true,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    mocks.getDeliveryAttemptByIdempotencyKey.mockResolvedValueOnce({ status: "sent" });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-1",
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail: "Private support detail should not return to the agent.",
      },
    );
    const result = outcome.result as { ok: boolean; supportCase: { id: string } };

    expect(result).toMatchObject({
      ok: true,
      supportCase: { id: "case-1" },
    });
    expect(mocks.getDeliveryAttemptByIdempotencyKey).toHaveBeenCalledWith(expect.anything(), "support-case:case-1");
    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auditId: "audit-1", apiKeyId: "api-key-1" }),
    );
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
    expect(mocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["secret-like", "https://hooks.slack.com/services/T/B/C"],
    ["card-like", "The card was 4242 4242 4242 4242."],
    ["comma-separated card-like", "The card was 4242, 4242, 4242, 4242."],
  ])("rejects %s agent support details before operator notification", async (_label, detail) => {
    const mocks = setupMocks();
    mocks.createSupportCase.mockImplementation(async (_env, input) => {
      const { normalizeSupportCaseInput } = await import("~/lib/support");
      normalizeSupportCaseInput({
        category: input.category,
        priority: input.priority,
        subject: input.subject,
        detail: input.detail,
      });
      throw new Error("unexpected support persistence");
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: `support-reject-${String(_label)}`,
        source: "api_v1",
      },
      "support_case.create",
      {
        category: "delivery",
        subject: "Digest did not arrive",
        detail,
      },
    )).rejects.toMatchObject({
      code: "secret_support_case_rejected",
      status: 400,
    });
    expect(mocks.sendOperatorAlertEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid agent support list status", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "support-list-invalid",
        source: "api_v1",
      },
      "support_case.list",
      {
        status: "pending",
      },
    )).rejects.toMatchObject({
      code: "invalid_support_case_status",
      status: 400,
    });
    expect(mocks.listSupportCases).not.toHaveBeenCalled();
  });

  it("saves and lists client rooms with owned resource refs", async () => {
    const mocks = setupMocks();
    mocks.listCollectionItems.mockResolvedValue([{
      id: "item-1",
      collectionId: "collection-1",
      adId: externalAd.metaAdId,
      note: "Saved evidence",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      tags: ["evidence"],
      ad: {
        ...externalAd,
        landingPageUrl: "https://glossier.com/offer",
        landingPage: {
          rawUrl: "https://glossier.com/offer",
          canonicalUrl: "https://glossier.com/offer",
          rawHeadline: "Current offer",
          normalizedHeadline: "current offer",
          normalizedHeadlineHash: "current-offer",
          captureMethod: "browser_render",
          capturedAt: "2026-07-15T00:00:00.000Z",
        },
      },
    }]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "room-1",
        source: "api_v1",
      },
      "client_room.upsert",
      {
        name: "Beauty client",
        clientLabel: "Nykaa",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Nykaa watch",
          },
          {
            resourceType: "report",
            resourceId: "collection:collection-1",
          },
        ],
        notes: {
          goal: "Weekly proof review",
        },
      },
    );

    const result = outcome.result as { room: { id: string } };
    expect(result.room.id).toEqual(expect.any(String));
    expect(mocks.getWatchlist).toHaveBeenCalledWith(expect.anything(), "watchlist-1", "user-1");
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "user-1");
    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();

    const listOutcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "room-list-1",
        source: "api_v1",
      },
      "client_room.list",
      {
        status: "all",
        limit: 5,
      },
    );
    const listResult = listOutcome.result as { rooms: Array<{ id: string }> };

    expect(listResult.rooms[0]?.id).toBe("room-1");
    expect(mocks.listClientRooms).toHaveBeenCalledWith(expect.anything(), "user-1", {
      status: "all",
      limit: 5,
    });
    expect(mocks.claimAgentActionAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionName: "client_room.list",
        idempotencyKey: null,
      }),
    );
  });

  it("rejects client-room notes with secret-like values before persistence", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-secret-notes-1",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          notes: {
            url: "https://hooks.slack.com/services/team/channel/token",
          },
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects client-room display fields with secret-like values before persistence", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-secret-labels-1",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          clientLabel: "https://hooks.slack.com/services/team/channel/token",
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-secret-labels-2",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "bearer abcdefghijklmnop",
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("allows ordinary client-room display fields that contain security-adjacent words", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "room-safe-labels-1",
        source: "api_v1",
      },
      "client_room.upsert",
      {
        name: "Token Metrics",
        clientLabel: "Secret Sales",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Webhook QA",
          },
        ],
      },
    );

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects malformed client-room notes instead of clearing them", async () => {
    const mocks = setupMocks();
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-bad-notes-1",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          notes: [],
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects caller-fabricated client-room report approvals", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-fabricated-approval-1",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          notes: {
            goal: "Weekly proof review",
            reportApprovals: {
              "collection:collection-1": {
                evidenceFingerprint: "forged",
                reviewedAt: "2026-07-15T00:00:00.000Z",
                approvalExpiresAt: "2026-07-16T00:00:00.000Z",
              },
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "reserved_room_notes",
      message: "reportApprovals is owner-managed; use the browser approval action to approve current report evidence.",
    });
    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("redacts secret-like values from listed client-room fields", async () => {
    const mocks = setupMocks();
    mocks.listClientRooms.mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "https://hooks.slack.com/services/team/channel/token",
        clientLabel: "apiKey=f9_live_secret",
        status: "active",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "bearer abcdefghijklmnop",
          },
        ],
        notes: {
          goal: "Weekly proof review",
          url: "https://hooks.slack.com/services/team/channel/token",
          handoff: {
            webhook: "https://hooks.slack.com/services/team/channel/token",
            owner: "Growth",
          },
          channels: ["Email", "bearer nestedabcdefghijklmnop"],
        },
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const outcome = await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "room-list-redacted-1",
        source: "api_v1",
      },
      "client_room.list",
      {
        status: "all",
      },
    );

    const result = outcome.result as {
      rooms: Array<{
        name: string;
        clientLabel: string | null;
        resourceRefs: Array<{ label?: string }>;
        notes: Record<string, unknown>;
      }>;
    };
    expect(result.rooms[0]).toMatchObject({
      name: "Client room",
      clientLabel: "Client",
      resourceRefs: [
        {
          label: "Linked resource",
        },
      ],
    });
    expect(result.rooms[0]?.notes).toEqual({
      goal: "Weekly proof review",
      url: "[redacted]",
      handoff: {
        "[redacted]": "[redacted]",
        owner: "Growth",
      },
      channels: ["Email", "[redacted]"],
    });
  });

  it("omits client-room notes from persistence when notes were not supplied", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await runCustomerAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        idempotencyKey: "room-no-notes-1",
        source: "api_v1",
      },
      "client_room.upsert",
      {
        name: "Beauty client",
        clientLabel: "Nykaa",
      },
    );

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("requires and forwards the last observed timestamp for client-room updates", async () => {
    let boundValues: unknown[] = [];
    const mocks = setupMocks({
      runAtomicAgentAction: async (_env, _context, atomicOptions) => {
        const prepared = await atomicOptions.prepare(
          {
            prepare: () => ({
              bind: (...bindings: unknown[]) => {
                boundValues = bindings;
                return {};
              },
            }),
          } as never,
          "audit-atomic",
        );
        return {
          audit: auditRecord({ actionName: "client_room.upsert", status: "succeeded", result: prepared.result }),
          replayed: false,
          result: prepared.result,
        };
      },
    });
    mocks.getClientRoom.mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Beauty client",
      clientLabel: "Nykaa",
      status: "active",
      resourceRefs: [],
      notes: { goal: "Weekly proof review" },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        { userId: "user-1", apiKeyId: "api-key-1", idempotencyKey: "room-update-missing-cas", source: "api_v1" },
        "client_room.upsert",
        { roomId: "room-1", name: "Beauty client" },
      ),
    ).rejects.toMatchObject({ code: "missing_expected_updated_at", status: 409 });

    await runCustomerAgentAction(
      { DB: {} } as never,
      { userId: "user-1", apiKeyId: "api-key-1", idempotencyKey: "room-update-with-cas", source: "api_v1" },
      "client_room.upsert",
      {
        roomId: "room-1",
        expectedUpdatedAt: "2026-07-15T10:00:00.000Z",
        name: "Beauty client revised",
      },
    );

    expect(boundValues).toContain("2026-07-15T10:00:00.000Z");
  });

  it("clears stale report approvals from the committed and replayed result when refs change", async () => {
    let committedResult: Record<string, unknown> | null = null;
    const mocks = setupMocks({
      runAtomicAgentAction: async (_env, context, atomicOptions) => {
        if (committedResult) {
          return {
            audit: auditRecord({ actionName: context.actionName, status: "succeeded", result: committedResult }),
            replayed: true,
            result: committedResult,
          };
        }
        const prepared = await atomicOptions.prepare(
          { prepare: () => ({ bind: () => ({}) }) } as never,
          "audit-atomic",
        );
        committedResult = prepared.result;
        return {
          audit: auditRecord({ actionName: context.actionName, status: "succeeded", result: prepared.result }),
          replayed: false,
          result: prepared.result,
        };
      },
    });
    mocks.getClientRoom.mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Beauty client",
      clientLabel: "Nykaa",
      status: "active",
      resourceRefs: [{
        resourceType: "collection",
        resourceId: "collection-1",
        label: "Original report",
      }],
      notes: {
        goal: "Weekly proof review",
        reportApprovals: {
          "collection:collection-1": {
            evidenceFingerprint: "stale-fingerprint",
            reviewedAt: "2026-07-15T09:00:00.000Z",
          },
        },
      },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
    });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const input = {
      roomId: "room-1",
      expectedUpdatedAt: "2026-07-15T10:00:00.000Z",
      name: "Beauty client",
      resourceRefs: [{
        resourceType: "watchlist" as const,
        resourceId: "watchlist-1",
        label: "Current proof",
      }],
    };
    const context = {
      userId: "user-1",
      apiKeyId: "api-key-1",
      idempotencyKey: "room-replace-refs-1",
      source: "api_v1" as const,
    };

    const first = await runCustomerAgentAction(
      { DB: {} } as never,
      context,
      "client_room.upsert",
      input,
    );
    const replay = await runCustomerAgentAction(
      { DB: {} } as never,
      context,
      "client_room.upsert",
      input,
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect((first.result as { room: { notes: Record<string, unknown> } }).room.notes).toEqual({
      goal: "Weekly proof review",
    });
    expect(replay.result).toEqual(first.result);
  });

  it("rejects client-room refs that are not owned by the account", async () => {
    const mocks = setupMocks();
    mocks.getWatchlist.mockResolvedValue(null);
    const { CustomerAgentActionError, runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          apiKeyId: "api-key-1",
          idempotencyKey: "room-bad-ref-1",
          source: "api_v1",
        },
        "client_room.upsert",
        {
          name: "Beauty client",
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "other-watchlist",
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(CustomerAgentActionError);

    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects client-room report refs without current evidence", async () => {
    const mocks = setupMocks();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        { userId: "user-1", apiKeyId: "api-key-1", idempotencyKey: "room-empty-report", source: "api_v1" },
        "client_room.upsert",
        {
          name: "Beauty client",
          resourceRefs: [{ resourceType: "report", resourceId: "collection:collection-1" }],
        },
      ),
    ).rejects.toMatchObject({ code: "evidence_not_ready" });
    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects client-room report refs for inactive watchlists", async () => {
    const mocks = setupMocks();
    mocks.getWatchlist.mockResolvedValue({ ...watchlist, isActive: false });
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        { userId: "user-1", apiKeyId: "api-key-1", idempotencyKey: "room-inactive-report", source: "api_v1" },
        "client_room.upsert",
        {
          name: "Beauty client",
          resourceRefs: [{ resourceType: "report", resourceId: "watchlist:watchlist-1" }],
        },
      ),
    ).rejects.toMatchObject({ code: "watchlist_not_found" });
    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });

  it("rejects client-room report refs when watch events are not verified", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([{ ...watchEvent, status: "detected", proofCaptureId: null }]);
    mocks.listAdsByIds.mockResolvedValue([externalAd]);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    await expect(
      runCustomerAgentAction(
        { DB: {} } as never,
        { userId: "user-1", apiKeyId: "api-key-1", idempotencyKey: "room-unverified-report", source: "api_v1" },
        "client_room.upsert",
        {
          name: "Beauty client",
          resourceRefs: [{ resourceType: "report", resourceId: "watchlist:watchlist-1" }],
        },
      ),
    ).rejects.toMatchObject({ code: "evidence_not_ready" });
    expect(mocks.upsertClientRoom).not.toHaveBeenCalled();
  });
});
