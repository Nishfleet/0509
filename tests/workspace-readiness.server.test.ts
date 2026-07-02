import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = "2026-06-18T00:00:00.000Z";

function createWatchlist(input: { id?: string; isActive?: boolean } = {}) {
  return {
    id: input.id ?? "watchlist-1",
    userId: "user-1",
    name: "Nykaa watch",
    targetType: "advertiser",
    targetId: "nykaa",
    targetFingerprint: "fp-nykaa",
    targetLabel: "Nykaa",
    targetCountry: "IN",
    isActive: input.isActive ?? true,
    lastScannedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function setupMocks(overrides: Record<string, unknown> = {}) {
  const dataMocks = {
    listSavedQueries: vi.fn().mockResolvedValue([{ id: "query-1" }]),
    listWatchlists: vi.fn().mockResolvedValue([createWatchlist()]),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([
      {
        id: "proof-1",
        status: "succeeded",
        attemptedAt: now,
        succeededAt: now,
      },
    ]),
    listDigests: vi.fn().mockResolvedValue([
      {
        id: "digest-1",
        userId: "user-1",
        periodStart: now,
        periodEnd: now,
        createdAt: now,
        items: [],
        delivery: {
          id: "delivery-1",
          digestRunId: "digest-1",
          provider: "email",
          status: "sent",
          recipientEmail: "nish@example.com",
          externalMessageId: "msg-1",
          errorMessage: null,
          deliveredAt: now,
        },
      },
    ]),
    getDeliveryTargetReadinessStats: vi.fn().mockResolvedValue({
      activeCount: 1,
      provenCount: 1,
    }),
    getUserPlanBillingInfo: vi.fn().mockResolvedValue({
      plan: "agency",
      dodoStatus: "active",
      dodoProductId: "prod-1",
      billingInterval: "annual",
      dodoSubscriptionId: "sub-1",
      dodoCustomerId: "cus-1",
      dodoNextBillingAt: now,
      planUpdatedAt: now,
    }),
    getSuccessfulProofCaptureStatsForUser: vi.fn().mockResolvedValue({
      count: 1,
      latestAt: now,
    }),
    listAgentMemory: vi.fn().mockResolvedValue([
      {
        id: "memory-1",
        userId: "user-1",
        scope: "workspace",
        key: "cadence",
        value: { cadence: "weekly" },
        source: "api_v1",
        createdAt: now,
        updatedAt: now,
      },
    ]),
    listClientRooms: vi.fn().mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "Beauty client",
        clientLabel: "Nykaa",
        status: "active",
        resourceRefs: [],
        notes: {},
        createdAt: now,
        updatedAt: now,
      },
    ]),
    listCustomerApiKeys: vi.fn().mockResolvedValue([
      {
        id: "key-1",
        userId: "user-1",
        name: "Agent workflow",
        keyPrefix: "f9_live_abc",
        actionsWriteEnabled: true,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]),
    ...overrides,
  };

  vi.doMock("~/lib/data.server", () => dataMocks);
  vi.doMock("~/lib/plan.server", () => ({
    getProofUsageSummary: vi.fn().mockResolvedValue({
      plan: "agency",
      used: 2,
      baseLimit: 2500,
      extraCredits: 0,
      limit: 2500,
      remaining: 2498,
      usageRatio: 0.001,
      warningLevel: "ok",
      upgradeTarget: null,
      periodStart: now,
      periodEnd: now,
      includedRemaining: 2498,
      topUpRemaining: 0,
      topUpRetainedWhileInactive: 0,
      canSpendTopUps: true,
      nextPeriodStart: now,
    }),
    listActiveProofCreditGrants: vi.fn().mockResolvedValue([
      {
        credits: 500,
        skuSlug: "burst_500_v1",
        providerPaymentId: "pay_secret",
        grantedAt: now,
        expiresAt: null,
      },
    ]),
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    listWorkspaceMembers: vi.fn().mockResolvedValue([
      {
        id: "member-1",
        ownerUserId: "user-1",
        memberUserId: "user-2",
        invitedEmail: "teammate@example.com",
        status: "active",
        createdAt: now,
        acceptedAt: now,
      },
    ]),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue({
      status: "healthy",
      provider: "meta_library_browser",
      mode: "live",
      summary: "Live commercial discovery is healthy.",
      lastCheckedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    }),
  }));

  return dataMocks;
}

