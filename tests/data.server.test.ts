import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import {
  claimDodoPlanCheckout,
  beginDodoWebhookEventProcessing,
  claimDodoWebhookEvent,
  claimAgentActionAudit,
  createDeliveryAttempt,
  createDiscoveryFetchLog,
  createAgentActionAudit,
  createLandingPageSnapshot,
  createProofCapture,
  createSupportCase,
  createWatchEvent,
  DODO_PLAN_CHECKOUT_LOCK_MINUTES,
  grantDodoPlanAccess,
  getDeliveryTargetReadinessStats,
  getUserIdForDodoLifecycle,
  markDodoPlanPaymentIssue,
  revokeDodoAccessForRefundedPayment,
  revokeDodoPlanAccess,
  recordWatchlistCapacitySkip,
  closeCounterMoveFollowUp,
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
  getLaunchReadinessSignals,
  getSuccessfulProofCaptureStatsForUser,
  getOperatorSnapshot,
  getWeeklyBusinessSummary,
  findAgentActionAuditByIdempotencyKey,
  finishAgentActionAudit,
  listRecentAgentActionAudits,
  listClientRooms,
  listAgentMemory,
  listAgentMemoryForClientRooms,
  listSupportCases,
  listActiveWatchlists,
  listCollectionItems,
  listDigests,
  upsertDigestDelivery,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
  upsertAgentMemory,
  legacyWatchEventImportanceScore,
  legacyWorkspaceDeliveryDefaults,
  listAdsByIds,
  upsertAd,
  upsertCustomerMetaConnection,
  upsertClientRoom,
  upsertDeliveryTarget,
  upsertProofTarget,
  upsertWatchlistDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
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
                sqlite.prepare(sql).run(...toSqliteBindings(bindings));
                return { success: true };
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
    expect(analysisInserts.every((statement) => statement.bindings.includes("lp-signals-v1"))).toBe(true);
  });

  it("updates the digest delivery provider when rerunning an existing digest", async () => {
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
    expect(statement?.sql).toContain("provider = excluded.provider");
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
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
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
    } finally {
      sqlite.close();
    }
  });

  it("returns the existing case when a request-key insert is ignored", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
      applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
      applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
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
      expect(rows).toHaveLength(1);
      expect(supportCase).toMatchObject({
        id: "case-existing",
        requestKey: "support-request-race",
        alreadyExists: true,
      });
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

    const insert = findStatement(mock.statements, "INSERT INTO client_room");
    expect(insert?.sql).toContain("ON CONFLICT(user_id, name)");
    expect(insert?.bindings.slice(1, 6)).toEqual([
      "user-1",
      "Beauty client",
      "Nykaa",
      "active",
      JSON.stringify({ goal: "Weekly proof review" }),
    ]);
    expect(findStatement(mock.statements, "DELETE FROM client_room_resource")?.bindings).toEqual([
      "room-1",
      "user-1",
    ]);
    expect(findStatement(mock.statements, "INSERT INTO client_room_resource")?.bindings.slice(1, 6)).toEqual([
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
    expect(statement?.sql).toContain("user_plan.dodo_payment_id = excluded.dodo_payment_id");
    // COALESCE keeps linkage fields when an event doesn't carry them
    expect(statement?.sql).toContain("COALESCE(excluded.dodo_subscription_id, user_plan.dodo_subscription_id)");
    expect(statement?.sql).toContain("COALESCE(excluded.dodo_next_billing_at, user_plan.dodo_next_billing_at)");
    expect(statement?.bindings).toEqual([
      "user-1",
      "starter",
      "pay_123",
      "prod_starter_monthly",
      null,
      null,
      null,
      "succeeded",
      "2026-06-04T12:00:00.000Z",
    ]);
  });

  it("keeps the pending plan checkout lock for the full Dodo checkout window", async () => {
    const mock = createMockDb();

    await claimDodoPlanCheckout(
      { DB: mock.db } as never,
      {
        userId: "user-1",
        claimedAt: "2026-06-15T12:00:00.000Z",
      },
    );

    const statement = findStatement(mock.statements, "INSERT INTO user_plan", "checkout_pending");
    expect(DODO_PLAN_CHECKOUT_LOCK_MINUTES).toBe(24 * 60);
    expect(statement?.bindings).toEqual([
      "user-1",
      "2026-06-15T12:00:00.000Z",
      "2026-06-14T12:00:00.000Z",
    ]);
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
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("payload_timestamp");
    expect(statements[1]?.sql).not.toContain("payload_timestamp");
    expect(statements[1]?.sql).toContain("WHERE dodo_webhook_event.outcome = 'failed'");
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

    expect(mock.statements[0]?.sql).toContain("INNER JOIN user_plan");
    expect(mock.statements[0]?.sql).toContain("watchlist.is_active = 1");
    expect(mock.statements[0]?.sql).toContain("user_plan.plan IN ('starter', 'agency')");
    expect(mock.statements[0]?.sql).toContain("user_plan.plan = 'scout'");
    expect(mock.statements[0]?.bindings).toEqual([0]);
  });

  it("can include Scout watchlists for the weekly digest path", async () => {
    const mock = createMockDb();

    await listActiveWatchlists({ DB: mock.db } as never, { includeScout: true });

    expect(mock.statements[0]?.bindings).toEqual([1]);
  });
});

describe("weekly business summary", () => {
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
  it("limits stale failure rows to the recent ops window", async () => {
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
      expect(discoveryFailures?.bindings).toContain(recentWindowIso);
    } finally {
      vi.useRealTimers();
    }
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
    expect(statement?.sql).not.toContain("channel = 'slack'");
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
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
    });
  });
});
