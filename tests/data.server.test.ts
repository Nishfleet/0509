import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import {
  creativeCaptureSourceFingerprint,
  shouldAttemptCreativeTextCapture,
} from "~/lib/creative-capture-policy";
import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import type { AdRecord } from "~/lib/types";
import {
  claimEmailTargetForDispatch,
  claimDodoPlanCheckout,
  claimDodoSubscriptionPlanChange,
  clearDodoSubscriptionPlanChangeClaim,
  clearDodoPlanCheckout,
  beginDodoWebhookEventProcessing,
  claimDodoWebhookEvent,
  claimAgentActionAudit,
  createDeliveryAttempt,
  createDiscoveryFetchLog,
  createAgentActionAudit,
  createEventCandidate,
  createLandingPageSnapshot,
  createProofCapture,
  createSupportCase,
  createSupportCaseEvent,
  createWatchEvent,
  deleteUnscannedWatchlistCreatedByFailedAgentAction,
  DODO_PLAN_CHECKOUT_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
  applyDodoPlanGrantWithWatchlistReconcile,
  grantDodoPlanAccess,
  getDeliveryTargetReadinessStats,
  getUserIdForDodoLifecycle,
  getUserPlanBillingInfo,
  markDodoPlanPaymentIssue,
  revokeDodoAccessForRefundedPayment,
  revokeDodoPlanAccess,
  recordWatchlistCapacitySkip,
  closeCounterMoveFollowUp,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  getLaunchReadinessSignals,
  getSuccessfulProofCaptureStatsForUser,
  getSuccessfulRunStatsForUserBetween,
  getOperatorRiskSummary,
  getOperatorSnapshot,
  getOldestUserId,
  getWeeklyBusinessSummary,
  findAgentActionAuditByIdempotencyKey,
  finishAgentActionAudit,
  isBlockingDodoSubscriptionPlanChangeStatus,
  markDodoSubscriptionPlanChangeScheduled,
  listRecentAgentActionAudits,
  listRecentWorkspaceWatchEvents,
  listProofCapturesForTarget,
  listProofCapturesForTargets,
  listClientRooms,
  listAgentMemory,
  listAgentMemoryForClientRooms,
  getSupportCase,
  getClientRoom,
  listSupportCases,
  listSupportCaseEvents,
  listActiveWatchlists,
  listCollectionItems,
  listDigests,
  listRetryableDigestRuns,
  listStaleBillingLifecycleEmailAttempts,
  upsertDigestDelivery,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
  upsertAgentMemory,
  legacyWatchEventImportanceScore,
  legacyWorkspaceDeliveryDefaults,
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  upsertAd,
  upsertCustomerMetaConnection,
  upsertClientRoom,
  upsertDeliveryTarget,
  provisionVerifiedAccountEmailTargetIfUnsuppressed,
  upsertProofTarget,
  upsertWatchlistDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
  suppressEmailTargetsForUserAndAddress,
  resumeEmailTargetsForUserAndAddress,
} from "~/lib/data.server";

function createMockDb(
  resultOverrides: Array<{ sqlIncludes: string; results: unknown[] }> = [],
) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];

  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true };
              },
              async all<T>() {
                const override = resultOverrides.find((entry) => sql.includes(entry.sqlIncludes));
                if (override) {
                  return { results: override.results as T[] };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
      async batch() {
        return statements.map(() => ({ success: true }));
      },
    },
  };
}

describe("proof capture history windows", () => {
  it("keeps every recent failed capture alongside the capped target history", async () => {
    const cutoff = "2026-07-30T06:00:00.000Z";
    const mock = createMockDb();

    await (
      listProofCapturesForTarget as unknown as (
        env: unknown,
        proofTargetId: string,
        limit: number,
        recentFailureCutoff: string,
      ) => Promise<unknown>
    )({ DB: mock.db }, "proof-target-1", 20, cutoff);

    const query = findStatement(mock.statements, "FROM proof_capture");
    expect(query?.sql).toContain("rn <= ?");
    expect(query?.sql).toContain("OR (status = 'failed'");
    expect(query?.bindings).toContain(cutoff);
  });

  it("keeps every recent failed capture in batched target history", async () => {
    const cutoff = "2026-07-30T06:00:00.000Z";
    const mock = createMockDb();

    await (
      listProofCapturesForTargets as unknown as (
        env: unknown,
        proofTargetIds: string[],
        limit: number,
        recentFailureCutoff: string,
      ) => Promise<unknown>
    )({ DB: mock.db }, ["proof-target-1", "proof-target-2"], 20, cutoff);

    const query = findStatement(mock.statements, "FROM proof_capture");
    expect(query?.sql).toContain("rn <= ?");
    expect(query?.sql).toContain("OR (status = 'failed'");
    expect(query?.bindings).toContain(cutoff);
  });
});

function createMissingTableDb(tableName: string) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              throw new Error(`D1_ERROR: no such table: ${tableName}: SQLITE_ERROR`);
            },
            async all() {
              throw new Error(`D1_ERROR: no such table: ${tableName}: SQLITE_ERROR`);
            },
          };
        },
      };
    },
  };
}

function createSqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;
  const toSqliteBindings = (bindings: unknown[]) => bindings as SqliteBindings;

  return {
    close: () => sqlite.close(),
    sqlite,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async run() {
                const result = sqlite.prepare(sql).run(...toSqliteBindings(bindings));
                return { success: true, meta: { changes: Number(result.changes ?? 0) } };
              },
              async all<T>() {
                return {
                  results: sqlite.prepare(sql).all(...toSqliteBindings(bindings)) as T[],
                };
              },
            };
          },
        };
      },
      async batch<T extends { run(): Promise<{ meta?: { changes?: number } }> }>(statements: T[]) {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of statements) {
            results.push(await statement.run());
          }
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

function applyMigration(sqlite: DatabaseSync, path: string) {
  sqlite.exec(readFileSync(path, "utf8"));
}

function findStatement(
  statements: Array<{ sql: string; bindings: unknown[] }>,
  ...needles: string[]
) {
  return statements.find((statement) =>
    needles.every((needle) => statement.sql.includes(needle)),
  );
}

