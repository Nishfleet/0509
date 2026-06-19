import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function setupMocks(options: { planLimitAllowed?: boolean; plan?: string } = {}) {
  const mocks = {
    checkPlanLimit: vi.fn().mockResolvedValue({
      allowed: options.planLimitAllowed ?? true,
      limit: 10,
      current: options.planLimitAllowed === false ? 10 : 1,
    }),
    getUserPlan: vi.fn().mockResolvedValue(options.plan ?? "starter"),
    createWatchlist: vi.fn().mockResolvedValue(watchlist),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    setWatchlistActive: vi.fn().mockResolvedValue(true),
    queueFirstWatchlistScan: vi.fn(),
    runWatchlistManual: vi.fn().mockResolvedValue({ status: "succeeded" }),
    addExternalProofToCollection: vi.fn().mockResolvedValue(externalAd),
    getCollection: vi.fn().mockResolvedValue(collection),
    getDigest: vi.fn().mockResolvedValue({
      id: "digest-1",
      userId: "user-1",
    }),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listCollectionItems: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
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
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    claimAgentActionAudit: vi.fn().mockResolvedValue({
      audit: auditRecord(),
      claimed: true,
    }),
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
  };

  vi.doMock("~/lib/plan.server", () => ({
    checkPlanLimit: mocks.checkPlanLimit,
    getUserPlan: mocks.getUserPlan,
  }));
  vi.doMock("~/lib/data.server", () => ({
    addExternalProofToCollection: mocks.addExternalProofToCollection,
    createShareLink: mocks.createShareLink,
    createWatchlist: mocks.createWatchlist,
    getCollection: mocks.getCollection,
    getDigest: mocks.getDigest,
    getShareLinkById: mocks.getShareLinkById,
    getWatchlist: mocks.getWatchlist,
    listAdsByIds: mocks.listAdsByIds,
    listAgentMemory: mocks.listAgentMemory,
    listClientRooms: mocks.listClientRooms,
    listCollectionItems: mocks.listCollectionItems,
    listWatchEvents: mocks.listWatchEvents,
    setWatchlistActive: mocks.setWatchlistActive,
    upsertClientRoom: mocks.upsertClientRoom,
    upsertAgentMemory: mocks.upsertAgentMemory,
    findAgentActionAuditByIdempotencyKey: mocks.findAgentActionAuditByIdempotencyKey,
    claimAgentActionAudit: mocks.claimAgentActionAudit,
    finishAgentActionAudit: mocks.finishAgentActionAudit,
  }));
  vi.doMock("~/lib/monitoring.server", () => ({
    queueFirstWatchlistScan: mocks.queueFirstWatchlistScan,
    runWatchlistManual: mocks.runWatchlistManual,
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
  }));

  return mocks;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runCustomerAgentAction", () => {
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

    const result = outcome.result as { watchlist: { id: string } };
    expect(result.watchlist.id).toBe("watchlist-1");
    expect(mocks.checkPlanLimit).toHaveBeenCalledWith(expect.anything(), "user-1", "watchlists");
    expect(mocks.createWatchlist).toHaveBeenCalledWith(
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

    expect(mocks.createWatchlist).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "action_failed",
      }),
    );
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

  it("adds audited external proof to an owned board", async () => {
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
    const mocks = setupMocks();
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
      },
    );

    const result = outcome.result as {
      report: { reportId: string };
      shareUrl: string;
    };
    expect(result.report.reportId).toBe("collection:collection-1");
    expect(result.shareUrl).toBe("https://0509.io/share/sharetoken1");
    expect(mocks.createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        user: expect.objectContaining({ id: "user-1" }),
      }),
      expect.objectContaining({
        resourceType: "report",
        resourceId: "collection:collection-1",
        isSnapshot: true,
        snapshotPayload: expect.objectContaining({
          reportId: "collection:collection-1",
        }),
      }),
    );
  });

  it("replays report share actions with a reconstructed share URL", async () => {
    const mocks = setupMocks();
    mocks.findAgentActionAuditByIdempotencyKey.mockResolvedValue(auditRecord({
      actionName: "report.share",
      status: "succeeded",
      result: {
        ok: true,
        action: "report.share",
        report: {
          reportId: "collection:collection-1",
        },
        share: {
          id: "share-1",
          token: "[redacted]",
          expiresAt: "2026-09-19T00:00:00.000Z",
        },
        shareUrl: "[redacted]",
      },
    }));
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
      },
    );

    const result = outcome.result as { shareUrl: string; share: { token: string } };
    expect(outcome.replayed).toBe(true);
    expect(result.shareUrl).toBe("https://0509.io/share/sharetoken1");
    expect(result.share.token).toBe("sharetoken1");
    expect(mocks.createShareLink).not.toHaveBeenCalled();
    expect(mocks.getShareLinkById).toHaveBeenCalledWith(expect.anything(), "user-1", "share-1");
  });

  it("builds audited counter-move briefs from owned watchlists", async () => {
    const mocks = setupMocks();
    mocks.listWatchEvents.mockResolvedValue([watchEvent]);
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
      },
    );

    const result = outcome.result as {
      brief: {
        watchlistId: string;
        moves: Array<{ counterMove: string; priorityBand: string }>;
      };
    };
    expect(result.brief.watchlistId).toBe("watchlist-1");
    expect(result.brief.moves[0]).toMatchObject({
      priorityBand: "High priority",
      counterMove: expect.stringContaining("offer shift"),
    });
    expect(mocks.listWatchEvents).toHaveBeenCalledWith(expect.anything(), "watchlist-1", 9);
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

  it("saves and lists client rooms with owned resource refs", async () => {
    const mocks = setupMocks();
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
          token: "should-not-store",
        },
      },
    );

    const result = outcome.result as { room: { id: string } };
    expect(result.room.id).toBe("room-1");
    expect(mocks.getWatchlist).toHaveBeenCalledWith(expect.anything(), "watchlist-1", "user-1");
    expect(mocks.getCollection).toHaveBeenCalledWith(expect.anything(), "collection-1", "user-1");
    expect(mocks.upsertClientRoom).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
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
      }),
    );

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

    const roomInput = mocks.upsertClientRoom.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(roomInput, "notes")).toBe(false);
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
});
