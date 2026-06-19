import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentActionAuditRecord, WatchlistRecord } from "~/lib/types";

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
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createAgentActionAudit: vi.fn().mockResolvedValue(auditRecord()),
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
    createWatchlist: mocks.createWatchlist,
    getWatchlist: mocks.getWatchlist,
    setWatchlistActive: mocks.setWatchlistActive,
    findAgentActionAuditByIdempotencyKey: mocks.findAgentActionAuditByIdempotencyKey,
    createAgentActionAudit: mocks.createAgentActionAudit,
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
});