describe("failed agent watchlist compensation", () => {
  it("deletes only an unscanned watchlist and its generated mention target", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE watchlist (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
        CREATE TABLE watchlist_run (
          id TEXT PRIMARY KEY,
          watchlist_id TEXT NOT NULL,
          FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
        );
        CREATE TABLE web_mention_target (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          watchlist_id TEXT,
          FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE SET NULL
        );
        INSERT INTO watchlist (id, user_id) VALUES
          ('unscanned', 'user-1'),
          ('running', 'user-1');
        INSERT INTO web_mention_target (id, user_id, watchlist_id) VALUES
          ('mention-unscanned', 'user-1', 'unscanned'),
          ('mention-running', 'user-1', 'running');
        INSERT INTO watchlist_run (id, watchlist_id) VALUES ('run-1', 'running');
      `);

      await expect(
        deleteUnscannedWatchlistCreatedByFailedAgentAction(
          { DB: sqlite.db } as never,
          "user-1",
          "unscanned",
        ),
      ).resolves.toBe(true);
      await expect(
        deleteUnscannedWatchlistCreatedByFailedAgentAction(
          { DB: sqlite.db } as never,
          "user-1",
          "running",
        ),
      ).resolves.toBe(false);

      expect(sqlite.sqlite.prepare("SELECT id FROM watchlist ORDER BY id").all()).toEqual([{ id: "running" }]);
      expect(sqlite.sqlite.prepare("SELECT id, watchlist_id FROM web_mention_target ORDER BY id").all()).toEqual([
        { id: "mention-running", watchlist_id: "running" },
      ]);
    } finally {
      sqlite.close();
    }
  });
});

describe("createLandingPageSnapshot", () => {
  it("persists structured landing-page fields and landing-page analysis provenance", async () => {
    const mock = createMockDb();

    await createLandingPageSnapshot(
      { DB: mock.db } as never,
      {
        rawUrl: "https://example.com/glow",
        canonicalUrl: "https://example.com/glow",
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "fnv1a-headline",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
        captureMethod: "landing_page_fetch",
        capturedAt: "2026-03-30T00:00:00.000Z",
        artifactKey: null,
        metadata: {
          fetchStatus: 200,
        },
      },
    );

    const snapshotInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO landing_page_snapshot"),
    );
    expect(snapshotInsert?.bindings).toContain("Shop now");
    expect(snapshotInsert?.bindings).toContain("Starting at ₹499");
    expect(snapshotInsert?.bindings).toContain(1);

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    expect(analysisInserts.length).toBe(3);
    expect(analysisInserts.every((statement) => statement.bindings.includes("landing_page"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("cta_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("price_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("form_present"))).toBe(true);
    expect(analysisInserts.every((statement) => statement.bindings.includes("lp-signals-v5"))).toBe(true);
  });

  it("keeps an accepted digest immutable when a stale retry result arrives", async () => {
    const mock = createMockDb();

    await upsertDigestDelivery({ DB: mock.db } as never, "digest-1", {
      provider: "postmark",
      status: "sent",
      recipientEmail: "owner@example.com",
      externalMessageId: "postmark-1",
      errorMessage: null,
      deliveredAt: "2026-06-05T00:00:00.000Z",
    });

    const statement = mock.statements.find((entry) => entry.sql.includes("INSERT INTO digest_delivery"));
    expect(statement?.sql).toContain("digest_delivery.status = 'sent'");
    expect(statement?.sql).toContain("excluded.status != 'sent'");
    expect(statement?.sql).toContain("digest_delivery.delivered_at IS NOT NULL");
    expect(statement?.sql).toContain("excluded.delivered_at IS NULL");
  });
});

describe("agent action audit persistence", () => {
  const row = {
    id: "audit-1",
    user_id: "user-1",
    api_key_id: "api-key-1",
    action_name: "watchlist.create",
    resource_type: "watchlist",
    resource_id: "watchlist-1",
    idempotency_key: "idem-1",
    status: "succeeded",
    result_json: JSON.stringify({ watchlistId: "watchlist-1" }),
    error_code: null,
    error_message: null,
    metadata_json: JSON.stringify({ source: "mcp" }),
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:01:00.000Z",
  };

  it("creates an audit row with normalized JSON payloads", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "SELECT * FROM agent_action_audit WHERE id = ?",
        results: [row],
      },
    ]);

    const audit = await createAgentActionAudit(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        apiKeyId: "api-key-1",
        actionName: "watchlist.create",
        resourceType: "watchlist",
        resourceId: "watchlist-1",
        idempotencyKey: "idem-1",
        status: "succeeded",
        result: { watchlistId: "watchlist-1" },
        metadata: { source: "mcp" },
      },
    );

    const insert = findStatement(mock.statements, "INSERT INTO agent_action_audit");
    expect(insert?.bindings.slice(1, 12)).toEqual([
      "user-1",
      "api-key-1",
      "watchlist.create",
      "watchlist",
      "watchlist-1",
      "idem-1",
      "succeeded",
      JSON.stringify({ watchlistId: "watchlist-1" }),
      null,
      null,
      JSON.stringify({ source: "mcp" }),
    ]);
    expect(audit).toMatchObject({
      id: "audit-1",
      userId: "user-1",
      status: "succeeded",
      result: { watchlistId: "watchlist-1" },
      metadata: { source: "mcp" },
    });
  });

  it("finds an audit row by user-scoped idempotency key", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM agent_action_audit",
        results: [row],
      },
    ]);

    const audit = await findAgentActionAuditByIdempotencyKey({ DB: mock.db } as never, "user-1", "idem-1");

    const select = findStatement(mock.statements, "FROM agent_action_audit", "idempotency_key = ?");
    expect(select?.bindings).toEqual(["user-1", "idem-1"]);
    expect(audit).toMatchObject({
      id: "audit-1",
      actionName: "watchlist.create",
      result: { watchlistId: "watchlist-1" },
    });
  });

  it("lists recent successful agent action audits by action name", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM agent_action_audit",
        results: [row],
      },
    ]);

    const audits = await listRecentAgentActionAudits({ DB: mock.db } as never, "user-1", {
      actionName: "counter_move_brief.create",
      status: "succeeded",
      resourceType: "watchlist",
      limit: 3,
      offset: 30,
    });

    const select = findStatement(mock.statements, "FROM agent_action_audit", "ORDER BY updated_at DESC");
    expect(select?.bindings).toEqual([
      "user-1",
      "counter_move_brief.create",
      "counter_move_brief.create",
      "succeeded",
      "succeeded",
      "watchlist",
      "watchlist",
      3,
      30,
    ]);
    expect(select?.sql).not.toContain("${");
    expect(select?.sql).toContain("LIMIT ? OFFSET ?");
    expect(audits[0]).toMatchObject({
      id: "audit-1",
      result: { watchlistId: "watchlist-1" },
    });
  });

  it("claims idempotent audit rows atomically", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "SELECT * FROM agent_action_audit WHERE id = ?",
        results: [row],
      },
    ]);

    const claim = await claimAgentActionAudit({ DB: mock.db } as never, {
      userId: "user-1",
      apiKeyId: "api-key-1",
      actionName: "watchlist.create",
      resourceType: "watchlist",
      resourceId: "watchlist-1",
      idempotencyKey: "idem-1",
      metadata: { source: "mcp" },
    });

    const insert = findStatement(mock.statements, "INSERT OR IGNORE INTO agent_action_audit");
    expect(insert?.bindings.slice(1, 10)).toEqual([
      "user-1",
      "api-key-1",
      "watchlist.create",
      "watchlist",
      "watchlist-1",
      "idem-1",
      JSON.stringify({ source: "mcp" }),
      expect.any(String),
      expect.any(String),
    ]);
    expect(claim).toMatchObject({
      claimed: true,
      audit: {
        id: "audit-1",
      },
    });
  });

  it("finishes an audit with status, resource, result, and error fields", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "SELECT * FROM agent_action_audit WHERE id = ?",
        results: [row],
      },
    ]);

    const audit = await finishAgentActionAudit(
      { DB: mock.db } as never,
      "audit-1",
      {
        status: "failed",
        leaseToken: row.updated_at,
        resourceType: "watchlist",
        resourceId: "watchlist-1",
        errorCode: "action_failed",
        errorMessage: "manual scan failed",
        metadata: { source: "mcp" },
      },
    );

    const update = findStatement(mock.statements, "UPDATE agent_action_audit");
    expect(update?.bindings.slice(0, 8)).toEqual([
      "failed",
      "watchlist",
      "watchlist-1",
      null,
      "action_failed",
      "manual scan failed",
      JSON.stringify({ source: "mcp" }),
      expect.any(String),
    ]);
    expect(update?.bindings[8]).toBe("audit-1");
    expect(update?.bindings.slice(9)).toEqual([row.updated_at, row.updated_at]);
    expect(update?.sql).toContain("status = 'started' AND updated_at = ?");
    expect(audit?.id).toBe("audit-1");
  });
});

describe("agent memory persistence", () => {
  const row = {
    id: "memory-1",
    user_id: "user-1",
    scope: "brand",
    memory_key: "voice",
    watchlist_id: null,
    client_room_id: null,
    value_json: JSON.stringify({ tone: "plainspoken" }),
    source: "api_v1",
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:01:00.000Z",
  };

  it("updates existing scoped memory with JSON value storage", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM agent_memory",
        results: [row],
      },
    ]);

    const memory = await upsertAgentMemory(
      { DB: mock.db } as never,
      "user-1",
      {
        scope: "brand",
        key: "voice",
        value: { tone: "plainspoken" },
        source: "api_v1",
      },
    );

    const update = findStatement(mock.statements, "UPDATE agent_memory");
    expect(update?.bindings.slice(0, 4)).toEqual([
      JSON.stringify({ tone: "plainspoken" }),
      "api_v1",
      expect.any(String),
      "memory-1",
    ]);
    expect(memory).toMatchObject({
      id: "memory-1",
      scope: "brand",
      key: "voice",
      watchlistId: null,
      clientRoomId: null,
      value: { tone: "plainspoken" },
      source: "api_v1",
    });
  });

  it("lists memory within an optional scope", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM agent_memory",
        results: [row],
      },
    ]);

    const memories = await listAgentMemory({ DB: mock.db } as never, "user-1", {
      scope: "brand",
      limit: 5,
    });

    const select = findStatement(mock.statements, "FROM agent_memory", "scope = ?");
    expect(select?.bindings).toEqual(["user-1", "brand", 5]);
    expect(memories[0]).toMatchObject({
      id: "memory-1",
      scope: "brand",
      key: "voice",
      watchlistId: null,
      clientRoomId: null,
    });
  });

  it("upserts global, watchlist, and client-room memory against the migration schema", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE watchlist (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
      `);
      applyMigration(sqlite.sqlite, "migrations/0036_agent_memory.sql");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec(`
        INSERT INTO user (id) VALUES ('user-1');
        INSERT INTO watchlist (id, user_id) VALUES ('watchlist-1', 'user-1');
        INSERT INTO client_room (
          id,
          user_id,
          name,
          status,
          notes_json,
          created_at,
          updated_at
        )
        VALUES (
          'room-1',
          'user-1',
          'Beauty client',
          'active',
          '{}',
          '2026-06-19T00:00:00.000Z',
          '2026-06-19T00:00:00.000Z'
        );
      `);

      const global = await upsertAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        key: "voice",
        value: { tone: "plainspoken" },
        source: "api_v1",
      });
      const watchlistScoped = await upsertAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        key: "voice",
        watchlistId: "watchlist-1",
        value: { tone: "watchlist" },
        source: "api_v1",
      });
      const clientScoped = await upsertAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        key: "voice",
        clientRoomId: "room-1",
        value: { tone: "client" },
        source: "api_v1",
      });
      await upsertAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        key: "voice",
        watchlistId: "watchlist-1",
        value: { tone: "watchlist updated" },
        source: "mcp",
      });

      const memories = await listAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        limit: 10,
      });
      const watchlistMemories = await listAgentMemory({ DB: sqlite.db } as never, "user-1", {
        scope: "brand",
        watchlistId: "watchlist-1",
        limit: 10,
      });
      const clientRoomMemories = await listAgentMemoryForClientRooms(
        { DB: sqlite.db } as never,
        "user-1",
        ["room-1"],
        { limitPerRoom: 2 },
      );

      expect(global).toMatchObject({ watchlistId: null, clientRoomId: null });
      expect(watchlistScoped).toMatchObject({ watchlistId: "watchlist-1", clientRoomId: null });
      expect(clientScoped).toMatchObject({ watchlistId: null, clientRoomId: "room-1" });
      expect(memories).toHaveLength(3);
      expect(clientRoomMemories).toHaveLength(1);
      expect(clientRoomMemories[0]).toMatchObject({
        clientRoomId: "room-1",
        value: { tone: "client" },
      });
      expect(watchlistMemories).toHaveLength(1);
      expect(watchlistMemories[0]).toMatchObject({
        watchlistId: "watchlist-1",
        value: { tone: "watchlist updated" },
        source: "mcp",
      });
    } finally {
      sqlite.close();
    }
  });

  it("lists client-room memory across multiple rooms with a per-room limit", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE watchlist (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
      `);
      applyMigration(sqlite.sqlite, "migrations/0036_agent_memory.sql");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      applyMigration(sqlite.sqlite, "migrations/0040_agent_memory_client_room_index.sql");
      sqlite.sqlite.exec(`
        INSERT INTO user (id) VALUES ('user-1'), ('user-2');
        INSERT INTO watchlist (id, user_id) VALUES ('watchlist-1', 'user-1');
        INSERT INTO client_room (
          id,
          user_id,
          name,
          status,
          notes_json,
          created_at,
          updated_at
        )
        VALUES
          ('room-1', 'user-1', 'Beauty client', 'active', '{}', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'),
          ('room-2', 'user-1', 'Retail client', 'active', '{}', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'),
          ('room-other', 'user-2', 'Other client', 'active', '{}', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z');
        INSERT INTO agent_memory (
          id,
          user_id,
          scope,
          memory_key,
          watchlist_id,
          client_room_id,
          value_json,
          source,
          created_at,
          updated_at
        )
        VALUES
          ('room-1-new', 'user-1', 'brand', 'room-1-new', NULL, 'room-1', '{"rank":1}', 'api_v1', '2026-06-20T10:05:00.000Z', '2026-06-20T10:05:00.000Z'),
          ('room-1-next', 'user-1', 'brand', 'room-1-next', NULL, 'room-1', '{"rank":2}', 'api_v1', '2026-06-20T10:04:00.000Z', '2026-06-20T10:04:00.000Z'),
          ('room-1-old', 'user-1', 'brand', 'room-1-old', NULL, 'room-1', '{"rank":3}', 'api_v1', '2026-06-20T10:03:00.000Z', '2026-06-20T10:03:00.000Z'),
          ('room-2-new', 'user-1', 'brand', 'room-2-new', NULL, 'room-2', '{"rank":1}', 'api_v1', '2026-06-20T10:02:00.000Z', '2026-06-20T10:02:00.000Z'),
          ('room-2-next', 'user-1', 'brand', 'room-2-next', NULL, 'room-2', '{"rank":2}', 'api_v1', '2026-06-20T10:01:00.000Z', '2026-06-20T10:01:00.000Z'),
          ('room-2-old', 'user-1', 'brand', 'room-2-old', NULL, 'room-2', '{"rank":3}', 'api_v1', '2026-06-20T10:00:00.000Z', '2026-06-20T10:00:00.000Z'),
          ('global-new', 'user-1', 'brand', 'global-new', NULL, NULL, '{"rank":0}', 'api_v1', '2026-06-20T10:06:00.000Z', '2026-06-20T10:06:00.000Z'),
          ('watchlist-new', 'user-1', 'brand', 'watchlist-new', 'watchlist-1', NULL, '{"rank":0}', 'api_v1', '2026-06-20T10:06:00.000Z', '2026-06-20T10:06:00.000Z'),
          ('other-user-room', 'user-2', 'brand', 'other-user-room', NULL, 'room-other', '{"rank":0}', 'api_v1', '2026-06-20T10:06:00.000Z', '2026-06-20T10:06:00.000Z');
      `);

      const memories = await listAgentMemoryForClientRooms(
        { DB: sqlite.db } as never,
        "user-1",
        ["room-1", "room-2", "room-1"],
        { limitPerRoom: 2 },
      );
      const memoryKeys = memories.map((memory) => memory.key);

      expect(memories).toHaveLength(4);
      expect(memories.filter((memory) => memory.clientRoomId === "room-1")).toHaveLength(2);
      expect(memories.filter((memory) => memory.clientRoomId === "room-2")).toHaveLength(2);
      expect(memoryKeys).toEqual(expect.arrayContaining([
        "room-1-new",
        "room-1-next",
        "room-2-new",
        "room-2-next",
      ]));
      expect(memoryKeys).not.toEqual(expect.arrayContaining([
        "room-1-old",
        "room-2-old",
        "global-new",
        "watchlist-new",
        "other-user-room",
      ]));
    } finally {
      sqlite.close();
    }
  });
});

describe("support case persistence", () => {
  it("creates and lists support cases through the migration schema", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("CREATE TABLE delivery_attempt (idempotency_key TEXT, payload_snapshot_json TEXT NOT NULL DEFAULT '{}');");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1'), ('user-2');");

      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "billing",
        priority: "urgent",
        subject: "Need invoice copy",
        detail: "Please send the latest invoice to finance.",
        requestKey: "support-request-1",
        context: { accountEmail: "owner@example.com" },
      });
      const duplicateSupportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "billing",
        priority: "urgent",
        subject: "Need invoice copy",
        detail: "Please send the latest invoice to finance.",
        requestKey: "support-request-1",
        context: { accountEmail: "owner@example.com" },
      });
      await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-2",
        category: "delivery",
        subject: "Digest missing",
        detail: "The weekly digest did not arrive.",
        context: { accountEmail: "other@example.com" },
      });

      const allCases = await listSupportCases({ DB: sqlite.db } as never, "user-1", {
        status: "all",
        limit: 500,
      });
      const openCases = await listSupportCases({ DB: sqlite.db } as never, "user-1", {
        status: "open",
        limit: 1,
      });
      const selectedCase = await getSupportCase({ DB: sqlite.db } as never, "user-1", supportCase?.id ?? "");
      const otherUserCase = await getSupportCase({ DB: sqlite.db } as never, "user-2", supportCase?.id ?? "");
      const caseEvents = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-1",
        supportCase?.id ?? "",
      );

      expect(supportCase).toMatchObject({
        userId: "user-1",
        requestKey: "support-request-1",
        category: "billing",
        priority: "urgent",
        status: "open",
        subject: "Need invoice copy",
        context: { accountEmail: "owner@example.com" },
      });
      expect(duplicateSupportCase?.id).toBe(supportCase?.id);
      expect(allCases).toHaveLength(1);
      expect(allCases[0].userId).toBe("user-1");
      expect(openCases).toHaveLength(1);
      expect(openCases[0]).toMatchObject({
        id: supportCase?.id,
        status: "open",
      });
      expect(selectedCase).toMatchObject({
        id: supportCase?.id,
        detail: "Please send the latest invoice to finance.",
      });
      expect(otherUserCase).toBeNull();
      expect(caseEvents).toHaveLength(1);
      expect(caseEvents[0]).toMatchObject({
        caseId: supportCase?.id,
        userId: "user-1",
        eventType: "case_opened",
        message: "Support case opened.",
        visibleToCustomer: true,
        metadata: {
          category: "billing",
          priority: "urgent",
        },
      });
    } finally {
      sqlite.close();
    }
  });

  it("returns the existing case when a request-key insert is ignored", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("CREATE TABLE delivery_attempt (idempotency_key TEXT, payload_snapshot_json TEXT NOT NULL DEFAULT '{}');");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
      sqlite.sqlite.exec(`
        INSERT INTO user (id) VALUES ('user-1');
        INSERT INTO support_case (
          id,
          user_id,
          request_key,
          category,
          priority,
          status,
          subject,
          detail,
          context_json,
          created_at,
          updated_at
        )
        VALUES (
          'case-existing',
          'user-1',
          'support-request-race',
          'delivery',
          'normal',
          'open',
          'Digest missing',
          'The digest did not arrive.',
          '{}',
          '2026-06-20T00:00:00.000Z',
          '2026-06-20T00:00:00.000Z'
        );
      `);

      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The digest did not arrive.",
        requestKey: "support-request-race",
      });

      const rows = sqlite.sqlite.prepare("SELECT id FROM support_case WHERE user_id = ?").all("user-1");
      const events = await listSupportCaseEvents({ DB: sqlite.db } as never, "user-1", "case-existing");
      expect(rows).toHaveLength(1);
      expect(events).toHaveLength(0);
      expect(supportCase).toMatchObject({
        id: "case-existing",
        requestKey: "support-request-race",
        alreadyExists: true,
      });
    } finally {
      sqlite.close();
    }
  });

  it("reopens a closed request-key case when explicitly requested", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("CREATE TABLE delivery_attempt (idempotency_key TEXT, payload_snapshot_json TEXT NOT NULL DEFAULT '{}');");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
      sqlite.sqlite.exec(`
        INSERT INTO user (id) VALUES ('user-1');
        INSERT INTO support_case (
          id,
          user_id,
          request_key,
          category,
          priority,
          status,
          subject,
          detail,
          context_json,
          created_at,
          updated_at
        )
        VALUES (
          'case-existing',
          'user-1',
          'account-deletion:user-1',
          'security',
          'urgent',
          'closed',
          'Delete my account',
          'Old deletion request.',
          '{}',
          '2026-06-20T00:00:00.000Z',
          '2026-06-20T00:00:00.000Z'
        );
      `);

      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "security",
        priority: "urgent",
        subject: "Delete my Five to Nine account",
        detail: "Fresh deletion request.",
        context: {
          createdFrom: "signed_in_account_deletion_request",
          source: "app.account",
        },
        reopenClosed: true,
        requestKey: "account-deletion:user-1",
      });

      const rows = sqlite.sqlite.prepare("SELECT id, status, detail FROM support_case WHERE user_id = ?").all("user-1");
      const events = await listSupportCaseEvents({ DB: sqlite.db } as never, "user-1", "case-existing");
      expect(rows).toEqual([
        {
          detail: "Fresh deletion request.",
          id: "case-existing",
          status: "open",
        },
      ]);
      expect(supportCase).toMatchObject({
        alreadyExists: false,
        id: "case-existing",
        requestKey: "account-deletion:user-1",
        status: "open",
      });
      expect((supportCase as { reopened?: boolean } | null)?.reopened).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: "status_changed",
        message: "Support case reopened from a new signed-in request.",
        metadata: {
          createdFrom: "signed_in_account_deletion_request",
          fromStatus: "closed",
          toStatus: "open",
        },
      });
    } finally {
      sqlite.close();
    }
  });

  it("lists only customer-visible support case events for the owning user", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("CREATE TABLE delivery_attempt (idempotency_key TEXT, payload_snapshot_json TEXT NOT NULL DEFAULT '{}');");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1'), ('user-2');");

      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The digest did not arrive.",
      });
      await createSupportCaseEvent({ DB: sqlite.db } as never, {
        caseId: supportCase?.id ?? "",
        userId: "user-1",
        eventType: "support_note",
        message: "Support is checking the delivery provider trail.",
        visibleToCustomer: true,
      });
      await createSupportCaseEvent({ DB: sqlite.db } as never, {
        caseId: supportCase?.id ?? "",
        userId: "user-1",
        eventType: "support_note",
        message: "Internal operator-only note.",
        visibleToCustomer: false,
      });

      const ownerEvents = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-1",
        supportCase?.id ?? "",
      );
      const otherUserEvents = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-2",
        supportCase?.id ?? "",
      );

      expect(ownerEvents.map((event) => event.message)).toEqual([
        "Support case opened.",
        "Support is checking the delivery provider trail.",
      ]);
      expect(otherUserEvents).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  it("uses the support case source context for the opened event", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      sqlite.sqlite.exec("CREATE TABLE delivery_attempt (idempotency_key TEXT, payload_snapshot_json TEXT NOT NULL DEFAULT '{}');");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The digest did not arrive.",
        context: {
          createdFrom: "agent_action",
          source: "api_v1",
        },
      });

      const events = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-1",
        supportCase?.id ?? "",
      );

      expect(events[0]).toMatchObject({
        eventType: "case_opened",
        message: "Support case opened by an account agent action.",
        metadata: {
          category: "delivery",
          priority: "normal",
          createdFrom: "agent_action",
          source: "api_v1",
        },
      });
    } finally {
      sqlite.close();
    }
  });

  it("rolls back case creation when the support case event table is unavailable", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      await expect(createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The digest did not arrive.",
      })).rejects.toThrow();
      const cases = await listSupportCases({ DB: sqlite.db } as never, "user-1");

      expect(cases).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });
});

describe("client room persistence", () => {
  const row = {
    id: "room-1",
    user_id: "user-1",
    name: "Beauty client",
    client_label: "Nykaa",
    status: "active",
    notes_json: JSON.stringify({ goal: "Weekly proof review" }),
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:01:00.000Z",
  };
  const resourceRow = {
    id: "room-resource-1",
    room_id: "room-1",
    user_id: "user-1",
    resource_type: "watchlist",
    resource_id: "watchlist-1",
    label: "Nykaa competitor watch",
    created_at: "2026-06-19T00:00:00.000Z",
  };

  it("upserts an account-owned room with linked resource refs", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "AND id <> ?",
        results: [],
      },
      {
        sqlIncludes: "FROM client_room_resource",
        results: [resourceRow],
      },
      {
        sqlIncludes: "FROM client_room",
        results: [row],
      },
    ]);

    const room = await upsertClientRoom(
      { DB: mock.db } as never,
      "user-1",
      {
        name: "Beauty client",
        clientLabel: "Nykaa",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Nykaa competitor watch",
          },
        ],
        notes: { goal: "Weekly proof review" },
      },
    );

    const update = findStatement(mock.statements, "UPDATE client_room");
    expect(update?.bindings.slice(0, 5)).toEqual([
      "Beauty client",
      "Nykaa",
      "active",
      JSON.stringify({ goal: "Weekly proof review" }),
      expect.any(String),
    ]);
    expect(findStatement(mock.statements, "DELETE FROM client_room_resource")?.bindings).toEqual([
      "room-1",
      "user-1",
    ]);
    expect(findStatement(mock.statements, "INSERT INTO client_room_resource")?.bindings.slice(0, 6)).toEqual([
      expect.any(String),
      "room-1",
      "user-1",
      "watchlist",
      "watchlist-1",
      "Nykaa competitor watch",
    ]);
    expect(room).toMatchObject({
      id: "room-1",
      userId: "user-1",
      name: "Beauty client",
      clientLabel: "Nykaa",
      resourceRefs: [
        {
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          label: "Nykaa competitor watch",
        },
      ],
      notes: { goal: "Weekly proof review" },
    });
  });

  it("lists active rooms scoped to the account by default", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM client_room_resource",
        results: [resourceRow],
      },
      {
        sqlIncludes: "FROM client_room",
        results: [row],
      },
    ]);

    const rooms = await listClientRooms({ DB: mock.db } as never, "user-1", {
      limit: 5,
    });

    const select = findStatement(mock.statements, "FROM client_room", "status = ?");
    expect(select?.bindings).toEqual(["user-1", "active", 5]);
    expect(rooms[0]).toMatchObject({
      id: "room-1",
      status: "active",
      resourceRefs: [
        {
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          label: "Nykaa competitor watch",
        },
      ],
    });
  });

  it("round-trips client-room resources through the migration schema", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      const room = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        clientLabel: "Nykaa",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Nykaa competitor watch",
          },
        ],
        notes: { goal: "Weekly proof review" },
      });
      expect(room?.id).toBeTruthy();
      const roomId = room?.id as string;
      await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        roomId,
        name: "Beauty client",
        clientLabel: "Nykaa",
        resourceRefs: [],
        notes: { goal: "No linked resources" },
      });
      const rooms = await listClientRooms({ DB: sqlite.db } as never, "user-1", {
        status: "all",
        limit: 5,
      });
      const resources = sqlite.sqlite
        .prepare("SELECT * FROM client_room_resource WHERE room_id = ?")
        .all(roomId);

      expect(room).toMatchObject({
        name: "Beauty client",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            label: "Nykaa competitor watch",
          },
        ],
      });
      expect(resources).toEqual([]);
      expect(rooms[0]).toMatchObject({
        name: "Beauty client",
        resourceRefs: [],
        notes: { goal: "No linked resources" },
      });
    } finally {
      sqlite.close();
    }
  });

  it("does not replace resource refs when a roomId update matches no owned room", async () => {
    const mock = createMockDb();

    const room = await upsertClientRoom({ DB: mock.db } as never, "user-1", {
      roomId: "missing-room",
      name: "Beauty client",
      resourceRefs: [
        {
          resourceType: "watchlist",
          resourceId: "watchlist-1",
        },
      ],
    });

    expect(room).toBeNull();
    expect(findStatement(mock.statements, "DELETE FROM client_room_resource")).toBeUndefined();
    expect(findStatement(mock.statements, "INSERT INTO client_room_resource")).toBeUndefined();
  });

  it("preserves room notes when a name-conflict upsert omits notes", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        clientLabel: "Nykaa",
        notes: { goal: "Weekly proof review" },
      });
      await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        clientLabel: "Nykaa updated",
        status: "archived",
      });

      const rooms = await listClientRooms({ DB: sqlite.db } as never, "user-1", {
        status: "all",
        limit: 5,
      });

      expect(rooms[0]).toMatchObject({
        name: "Beauty client",
        clientLabel: "Nykaa updated",
        status: "archived",
        notes: { goal: "Weekly proof review" },
      });
    } finally {
      sqlite.close();
    }
  });

  it("returns the existing room identity and atomically replaces refs and approvals on repeated name upserts", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      const first = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-1" }],
        notes: { goal: "Initial", reportApprovals: { approved: true } },
      });
      const second = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        clientLabel: "Nykaa updated",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-2" }],
      });

      expect(first?.id).toBeTruthy();
      expect(second?.id).toBe(first?.id);
      expect(second).toMatchObject({
        clientLabel: "Nykaa updated",
        notes: { goal: "Initial" },
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-2" }],
      });
      expect(second?.notes).not.toHaveProperty("reportApprovals");

      const third = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-3" }],
        notes: { goal: "Updated", reportApprovals: { approved: true } },
      });
      expect(third?.id).toBe(first?.id);
      expect(third).toMatchObject({
        notes: { goal: "Updated" },
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-3" }],
      });
      expect(third?.notes).not.toHaveProperty("reportApprovals");
      expect(sqlite.sqlite.prepare("SELECT COUNT(*) AS count FROM client_room").get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it("does not rename a room over another room with the same account name", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");

      const first = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
      });
      const second = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Retail client",
      });

      const renamed = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        roomId: second?.id,
        name: "Beauty client",
      });
      const rooms = await listClientRooms({ DB: sqlite.db } as never, "user-1", {
        status: "all",
        limit: 5,
      });

      expect(first?.id).toBeTruthy();
      expect(second?.id).toBeTruthy();
      expect(renamed).toBeNull();
      expect(rooms.map((room) => room.name).sort()).toEqual(["Beauty client", "Retail client"]);
    } finally {
      sqlite.close();
    }
  });

  it("rejects stale room writes without changing newer notes or refs", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
      const created = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-1" }],
        notes: { goal: "Initial" },
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const first = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        roomId: created!.id,
        expectedUpdatedAt: created!.updatedAt,
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-2" }],
        notes: { goal: "Newer" },
      });
      await expect(upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        roomId: created!.id,
        expectedUpdatedAt: created!.updatedAt,
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-stale" }],
        notes: { goal: "Stale" },
      })).rejects.toMatchObject({ code: "stale_write", status: 409 });
      expect(first?.notes).toEqual({ goal: "Newer" });
      expect((await getClientRoom({ DB: sqlite.db } as never, "user-1", created!.id))?.resourceRefs)
        .toEqual([{ resourceType: "watchlist", resourceId: "watchlist-2" }]);
    } finally {
      sqlite.close();
    }
  });

  it("rolls back the parent when resource replacement fails inside the batch", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0037_client_rooms.sql");
      sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
      const created = await upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        name: "Beauty client",
        resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-1" }],
        notes: { goal: "Initial" },
      });
      await expect(upsertClientRoom({ DB: sqlite.db } as never, "user-1", {
        roomId: created!.id,
        expectedUpdatedAt: created!.updatedAt,
        name: "Beauty client",
        resourceRefs: [
          { resourceType: "watchlist", resourceId: "watchlist-2" },
          { resourceType: "watchlist", resourceId: "watchlist-2" },
        ],
        notes: { goal: "Should roll back" },
      })).rejects.toThrow();
      const room = await getClientRoom({ DB: sqlite.db } as never, "user-1", created!.id);
      expect(room?.notes).toEqual({ goal: "Initial" });
      expect(room?.resourceRefs).toEqual([{ resourceType: "watchlist", resourceId: "watchlist-1" }]);
    } finally {
      sqlite.close();
    }
  });
});

describe("Dodo billing persistence", () => {
  it("records Dodo paid plan access with the supplied webhook event timestamp", async () => {
    const mock = createMockDb();

    await grantDodoPlanAccess(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: "pay_123",
        providerProductId: "prod_starter_monthly",
        status: "succeeded",
        grantedAt: "2026-06-04T12:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "INSERT INTO user_plan", "dodo_payment_id");

    expect(statement?.sql).toContain("julianday(excluded.plan_updated_at)");
    expect(statement?.sql).not.toContain("user_plan.dodo_payment_id = excluded.dodo_payment_id");
    // Subscription events with no payment id must clear temporary checkout locks,
    // while preserving already-confirmed real payment ids.
      expect(statement?.sql).toContain("WHEN user_plan.dodo_status = 'checkout_pending' THEN NULL");
      expect(statement?.sql).toContain("WHEN excluded.dodo_payment_id IS NOT NULL THEN excluded.dodo_payment_id");
      expect(statement?.sql).toContain("COALESCE(excluded.dodo_subscription_id, user_plan.dodo_subscription_id)");
      expect(statement?.sql).toContain("COALESCE(excluded.dodo_next_billing_at, user_plan.dodo_next_billing_at)");
      expect(statement?.sql).toContain("dodo_plan_change_product_id = CASE");
      expect(statement?.sql).toContain("THEN user_plan.dodo_plan_change_product_id");
      expect(statement?.sql).toContain("ELSE NULL");
      expect(statement?.sql).toContain("'plan_change_pending'");
      expect(statement?.sql).toContain("'plan_change_scheduled'");
      expect(statement?.sql).toContain("'payment.failed'");
      expect(statement?.sql).toContain("'subscription.failed'");
      expect(statement?.sql).toContain("'subscription.on_hold'");
      expect(statement?.sql).toContain("'payment.succeeded'");
      expect(statement?.sql).toContain("user_plan.dodo_plan_change_product_id = excluded.dodo_product_id");
      expect(statement?.sql).toContain("user_plan.dodo_subscription_id = excluded.dodo_subscription_id");
      expect(statement?.sql).toContain("user_plan.dodo_customer_id = excluded.dodo_customer_id");
      expect(statement?.bindings).toEqual([
        "user-1",
        "starter",
        "pay_123",
        "prod_starter_monthly",
        null,
        null,
        null,
        null,
        "succeeded",
        "2026-06-04T12:00:00.000Z",
        0,
        0,
        0,
      ]);
    });

  it("clears a temporary checkout payment id on subscription grants with no payment id", async () => {
    const mock = createMockDb();

    await applyDodoPlanGrantWithWatchlistReconcile(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: null,
        providerProductId: "prod_starter_annual",
        providerSubscriptionId: "sub_123",
        providerCustomerId: "cus_123",
        nextBillingAt: "2027-06-04T12:00:00.000Z",
        status: "active",
        grantedAt: "2026-06-04T12:00:00.000Z",
      },
      10,
      {
        eventId: "evt_subscription_active",
        outcome: "processed",
        metadata: { action: "subscription_grant" },
      },
    );

      const statement = findStatement(mock.statements, "INSERT INTO user_plan", "dodo_payment_id");
      expect(statement?.sql).toContain("WHEN user_plan.dodo_status = 'checkout_pending' THEN NULL");
      expect(statement?.bindings).toEqual([
        "user-1",
        "starter",
        null,
        "prod_starter_annual",
        "sub_123",
        "cus_123",
        "2027-06-04T12:00:00.000Z",
        null,
        "active",
        "2026-06-04T12:00:00.000Z",
        null,
        0,
        "user-1",
        "prod_starter_annual",
        "sub_123",
        "cus_123",
        0,
        0,
        0,
        0,
      ]);
    });

  it("keeps the pending plan checkout lock for the full Dodo checkout window", async () => {
    const mock = createMockDb();

    await claimDodoPlanCheckout(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        checkoutId: "checkout_1",
        claimedAt: "2026-06-15T12:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "INSERT INTO user_plan", "checkout_pending");
    expect(DODO_PLAN_CHECKOUT_LOCK_MINUTES).toBe(24 * 60);
    expect(statement?.sql).toContain("dodo_payment_id");
    expect(statement?.bindings).toEqual([
      "user-1",
      "checkout_1",
      "2026-06-15T12:00:00.000Z",
      "2026-06-14T12:00:00.000Z",
    ]);
  });

  it("claims subscription plan changes with a local duplicate-submit guard", async () => {
    const mock = createMockDb();

        await claimDodoSubscriptionPlanChange(
          { DB: mock.db } as never,
          {
            userId: "user-1",
            status: DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
            providerProductId: "prod_starter_annual",
            currentSubscriptionId: "sub_123",
            currentProductId: "prod_scout_monthly",
            currentStatus: "subscription.active",
            currentPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
          },
        );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "dodo_subscription_id = ?");
        expect(statement?.sql).toContain("dodo_subscription_id = ?");
        expect(statement?.sql).toContain("dodo_product_id = ?");
        expect(statement?.sql).toContain("dodo_status = ?");
        expect(statement?.sql).toContain("plan_updated_at = ?");
        expect(statement?.sql).toContain("dodo_plan_change_product_id = ?");
      expect(statement?.sql).toContain("'plan_change_pending'");
      expect(statement?.sql).toContain("'plan_change_scheduled'");
      expect(statement?.sql).toContain("'payment.failed'");
      expect(statement?.sql).toContain("'subscription.failed'");
      expect(statement?.sql).not.toContain("julianday(plan_updated_at) <= julianday(?)");
        expect(statement?.bindings[0]).toBe(DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS);
        expect(Number.isFinite(Date.parse(String(statement?.bindings[1])))).toBe(true);
        expect(statement?.bindings[2]).toBe("prod_starter_annual");
        expect(statement?.bindings[3]).toBe("user-1");
        expect(statement?.bindings.slice(4)).toEqual([
          "sub_123",
          "prod_scout_monthly",
          "prod_scout_monthly",
          "subscription.active",
          "subscription.active",
          "2026-06-04T12:00:00.000Z",
          "2026-06-04T12:00:00.000Z",
        ]);
      });

    it("blocks immediate subscription plan-change locks until webhook or support resolution", () => {
      expect(
        isBlockingDodoSubscriptionPlanChangeStatus(
          DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
          new Date().toISOString(),
        ),
      ).toBe(true);
      expect(
        isBlockingDodoSubscriptionPlanChangeStatus(
          DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
          new Date(Date.now() - (DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES + 1) * 60 * 1000)
            .toISOString(),
        ),
      ).toBe(true);
      expect(isBlockingDodoSubscriptionPlanChangeStatus(DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS, null)).toBe(true);
      expect(isBlockingDodoSubscriptionPlanChangeStatus("plan_change_scheduled", null)).toBe(true);
      expect(isBlockingDodoSubscriptionPlanChangeStatus("succeeded", null, "prod_starter_monthly")).toBe(true);
    });

  it("clears a claimed subscription plan change after a definite provider rejection", async () => {
    const mock = createMockDb();

    await clearDodoSubscriptionPlanChangeClaim(
      { DB: mock.db } as never,
      {
        userId: "user-1",
          claimedStatus: DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
          previousStatus: "subscription.active",
          previousPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
          providerProductId: "prod_starter_annual",
          subscriptionId: "sub_123",
          claimedAt: "2026-06-04T12:01:00.000Z",
        },
      );

      const statement = findStatement(mock.statements, "UPDATE user_plan", "AND dodo_status = ?");
      expect(statement?.sql).toContain("SET dodo_status = ?");
        expect(statement?.sql).toContain("plan_updated_at = COALESCE(?, plan_updated_at)");
        expect(statement?.sql).toContain("dodo_plan_change_product_id = NULL");
        expect(statement?.sql).toContain("AND dodo_status = ?");
        expect(statement?.sql).toContain("AND dodo_plan_change_product_id = ?");
        expect(statement?.sql).toContain("AND dodo_subscription_id = ?");
        expect(statement?.sql).toContain("AND plan_updated_at = ?");
      expect(statement?.bindings).toEqual([
        "subscription.active",
        "2026-06-04T12:00:00.000Z",
        "user-1",
        DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
        "prod_starter_annual",
        "sub_123",
        "2026-06-04T12:01:00.000Z",
      ]);
  });

  it("marks an accepted scheduled subscription plan change after provider success", async () => {
    const mock = createMockDb();

    await markDodoSubscriptionPlanChangeScheduled({ DB: mock.db } as never, {
      userId: "user-1",
    });

    const statement = findStatement(mock.statements, "UPDATE user_plan", "plan_updated_at = ?");
    expect(statement?.sql).toContain("SET dodo_status = ?");
    expect(statement?.sql).toContain("AND dodo_status = ?");
    expect(statement?.bindings[0]).toBe("plan_change_scheduled");
    expect(Number.isFinite(Date.parse(String(statement?.bindings[1])))).toBe(true);
    expect(statement?.bindings[2]).toBe("user-1");
    expect(statement?.bindings[3]).toBe(DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS);
  });

  it("guards webhook checkout cleanup against newer pending checkout locks", async () => {
    const mock = createMockDb();

    await clearDodoPlanCheckout(
      { DB: mock.db } as never,
      "user-1",
      { checkoutId: "checkout_1", occurredAt: "2026-07-01T08:00:00.000Z" },
    );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "checkout_pending");
    expect(statement?.sql).toContain("dodo_payment_id = NULL");
    expect(statement?.sql).toContain("AND dodo_payment_id = ?");
    expect(statement?.sql).toContain("julianday(plan_updated_at) <= julianday(?)");
    expect(statement?.bindings).toEqual([
      "user-1",
      "checkout_1",
      "2026-07-01T08:00:00.000Z",
    ]);
  });

  it("can clear checkout locks with a matching id or missing stored id", async () => {
    const mock = createMockDb();

    await clearDodoPlanCheckout(
      { DB: mock.db } as never,
      "user-1",
      {
        allowMissingStoredCheckoutId: true,
        checkoutId: "checkout_1",
        occurredAt: "2026-07-01T08:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "checkout_pending");
    expect(statement?.sql).toContain("(dodo_payment_id = ? OR dodo_payment_id IS NULL)");
    expect(statement?.sql).toContain("julianday(plan_updated_at) <= julianday(?)");
    expect(statement?.bindings).toEqual([
      "user-1",
      "checkout_1",
      "2026-07-01T08:00:00.000Z",
    ]);
  });

  it("can require a missing stored checkout id for no-id terminal failures", async () => {
    const mock = createMockDb();

    await clearDodoPlanCheckout(
      { DB: mock.db } as never,
      "user-1",
      {
        occurredAt: "2026-07-01T08:00:00.000Z",
        requireMissingStoredCheckoutId: true,
      },
    );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "checkout_pending");
    expect(statement?.sql).toContain("dodo_payment_id IS NULL");
    expect(statement?.sql).toContain("julianday(plan_updated_at) <= julianday(?)");
    expect(statement?.bindings).toEqual([
      "user-1",
      "2026-07-01T08:00:00.000Z",
    ]);
  });

  it("can clear timestamp-matched stored checkout ids for no-id terminal failures", async () => {
    const mock = createMockDb();

    await clearDodoPlanCheckout(
      { DB: mock.db } as never,
      "user-1",
      {
        allowTimestampMatchedStoredCheckoutId: true,
        occurredAt: "2026-07-01T08:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "checkout_pending");
    expect(statement?.sql).not.toContain("dodo_payment_id IS NULL");
    expect(statement?.sql).not.toContain("dodo_payment_id = ?");
    expect(statement?.sql).toContain("julianday(plan_updated_at) <= julianday(?)");
    expect(statement?.bindings).toEqual([
      "user-1",
      "2026-07-01T08:00:00.000Z",
    ]);
  });

  it("clears a UUID-backed pending checkout when a no-id failure timestamp matches it", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user_plan (
          user_id TEXT PRIMARY KEY NOT NULL,
          plan TEXT NOT NULL DEFAULT 'free',
          dodo_payment_id TEXT,
          dodo_status TEXT,
          plan_updated_at TEXT
        );
        INSERT INTO user_plan (
          user_id,
          plan,
          dodo_payment_id,
          dodo_status,
          plan_updated_at
        ) VALUES (
          'user-1',
          'free',
          'local-checkout-uuid',
          'checkout_pending',
          '2026-07-01T07:58:00.000Z'
        );
      `);

      await clearDodoPlanCheckout(
        { DB: sqlite.db } as never,
        "user-1",
        {
          allowTimestampMatchedStoredCheckoutId: true,
          occurredAt: "2026-07-01T08:00:00.000Z",
        },
      );

      const row = sqlite.sqlite
        .prepare("SELECT dodo_payment_id, dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1") as { dodo_payment_id: string | null; dodo_status: string | null };
      expect(row).toEqual({ dodo_payment_id: null, dodo_status: null });
    } finally {
      sqlite.close();
    }
  });

  it("does not clear a newer UUID-backed pending checkout from an older no-id failure", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user_plan (
          user_id TEXT PRIMARY KEY NOT NULL,
          plan TEXT NOT NULL DEFAULT 'free',
          dodo_payment_id TEXT,
          dodo_status TEXT,
          plan_updated_at TEXT
        );
        INSERT INTO user_plan (
          user_id,
          plan,
          dodo_payment_id,
          dodo_status,
          plan_updated_at
        ) VALUES (
          'user-1',
          'free',
          'newer-local-checkout-uuid',
          'checkout_pending',
          '2026-07-01T08:02:00.000Z'
        );
      `);

      await clearDodoPlanCheckout(
        { DB: sqlite.db } as never,
        "user-1",
        {
          allowTimestampMatchedStoredCheckoutId: true,
          occurredAt: "2026-07-01T08:00:00.000Z",
        },
      );

      const row = sqlite.sqlite
        .prepare("SELECT dodo_payment_id, dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1") as { dodo_payment_id: string | null; dodo_status: string | null };
      expect(row).toEqual({
        dodo_payment_id: "newer-local-checkout-uuid",
        dodo_status: "checkout_pending",
      });
    } finally {
      sqlite.close();
    }
  });

  it("derives the billing interval from the Dodo product id", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM user_plan",
        results: [
          {
            plan: "starter",
            dodo_status: "subscription.active",
            dodo_payment_id: "payment-current",
            dodo_product_id: "prod_starter_annual",
            dodo_subscription_id: "sub_123",
            dodo_customer_id: "cus_123",
            dodo_next_billing_at: "2027-06-04T12:00:00.000Z",
            plan_updated_at: "2026-06-04T12:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(
      getUserPlanBillingInfo(
        {
          DB: mock.db,
          DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
        } as never,
        "user-1",
      ),
    ).resolves.toMatchObject({
      plan: "starter",
      dodoPaymentId: "payment-current",
      dodoProductId: "prod_starter_annual",
      billingInterval: "annual",
    });
  });

  it("does not derive a billing interval from stale Dodo product ids on free plans", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM user_plan",
        results: [
          {
            plan: "free",
            dodo_status: "refunded",
            dodo_product_id: "prod_starter_annual",
            dodo_subscription_id: "sub_123",
            dodo_customer_id: "cus_123",
            dodo_next_billing_at: "2027-06-04T12:00:00.000Z",
            plan_updated_at: "2026-06-04T12:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(
      getUserPlanBillingInfo(
        {
          DB: mock.db,
          DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
        } as never,
        "user-1",
      ),
    ).resolves.toMatchObject({
      plan: "free",
      dodoProductId: "prod_starter_annual",
      billingInterval: null,
    });
  });

  it("does not derive a billing interval from product ids for another paid plan", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM user_plan",
        results: [
          {
            plan: "scout",
            dodo_status: "subscription.active",
            dodo_product_id: "prod_starter_annual",
            dodo_subscription_id: "sub_123",
            dodo_customer_id: "cus_123",
            dodo_next_billing_at: "2027-06-04T12:00:00.000Z",
            plan_updated_at: "2026-06-04T12:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(
      getUserPlanBillingInfo(
        {
          DB: mock.db,
          DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
        } as never,
        "user-1",
      ),
    ).resolves.toMatchObject({
      plan: "scout",
      dodoProductId: "prod_starter_annual",
      billingInterval: null,
    });
  });

  it("reports a lapsed scheduled cancellation as the free plan", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM user_plan",
        results: [
          {
            plan: "starter",
            dodo_status: "cancellation_scheduled",
            dodo_product_id: "prod_starter_annual",
            dodo_subscription_id: "sub_123",
            dodo_customer_id: "cus_123",
            dodo_next_billing_at: "2026-01-01T00:00:00.000Z",
            plan_updated_at: "2025-12-01T12:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(
      getUserPlanBillingInfo(
        {
          DB: mock.db,
          DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
        } as never,
        "user-1",
      ),
    ).resolves.toMatchObject({
      plan: "free",
      dodoStatus: "cancellation_scheduled",
      billingInterval: null,
    });
  });

  it("keeps the paid plan visible while a scheduled cancellation is still in the future", async () => {
    const futureBillingAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const mock = createMockDb([
      {
        sqlIncludes: "FROM user_plan",
        results: [
          {
            plan: "starter",
            dodo_status: "cancellation_scheduled",
            dodo_product_id: "prod_starter_annual",
            dodo_subscription_id: "sub_123",
            dodo_customer_id: "cus_123",
            dodo_next_billing_at: futureBillingAt,
            plan_updated_at: "2026-06-04T12:00:00.000Z",
          },
        ],
      },
    ]);

    await expect(
      getUserPlanBillingInfo(
        {
          DB: mock.db,
          DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
        } as never,
        "user-1",
      ),
    ).resolves.toMatchObject({
      plan: "starter",
      dodoStatus: "cancellation_scheduled",
      billingInterval: "annual",
    });
  });

  it("revokes Dodo plan access to free with monotonic timestamp ordering", async () => {
    const mock = createMockDb();

    await revokeDodoPlanAccess(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        providerSubscriptionId: "sub_123",
        status: "subscription.cancelled",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "INSERT INTO user_plan", "'free'");

    expect(statement?.sql).toContain("julianday(excluded.plan_updated_at) >= julianday(user_plan.plan_updated_at)");
    expect(statement?.sql).not.toContain("dodo_payment_id = excluded.dodo_payment_id");
    expect(statement?.bindings).toEqual([
      "user-1",
      "subscription.cancelled",
      "2026-07-01T00:00:00.000Z",
    ]);
  });

  it("records a payment issue without touching the plan column", async () => {
    const mock = createMockDb();

    await markDodoPlanPaymentIssue(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        status: "subscription.on_hold",
        occurredAt: "2026-07-01T00:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "UPDATE user_plan", "dodo_status");

    expect(statement?.sql).not.toContain("plan = ");
    expect(statement?.sql).toContain("plan != 'free'");
    expect(statement?.sql).toContain("julianday(?) >= julianday(plan_updated_at)");
    expect(statement?.bindings).toEqual([
      "subscription.on_hold",
      null,
      null,
      "2026-07-01T00:00:00.000Z",
      "user-1",
      null,
      null,
      null,
      null,
      "2026-07-01T00:00:00.000Z",
    ]);
  });

  it("resolves Dodo lifecycle events by stored subscription before customer id", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  return { results: [{ user_id: "user-subscription" }] as T[] };
                },
              };
            },
          };
        },
      },
    };

    await expect(
      getUserIdForDodoLifecycle(
        { DB: mock.db } as never,
        {
          subscriptionId: "sub_123",
          customerId: "cus_123",
        },
      ),
    ).resolves.toBe("user-subscription");

    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain("dodo_subscription_id = ?");
    expect(statements[0]?.bindings).toEqual(["sub_123"]);
  });

  it("falls back to stored Dodo customer id for lifecycle events", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const results = [[], [{ user_id: "user-customer" }]];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  return { results: (results.shift() ?? []) as T[] };
                },
              };
            },
          };
        },
      },
    };

    await expect(
      getUserIdForDodoLifecycle(
        { DB: mock.db } as never,
        {
          subscriptionId: "sub_missing",
          customerId: "cus_123",
        },
      ),
    ).resolves.toBe("user-customer");

    expect(statements[0]?.sql).toContain("dodo_subscription_id = ?");
    expect(statements[1]?.sql).toContain("dodo_customer_id = ?");
    expect(statements[1]?.bindings).toEqual(["cus_123"]);
  });

  it("falls back to email only for existing paid Dodo-linked lifecycle rows", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const results = [[], [], [{ user_id: "user-paid-dodo" }]];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  return { results: (results.shift() ?? []) as T[] };
                },
              };
            },
          };
        },
      },
    };

    await expect(
      getUserIdForDodoLifecycle(
        { DB: mock.db } as never,
        {
          subscriptionId: "sub_missing",
          customerId: "cus_missing",
          customerEmail: "Owner@Example.com",
        },
      ),
    ).resolves.toBe("user-paid-dodo");

    expect(statements[2]?.sql).toContain("user.email = ? COLLATE NOCASE");
    expect(statements[2]?.sql).toContain("user_plan.plan != 'free'");
    expect(statements[2]?.sql).toContain("user_plan.dodo_payment_id IS NOT NULL");
    expect(statements[2]?.bindings).toEqual(["Owner@Example.com"]);
  });

  it("revokes plan access and expires usage credits for a refunded payment", async () => {
    const mock = createMockDb();

    await revokeDodoAccessForRefundedPayment(
      { DB: mock.db } as never,
      {
        paymentId: "pay_123",
        refundedAt: "2026-07-05T00:00:00.000Z",
      },
    );

    const planStatement = findStatement(mock.statements, "UPDATE user_plan", "'refunded'");
    expect(planStatement?.sql).toContain("plan = 'free'");
    expect(planStatement?.sql).toContain("WHERE dodo_payment_id = ?");
    expect(planStatement?.sql).toContain("julianday(?) >= julianday(plan_updated_at)");
    expect(planStatement?.bindings).toEqual([
      "2026-07-05T00:00:00.000Z",
      "pay_123",
      "2026-07-05T00:00:00.000Z",
    ]);

    const creditStatement = findStatement(mock.statements, "UPDATE proof_usage_credit", "expires_at");
    expect(creditStatement?.sql).toContain("WHERE provider_payment_id = ?");
    expect(creditStatement?.bindings).toEqual([
      "2026-07-05T00:00:00.000Z",
      "pay_123",
      "2026-07-05T00:00:00.000Z",
    ]);
  });

  it("dedupes Dodo webhook events and allows failed events to be reclaimed", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    let insertAttempts = 0;
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async run() {
                  if (sql.includes("INSERT INTO dodo_webhook_event")) {
                    insertAttempts += 1;
                    return {
                      success: true,
                      meta: { changes: insertAttempts === 1 || insertAttempts === 3 ? 1 : 0 },
                    };
                  }
                  return { success: true, meta: { changes: 0 } };
                },
                async all<T>() {
                  if (sql.includes("SELECT outcome FROM dodo_webhook_event")) {
                    return { results: [{ outcome: "processing" }] as T[] };
                  }
                  return { results: [] as T[] };
                },
              };
            },
          };
        },
      },
    };

    const input = {
      eventId: "evt-1",
      eventType: "payment.succeeded",
      userId: null,
      payloadTimestamp: "1765459200",
    };

    expect(await beginDodoWebhookEventProcessing({ DB: mock.db } as never, input)).toEqual({
      status: "claimed",
    });
    expect(await beginDodoWebhookEventProcessing({ DB: mock.db } as never, input)).toEqual({
      status: "in_progress",
    });
    expect(await beginDodoWebhookEventProcessing({ DB: mock.db } as never, input)).toEqual({
      status: "claimed",
    });

    const claim = statements.find((statement) => statement.sql.includes("INSERT INTO dodo_webhook_event"));
    expect(claim?.sql).toContain("outcome = 'failed'");
  });

  it("falls back when an existing Dodo webhook ledger lacks payload timestamps", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async run() {
                  if (sql.includes("payload_timestamp")) {
                    throw new Error(
                      "D1_ERROR: table dodo_webhook_event has no column named payload_timestamp: SQLITE_ERROR",
                    );
                  }
                  return { success: true, meta: { changes: 1 } };
                },
                async all<T>() {
                  return { results: [] as T[] };
                },
              };
            },
          };
        },
      },
    };

    const claimed = await claimDodoWebhookEvent(
      { DB: mock.db } as never,
      {
        eventId: "evt-1",
        eventType: "payment.succeeded",
        userId: null,
        payloadTimestamp: "1765459200",
      },
    );

    expect(claimed).toBe(true);
    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("payload_timestamp");
    expect(statements[1]?.sql).not.toContain("payload_timestamp");
    expect(statements[1]?.sql).toContain("processing_started_at");
    expect(statements[1]?.sql).toContain("SELECT ?, ?, ?, ?, 'processing', ?, '{}'");
    expect(statements[1]?.sql).toContain("WHERE 1 = 1");
    expect(statements[1]?.sql).toContain("outcome = 'processing'");
    expect(statements[1]?.sql).not.toContain("outcome = 'received'");
    expect(statements[1]?.sql).toContain("dodo_webhook_event.outcome = 'failed'");
    expect(statements[2]?.sql).toContain("SELECT metadata_json");
  });

  it("fails closed when the Dodo webhook ledger lacks processing leases", async () => {
    const statements: string[] = [];
    const mock = {
      db: {
        prepare(sql: string) {
          statements.push(sql);
          return {
            bind() {
              return {
                async run() {
                  throw new Error(
                    "D1_ERROR: table dodo_webhook_event has no column named processing_started_at: SQLITE_ERROR",
                  );
                },
                async all<T>() {
                  return { results: [] as T[] };
                },
              };
            },
          };
        },
      },
    };

    await expect(
      beginDodoWebhookEventProcessing(
        { DB: mock.db } as never,
        {
          eventId: "evt-missing-lease",
          eventType: "payment.succeeded",
          userId: null,
          payloadTimestamp: "1765459200",
        },
      ),
    ).rejects.toThrow("processing_started_at");
    expect(statements).toHaveLength(1);
  });

  it("rejects blank Dodo webhook event ids", async () => {
    await expect(
      claimDodoWebhookEvent(
        { DB: { prepare: vi.fn() } } as never,
        {
          eventId: "   ",
          eventType: "payment.succeeded",
          userId: null,
          payloadTimestamp: null,
        },
      ),
    ).rejects.toThrow("Dodo webhook event id is required.");
  });

  it("records a capacity-budget skip on watchlist runs", async () => {
    const mock = createMockDb();

    await recordWatchlistCapacitySkip(
      { DB: mock.db } as never,
      "watchlist-1",
    );

    const statement = findStatement(mock.statements, "INSERT OR IGNORE INTO watchlist_run", "capacity_budget");
    expect(statement?.sql).toContain("'skipped'");
    expect(statement?.sql).toContain("idempotency_key");
  });

  it("closes a counter-move follow-up inside the stored audit result", async () => {
    const auditId = "audit-1";
    const auditRow = {
      id: auditId,
      user_id: "user-1",
      api_key_id: null,
      action_name: "counter_move_brief.create",
      resource_type: "watchlist",
      resource_id: "watchlist-1",
      idempotency_key: "idem-1",
      status: "succeeded",
      result_json: JSON.stringify({
        brief: {
          watchlistId: "watchlist-1",
          workflow: {
            status: "needs_review",
            openCount: 1,
            followUps: [
              {
                eventId: "event-1",
                status: "open",
                title: "Landing page changed",
              },
            ],
          },
        },
      }),
      error_code: null,
      error_message: null,
      metadata_json: "{}",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const mock = createMockDb([
      {
        sqlIncludes: "FROM agent_action_audit",
        results: [auditRow],
      },
      {
        sqlIncludes: "SELECT * FROM agent_action_audit WHERE id = ?",
        results: [auditRow],
      },
    ]);

    const result = await closeCounterMoveFollowUp(
      { DB: mock.db } as never,
      {
        auditId,
        userId: "user-1",
        eventId: "event-1",
      },
    );

    expect(result.ok).toBe(true);
    const update = findStatement(mock.statements, "UPDATE agent_action_audit", "result_json");
    expect(update?.bindings?.[0]).toBe("succeeded");
    expect(String(update?.bindings?.[3])).toContain('"status":"closed"');
  });
});

describe("scheduled watchlist selection", () => {
  it("excludes Scout watchlists from default scheduled monitoring selection", async () => {
    const mock = createMockDb();

    await listActiveWatchlists({ DB: mock.db } as never);

    // LEFT JOIN + the plan filter behaves like the previous INNER JOIN when
    // both flags are off: null-plan rows fail the IN () branch.
    expect(mock.statements[0]?.sql).toContain("LEFT JOIN user_plan");
    expect(mock.statements[0]?.sql).toContain("watchlist.is_active = 1");
    expect(mock.statements[0]?.sql).toContain("user_plan.plan IN ('starter', 'agency')");
    expect(mock.statements[0]?.sql).toContain("user_plan.plan = 'scout'");
    expect(mock.statements[0]?.sql).toContain("user_plan.plan = 'free' OR user_plan.plan IS NULL");
    expect(mock.statements[0]?.sql).toContain("LIMIT ?");
    expect(mock.statements[0]?.sql).toContain("OFFSET ?");
    expect(mock.statements[0]?.bindings).toEqual([0, 0, 100, 0]);
  });

  it("can include Scout watchlists for the weekly digest path", async () => {
    const mock = createMockDb();

    await listActiveWatchlists({ DB: mock.db } as never, { includeScout: true });

    expect(mock.statements[0]?.bindings).toEqual([1, 0, 100, 0]);
  });

  it("includes free (and row-less) watchlists only when the weekly flag is set", async () => {
    const mock = createMockDb();

    await listActiveWatchlists({ DB: mock.db } as never, { includeFree: true });

    expect(mock.statements[0]?.bindings).toEqual([0, 1, 100, 0]);
  });
});

describe("workspace recent watch events", () => {
  it("loads one globally ordered bounded result across all active owned watchlists", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      id: `event-${index}`,
      watchlist_id: `watch-${index}`,
      run_id: `run-${index}`,
      event_type: "ad_new",
      status: "confirmed",
      importance_score: 70,
      ad_id: null,
      baseline_from_run_id: null,
      candidate_id: null,
      proof_capture_id: null,
      title: `Move ${index}`,
      summary: "A new ad appeared.",
      metadata_json: "{}",
      confirmed_at: `2026-06-20T00:0${index}:00.000Z`,
      suppressed_at: null,
      invalidated_at: null,
      last_evaluated_at: `2026-06-20T00:0${index}:00.000Z`,
      created_at: `2026-06-20T00:0${index}:00.000Z`,
    }));
    const mock = createMockDb([{ sqlIncludes: "FROM watch_event", results: rows }]);

    const events = await listRecentWorkspaceWatchEvents({ DB: mock.db } as never, "workspace-1", 8);

    expect(events).toHaveLength(8);
    expect(events.map((event) => event.watchlistId)).toEqual(
      rows.map((row) => row.watchlist_id),
    );
    expect(mock.statements).toHaveLength(1);
    expect(mock.statements[0]?.sql).toContain("JOIN watchlist");
    expect(mock.statements[0]?.sql).toContain("watchlist.user_id = ?");
    expect(mock.statements[0]?.sql).toContain("watchlist.is_active = 1");
    // The Overview decision feed must never surface suppressed or
    // invalidated events — they belong in the per-competitor audit trail.
    expect(mock.statements[0]?.sql).toContain(
      "watch_event.status NOT IN ('suppressed', 'invalidated')",
    );
    expect(mock.statements[0]?.sql).toContain("ORDER BY watch_event.created_at DESC");
    expect(mock.statements[0]?.sql).toContain("LIMIT ?");
    expect(mock.statements[0]?.bindings).toEqual(["workspace-1", 8]);
  });
});

describe("weekly business summary", () => {
  it("uses Better Auth user.createdAt for signup counts", async () => {
    const mock = createMockDb();

    await getWeeklyBusinessSummary({ DB: mock.db } as never);

    const statement = findStatement(mock.statements, "FROM user", "createdAt >= ?");
    expect(statement?.sql).toContain("createdAt >= ?");
    expect(statement?.sql).not.toContain("created_at >= ?");
  });

  it("does not count pending Dodo checkouts as dropped-to-free customers", async () => {
    const mock = createMockDb();

    await getWeeklyBusinessSummary({ DB: mock.db } as never);

    const statement = findStatement(
      mock.statements,
      "FROM user_plan",
      "plan = 'free'",
      "plan_updated_at >= ?",
    );
    expect(statement?.sql).toContain("dodo_status != 'checkout_pending'");
  });
});

describe("user lookup helpers", () => {
  it("uses Better Auth user.createdAt when finding the oldest user", async () => {
    const mock = createMockDb();

    await getOldestUserId({ DB: mock.db } as never);

    expect(mock.statements[0]?.sql).toContain("ORDER BY createdAt ASC");
    expect(mock.statements[0]?.sql).not.toContain("created_at");
  });
});

describe("customer Meta connection persistence", () => {
  it("stores encrypted customer Meta tokens without binding the raw token", async () => {
    const mock = createMockDb();

    await upsertCustomerMetaConnection(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        encryptedAccessToken: "v1:iv:ciphertext",
        tokenLastFour: "1234",
        tokenFingerprint: "fingerprint",
        status: "healthy",
        summary: "Connected.",
        lastCheckedAt: "2026-05-15T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    );

    const statement = findStatement(
      mock.statements,
      "INSERT INTO customer_meta_connection",
      "encrypted_access_token",
    );

    expect(statement?.bindings).toContain("v1:iv:ciphertext");
    expect(statement?.bindings).toContain("1234");
    expect(statement?.bindings).not.toContain("raw-meta-token");
    expect(statement?.sql).toContain("ON CONFLICT(user_id)");
  });
});

describe("upsertAd", () => {
  it("persists creative OCR analysis fields when present on the ad", async () => {
    const mock = createMockDb();

    await upsertAd(
      { DB: mock.db } as never,
      {
        metaAdId: "meta-boat-1",
        advertiser: "boAt",
        body: "Bass bhi, battery bhi.",
        previewHeadline: "Bass bhi. Battery bhi.",
        previewSubhead: "Launch pricing",
        hook: "Bass bhi. Battery bhi.",
        offer: "Launch pricing",
        cta: "Buy now",
        format: "video",
        languageLabel: "Hinglish",
        destinationType: "website",
        landingPageUrl: "https://boat.example.com/rockerz-neckband",
        adSnapshotUrl: "https://facebook.example.com/ad-snapshot",
        countries: ["India"],
        platforms: ["Instagram"],
        firstSeenAt: null,
        lastSeenAt: null,
        active: true,
        researchSummary: "Summary",
        source: "demo",
        analysisFields: [],
        creativeText: "60 Hours Playback\nOnly ₹999",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: {
          fetchStatus: 200,
        },
      },
    );

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    const adInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO ad"),
    );

    expect(adInsert?.sql).toContain("creative_text");
    expect(adInsert?.sql).toContain("creative_text_capture_method");
    expect(adInsert?.sql).toContain("creative_text_metadata_json");
    expect(adInsert?.bindings).toContain("60 Hours Playback\nOnly ₹999");
    expect(adInsert?.bindings).toContain("ad_snapshot_fetch");
    expect(
      adInsert?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"fetchStatus\":200"),
      ),
    ).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ocr_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ad_snapshot_fetch"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes(CREATIVE_TEXT_EXTRACTOR_VERSION))).toBe(true);
  });
});

describe("listAdsByIds", () => {
  it("returns parsed ad records for the requested ids", async () => {
    const ad = {
      metaAdId: "meta-boat-1",
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      hook: "Bass bhi. Battery bhi.",
      offer: "Launch pricing",
      cta: "Buy now",
      format: "video",
      languageLabel: "Hinglish",
      destinationType: "website",
      landingPageUrl: "https://boat.example.com/rockerz-neckband",
      adSnapshotUrl: "https://cdn.example.com/boat.png",
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Summary",
      source: "demo",
      analysisFields: [],
    };

    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              return {
                async all<T>() {
                  if (sql.includes("FROM ad")) {
                    expect(bindings).toEqual(["meta-boat-1"]);
                    return {
                      results: [{
                        id: "meta-boat-1",
                        raw_json: JSON.stringify(ad),
                      }] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const result = await listAdsByIds({ DB: mock.db } as never, ["meta-boat-1"]);

    expect(result).toEqual([ad]);
  });

  it("hydrates canonical SQL columns when raw_json is sparse", async () => {
    const row = {
      id: "e2e-ad-1",
      advertiser: "Okara",
      body: "Fixture creative text",
      body_secondary: null,
      preview_headline: "Free trial",
      preview_subhead: "",
      hook: "Free trial",
      offer_text: "Starting at ₹499",
      cta: "Learn more",
      creative_format: "image",
      language_label: "English",
      destination_type: "website",
      landing_page_url: "https://okara.example.invalid/launch",
      ad_snapshot_url: "https://facebook.example.invalid/ad/1",
      countries_json: '["India"]',
      platforms_json: '["Facebook"]',
      first_seen_at: null,
      last_seen_at: null,
      is_active: 1,
      source: "meta_api",
      research_summary: "Stored fixture evidence",
      creative_text: "Fixture creative text",
      creative_text_capture_method: "ad_snapshot_fetch",
      creative_text_metadata_json: '{"captured":true}',
      raw_json: JSON.stringify({
        metaAdId: "stale-raw-id",
        advertiser: "Stale raw advertiser",
        languageLabel: "Stale raw language",
        landingPageUrl: "https://stale.example.invalid",
        creativeText: "Stale raw creative",
      }),
    };
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [row] }),
        })),
      })),
    };

    const [ad] = await listAdsByIds({ DB: db } as never, ["e2e-ad-1"]);

    expect(ad).toMatchObject({
      metaAdId: "e2e-ad-1",
      advertiser: "Okara",
      languageLabel: "English",
      landingPageUrl: "https://okara.example.invalid/launch",
      creativeText: "Fixture creative text",
      analysisFields: [],
    });
  });

  it("falls back to raw JSON when nullable canonical columns are NULL", async () => {
    const row = {
      id: "legacy-ad-1",
      advertiser: "Legacy brand",
      body: "Legacy body",
      body_secondary: null,
      preview_headline: "",
      preview_subhead: "",
      hook: "",
      offer_text: "",
      cta: "",
      creative_format: "image",
      language_label: "",
      destination_type: "unknown",
      landing_page_url: null,
      ad_snapshot_url: null,
      countries_json: "[]",
      platforms_json: "[]",
      first_seen_at: null,
      last_seen_at: null,
      is_active: 1,
      source: "meta_api",
      research_summary: "",
      creative_text: null,
      creative_text_capture_method: null,
      creative_text_metadata_json: null,
      raw_json: JSON.stringify({
        metaAdId: "legacy-ad-1",
        bodySecondary: "Secondary text retained in the legacy payload",
        landingPageUrl: "https://legacy.example.invalid/launch",
        adSnapshotUrl: "https://legacy.example.invalid/ad.png",
        firstSeenAt: "2026-01-02T03:04:05.000Z",
        lastSeenAt: "2026-02-03T04:05:06.000Z",
        creativeText: "Text retained in the legacy payload",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: { extractor: "legacy" },
        analysisFields: [
          {
            scopeType: "ad",
            fieldKey: "hook",
            fieldValue: "Legacy hook",
            provenanceSource: "meta_api",
          },
        ],
      }),
    };
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [row] }),
        })),
      })),
    };

    const [ad] = await listAdsByIds({ DB: db } as never, ["legacy-ad-1"]);

    expect(ad).toMatchObject({
      bodySecondary: "Secondary text retained in the legacy payload",
      landingPageUrl: "https://legacy.example.invalid/launch",
      adSnapshotUrl: "https://legacy.example.invalid/ad.png",
      firstSeenAt: "2026-01-02T03:04:05.000Z",
      lastSeenAt: "2026-02-03T04:05:06.000Z",
      creativeText: "Text retained in the legacy payload",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: { extractor: "legacy" },
      analysisFields: [
        expect.objectContaining({
          fieldKey: "hook",
          fieldValue: "Legacy hook",
        }),
      ],
    });
  });

  it("chunks lookups so 150 ad ids never exceed D1's bound-parameter cap", async () => {
    const adIds = Array.from({ length: 150 }, (_, index) => `ad-${index}`);
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM ad")) {
                    return {
                      results: bindings.map((id) => ({
                        id,
                        raw_json: JSON.stringify({ metaAdId: id, advertiser: "Brand" }),
                      })) as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const result = await listAdsByIds({ DB: mock.db } as never, adIds);

    expect(result).toHaveLength(150);

    const adQueries = statements.filter((statement) => statement.sql.includes("FROM ad"));
    expect(adQueries.length).toBeGreaterThanOrEqual(2);

    for (const statement of adQueries) {
      expect(statement.bindings.length).toBeLessThanOrEqual(90);
    }
  });

  it("hydrates landing-only evidence and preserves its provenance fields", async () => {
    const incoming: AdRecord = {
      metaAdId: "meta-landing-only-1",
      advertiser: "boAt",
      body: "Current provider copy",
      previewHeadline: "Current provider headline",
      previewSubhead: "Current provider subhead",
      hook: "Current hook",
      offer: "Current offer",
      cta: "Shop now",
      format: "image" as const,
      languageLabel: "English",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: null,
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Current provider summary",
      source: "meta" as const,
      analysisFields: [],
    };
    const stored = {
      ...incoming,
      landingPageUrl: "https://boat-lifestyle.com/sale",
      landingPage: {
        rawUrl: "https://boat-lifestyle.com/sale",
        canonicalUrl: "https://boat-lifestyle.com/sale",
        rawHeadline: "Stored sale",
        normalizedHeadline: "stored sale",
        normalizedHeadlineHash: "stored-hash",
        captureMethod: "browser_render" as const,
        artifactKey: "proof/stored.png",
        ctaText: "Buy now",
        priceText: "₹999",
        formPresent: false,
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
      analysisFields: [{
        scopeType: "landing_page" as const,
        fieldKey: "landing_page_headline_summary",
        fieldValue: "Stored sale",
        provenanceSource: "browser_render" as const,
        extractorVersion: "landing-page-v1",
        confidence: 0.9,
        metadata: { artifactKey: "proof/stored.png" },
      }],
    };
    const mock = createMockDb([{
      sqlIncludes: "FROM ad",
      results: [{ id: stored.metaAdId, raw_json: JSON.stringify(stored) }],
    }]);

    const [hydrated] = await hydrateAdsWithPersistedCreatives(
      { DB: mock.db } as never,
      [incoming],
    );

    expect(hydrated.landingPageUrl).toBe(stored.landingPageUrl);
    expect(hydrated.landingPage).toEqual(stored.landingPage);
    expect(hydrated.analysisFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldKey: "landing_page_headline_summary",
        provenanceSource: "browser_render",
      }),
    ]));
  });

  it("keeps redirected creative cooldown stable through provider hydration", async () => {
    const requestedImageUrl = "https://images.example.com/creative.jpg";
    const persistedImageUrl = "https://cdn.example.com/creative-v2.jpg";
    const capturedAt = "2026-07-31T00:00:00.000Z";
    const incoming: AdRecord = {
      metaAdId: "meta-redirected-creative-1",
      advertiser: "Nykaa",
      body: "Current provider copy",
      previewHeadline: "Current provider headline",
      previewSubhead: "",
      hook: "Current hook",
      offer: "Current offer",
      cta: "Shop now",
      format: "image",
      languageLabel: "English",
      destinationType: "website",
      landingPageUrl: null,
      adSnapshotUrl: null,
      creativeImageUrl: requestedImageUrl,
      countries: ["India"],
      platforms: ["Instagram"],
      firstSeenAt: null,
      lastSeenAt: null,
      active: true,
      researchSummary: "Current provider summary",
      source: "meta",
      analysisFields: [],
    };
    const stored: AdRecord = {
      ...incoming,
      creativeImageUrl: persistedImageUrl,
      creativeText: null,
      creativeTextMetadata: {
        capturedAt,
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint({
          creativeImageUrl: persistedImageUrl,
        }),
        creativeRequestedSourceFingerprint: creativeCaptureSourceFingerprint({
          creativeImageUrl: requestedImageUrl,
        }),
      },
    };
    const mock = createMockDb([{
      sqlIncludes: "FROM ad",
      results: [{ id: stored.metaAdId, raw_json: JSON.stringify(stored) }],
    }]);

    const [hydrated] = await hydrateAdsWithPersistedCreatives(
      { DB: mock.db } as never,
      [incoming],
    );

    expect(hydrated.creativeImageUrl).toBe(requestedImageUrl);
    expect(
      shouldAttemptCreativeTextCapture(hydrated, Date.parse(capturedAt) + 1),
    ).toBe(false);

    const [changed] = await hydrateAdsWithPersistedCreatives(
      { DB: mock.db } as never,
      [{
        ...incoming,
        creativeImageUrl: "https://images.example.com/creative-new.jpg",
      }],
    );

    expect(
      shouldAttemptCreativeTextCapture(changed, Date.parse(capturedAt) + 1),
    ).toBe(true);
  });
});

describe("listDigests", () => {
  it("loads digest items and deliveries in two batched lookups", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM digest_run")) {
                    return {
                      results: [
                        {
                          id: "digest-1",
                          user_id: "user-1",
                          period_start: "2026-05-01T00:00:00.000Z",
                          period_end: "2026-05-02T00:00:00.000Z",
                          created_at: "2026-05-02T00:00:00.000Z",
                        },
                        {
                          id: "digest-2",
                          user_id: "user-1",
                          period_start: "2026-05-02T00:00:00.000Z",
                          period_end: "2026-05-03T00:00:00.000Z",
                          created_at: "2026-05-03T00:00:00.000Z",
                        },
                      ] as T[],
                    };
                  }

                  if (sql.includes("FROM digest_item")) {
                    return {
                      results: [
                        {
                          id: "item-1",
                          digest_run_id: "digest-1",
                          watchlist_id: "watch-1",
                          watchlist_name: "Nykaa",
                          event_type: "ad_new",
                          title: "New ad",
                          summary: "A new ad appeared.",
                          metadata_json: "{}",
                          created_at: "2026-05-02T00:10:00.000Z",
                        },
                      ] as T[],
                    };
                  }

                  if (sql.includes("FROM digest_delivery")) {
                    return {
                      results: [
                        {
                          id: "delivery-1",
                          digest_run_id: "digest-1",
                          provider: "resend",
                          status: "sent",
                          recipient_email: "owner@example.com",
                          external_message_id: "msg_1",
                          error_message: null,
                          delivered_at: "2026-05-02T00:15:00.000Z",
                        },
                      ] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const digests = await listDigests({ DB: mock.db } as never, "user-1");

    expect(digests).toHaveLength(2);
    expect(digests[0]?.items).toHaveLength(1);
    expect(digests[0]?.delivery?.id).toBe("delivery-1");
    expect(digests[1]?.items).toHaveLength(0);
    expect(statements.filter((statement) => statement.sql.includes("FROM digest_item"))).toHaveLength(1);
    expect(statements.filter((statement) => statement.sql.includes("FROM digest_delivery"))).toHaveLength(1);
    expect(statements.find((statement) => statement.sql.includes("FROM digest_item"))?.bindings).toEqual([
      "user-1",
      "2026-05-03T00:00:00.000Z",
    ]);
  });

  it("stays under D1's 100-bound-parameter cap with 150 digest runs", async () => {
    const runs = Array.from({ length: 150 }, (_, index) => ({
      id: `digest-${index}`,
      user_id: "user-1",
      period_start: `2025-01-01T00:00:00.000Z`,
      period_end: `2025-01-02T00:00:00.000Z`,
      created_at: `2025-01-02T00:00:00.000Z`,
    }));
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM digest_run")) {
                    return { results: runs as T[] };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const digests = await listDigests({ DB: mock.db } as never, "user-1", 200);

    expect(digests).toHaveLength(150);

    for (const statement of statements) {
      expect(statement.bindings.length).toBeLessThanOrEqual(90);
      expect(statement.sql).not.toContain("IN (");
    }
  });

  it("bounds the digest run list by default", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    await listDigests({ DB: mock.db } as never, "user-1");

    const runQuery = statements.find((statement) => statement.sql.includes("FROM digest_run"));
    expect(runQuery?.sql).toContain("LIMIT ?");
    expect(runQuery?.bindings).toEqual(["user-1", 60]);
  });
});

describe("listCollectionItems", () => {
  it("loads tags with a single-parameter join even for 150 items", async () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      id: `item-${index}`,
      collection_id: "collection-1",
      ad_id: `ad-${index}`,
      note: null,
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
      ad_snapshot_json: "{}",
    }));
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM collection_item_tag")) {
                    return {
                      results: [
                        { collection_item_id: "item-3", label: "festival" },
                      ] as T[],
                    };
                  }

                  if (sql.includes("FROM collection_item")) {
                    return { results: items as T[] };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    const records = await listCollectionItems({ DB: mock.db } as never, "collection-1");

    expect(records).toHaveLength(150);
    expect(records.find((record) => record.id === "item-3")?.tags).toEqual(["festival"]);

    const tagQuery = statements.find((statement) => statement.sql.includes("FROM collection_item_tag"));
    expect(tagQuery?.bindings).toEqual(["collection-1"]);

    for (const statement of statements) {
      expect(statement.bindings.length).toBeLessThanOrEqual(90);
    }
  });
});

describe("getDiscoveryCacheEntry", () => {
  it("returns null instead of demo data when cached payload JSON is corrupted", async () => {
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(..._bindings: unknown[]) {
              return {
                async all<T>() {
                  return {
                    results: [
                      {
                        cache_key: "cache-1",
                        provider: "meta_api",
                        route_context: "public_search",
                        query_fingerprint: "fp",
                        country: "IN",
                        cursor: null,
                        payload_json: "{not-json",
                        fetched_at: "2026-05-15T00:00:00.000Z",
                        expires_at: "2026-05-15T01:00:00.000Z",
                        browser_ms_used: null,
                        created_at: "2026-05-15T00:00:00.000Z",
                        updated_at: "2026-05-15T00:00:00.000Z",
                      },
                    ] as T[],
                  };
                },
              };
            },
          };
        },
      },
    };

    await expect(getDiscoveryCacheEntry({ DB: mock.db } as never, "cache-1")).resolves.toBeNull();
  });
});

describe("createWatchEvent", () => {
  it("persists proof-first defaults alongside the existing watch-event fields", async () => {
    const mock = createMockDb();

    await createWatchEvent(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        runId: "run-1",
        eventType: "ad_new",
        adId: "meta-boat-1",
        baselineFromRunId: null,
        title: "New ad detected",
        summary: "A new ad entered the watchlist.",
        metadata: {
          advertiser: "boAt",
        },
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO watch_event"),
    );

    expect(statement?.sql).toContain("status");
    expect(statement?.sql).toContain("importance_score");
    expect(statement?.sql).toContain("candidate_id");
    expect(statement?.sql).toContain("proof_capture_id");
    expect(statement?.sql).toContain("confirmed_at");
    expect(statement?.sql).toContain("last_evaluated_at");
    expect(statement?.sql.match(/\?/g)?.length).toBe(statement?.bindings.length);
    expect(statement?.bindings).toContain("confirmed");
    expect(statement?.bindings).toContain(0);
  });

  it("reuses an existing proof-backed watch event for the same proof capture", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM watch_event",
        results: [{ id: "event-existing" }],
      },
    ]);

    const eventId = await createWatchEvent(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        runId: "run-1",
        eventType: "landing_page_cta_changed",
        adId: "meta-boat-1",
        baselineFromRunId: null,
        candidateId: "candidate-1",
        proofCaptureId: "proof-1",
        title: "CTA changed",
        summary: "The landing page CTA changed.",
        metadata: {},
      },
    );

    expect(eventId).toBe("event-existing");
    expect(mock.statements.some((entry) => entry.sql.includes("INSERT INTO watch_event"))).toBe(false);
  });

  it("recovers a proof-backed watch event inserted by a concurrent writer", async () => {
    let lookupCount = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("INSERT INTO watch_event")) {
                  throw new Error(
                    "D1_ERROR: UNIQUE constraint failed: watch_event.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)",
                  );
                }
                return { success: true };
              },
              async all<T>() {
                if (sql.includes("FROM watch_event")) {
                  lookupCount += 1;
                  return {
                    results: (lookupCount === 1 ? [] : [{ id: "event-existing" }]) as T[],
                  };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    await expect(
      createWatchEvent(
        { DB: db } as never,
        {
          watchlistId: "watch-1",
          runId: "run-1",
          eventType: "landing_page_cta_changed",
          adId: "meta-boat-1",
          baselineFromRunId: null,
          candidateId: "candidate-1",
          proofCaptureId: "proof-1",
          title: "CTA changed",
          summary: "The landing page CTA changed.",
          metadata: {},
        },
      ),
    ).resolves.toBe("event-existing");
    expect(lookupCount).toBe(2);
  });
});

describe("createEventCandidate", () => {
  it("reuses an existing proof-backed event candidate for the same proof target", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM event_candidate",
        results: [{ id: "candidate-existing" }],
      },
    ]);

    const candidateId = await createEventCandidate(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        runId: "run-1",
        eventType: "landing_page_cta_changed",
        status: "confirmed",
        importanceScore: 7,
        adId: "meta-boat-1",
        proofTargetId: "target-1",
        title: "CTA changed",
        summary: "The landing page CTA changed.",
        metadata: {},
        proofRequired: true,
      },
    );

    expect(candidateId).toBe("candidate-existing");
    expect(mock.statements.some((entry) => entry.sql.includes("INSERT INTO event_candidate"))).toBe(false);
  });

  it("recovers a proof-backed event candidate inserted by a concurrent writer", async () => {
    let lookupCount = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("INSERT INTO event_candidate")) {
                  throw new Error(
                    "D1_ERROR: UNIQUE constraint failed: event_candidate.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)",
                  );
                }
                return { success: true };
              },
              async all<T>() {
                if (sql.includes("FROM event_candidate")) {
                  lookupCount += 1;
                  return {
                    results: (lookupCount === 1 ? [] : [{ id: "candidate-existing" }]) as T[],
                  };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    await expect(
      createEventCandidate(
        { DB: db } as never,
        {
          watchlistId: "watch-1",
          runId: "run-1",
          eventType: "landing_page_cta_changed",
          status: "confirmed",
          importanceScore: 7,
          adId: "meta-boat-1",
          proofTargetId: "target-1",
          title: "CTA changed",
          summary: "The landing page CTA changed.",
          metadata: {},
          proofRequired: true,
        },
      ),
    ).resolves.toBe("candidate-existing");
    expect(lookupCount).toBe(2);
  });
});

describe("discovery state persistence", () => {
  it("persists discovery cache entries separately from meta integration logs", async () => {
    const mock = createMockDb();

    await upsertDiscoveryCacheEntry(
      { DB: mock.db } as never,
      {
        cacheKey: "meta_library_browser:fp-nykaa:india",
        provider: "meta_library_browser",
        routeContext: "public_search",
        queryFingerprint: "fp-nykaa",
        country: "India",
        cursor: null,
        payload: {
          ads: [],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "miss",
        },
        fetchedAt: "2026-04-19T00:00:00.000Z",
        expiresAt: "2026-04-19T00:15:00.000Z",
        browserMsUsed: 2500,
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_cache_entry"),
    );

    expect(statement?.bindings).toContain("meta_library_browser:fp-nykaa:india");
    expect(statement?.bindings).toContain("meta_library_browser");
    expect(statement?.bindings).toContain("public_search");
    expect(statement?.bindings).toContain(2500);
  });

  it("persists provider health and fetch logs for discovery runs", async () => {
    const mock = createMockDb();

    await createDiscoveryFetchLog(
      { DB: mock.db } as never,
      {
        provider: "meta_library_browser",
        routeContext: "watchlist_scan",
        queryFingerprint: "fp-nykaa",
        country: "India",
        status: "failed",
        cacheStatus: "miss",
        failureClass: "selector_drift",
        browserMsUsed: 0,
        metadata: {
          watchlistId: "watch-1",
        },
      },
    );
    await upsertDiscoveryProviderState(
      { DB: mock.db } as never,
      {
        provider: "meta_library_browser",
        status: "degraded",
        failureClass: "selector_drift",
        summary: "Commercial discovery degraded; serving cached results.",
        lastSuccessAt: null,
        lastFailureAt: "2026-04-19T00:00:00.000Z",
        metadata: {
          sampleSize: 20,
        },
      },
    );

    const fetchLogStatement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_fetch_log"),
    );
    const providerStateStatement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO discovery_provider_state"),
    );

    expect(fetchLogStatement?.bindings).toContain("selector_drift");
    expect(providerStateStatement?.bindings).toContain("degraded");
    expect(providerStateStatement?.bindings).toContain(
      "Commercial discovery degraded; serving cached results.",
    );
  });

  it("treats absent discovery cache storage as empty optional state", async () => {
    const db = createMissingTableDb("discovery_cache_entry");

    await expect(getDiscoveryCacheEntry({ DB: db } as never, "cache-key")).resolves.toBeNull();
    await expect(
      upsertDiscoveryCacheEntry(
        { DB: db } as never,
        {
          cacheKey: "cache-key",
          provider: "meta_library_browser",
          routeContext: "public_search",
          queryFingerprint: "fp-nykaa",
          country: "India",
          cursor: null,
          payload: {
            ads: [],
            nextCursor: null,
            source: "meta_library_browser",
            provider: "meta_library_browser",
            cacheStatus: "miss",
          },
          fetchedAt: "2026-04-19T00:00:00.000Z",
          expiresAt: "2026-04-19T00:15:00.000Z",
          browserMsUsed: 2500,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("treats absent discovery provider storage as empty optional state", async () => {
    const db = createMissingTableDb("discovery_provider_state");

    await expect(
      getDiscoveryProviderState({ DB: db } as never, "meta_library_browser"),
    ).resolves.toBeNull();
    await expect(
      upsertDiscoveryProviderState(
        { DB: db } as never,
        {
          provider: "meta_library_browser",
          status: "degraded",
          failureClass: "selector_drift",
          summary: "Commercial discovery degraded; serving cached results.",
          lastSuccessAt: null,
          lastFailureAt: "2026-04-19T00:00:00.000Z",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("treats absent discovery fetch logs as optional state", async () => {
    const db = createMissingTableDb("discovery_fetch_log");

    await expect(
      createDiscoveryFetchLog(
        { DB: db } as never,
        {
          provider: "meta_library_browser",
          routeContext: "public_search",
          queryFingerprint: "fp-nykaa",
          country: "India",
          status: "failed",
          cacheStatus: "miss",
          failureClass: "selector_drift",
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("getOperatorSnapshot", () => {
  it("limits stale failure and provider-unknown rows to the recent ops window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T10:00:00.000Z"));

    try {
      const mock = createMockDb();

      await getOperatorSnapshot({ DB: mock.db } as never);

      const recentWindowIso = "2026-04-19T10:00:00.000Z";
      const failingRuns = findStatement(
        mock.statements,
        "FROM watchlist_run",
        "watchlist_run.status = 'failed'",
      );
      const failedProofs = findStatement(
        mock.statements,
        "FROM proof_capture",
        "proof_capture.status = 'failed'",
      );
      const budgetBlockedProofs = findStatement(
        mock.statements,
        "FROM proof_capture",
        "skipped_due_to_budget",
      );
      const deliveryFailures = findStatement(
        mock.statements,
        "FROM delivery_attempt",
        "delivery_attempt.status = 'failed'",
      );
      const discoveryFailures = findStatement(
        mock.statements,
        "FROM discovery_fetch_log",
        "discovery_fetch_log.status = 'failed'",
      );

      expect(failingRuns?.bindings).toContain(recentWindowIso);
      expect(failedProofs?.bindings).toContain(recentWindowIso);
      expect(budgetBlockedProofs?.bindings).toContain(recentWindowIso);
      expect(deliveryFailures?.bindings).toContain(recentWindowIso);
      expect(deliveryFailures?.bindings).toContain("2026-04-26T09:45:00.000Z");
      expect(deliveryFailures?.sql).toContain("delivery_attempt.status = 'pending'");
      expect(deliveryFailures?.sql).toContain("delivery_attempt.status = 'sent'");
      expect(deliveryFailures?.sql).toContain("delivery_attempt.webhook_status = 'provider_unknown'");
      expect(deliveryFailures?.sql).toContain("delivery_attempt.updated_at <= ?");
      expect(deliveryFailures?.sql).toMatch(
        /WHEN delivery_attempt\.status = 'failed' THEN 0\s+WHEN delivery_attempt\.status = 'pending' THEN 1\s+ELSE 2/,
      );
      expect(discoveryFailures?.bindings).toContain(recentWindowIso);
      expect(discoveryFailures?.sql).toContain(
        "json_extract(discovery_fetch_log.metadata_json, '$.partial') AS partial",
      );
      const discoveryProviders = findStatement(
        mock.statements,
        "FROM discovery_provider_state",
        "ORDER BY updated_at DESC",
      );
      expect(discoveryProviders?.sql).toContain(
        "json_extract(metadata_json, '$.partial') AS partial",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getOperatorRiskSummary", () => {
  it("uses cadence-aware stale-scan cutoffs for Scout, Starter, and Agency watchlists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));

    try {
      const mock = createMockDb();

      await getOperatorRiskSummary({ DB: mock.db } as never);

      const staleWatchlists = findStatement(
        mock.statements,
        "FROM watchlist",
        "watchlist.last_scanned_at",
        "user_plan.plan = 'scout'",
        "user_plan.plan = 'starter'",
        "user_plan.plan = 'agency'",
      );
      expect(staleWatchlists?.sql).not.toContain("user_plan.plan IN ('starter', 'agency')");
      expect(staleWatchlists?.bindings).toEqual([
        "2026-07-02T23:00:00.000Z",
        "2026-07-02T23:00:00.000Z",
        "2026-07-03T05:00:00.000Z",
        "2026-07-03T05:00:00.000Z",
        "2026-07-03T05:00:00.000Z",
        "2026-07-03T05:00:00.000Z",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getSuccessfulRunStatsForUserBetween", () => {
  it("counts heartbeat scans by completion time rather than scheduled slot time", async () => {
    const mock = createMockDb();

    await getSuccessfulRunStatsForUserBetween(
      { DB: mock.db } as never,
      "user-1",
      "2026-07-03T04:00:00.000Z",
      "2026-07-04T04:00:00.000Z",
    );

    const statsQuery = findStatement(
      mock.statements,
      "FROM watchlist_run",
      "COUNT(DISTINCT watchlist_run.watchlist_id)",
    );

    expect(statsQuery?.sql).toContain("watchlist_run.finished_at >= ?");
    expect(statsQuery?.sql).toContain("watchlist_run.finished_at < ?");
    expect(statsQuery?.sql).toContain("AS no_change_runs");
    expect(statsQuery?.sql).toContain("json_type(watchlist_run.summary_json, '$.adsSeen')");
    expect(statsQuery?.sql).not.toContain("watchlist_run.started_at >= ?");
  });
});

describe("listRetryableDigestRuns", () => {
  it("only retries failed or missing digest delivery rows", async () => {
    const mock = createMockDb();

    await listRetryableDigestRuns(
      { DB: mock.db } as never,
      {
        since: "2026-06-01T00:00:00.000Z",
        stalePreDispatchBefore: "2026-07-13T08:59:00.000Z",
        limit: 25,
      },
    );

    const query = findStatement(mock.statements, "FROM digest_run");
    expect(query?.sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1\s*FROM delivery_attempt\s*WHERE delivery_attempt\.digest_run_id/,
    );
    expect(query?.sql).toContain("delivery_attempt.status = 'failed'");
    expect(query?.sql).toContain("delivery_attempt.webhook_status = 'failed'");
    expect(query?.sql).toContain("delivery_attempt.status = 'pending'");
    expect(query?.sql).toContain("delivery_attempt.webhook_status = 'pending'");
    expect(query?.sql).toContain("delivery_attempt.updated_at <= ?");
    expect(query?.sql).toContain("'$.deliveryClaimProtocol'");
    expect(query?.bindings).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-07-13T08:59:00.000Z",
      "digest_preclaim_v1",
      "atomic-v2",
      25,
    ]);
  });
});

describe("listStaleBillingLifecycleEmailAttempts", () => {
  it("only selects bounded stale pre-dispatch billing email claims", async () => {
    const mock = createMockDb();

    await listStaleBillingLifecycleEmailAttempts(
      { DB: mock.db } as never,
      {
        staleBefore: "2026-07-13T08:59:00.000Z",
        limit: 10,
        maxRecoveryAttempts: 4,
      },
    );

    const query = findStatement(mock.statements, "FROM delivery_attempt");
    expect(query?.sql).toContain("lane = 'customer'");
    expect(query?.sql).toContain("channel = 'email'");
    expect(query?.sql).toContain("watchlist_id IS NULL");
    expect(query?.sql).toContain("digest_run_id IS NULL");
    expect(query?.sql).toContain("delivery_target_id IS NULL");
    expect(query?.sql).toContain("idempotency_key LIKE 'billing-payment-issue:%'");
    expect(query?.sql).toContain("idempotency_key LIKE 'billing-cancellation:%'");
    expect(query?.sql).toContain("idempotency_key LIKE 'billing-refund:%'");
    expect(query?.sql).toContain("status = 'pending'");
    expect(query?.sql).toContain("webhook_status = 'pending'");
    expect(query?.sql).toContain("recoveryAttemptCount");
    expect(query?.bindings).toEqual([
      "2026-07-13T08:59:00.000Z",
      4,
      10,
    ]);
    expect(query?.sql).toContain("updated_at <= ?");
    expect(query?.sql).toContain("ORDER BY updated_at ASC");
  });
});

describe("upsertProofTarget", () => {
  it("persists canonical page identity separately from proof-target identity", async () => {
    const mock = createMockDb();

    await upsertProofTarget(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        adId: "meta-boat-1",
        landingPageUrl: "https://example.com/glow?utm_source=meta",
        canonicalPageIdentity: "example.com/glow",
        proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO proof_target"),
    );

    expect(statement?.bindings).toContain("example.com/glow");
    expect(statement?.bindings).toContain("watch-1:meta-boat-1:example.com/glow");
    expect(statement?.sql).toContain("canonical_page_identity");
    expect(statement?.sql).toContain("proof_target_identity");
  });
});

describe("createProofCapture", () => {
  it("persists extractor metadata, render metadata, and idempotency fields", async () => {
    const mock = createMockDb();

    await createProofCapture(
      { DB: mock.db } as never,
      {
        proofTargetId: "proof-target-1",
        status: "succeeded",
        screenshotArtifactKey: "proof/shot.webp",
        htmlArtifactKey: "proof/page.html",
        extractedFields: {
          headline: "Glow Serum Sale",
        },
        fieldConfidence: {
          headline: 0.97,
        },
        extractionWarnings: ["cookie_banner_present"],
        captureMetadata: {
          browser: "browser_run",
        },
        renderMode: "mobile",
        deviceProfile: "mobile_default",
        extractorVersion: "proof-extractor-v1",
        idempotencyKey: "capture:watch-1:meta-boat-1",
        attemptedAt: "2026-04-18T16:00:00.000Z",
        succeededAt: "2026-04-18T16:00:05.000Z",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO proof_capture"),
    );

    expect(statement?.sql).toContain("field_confidence_json");
    expect(statement?.sql).toContain("extraction_warnings_json");
    expect(statement?.sql).toContain("render_mode");
    expect(statement?.sql).toContain("device_profile");
    expect(statement?.sql).toContain("idempotency_key");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"headline\":0.97"),
      ),
    ).toBe(true);
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("cookie_banner_present"),
      ),
    ).toBe(true);
    expect(statement?.bindings).toContain("capture:watch-1:meta-boat-1");
  });

  it("reuses an existing idempotent proof capture under foreign-key enforcement", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE watchlist (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE TABLE ad (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE proof_target (
          id TEXT PRIMARY KEY NOT NULL,
          watchlist_id TEXT NOT NULL,
          ad_id TEXT,
          landing_page_url TEXT,
          canonical_page_identity TEXT NOT NULL,
          proof_target_identity TEXT NOT NULL,
          last_capture_attempt_at TEXT,
          last_successful_proof_at TEXT,
          last_successful_capture_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
          FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX idx_proof_target_identity
          ON proof_target(proof_target_identity);
        CREATE TABLE proof_capture (
          id TEXT PRIMARY KEY NOT NULL,
          proof_target_id TEXT NOT NULL,
          status TEXT NOT NULL,
          skip_reason TEXT,
          failure_code TEXT,
          failure_reason TEXT,
          screenshot_artifact_key TEXT,
          html_artifact_key TEXT,
          extracted_fields_json TEXT NOT NULL DEFAULT '{}',
          field_confidence_json TEXT,
          extraction_warnings_json TEXT,
          capture_metadata_json TEXT NOT NULL DEFAULT '{}',
          render_mode TEXT NOT NULL DEFAULT 'mobile',
          device_profile TEXT NOT NULL DEFAULT 'mobile_default',
          extractor_version TEXT NOT NULL,
          idempotency_key TEXT,
          attempted_at TEXT NOT NULL,
          succeeded_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (proof_target_id) REFERENCES proof_target(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_proof_capture_idempotency
          ON proof_capture(idempotency_key);
        INSERT INTO user (id) VALUES ('user-1');
        INSERT INTO watchlist (id, user_id) VALUES ('watch-1', 'user-1');
        INSERT INTO ad (id) VALUES ('meta-boat-1');
      `);

      const target = await upsertProofTarget(
        { DB: sqlite.db } as never,
        {
          watchlistId: "watch-1",
          adId: "meta-boat-1",
          landingPageUrl: "https://example.com/glow",
          canonicalPageIdentity: "example.com/glow",
          proofTargetIdentity: "watch-1:meta-boat-1:example.com/glow",
        },
      );
      expect(target?.id).toEqual(expect.any(String));

      const firstId = await createProofCapture(
        { DB: sqlite.db } as never,
        {
          proofTargetId: target!.id,
          status: "succeeded",
          extractorVersion: "proof-extractor-v1",
          idempotencyKey: "capture:watch-1:meta-boat-1",
          attemptedAt: "2026-04-18T16:00:00.000Z",
          succeededAt: "2026-04-18T16:00:05.000Z",
        },
      );
      const secondId = await createProofCapture(
        { DB: sqlite.db } as never,
        {
          proofTargetId: target!.id,
          status: "succeeded",
          extractorVersion: "proof-extractor-v1",
          idempotencyKey: "capture:watch-1:meta-boat-1",
          attemptedAt: "2026-04-18T16:00:00.000Z",
          succeededAt: "2026-04-18T16:00:05.000Z",
        },
      );
      const row = sqlite.sqlite
        .prepare("SELECT COUNT(*) AS count FROM proof_capture WHERE idempotency_key = ?")
        .get("capture:watch-1:meta-boat-1") as { count: number };

      expect(secondId).toBe(firstId);
      expect(row.count).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("does not reuse a successful idempotent proof capture with different proof payload", async () => {
    const existingCapture = {
      id: "proof-existing",
      proof_target_id: "target-1",
      status: "succeeded",
      skip_reason: null,
      failure_code: null,
      failure_reason: null,
      screenshot_artifact_key: null,
      html_artifact_key: null,
      extracted_fields_json: "{}",
      field_confidence_json: "{}",
      extraction_warnings_json: "[]",
      capture_metadata_json: "{}",
      render_mode: "mobile",
      device_profile: "mobile_default",
      extractor_version: "proof-extractor-v1",
      idempotency_key: "capture:payload-mismatch",
      attempted_at: "2026-04-18T16:00:00.000Z",
      succeeded_at: "2026-04-18T16:00:05.000Z",
      created_at: "2026-04-18T16:00:00.000Z",
      updated_at: "2026-04-18T16:00:00.000Z",
    };
    const mock = createMockDb([
      {
        sqlIncludes: "FROM proof_capture",
        results: [existingCapture],
      },
    ]);

    await expect(
      createProofCapture(
        { DB: mock.db } as never,
        {
          proofTargetId: "target-1",
          status: "succeeded",
          extractorVersion: "proof-extractor-v1",
          idempotencyKey: "capture:payload-mismatch",
          attemptedAt: "2026-04-18T16:01:00.000Z",
          succeededAt: "2026-04-18T16:01:05.000Z",
        },
      ),
    ).rejects.toThrow(/incompatible proof payload/);
    expect(mock.statements.some((entry) => entry.sql.includes("INSERT INTO proof_capture"))).toBe(false);
  });

  it("recovers an idempotent proof capture created by a concurrent writer", async () => {
    let lookupCount = 0;
    const existingCapture = {
      id: "proof-existing",
      proof_target_id: "target-1",
      status: "succeeded",
      skip_reason: null,
      failure_code: null,
      failure_reason: null,
      screenshot_artifact_key: null,
      html_artifact_key: null,
      extracted_fields_json: "{}",
      field_confidence_json: "{}",
      extraction_warnings_json: "[]",
      capture_metadata_json: "{}",
      render_mode: "mobile",
      device_profile: "mobile_default",
      extractor_version: "proof-extractor-v1",
      idempotency_key: "capture:race",
      attempted_at: "2026-04-18T16:00:00.000Z",
      succeeded_at: "2026-04-18T16:00:05.000Z",
      created_at: "2026-04-18T16:00:00.000Z",
      updated_at: "2026-04-18T16:00:00.000Z",
    };
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("INSERT INTO proof_capture")) {
                  throw new Error(
                    "D1_ERROR: UNIQUE constraint failed: proof_capture.idempotency_key: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
                  );
                }
                return { success: true };
              },
              async all<T>() {
                if (sql.includes("FROM proof_capture") && sql.includes("idempotency_key")) {
                  lookupCount += 1;
                  return {
                    results: (lookupCount === 1 ? [] : [existingCapture]) as T[],
                  };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    await expect(
      createProofCapture(
        { DB: db } as never,
        {
          proofTargetId: "target-1",
          status: "succeeded",
          extractorVersion: "proof-extractor-v1",
          idempotencyKey: "capture:race",
          attemptedAt: "2026-04-18T16:00:00.000Z",
          succeededAt: "2026-04-18T16:00:05.000Z",
        },
      ),
    ).resolves.toBe("proof-existing");
    expect(lookupCount).toBe(2);
  });

  it("does not reuse a failed idempotent proof capture for a later success", async () => {
    const failedCapture = {
      id: "proof-failed",
      proof_target_id: "target-1",
      status: "failed",
      skip_reason: null,
      failure_code: "proof_capture_failed",
      failure_reason: "Landing page proof capture failed.",
      screenshot_artifact_key: null,
      html_artifact_key: null,
      extracted_fields_json: "{}",
      field_confidence_json: "{}",
      extraction_warnings_json: "[]",
      capture_metadata_json: "{}",
      render_mode: "mobile",
      device_profile: "mobile_default",
      extractor_version: "proof-extractor-v1",
      idempotency_key: "capture:failed-then-success",
      attempted_at: "2026-04-18T16:00:00.000Z",
      succeeded_at: null,
      created_at: "2026-04-18T16:00:00.000Z",
      updated_at: "2026-04-18T16:00:00.000Z",
    };
    const mock = createMockDb([
      {
        sqlIncludes: "FROM proof_capture",
        results: [failedCapture],
      },
    ]);

    await expect(
      createProofCapture(
        { DB: mock.db } as never,
        {
          proofTargetId: "target-1",
          status: "succeeded",
          extractorVersion: "proof-extractor-v1",
          idempotencyKey: "capture:failed-then-success",
          attemptedAt: "2026-04-18T16:01:00.000Z",
          succeededAt: "2026-04-18T16:01:05.000Z",
        },
      ),
    ).rejects.toThrow(/incompatible status/);
    expect(mock.statements.some((entry) => entry.sql.includes("INSERT INTO proof_capture"))).toBe(false);
  });
});

