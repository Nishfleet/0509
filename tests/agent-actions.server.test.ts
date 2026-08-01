import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentActionAuditRecord } from "~/lib/types";
import { createSqliteD1 } from "./helpers/sqlite-d1";

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
    reclaimRetryableAgentActionAudit: vi.fn().mockImplementation((_, input: { auditId: string }) =>
      Promise.resolve(auditRecord({
        id: input.auditId,
        apiKeyId: existing ? existing.apiKeyId : "api-key-1",
        actionName: existing?.actionName ?? "support_case.create",
        resourceType: existing?.resourceType ?? "support_case",
        resourceId: existing?.resourceId ?? "case-1",
        status: "started",
      })),
    ),
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

  it("retries a failed non-terminal action with the same idempotency key", async () => {
    const existing = auditRecord({
      status: "failed",
      actionName: "support_case.create",
      resourceType: "support_case",
      resourceId: "case-1",
      result: { ok: false, supportCase: { id: "case-1" } },
      errorCode: "support_notification_failed",
    });
    const completed = auditRecord({
      status: "succeeded",
      actionName: "support_case.create",
      resourceType: "support_case",
      resourceId: "case-1",
      result: { ok: true, supportCase: { id: "case-1" } },
    });
    const mocks = setupDataMock(existing);
    mocks.finishAgentActionAudit.mockResolvedValue(completed);
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const action = vi.fn().mockResolvedValue({
      resourceType: "support_case",
      resourceId: "case-1",
      result: { ok: true, supportCase: { id: "case-1" } },
    });

    const outcome = await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    );

    expect(action).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      replayed: false,
      audit: { status: "succeeded" },
      result: { ok: true, supportCase: { id: "case-1" } },
    });
    expect(mocks.claimAgentActionAudit).not.toHaveBeenCalled();
    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auditId: "audit-1", apiKeyId: "api-key-1" }),
    );
    expect(mocks.finishAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      "audit-1",
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("does not rerun a failed action when another caller reclaimed it first", async () => {
    const existing = auditRecord({
      status: "failed",
      actionName: "support_case.create",
      errorCode: "support_notification_failed",
    });
    const mocks = setupDataMock(existing);
    mocks.reclaimRetryableAgentActionAudit.mockResolvedValue(null);
    const { AgentActionReplayUnavailableError, runAuditedAgentAction } = await import(
      "~/lib/agent-actions.server"
    );
    const action = vi.fn();

    await expect(runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    )).rejects.toBeInstanceOf(AgentActionReplayUnavailableError);

    expect(action).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).not.toHaveBeenCalled();
  });

  it("keeps a fresh started retry unavailable", async () => {
    const existing = auditRecord({
      status: "started",
      actionName: "support_case.create",
      updatedAt: new Date().toISOString(),
    });
    const mocks = setupDataMock(existing);
    mocks.reclaimRetryableAgentActionAudit.mockResolvedValue(null);
    const { AgentActionReplayUnavailableError, runAuditedAgentAction } = await import(
      "~/lib/agent-actions.server"
    );
    const action = vi.fn();

    await expect(runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    )).rejects.toBeInstanceOf(AgentActionReplayUnavailableError);

    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        auditId: "audit-1",
        apiKeyId: "api-key-1",
      }),
    );
    expect(action).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).not.toHaveBeenCalled();
  });

  it("executes one retry after a stale started lease is reclaimed", async () => {
    const existing = auditRecord({
      status: "started",
      actionName: "support_case.create",
      updatedAt: "2026-06-19T00:00:00.000Z",
    });
    const completed = auditRecord({
      status: "succeeded",
      actionName: "support_case.create",
      result: { ok: true, supportCase: { id: "case-1" } },
    });
    const mocks = setupDataMock(existing);
    mocks.finishAgentActionAudit.mockResolvedValue(completed);
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const action = vi.fn().mockResolvedValue({
      resourceType: "support_case",
      resourceId: "case-1",
      result: { ok: true, supportCase: { id: "case-1" } },
    });

    const outcome = await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    );

    expect(outcome).toMatchObject({ replayed: false, audit: { status: "succeeded" } });
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auditId: "audit-1", apiKeyId: "api-key-1" }),
    );
  });

  it("rejects retrying a failed audit through a different API key", async () => {
    const existing = auditRecord({
      status: "failed",
      actionName: "support_case.create",
      apiKeyId: "api-key-original",
    });
    const mocks = setupDataMock(existing);
    const { AgentActionIdempotencyConflictError, runAuditedAgentAction } = await import(
      "~/lib/agent-actions.server"
    );
    const action = vi.fn();

    await expect(runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-different",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    )).rejects.toBeInstanceOf(AgentActionIdempotencyConflictError);

    expect(mocks.reclaimRetryableAgentActionAudit).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(mocks.finishAgentActionAudit).not.toHaveBeenCalled();
  });

  it("preserves null API-key attribution when reclaiming a failed audit", async () => {
    const existing = auditRecord({
      status: "failed",
      actionName: "support_case.create",
      apiKeyId: null,
    });
    const mocks = setupDataMock(existing);
    const { runAuditedAgentAction } = await import("~/lib/agent-actions.server");
    const action = vi.fn().mockResolvedValue({
      result: { ok: true, supportCase: { id: "case-1" } },
    });

    await runAuditedAgentAction(
      { DB: {} } as never,
      {
        userId: "user-1",
        actionName: "support_case.create",
        idempotencyKey: "idem-1",
      },
      action,
      { retryFailed: true },
    );

    expect(mocks.reclaimRetryableAgentActionAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auditId: "audit-1", apiKeyId: null }),
    );
    expect(action).toHaveBeenCalledTimes(1);
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

function createAgentActionAuditHarness() {
  const harness = createSqliteD1();
  harness.sqlite.exec(`
    CREATE TABLE agent_action_audit (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      api_key_id TEXT,
      action_name TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );
  `);
  return harness;
}

function seedRetryableAudit(
  harness: ReturnType<typeof createAgentActionAuditHarness>,
  input: {
    id: string;
    apiKeyId: string | null;
    status: "failed" | "started";
    updatedAt: string;
  },
) {
  harness.sqlite.prepare(`
    INSERT INTO agent_action_audit (
      id, user_id, api_key_id, action_name, resource_type, resource_id,
      idempotency_key, status, result_json, error_code, error_message,
      metadata_json, created_at, updated_at
    ) VALUES (?, 'user-1', ?, 'support_case.create', 'support_case', 'case-1', ?, ?,
      '{"ok":false}', 'support_notification_failed', 'Operator notification failed.',
      '{"source":"mcp"}', '2026-06-18T00:00:00.000Z', ?)
  `).run(input.id, input.apiKeyId, `support-retry-${input.id}`, input.status, input.updatedAt);
}

describe("reclaimRetryableAgentActionAudit", () => {
  it("reclaims a failed audit once and persists cleared retry state", async () => {
    const harness = createAgentActionAuditHarness();
    try {
      seedRetryableAudit(harness, {
        id: "audit-failed",
        apiKeyId: "api-key-1",
        status: "failed",
        updatedAt: "2026-06-20T00:00:00.000Z",
      });
      const { reclaimRetryableAgentActionAudit } = await import(
        "~/lib/data/customer-api-agent.server"
      );
      const env = { DB: harness.db as unknown as D1Database } as never;
      const reclaimInput = {
        auditId: "audit-failed",
        apiKeyId: "api-key-1",
      };

      const reclaimed = await reclaimRetryableAgentActionAudit(env, reclaimInput);
      const secondClaim = await reclaimRetryableAgentActionAudit(env, reclaimInput);

      expect(reclaimed).toMatchObject({
        id: "audit-failed",
        apiKeyId: "api-key-1",
        status: "started",
        result: null,
        errorCode: null,
        errorMessage: null,
        resourceType: "support_case",
        resourceId: "case-1",
        metadata: { source: "mcp" },
      });
      expect(secondClaim).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("rejects a fresh lease and lets only one claimant refresh a stale lease", async () => {
    const harness = createAgentActionAuditHarness();
    try {
      seedRetryableAudit(harness, {
        id: "audit-fresh",
        apiKeyId: "api-key-1",
        status: "started",
        updatedAt: new Date().toISOString(),
      });
      seedRetryableAudit(harness, {
        id: "audit-stale",
        apiKeyId: "api-key-1",
        status: "started",
        updatedAt: "2026-06-18T00:00:00.000Z",
      });
      const { reclaimRetryableAgentActionAudit } = await import(
        "~/lib/data/customer-api-agent.server"
      );
      const env = { DB: harness.db as unknown as D1Database } as never;
      const baseInput = {
        apiKeyId: "api-key-1",
      };

      const freshClaim = await reclaimRetryableAgentActionAudit(env, {
        ...baseInput,
        auditId: "audit-fresh",
      });
      const staleClaim = await reclaimRetryableAgentActionAudit(env, {
        ...baseInput,
        auditId: "audit-stale",
      });
      const staleLoser = await reclaimRetryableAgentActionAudit(env, {
        ...baseInput,
        auditId: "audit-stale",
      });

      expect(freshClaim).toBeNull();
      expect(staleClaim).toMatchObject({
        id: "audit-stale",
        apiKeyId: "api-key-1",
        status: "started",
        result: null,
        errorCode: null,
        errorMessage: null,
      });
      expect(staleClaim?.updatedAt).not.toBe("2026-06-18T00:00:00.000Z");
      expect(staleLoser).toBeNull();
      expect(harness.sqlite.prepare(`
        SELECT status, result_json, error_code, error_message, updated_at
        FROM agent_action_audit
        WHERE id = ?
      `).get("audit-stale")).toEqual({
        status: "started",
        result_json: null,
        error_code: null,
        error_message: null,
        updated_at: staleClaim?.updatedAt,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects an old owner after reclaim while the current owner completes", async () => {
    const harness = createAgentActionAuditHarness();
    try {
      const oldLeaseToken = "2026-06-18T00:00:00.000Z";
      seedRetryableAudit(harness, {
        id: "audit-stale-owner",
        apiKeyId: "api-key-1",
        status: "started",
        updatedAt: oldLeaseToken,
      });
      const {
        finishAgentActionAudit,
        reclaimRetryableAgentActionAudit,
      } = await import("~/lib/data/customer-api-agent.server");
      const env = { DB: harness.db as unknown as D1Database } as never;

      const reclaimed = await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-stale-owner",
        apiKeyId: "api-key-1",
      });
      expect(reclaimed?.updatedAt).not.toBe(oldLeaseToken);

      const currentCompletion = await finishAgentActionAudit(
        env,
        "audit-stale-owner",
        {
          status: "succeeded",
          leaseToken: reclaimed!.updatedAt,
          result: { ok: true, supportCase: { id: "case-1" } },
          metadata: { source: "mcp" },
        },
      );
      const oldOwnerCompletion = await finishAgentActionAudit(
        env,
        "audit-stale-owner",
        {
          status: "failed",
          leaseToken: oldLeaseToken,
          errorCode: "action_failed",
          errorMessage: "Old worker failed after the retry completed.",
          metadata: { source: "mcp" },
        },
      );

      expect(currentCompletion).toMatchObject({
        status: "succeeded",
        result: { ok: true, supportCase: { id: "case-1" } },
      });
      expect(oldOwnerCompletion).toBeNull();
      expect(harness.sqlite.prepare(`
        SELECT status, result_json, error_code, error_message
        FROM agent_action_audit
        WHERE id = ?
      `).get("audit-stale-owner")).toEqual({
        status: "succeeded",
        result_json: '{"ok":true,"supportCase":{"id":"case-1"}}',
        error_code: null,
        error_message: null,
      });
    } finally {
      harness.close();
    }
  });

  it("enforces API-key identity with null-safe claim semantics", async () => {
    const harness = createAgentActionAuditHarness();
    try {
      seedRetryableAudit(harness, {
        id: "audit-keyed",
        apiKeyId: "api-key-1",
        status: "failed",
        updatedAt: "2026-06-18T00:00:00.000Z",
      });
      seedRetryableAudit(harness, {
        id: "audit-null-key",
        apiKeyId: null,
        status: "failed",
        updatedAt: "2026-06-18T00:00:00.000Z",
      });
      const { reclaimRetryableAgentActionAudit } = await import(
        "~/lib/data/customer-api-agent.server"
      );
      const env = { DB: harness.db as unknown as D1Database } as never;
      expect(await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-keyed",
        apiKeyId: "api-key-2",
      })).toBeNull();
      expect(await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-keyed",
        apiKeyId: null,
      })).toBeNull();
      expect(await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-null-key",
        apiKeyId: "api-key-1",
      })).toBeNull();

      const keyedClaim = await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-keyed",
        apiKeyId: "api-key-1",
      });
      const nullKeyClaim = await reclaimRetryableAgentActionAudit(env, {
        auditId: "audit-null-key",
        apiKeyId: null,
      });

      expect(keyedClaim).toMatchObject({ status: "started", apiKeyId: "api-key-1" });
      expect(nullKeyClaim).toMatchObject({ status: "started", apiKeyId: null });
    } finally {
      harness.close();
    }
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