async function loadReadiness() {
  const { getWorkspaceReadiness } = await import("~/lib/workspace-readiness.server");
  return getWorkspaceReadiness({ DB: {} } as never, "user-1");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("getWorkspaceReadiness", () => {
  it("summarizes a ready workspace without exposing secrets", async () => {
    setupMocks();

    const readiness = await loadReadiness();
    const itemStatuses = Object.fromEntries(readiness.items.map((item) => [item.id, item.status]));
    const serialized = JSON.stringify(readiness);

    expect(readiness.status).toBe("ready");
    expect(readiness.counts).toMatchObject({
      competitors: 1,
      activeWatchlists: 1,
      successfulProofs: 1,
      sentDigests: 1,
      deliveryTargets: 1,
      activeApiKeys: 1,
      actionEnabledApiKeys: 1,
      teamMembers: 1,
      agentMemoryEntries: 1,
      clientRooms: 1,
    });
    expect(readiness.nudges).toEqual([
      expect.objectContaining({ id: "billing_support", priority: "low" }),
    ]);
    expect(readiness.billing).toMatchObject({
      plan: "agency",
      billingInterval: "annual",
      dodoStatus: "active",
      nextBillingAt: now,
      hasPaymentIssue: false,
      proofUsage: {
        limit: 2500,
        remaining: 2498,
        topUpRemaining: 0,
        canSpendTopUps: true,
      },
      topUpGrants: [
        {
          skuSlug: "burst_500_v1",
          packName: "Burst Pack",
          remainingCredits: 500,
          grantedAt: now,
          expiresAt: null,
        },
      ],
    });
    expect(readiness.workspace).toMatchObject({
      workspaceUserId: "user-1",
      isMember: false,
      billingOwnerName: null,
      canManageBilling: true,
    });
    expect(itemStatuses.delivery).toBe("ready");
    expect(itemStatuses.api).toBe("ready");
    expect(serialized).not.toContain("encryptedWebhookUrl");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("f9_live_abc");
    expect(serialized).not.toContain("prod-1");
    expect(serialized).not.toContain("sub-1");
    expect(serialized).not.toContain("cus-1");
    expect(serialized).not.toContain("pay_secret");
  });

  it("marks configured Slack without a successful send as needing proof", async () => {
    setupMocks({
      listDigests: vi.fn().mockResolvedValue([]),
      getDeliveryTargetReadinessStats: vi.fn().mockResolvedValue({
        activeCount: 1,
        provenCount: 0,
      }),
    });

    const readiness = await loadReadiness();
    const delivery = readiness.items.find((item) => item.id === "delivery");

    expect(readiness.status).toBe("needs_setup");
    expect(delivery).toMatchObject({
      status: "needs_proof",
      detail: "A delivery target exists but needs a successful delivery check.",
      action: { href: "/app/sources" },
    });
  });

  it("marks billing attention when a paid subscription has a payment issue", async () => {
    setupMocks({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoStatus: "subscription.on_hold",
        dodoProductId: "prod-1",
        billingInterval: "monthly",
        dodoSubscriptionId: "sub-1",
        dodoCustomerId: "cus-1",
        dodoNextBillingAt: now,
        planUpdatedAt: now,
      }),
    });

    const readiness = await loadReadiness();
    const billing = readiness.items.find((item) => item.id === "billing");

    expect(readiness.status).toBe("attention");
    expect(billing).toMatchObject({
      status: "attention",
      detail: "Payment issue needs review before retained monitoring is ready.",
      action: { href: "/app/billing" },
    });
    expect(readiness.billing).toMatchObject({
      plan: "starter",
      billingInterval: "monthly",
      dodoStatus: "subscription.on_hold",
      hasPaymentIssue: true,
    });
  });

  it("does not mark delivery ready from old sent digests without an active target", async () => {
    setupMocks({
      getDeliveryTargetReadinessStats: vi.fn().mockResolvedValue({
        activeCount: 0,
        provenCount: 0,
      }),
    });

    const readiness = await loadReadiness();
    const delivery = readiness.items.find((item) => item.id === "delivery");

    expect(delivery).toMatchObject({
      status: "needs_setup",
      detail: "Digest history exists, but no active delivery target is configured.",
      action: { href: "/app/sources" },
    });
    expect(readiness.counts).toMatchObject({
      sentDigests: 1,
      deliveryTargets: 0,
    });
  });

  it("marks developer access ready when only read-only API keys exist", async () => {
    setupMocks({
      listCustomerApiKeys: vi.fn().mockResolvedValue([
        {
          id: "key-1",
          userId: "user-1",
          name: "Read-only workflow",
          keyPrefix: "f9_live_read",
          actionsWriteEnabled: false,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    });

    const readiness = await loadReadiness();
    const api = readiness.items.find((item) => item.id === "api");

    expect(readiness.status).toBe("ready");
    expect(readiness.counts).toMatchObject({
      activeApiKeys: 1,
      actionEnabledApiKeys: 0,
    });
    expect(api).toMatchObject({
      status: "ready",
      action: null,
    });
    expect(JSON.stringify(readiness)).not.toContain("MCP agent");
  });

  it("keeps proof ready when the latest successful proof is outside recent captures", async () => {
    setupMocks({
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([
        {
          id: "proof-failed-1",
          status: "failed",
          attemptedAt: now,
          succeededAt: null,
        },
      ]),
      getSuccessfulProofCaptureStatsForUser: vi.fn().mockResolvedValue({
        count: 1,
        latestAt: "2026-05-01T00:00:00.000Z",
      }),
    });

    const readiness = await loadReadiness();
    const firstProof = readiness.items.find((item) => item.id === "first_proof");

    expect(firstProof).toMatchObject({
      status: "ready",
      detail: "1 successful evidence check recorded.",
    });
    expect(readiness.counts.successfulProofs).toBe(1);
  });

  it("returns safe setup actions for an empty workspace", async () => {
    setupMocks({
      listSavedQueries: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listDigests: vi.fn().mockResolvedValue([]),
      getDeliveryTargetReadinessStats: vi.fn().mockResolvedValue({
        activeCount: 0,
        provenCount: 0,
      }),
      listCustomerApiKeys: vi.fn().mockResolvedValue([]),
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([]),
      getSuccessfulProofCaptureStatsForUser: vi.fn().mockResolvedValue({
        count: 0,
        latestAt: null,
      }),
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        billingInterval: null,
        dodoSubscriptionId: null,
        dodoCustomerId: null,
        dodoNextBillingAt: null,
        planUpdatedAt: null,
      }),
    });
    vi.doMock("~/lib/plan.server", () => ({
      getProofUsageSummary: vi.fn().mockResolvedValue({
        plan: "free",
        used: 0,
        baseLimit: 0,
        extraCredits: 0,
        limit: 0,
        remaining: 0,
        usageRatio: 0,
        warningLevel: "ok",
        upgradeTarget: null,
      }),
      listActiveProofCreditGrants: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      listWorkspaceMembers: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue({
        status: "demo",
        provider: "demo",
        mode: "demo",
        summary: "No live commercial discovery provider is configured.",
        lastCheckedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }),
    }));

    const readiness = await loadReadiness();
    const items = Object.fromEntries(readiness.items.map((item) => [item.id, item]));

    expect(readiness.status).toBe("needs_setup");
    expect(items.first_competitor).toMatchObject({
      status: "needs_setup",
      action: { href: "/search" },
    });
    expect(items.billing).toMatchObject({
      status: "needs_setup",
      action: { href: "/app/billing" },
    });
    expect(items.team).toMatchObject({
      status: "not_applicable",
      action: null,
    });
    expect(items.api).toMatchObject({
      status: "needs_setup",
      action: { href: "/app/sources" },
    });
    expect(readiness.nudges[0]).toMatchObject({
      id: "first_competitor",
      href: "/search",
    });
  });
});