describe("getSuccessfulProofCaptureStatsForUser", () => {
  it("counts only succeeded proof captures for the workspace user", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "COUNT(*) AS total, MAX(proof_capture.succeeded_at) AS latest_at",
        results: [{ total: 3, latest_at: "2026-04-18T16:00:05.000Z" }],
      },
    ]);

    const result = await getSuccessfulProofCaptureStatsForUser(
      { DB: mock.db } as never,
      "user-1",
    );

    expect(result).toEqual({
      count: 3,
      latestAt: "2026-04-18T16:00:05.000Z",
    });

    const statement = findStatement(
      mock.statements,
      "FROM proof_capture",
      "proof_capture.status = 'succeeded'",
    );
    expect(statement?.sql).toContain("proof_capture.succeeded_at IS NOT NULL");
    expect(statement?.bindings).toEqual(["user-1"]);
  });
});

describe("upsertWorkspaceDeliveryConfig", () => {
  it("persists delivery sensitivity and channel toggles for a workspace", async () => {
    const mock = createMockDb();

    await upsertWorkspaceDeliveryConfig(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
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
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO workspace_delivery_config"),
    );

    expect(statement?.sql).toContain("slack_enabled");
    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("balanced");
    expect(statement?.bindings).toContain(0);
    expect(statement?.bindings).toContain(1);
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"startHour\":22"),
      ),
    ).toBe(true);
  });
});

