import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentActionAuditRecord } from "~/lib/types";

function auditRecord(input: Partial<AgentActionAuditRecord> = {}): AgentActionAuditRecord {
  return {
    id: "audit-1",
    userId: "user-1",
    apiKeyId: "api-key-1",
    actionName: "watchlist.create",
    resourceType: "watchlist",
    resourceId: "watchlist-1",
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

function setupDataMock(existing: AgentActionAuditRecord | null = null) {
  const completed = auditRecord({
    status: "succeeded",
    result: { watchlistId: "watchlist-1" },
    metadata: { source: "mcp", note: "safe" },
  });
  const mocks = {
    findAgentActionAuditByIdempotencyKey: vi.fn().mockResolvedValue(existing),
    claimAgentActionAudit: vi.fn().mockResolvedValue({
      audit: auditRecord(),
      claimed: true,
    }),
    finishAgentActionAudit: vi.fn().mockResolvedValue(completed),
  };

  vi.doMock("~/lib/data.server", () => mocks);

  return mocks;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runAuditedAgentAction", () => {
  it("creates a started audit and finishes it when the action succeeds", async () => {
    const mocks = setupDataMock();
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const action = vi.fn().mockResolvedValue({
      resourceType: "watchlist",
      resourceId: "watchlist-1",
      result: {
        watchlistId: "watchlist-1",
        shareUrl: "https://0509.io/share/abcdefghijklmnopqrstuvwxyz",
        share: {
          id: "share-1",
          token: "abcdefghijklmnopqrstuvwxyz",
        },
      },
      metadata: {
        note: "safe",
        token: "should-not-persist",
      },
    });

    const outcome = await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: " Watchlist.Create ",
        idempotencyKey: "idem-1",
        metadata: {
          source: "mcp",
          apiKey: "should-not-persist",
        },
      },
      action,
    );

    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toEqual({
      watchlistId: "watchlist-1",
      shareUrl: "https://0509.io/share/abcdefghijklmnopqrstuvwxyz",
      share: {
        id: "share-1",
        token: "abcdefghijklmnopqrstuvwxyz",
      },
    });
    expect(mocks.claimAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "watchlist.create",
        idempotencyKey: "idem-1",
        metadata: { source: "mcp" },
      }),
    );
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "succeeded",
        resourceType: "watchlist",
        resourceId: "watchlist-1",
        result: {
          watchlistId: "watchlist-1",
          shareUrl: "[redacted]",
          share: {
            id: "share-1",
            token: "[redacted]",
          },
        },
        metadata: { source: "mcp", note: "safe" },
      }),
    );
  });

  it("preserves public memory keys when storing redacted action results", async () => {
    const mocks = setupDataMock();
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");

    await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "memory.upsert",
        idempotencyKey: "idem-1",
      },
      vi.fn().mockResolvedValue({
        resourceType: "agent_memory",
        resourceId: "memory-1",
        result: {
          ok: true,
          action: "memory.upsert",
          memory: {
            id: "memory-1",
            scope: "brand",
            key: "voice",
            value: {
              tone: "plainspoken",
              apiKey: "should-not-persist",
            },
          },
        },
      }),
    );

    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        result: {
          ok: true,
          action: "memory.upsert",
          memory: {
            id: "memory-1",
            scope: "brand",
            key: "voice",
            value: {
              tone: "plainspoken",
              apiKey: "[redacted]",
            },
          },
        },
      }),
    );
  });

  it("redacts standalone provider credentials from audit results and metadata", async () => {
    const mocks = setupDataMock();
    const stripeSecret = ["sk", "live", "1234567890abcdefghijkl"].join("_");
    const awsAccessKey = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
    const googleApiKey = ["AI", "za", "A".repeat(35)].join("");
    const opaqueToken = ["AbcdefGHIJK", "1234567890", "mnopqrstuvwxyzABCDE"].join("");
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");

    await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "report.create",
        idempotencyKey: "idem-1",
        metadata: {
          source: "mcp",
          note: stripeSecret,
        },
      },
      vi.fn().mockResolvedValue({
        resourceType: "report",
        resourceId: "report-1",
        result: {
          ok: true,
          report: {
            summary: "Safe report",
            note: stripeSecret,
            nested: {
              owner: "Growth",
              awsRef: awsAccessKey,
              googleRef: googleApiKey,
              opaqueRef: opaqueToken,
            },
          },
        },
        metadata: {
          trace: googleApiKey,
        },
      }),
    );

    expect(mocks.claimAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: {
          source: "mcp",
          note: "[redacted]",
        },
      }),
    );
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        result: {
          ok: true,
          report: {
            summary: "Safe report",
            note: "[redacted]",
            nested: {
              owner: "Growth",
              awsRef: "[redacted]",
              googleRef: "[redacted]",
              opaqueRef: "[redacted]",
            },
          },
        },
        metadata: {
          source: "mcp",
          note: "[redacted]",
          trace: "[redacted]",
        },
      }),
    );
  });

  it("replays a completed action with the same idempotency key", async () => {
    const existing = auditRecord({
      status: "succeeded",
      result: { watchlistId: "watchlist-1" },
    });
    const mocks = setupDataMock(existing);
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const action = vi.fn();

    const outcome = await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        actionName: "watchlist.create",
        idempotencyKey: "idem-1",
      },
      action,
    );

    expect(outcome.replayed).toBe(true);
    expect(outcome.audit).toBe(existing);
    expect(outcome.result).toEqual({ watchlistId: "watchlist-1" });
    expect(action).not.toHaveBeenCalled();
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key for a different action", async () => {
    setupDataMock(auditRecord({ actionName: "watchlist.refresh", status: "succeeded" }));
    const { AgentActionIdempotencyConflictError, runAuditedAgentAction } = await import("~/lib/agent-actions.server");

    await expect(
      runAuditedAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          actionName: "watchlist.create",
          idempotencyKey: "idem-1",
        },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(AgentActionIdempotencyConflictError);
  });

  it("rejects a reused idempotency key for different request metadata", async () => {
    setupDataMock(auditRecord({
      status: "succeeded",
      result: { watchlistId: "watchlist-1" },
      metadata: {
        requestFingerprint: "fp:one",
      },
    }));
    const { AgentActionIdempotencyConflictError, runAuditedAgentAction } = await import("~/lib/agent-actions.server");

    await expect(
      runAuditedAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          actionName: "watchlist.create",
          idempotencyKey: "idem-1",
          metadata: {
            requestFingerprint: "fp:two",
          },
        },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(AgentActionIdempotencyConflictError);
  });

  it("marks the audit failed and rethrows when the action fails", async () => {
    const mocks = setupDataMock();
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const error = new Error("manual scan failed");

    await expect(
      runAuditedAgentAction(
        { DB: {} } as never,
        {
          userId: "user-1",
          actionName: "watchlist.refresh",
          idempotencyKey: "idem-1",
        },
        vi.fn().mockRejectedValue(error),
      ),
    ).rejects.toThrow("manual scan failed");

    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({
        status: "failed",
        errorCode: "action_failed",
        errorMessage: "manual scan failed",
      }),
    );
  });
});

describe("sanitizeAgentActionMetadata", () => {
  it("removes secret-like fields while preserving safe context", async () => {
    const { sanitizeAgentActionMetadata } = await import("~/lib/agent-actions.server");

    expect(
      sanitizeAgentActionMetadata({
        source: "mcp",
        nested: {
          campaign: "summer",
          webhookUrl: "https://hooks.example.com/private",
          accessToken: "token",
          note: ["whsec", "1234567890abcdefghijkl"].join("_"),
        },
        list: [
          {
            label: "safe",
            credentials: "secret",
          },
        ],
        api_key: "secret",
        key: "secret",
      }),
    ).toEqual({
      source: "mcp",
      nested: {
        campaign: "summer",
        note: "[redacted]",
      },
      list: [
        {
          label: "safe",
        },
      ],
    });
  });
});