describe("upsertWatchlistDeliveryConfig", () => {
  it("persists watchlist-specific delivery overrides", async () => {
    const mock = createMockDb();

    await upsertWatchlistDeliveryConfig(
      { DB: mock.db } as never,
      {
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "quiet",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: true,
        slackEnabled: false,
        quietHours: {
          startHour: 23,
          endHour: 7,
        },
        timezone: "UTC",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO watchlist_delivery_config"),
    );

    expect(statement?.sql).toContain("slack_enabled");
    expect(statement?.bindings).toContain("watch-1");
    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("quiet");
    expect(statement?.bindings).toContain(0);
    expect(statement?.bindings).toContain(1);
    expect(statement?.bindings).toContain("UTC");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"startHour\":23"),
      ),
    ).toBe(true);
  });
});

describe("upsertDeliveryTarget", () => {
  it("summarizes active and proven delivery targets without a page limit", async () => {
    const mock = createMockDb([
      {
        sqlIncludes: "FROM delivery_target",
        results: [
          {
            active_count: 26,
            proven_count: 3,
          },
        ],
      },
    ]);

    const result = await getDeliveryTargetReadinessStats(
      { DB: mock.db } as never,
      "user-1",
    );
    const statement = mock.statements.find((entry) =>
      entry.sql.includes("FROM delivery_target"),
    );

    expect(result).toEqual({
      activeCount: 26,
      provenCount: 3,
    });
    expect(statement?.bindings).toEqual(["user-1"]);
    expect(statement?.sql).toContain("last_successful_delivery_at IS NOT NULL");
    expect(statement?.sql).toContain("opted_out_at IS NULL");
    expect(statement?.sql).toContain("channel = 'email'");
    // Slack and Teams webhook delivery are live; WhatsApp stays dormant.
    expect(statement?.sql).toContain("channel = 'slack'");
    expect(statement?.sql).toContain("channel = 'teams'");
    expect(statement?.sql).not.toContain("channel = 'whatsapp'");
    expect(statement?.sql).toContain("is_validated = 1");
    expect(statement?.sql).toContain("validation_status = 'validated'");
    expect(statement?.sql).not.toContain("LIMIT");
  });

  it("counts only opted-in validated customer-facing targets as readiness usable", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE delivery_target (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          is_opted_in INTEGER NOT NULL DEFAULT 0,
          is_paused INTEGER NOT NULL DEFAULT 0,
          opted_out_at TEXT,
          is_validated INTEGER NOT NULL DEFAULT 0,
          validation_status TEXT NOT NULL,
          template_eligible INTEGER NOT NULL DEFAULT 0,
          last_successful_delivery_at TEXT
        );
        INSERT INTO delivery_target (
          id,
          user_id,
          channel,
          is_opted_in,
          is_paused,
          opted_out_at,
          is_validated,
          validation_status,
          last_successful_delivery_at
        ) VALUES
          ('target-valid', 'user-1', 'email', 1, 0, NULL, 1, 'validated', '2026-06-19T00:00:00.000Z'),
          ('target-pending', 'user-1', 'email', 0, 0, NULL, 0, 'pending', '2026-06-19T00:00:00.000Z'),
          ('target-rejected', 'user-1', 'email', 1, 0, NULL, 0, 'provider_rejected', '2026-06-19T00:00:00.000Z');
        INSERT INTO delivery_target (
          id,
          user_id,
          channel,
          is_opted_in,
          is_paused,
          opted_out_at,
          is_validated,
          validation_status,
          template_eligible,
          last_successful_delivery_at
        ) VALUES
          ('target-whatsapp-dormant', 'user-1', 'whatsapp', 1, 0, NULL, 1, 'validated', 1, '2026-06-19T00:00:00.000Z');
      `);

      await expect(getDeliveryTargetReadinessStats({ DB: sqlite.db } as never, "user-1"))
        .resolves.toEqual({
          activeCount: 1,
          provenCount: 1,
        });
    } finally {
      sqlite.close();
    }
  });

  it("persists channel-specific validation and opt-in state", async () => {
    const mock = createMockDb();

    await upsertDeliveryTarget(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: "watch-1",
        channel: "whatsapp",
        targetValue: "+919999999999",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_import",
        optedInAt: "2026-04-18T10:00:00.000Z",
        templateEligible: true,
        providerIdentifier: "wa_123",
        metadata: {
          label: "Founder WhatsApp",
        },
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO delivery_target"),
    );

    expect(statement?.bindings).toContain("user-1");
    expect(statement?.bindings).toContain("watch-1");
    expect(statement?.bindings).toContain("whatsapp");
    expect(statement?.bindings).toContain("+919999999999");
    expect(statement?.bindings).toContain("validated");
    expect(statement?.bindings).toContain(1);
    expect(statement?.bindings).toContain("manual_import");
    expect(statement?.bindings).toContain("wa_123");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"label\":\"Founder WhatsApp\""),
      ),
    ).toBe(true);
  });

  it("updates an existing workspace-level target instead of inserting duplicates", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const mock = {
      db: {
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });
              return {
                async all<T>() {
                  if (sql.includes("FROM delivery_target")) {
                    return {
                      results: [
                        {
                          id: "target-existing",
                          user_id: "user-1",
                          watchlist_id: null,
                          channel: "email",
                          target_value: "owner@example.com",
                          validation_status: "validated",
                          is_validated: 1,
                          is_opted_in: 1,
                          opt_in_source: "account_email",
                          opted_in_at: "2026-04-18T00:00:00.000Z",
                          is_paused: 0,
                          paused_at: null,
                          opted_out_at: null,
                          template_eligible: 0,
                          last_successful_delivery_at: null,
                          last_successful_attempt_id: null,
                          provider_identifier: null,
                          metadata_json: "{}",
                          created_at: "2026-04-18T00:00:00.000Z",
                          updated_at: "2026-04-18T00:00:00.000Z",
                        },
                      ] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    await upsertDeliveryTarget(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
      },
    );

    expect(
      statements.some(
        (statement) =>
          statement.sql.includes("FROM delivery_target") &&
          statement.sql.includes("watchlist_id IS NULL"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.sql.includes("UPDATE delivery_target")),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.sql.includes("INSERT INTO delivery_target")),
    ).toBe(false);
  });
});

describe("email target dispatch and unsubscribe ordering", () => {
  it("atomically refuses lazy provisioning after an account-wide unsubscribe", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE delivery_target (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          watchlist_id TEXT,
          channel TEXT NOT NULL,
          target_value TEXT NOT NULL,
          validation_status TEXT NOT NULL,
          is_validated INTEGER NOT NULL,
          is_opted_in INTEGER NOT NULL,
          opt_in_source TEXT,
          opted_in_at TEXT,
          is_paused INTEGER NOT NULL,
          paused_at TEXT,
          opted_out_at TEXT,
          template_eligible INTEGER NOT NULL,
          last_successful_delivery_at TEXT,
          last_successful_attempt_id TEXT,
          provider_identifier TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_delivery_target_unique_workspace
          ON delivery_target(user_id, channel, target_value)
          WHERE watchlist_id IS NULL;
        INSERT INTO delivery_target (
          id, user_id, watchlist_id, channel, target_value, validation_status,
          is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
          paused_at, opted_out_at, template_eligible, last_successful_delivery_at,
          last_successful_attempt_id, provider_identifier, metadata_json,
          created_at, updated_at
        ) VALUES (
          'target-watchlist-suppressed', 'user-1', 'watch-1', 'email',
          'OWNER@example.com', 'validated', 1, 0, 'account_email',
          '2026-07-30T00:00:00.000Z', 1, '2026-07-30T01:00:00.000Z',
          '2026-07-30T01:00:00.000Z', 0, NULL, NULL, NULL, '{}',
          '2026-07-30T00:00:00.000Z', '2026-07-30T01:00:00.000Z'
        );
      `);

      await expect(
        provisionVerifiedAccountEmailTargetIfUnsuppressed(
          { DB: sqlite.db } as never,
          {
            userId: "user-1",
            targetValue: "owner@example.com",
            optInSource: "account_email",
            metadata: { autoProvisioned: true },
          },
        ),
      ).resolves.toBeNull();
      expect(
        sqlite.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM delivery_target WHERE user_id = 'user-1' AND watchlist_id IS NULL",
          )
          .get(),
      ).toMatchObject({ count: 0 });

      await expect(
        provisionVerifiedAccountEmailTargetIfUnsuppressed(
          { DB: sqlite.db } as never,
          {
            userId: "user-2",
            targetValue: "fresh@example.com",
            optInSource: "account_email",
          },
        ),
      ).resolves.toMatchObject({
        userId: "user-2",
        targetValue: "fresh@example.com",
        isOptedIn: true,
        isValidated: true,
        validationStatus: "validated",
      });
    } finally {
      sqlite.close();
    }
  });

  it("claims only the current verified account email and atomically suppresses every matching target", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE user (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL,
          emailVerified INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE delivery_target (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          watchlist_id TEXT,
          channel TEXT NOT NULL,
          target_value TEXT NOT NULL,
          validation_status TEXT NOT NULL,
          is_validated INTEGER NOT NULL,
          is_opted_in INTEGER NOT NULL,
          opt_in_source TEXT NOT NULL,
          opted_in_at TEXT,
          is_paused INTEGER NOT NULL,
          paused_at TEXT,
          opted_out_at TEXT,
          template_eligible INTEGER NOT NULL,
          last_successful_delivery_at TEXT,
          last_successful_attempt_id TEXT,
          provider_identifier TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE delivery_attempt (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          delivery_target_id TEXT,
          channel TEXT NOT NULL,
          status TEXT NOT NULL,
          webhook_status TEXT NOT NULL,
          error_message TEXT,
          failed_at TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO user (id, email, emailVerified)
        VALUES ('user-1', 'owner@example.com', 1);
        INSERT INTO delivery_target (
          id, user_id, watchlist_id, channel, target_value, validation_status,
          is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
          paused_at, opted_out_at, template_eligible, last_successful_delivery_at,
          last_successful_attempt_id, provider_identifier, metadata_json, created_at, updated_at
        ) VALUES
          ('target-workspace', 'user-1', NULL, 'email', 'Owner@Example.com', 'validated',
           1, 1, 'account_email', '2026-07-15T00:00:00.000Z', 0,
           NULL, NULL, 0, NULL, NULL, NULL, '{}', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
          ('target-watchlist', 'user-1', 'watch-1', 'email', 'owner@example.com', 'validated',
           1, 1, 'account_email', '2026-07-15T00:00:00.000Z', 0,
           NULL, NULL, 0, NULL, NULL, NULL, '{}', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
        INSERT INTO delivery_attempt (
          id, user_id, delivery_target_id, channel, status, webhook_status,
          error_message, failed_at, updated_at
        ) VALUES (
          'attempt-pending', 'user-1', 'target-workspace', 'email', 'pending', 'pending',
          NULL, NULL, '2026-07-15T00:00:00.000Z'
        );
      `);

      await expect(claimEmailTargetForDispatch({ DB: sqlite.db } as never, {
        userId: "user-1",
        targetId: "target-workspace",
      })).resolves.toMatchObject({ id: "target-workspace", targetValue: "owner@example.com" });

      sqlite.sqlite.exec("UPDATE user SET emailVerified = 0 WHERE id = 'user-1'");
      await expect(claimEmailTargetForDispatch({ DB: sqlite.db } as never, {
        userId: "user-1",
        targetId: "target-workspace",
      })).resolves.toBeNull();
      sqlite.sqlite.exec("UPDATE user SET emailVerified = 1 WHERE id = 'user-1'");

      await expect(suppressEmailTargetsForUserAndAddress({ DB: sqlite.db } as never, {
        userId: "user-1",
        targetValue: "OWNER@example.com",
      })).resolves.toBe(2);
      const suppressed = sqlite.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM delivery_target WHERE is_opted_in = 0 AND is_paused = 1 AND opted_out_at IS NOT NULL",
      ).get() as { count: number };
      expect(Number(suppressed.count)).toBe(2);
      const cancelledAttempt = sqlite.sqlite.prepare(
        "SELECT status, webhook_status, error_message FROM delivery_attempt WHERE id = 'attempt-pending'",
      ).get() as { status: string; webhook_status: string; error_message: string };
      expect(cancelledAttempt).toMatchObject({
        status: "failed",
        webhook_status: "failed",
        error_message: "Email delivery target was unsubscribed before dispatch.",
      });
    } finally {
      sqlite.close();
    }
  });

  it("re-opts unsubscribe-suppressed email targets without clearing independent pauses", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(`
        CREATE TABLE delivery_target (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          watchlist_id TEXT,
          channel TEXT NOT NULL,
          target_value TEXT NOT NULL,
          is_opted_in INTEGER NOT NULL,
          opt_in_source TEXT NOT NULL,
          opted_in_at TEXT,
          is_paused INTEGER NOT NULL,
          paused_at TEXT,
          opted_out_at TEXT,
          metadata_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO delivery_target (
          id, user_id, watchlist_id, channel, target_value, is_opted_in,
          opt_in_source, opted_in_at, is_paused, paused_at, opted_out_at,
          metadata_json, updated_at
        ) VALUES
          ('target-workspace', 'user-1', NULL, 'email', 'Owner@Example.com', 0,
           'account_email', '2026-07-15T00:00:00.000Z', 1, '2026-07-16T00:00:00.000Z',
           '2026-07-16T00:00:00.000Z', '{"scope":"workspace","unsubscribedVia":"email_unsubscribe_link"}',
           '2026-07-16T00:00:00.000Z'),
          ('target-watchlist', 'user-1', 'watch-1', 'email', 'owner@example.com', 0,
           'account_email', '2026-07-15T00:00:00.000Z', 1, '2026-07-16T00:00:00.000Z',
           '2026-07-16T00:00:00.000Z', '{"scope":"watchlist","unsubscribedVia":"email_unsubscribe_link"}',
           '2026-07-16T00:00:00.000Z'),
          ('target-watchlist-paused-before-unsubscribe', 'user-1', 'watch-2', 'email', 'owner@example.com', 0,
           'watchlist_settings', '2026-07-14T00:00:00.000Z', 1, '2026-07-15T00:00:00.000Z',
           '2026-07-16T00:00:00.000Z', '{"scope":"watchlist","unsubscribedVia":"email_unsubscribe_link"}',
           '2026-07-16T00:00:00.000Z'),
          ('target-watchlist-manually-paused', 'user-1', 'watch-3', 'email', 'owner@example.com', 1,
           'watchlist_settings', '2026-07-14T00:00:00.000Z', 1, '2026-07-15T00:00:00.000Z',
           NULL, '{"scope":"watchlist"}', '2026-07-15T00:00:00.000Z'),
          ('target-other-address', 'user-1', 'watch-2', 'email', 'other@example.com', 0,
           'account_email', '2026-07-15T00:00:00.000Z', 1, '2026-07-16T00:00:00.000Z',
           '2026-07-16T00:00:00.000Z', '{"scope":"watchlist","unsubscribedVia":"email_unsubscribe_link"}',
           '2026-07-16T00:00:00.000Z'),
          ('target-other-user', 'user-2', NULL, 'email', 'owner@example.com', 0,
           'account_email', '2026-07-15T00:00:00.000Z', 1, '2026-07-16T00:00:00.000Z',
           '2026-07-16T00:00:00.000Z', '{"scope":"workspace","unsubscribedVia":"email_unsubscribe_link"}',
           '2026-07-16T00:00:00.000Z');
      `);

      await expect(resumeEmailTargetsForUserAndAddress({ DB: sqlite.db } as never, {
        userId: "user-1",
        targetValue: "OWNER@example.com",
      })).resolves.toBe(3);

      const resumed = sqlite.sqlite.prepare(`
        SELECT id, is_opted_in, opt_in_source, is_paused, paused_at, opted_out_at,
               json_extract(metadata_json, '$.scope') AS scope,
               json_extract(metadata_json, '$.unsubscribedVia') AS unsubscribed_via
        FROM delivery_target
        WHERE id IN (
          'target-workspace',
          'target-watchlist',
          'target-watchlist-paused-before-unsubscribe'
        )
        ORDER BY id
      `).all() as Array<Record<string, unknown>>;
      expect(resumed).toEqual([
        expect.objectContaining({
          id: "target-watchlist",
          is_opted_in: 1,
          opt_in_source: "delivery_settings",
          is_paused: 0,
          paused_at: null,
          opted_out_at: null,
          scope: "watchlist",
          unsubscribed_via: null,
        }),
        expect.objectContaining({
          id: "target-watchlist-paused-before-unsubscribe",
          is_opted_in: 1,
          opt_in_source: "delivery_settings",
          is_paused: 1,
          paused_at: "2026-07-15T00:00:00.000Z",
          opted_out_at: null,
          scope: "watchlist",
          unsubscribed_via: null,
        }),
        expect.objectContaining({
          id: "target-workspace",
          is_opted_in: 1,
          opt_in_source: "delivery_settings",
          is_paused: 0,
          paused_at: null,
          opted_out_at: null,
          scope: "workspace",
          unsubscribed_via: null,
        }),
      ]);

      const stillSuppressed = sqlite.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM delivery_target
        WHERE id IN ('target-other-address', 'target-other-user')
          AND is_opted_in = 0
          AND is_paused = 1
          AND opted_out_at IS NOT NULL
      `).get() as { count: number };
      expect(Number(stillSuppressed.count)).toBe(2);

      const manuallyPaused = sqlite.sqlite.prepare(`
        SELECT is_opted_in, opt_in_source, is_paused, paused_at, opted_out_at,
               json_extract(metadata_json, '$.unsubscribedVia') AS unsubscribed_via,
               updated_at
        FROM delivery_target
        WHERE id = 'target-watchlist-manually-paused'
      `).get() as Record<string, unknown>;
      expect(manuallyPaused).toEqual(expect.objectContaining({
        is_opted_in: 1,
        opt_in_source: "watchlist_settings",
        is_paused: 1,
        paused_at: "2026-07-15T00:00:00.000Z",
        opted_out_at: null,
        unsubscribed_via: null,
        updated_at: "2026-07-15T00:00:00.000Z",
      }));
    } finally {
      sqlite.close();
    }
  });
});

describe("createDeliveryAttempt", () => {
  it("persists payload snapshots and webhook status on delivery attempts", async () => {
    const mock = createMockDb();

    await createDeliveryAttempt(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        watchlistId: "watch-1",
        digestRunId: null,
        deliveryTargetId: "target-1",
        lane: "customer",
        channel: "email",
        provider: "resend",
        status: "sent",
        webhookStatus: "legacy_unknown",
        targetValue: "owner@example.com",
        providerMessageId: "msg_123",
        providerStatusLastSeenAt: "2026-04-18T16:30:00.000Z",
        eventIds: ["event-1", "event-2"],
        payloadSnapshot: {
          subject: "3 changes this week",
        },
        idempotencyKey: "delivery:user-1:digest-2026-04-18",
        sentAt: "2026-04-18T16:29:00.000Z",
      },
    );

    const statement = mock.statements.find((entry) =>
      entry.sql.includes("INSERT INTO delivery_attempt"),
    );

    expect(statement?.sql).toContain("webhook_status");
    expect(statement?.sql).toContain("payload_snapshot_json");
    expect(statement?.sql).toContain("idempotency_key");
    expect(statement?.bindings).toContain("legacy_unknown");
    expect(statement?.bindings).toContain("delivery:user-1:digest-2026-04-18");
    expect(
      statement?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"subject\":\"3 changes this week\""),
      ),
    ).toBe(true);
  });
});

describe("getLaunchReadinessSignals", () => {
  it("does not count synthetic launch canary proof captures as real proof readiness", async () => {
    const mock = createMockDb();

    await getLaunchReadinessSignals(
      { DB: mock.db } as never,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    const proofQuery = findStatement(mock.statements, "FROM proof_capture", "launch_readiness_canary");
    expect(proofQuery?.sql).toContain("json_extract(capture_metadata_json, '$.kind')");
    const digestEmailQuery = findStatement(
      mock.statements,
      "FROM delivery_attempt",
      "digest_run_id IS NOT NULL",
      "channel = 'email'",
      "provider = 'cloudflare_email'",
      "provider_status_last_seen_at",
    );
    expect(digestEmailQuery).toBeTruthy();
    expect(digestEmailQuery?.sql).toContain(
      "COALESCE(provider_status_last_seen_at, sent_at, updated_at, created_at) >= ?",
    );
    expect(digestEmailQuery?.sql).toContain("lane = 'customer'");
    expect(findStatement(mock.statements, "FROM delivery_target", "channel = 'slack'")).toBeTruthy();
    expect(findStatement(mock.statements, "FROM delivery_attempt", "channel = 'email'")).toBeTruthy();
    expect(findStatement(mock.statements, "FROM delivery_attempt", "channel = 'slack'")).toBeTruthy();
    expect(
      findStatement(
        mock.statements,
        "FROM delivery_target",
        "channel = 'whatsapp'",
        "template_eligible = 1",
      ),
    ).toBeTruthy();
    expect(
      findStatement(
        mock.statements,
        "FROM delivery_attempt",
        "channel = 'whatsapp'",
        "lane = 'customer'",
        "webhook_status = 'delivered'",
      ),
    ).toBeTruthy();
  });
});

describe("legacy proof-first defaults", () => {
  it("keeps legacy users digest-first and maps legacy event importance explicitly", () => {
    expect(legacyWatchEventImportanceScore("landing_page_url_changed")).toBe(85);
    expect(legacyWatchEventImportanceScore("landing_page_headline_changed")).toBe(75);
    expect(legacyWatchEventImportanceScore("ad_new")).toBe(65);
    expect(legacyWatchEventImportanceScore("ad_inactive")).toBe(60);

    expect(
      legacyWorkspaceDeliveryDefaults({
        hasEmail: true,
      }),
    ).toEqual({
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      teamsEnabled: false,
    });
  });
});
