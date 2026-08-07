import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  countSourceTargetsForEntity,
  countTrackedEntities,
  listPollCursorsForTargets,
  listPresenceItems,
  reconcilePresenceItemsAfterPoll,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import type { NormalizedPresenceItem, SourceTargetRecord } from "~/lib/presence-types";

type StatementCapture = { sql: string; bindings: unknown[] };

type MockDbOptions = {
  firstResults?: Array<{ sqlIncludes: string; row: unknown }>;
  allResults?: Array<{ sqlIncludes: string; results: unknown[] }>;
  runMeta?: { changes: number };
};

/**
 * Captures every prepare/bind so tests can assert parameterized scoping
 * (user_id / tracked_entity_id) without spinning up SQLite.
 */
function createMockDb(options: MockDbOptions = {}) {
  const statements: StatementCapture[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          statements.push({ sql, bindings });
          return {
            async first<T>() {
              const match = options.firstResults?.find((entry) => sql.includes(entry.sqlIncludes));
              return (match?.row ?? null) as T;
            },
            async all<T>() {
              const match = options.allResults?.find((entry) => sql.includes(entry.sqlIncludes));
              return { results: (match?.results ?? []) as T[] };
            },
            async run() {
              return { success: true, meta: options.runMeta ?? { changes: 0 } };
            },
          };
        },
      };
    },
  };

  return {
    statements,
    env: { DB: db } as unknown as AppEnv,
  };
}

function expectScoped(sql: string, column: string) {
  expect(sql).toMatch(new RegExp(`${column}\\s*=\\s*\\?`));
}

function sourceTarget(overrides: Partial<SourceTargetRecord> = {}): SourceTargetRecord {
  return {
    id: "st_owner",
    trackedEntityId: "te_owner",
    userId: "user_owner",
    connectorId: "website",
    targetKey: "https://example.com",
    targetUrl: "https://example.com",
    targetHandle: null,
    metadata: {},
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    isActive: true,
    deletedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function presenceItem(overrides: Partial<NormalizedPresenceItem> = {}): NormalizedPresenceItem {
  return {
    externalId: null,
    canonicalUrl: "https://example.com/post-1",
    title: "Post one",
    bodyExcerpt: "Excerpt",
    author: null,
    publishedAt: null,
    observedAt: "2026-07-13T00:00:00.000Z",
    contentHash: "hash-1",
    ...overrides,
  };
}

describe("presence-data count builders", () => {
  it("countTrackedEntities always scopes by user_id and parameterizes optional filters", async () => {
    const { env, statements } = createMockDb({
      firstResults: [{ sqlIncludes: "SELECT COUNT(*) AS count FROM tracked_entity", row: { count: 2 } }],
    });

    await expect(countTrackedEntities(env, "user_a")).resolves.toBe(2);
    await expect(
      countTrackedEntities(env, "user_a", { trackingMode: "competitor", activeOnly: false }),
    ).resolves.toBe(2);

    expect(statements).toHaveLength(2);

    const [defaultCount, filteredCount] = statements;
    expectScoped(defaultCount.sql, "user_id");
    expect(defaultCount.sql).toContain("deleted_at IS NULL");
    expect(defaultCount.sql).toContain("is_active = 1");
    expect(defaultCount.sql).not.toContain("tracking_mode");
    expect(defaultCount.bindings).toEqual(["user_a"]);
    expect(defaultCount.sql).not.toMatch(/user_id\s*=\s*'user_a'/);

    expectScoped(filteredCount.sql, "user_id");
    expect(filteredCount.sql).toContain("tracking_mode = ?");
    expect(filteredCount.sql).not.toContain("is_active = 1");
    expect(filteredCount.bindings).toEqual(["user_a", "competitor"]);
  });

  it("countSourceTargetsForEntity always scopes by tracked_entity_id", async () => {
    const { env, statements } = createMockDb({
      firstResults: [{ sqlIncludes: "SELECT COUNT(*) AS count FROM source_target", row: { count: 3 } }],
    });

    await expect(countSourceTargetsForEntity(env, "te_1")).resolves.toBe(3);
    await expect(countSourceTargetsForEntity(env, "te_1", "website")).resolves.toBe(3);

    expect(statements).toHaveLength(2);

    const [defaultCount, connectorCount] = statements;
    expectScoped(defaultCount.sql, "tracked_entity_id");
    expect(defaultCount.sql).toContain("deleted_at IS NULL");
    expect(defaultCount.sql).toContain("is_active = 1");
    expect(defaultCount.sql).not.toContain("connector_id");
    expect(defaultCount.bindings).toEqual(["te_1"]);

    expectScoped(connectorCount.sql, "tracked_entity_id");
    expect(connectorCount.sql).toContain("connector_id = ?");
    expect(connectorCount.bindings).toEqual(["te_1", "website"]);
    expect(connectorCount.sql).not.toMatch(/tracked_entity_id\s*=\s*'te_1'/);
  });
});

describe("presence-data listPresenceItems clause builder", () => {
  it("always includes user_id scoping and parameterizes optional filters", async () => {
    const { env, statements } = createMockDb({
      allResults: [
        {
          sqlIncludes: "SELECT presence_item.* FROM presence_item",
          results: [
            {
              id: "pitem_1",
              source_target_id: "st_1",
              tracked_entity_id: "te_1",
              user_id: "user_a",
              connector_id: "website",
              external_id: null,
              canonical_url: "https://example.com/a",
              url_hash: "uh1",
              title: "A",
              body_excerpt: null,
              author: null,
              published_at: null,
              observed_at: "2026-07-13T00:00:00.000Z",
              content_hash: "ch1",
              raw_json: null,
              is_tombstone: 0,
              revision: 1,
              created_at: "2026-07-13T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const items = await listPresenceItems(env, "user_a", {
      trackedEntityId: "te_1",
      connectorId: "website",
      since: "2026-07-01T00:00:00.000Z",
      limit: 10,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "pitem_1",
      userId: "user_a",
      trackedEntityId: "te_1",
    });

    expect(statements).toHaveLength(1);
    const [query] = statements;
    expect(query.sql).toContain("presence_item.user_id = ?");
    expect(query.sql).toContain("presence_item.tracked_entity_id = ?");
    expect(query.sql).toContain("presence_item.connector_id = ?");
    expect(query.sql).toContain("presence_item.observed_at > ?");
    expect(query.sql).toContain("INNER JOIN source_target");
    expect(query.sql).toContain("INNER JOIN tracked_entity");
    expect(query.bindings).toEqual([
      "user_a",
      "te_1",
      "website",
      "2026-07-01T00:00:00.000Z",
      10,
    ]);
  });

  it("never drops user_id scoping when listing without entity filter", async () => {
    const { env, statements } = createMockDb();

    await listPresenceItems(env, "user_b");

    expect(statements).toHaveLength(1);
    const [query] = statements;
    expect(query.sql).toContain("presence_item.user_id = ?");
    expect(query.sql).not.toContain("presence_item.tracked_entity_id = ?");
    expect(query.bindings[0]).toBe("user_b");
    expect(query.bindings.at(-1)).toBe(50);
  });
});

describe("presence-data observation aggregation scoping", () => {
  it("upsertPresenceItems stamps inserts with sourceTarget user_id and tracked_entity_id", async () => {
    const { env, statements } = createMockDb({
      firstResults: [{ sqlIncludes: "SELECT id, content_hash, revision FROM presence_item", row: null }],
    });

    const target = sourceTarget({
      id: "st_owner",
      userId: "user_owner",
      trackedEntityId: "te_owner",
    });

    const result = await upsertPresenceItems(env, {
      sourceTarget: target,
      items: [presenceItem({ canonicalUrl: "https://example.com/post-1", contentHash: "hash-1" })],
    });

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);

    const insert = statements.find((entry) => entry.sql.includes("INSERT INTO presence_item"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("tracked_entity_id");
    expect(insert!.sql).toContain("user_id");
    // bind order: id, source_target_id, tracked_entity_id, user_id, connector_id, ...
    expect(insert!.bindings[1]).toBe("st_owner");
    expect(insert!.bindings[2]).toBe("te_owner");
    expect(insert!.bindings[3]).toBe("user_owner");
    expect(insert!.bindings).not.toContain("user_other");
    expect(insert!.bindings).not.toContain("te_other");
  });

  it("upsertPresenceItems cannot re-attribute an existing row to another user via update", async () => {
    const { env, statements } = createMockDb({
      firstResults: [
        {
          sqlIncludes: "SELECT id, content_hash, revision FROM presence_item",
          row: { id: "pitem_existing", content_hash: "old-hash", revision: 1 },
        },
      ],
    });

    await upsertPresenceItems(env, {
      sourceTarget: sourceTarget({ userId: "user_attacker", trackedEntityId: "te_attacker" }),
      items: [
        presenceItem({
          canonicalUrl: "https://example.com/post-1",
          contentHash: "new-hash",
          title: "Changed",
        }),
      ],
    });

    const update = statements.find((entry) => entry.sql.includes("UPDATE presence_item"));
    expect(update).toBeDefined();
    // Update is keyed by presence_item.id only — ownership comes from the prior
    // SELECT which is scoped to source_target_id (from the caller's SourceTargetRecord).
    expect(update!.sql).toMatch(/WHERE id = \?/);
    expect(update!.bindings.at(-1)).toBe("pitem_existing");
    expect(update!.sql).not.toContain("user_id");
    expect(update!.sql).not.toContain("tracked_entity_id");

    const lookup = statements.find((entry) =>
      entry.sql.includes("SELECT id, content_hash, revision FROM presence_item"),
    );
    expect(lookup).toBeDefined();
    expectScoped(lookup!.sql, "source_target_id");
    expect(lookup!.bindings[0]).toBe("st_owner");
  });

  it("reconcilePresenceItemsAfterPoll tombstones only within the source_target scope", async () => {
    const { env, statements } = createMockDb({
      allResults: [
        {
          sqlIncludes: "SELECT url_hash FROM presence_item",
          results: [{ url_hash: "gone-hash" }],
        },
      ],
      runMeta: { changes: 1 },
    });

    const result = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget: sourceTarget({ id: "st_owner" }),
      observedUrlHashes: ["kept-hash"],
      completeSnapshot: true,
    });

    expect(result.tombstoned).toBe(1);
    expect(result.tombstonedUrlHashes).toEqual(["gone-hash"]);

    const select = statements.find((entry) => entry.sql.includes("SELECT url_hash FROM presence_item"));
    const update = statements.find((entry) => entry.sql.includes("UPDATE presence_item"));
    expect(select).toBeDefined();
    expect(update).toBeDefined();

    for (const statement of [select!, update!]) {
      expectScoped(statement.sql, "source_target_id");
      expect(statement.sql).toContain("url_hash NOT IN (?)");
      expect(statement.bindings).toContain("st_owner");
      expect(statement.bindings).toContain("kept-hash");
      expect(statement.sql).not.toMatch(/source_target_id\s*=\s*'st_owner'/);
    }
  });

  it("reconcilePresenceItemsAfterPoll refuses unscoped mass tombstone without observed anchors", async () => {
    const { env, statements } = createMockDb();

    await expect(
      reconcilePresenceItemsAfterPoll(env, {
        sourceTarget: sourceTarget(),
        observedUrlHashes: [],
        completeSnapshot: true,
      }),
    ).resolves.toEqual({ tombstoned: 0, tombstonedUrlHashes: [] });

    expect(statements).toHaveLength(0);
  });
});

describe("workspace cursor batching (remediation)", () => {
  it("reads any number of cursors in exactly one parameterized statement", async () => {
    const { env, statements } = createMockDb({
      allResults: [
        {
          sqlIncludes: "FROM presence_poll_cursor",
          results: [
            {
              source_target_id: "target-1",
              cursor_json: null,
              etag: null,
              last_modified: null,
              last_polled_at: "2026-07-20T00:00:00.000Z",
              last_success_at: "2026-07-20T00:00:00.000Z",
              last_error_code: null,
              last_error_message: null,
              updated_at: "2026-07-20T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const cursors = await listPollCursorsForTargets(env, [
      "target-1",
      "target-2",
      "target-3",
    ]);

    expect(cursors).toHaveLength(1);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("IN (?, ?, ?)");
    expect(statements[0].bindings).toEqual(["target-1", "target-2", "target-3"]);
  });

  it("issues zero queries for an empty target list", async () => {
    const { env, statements } = createMockDb();
    await expect(listPollCursorsForTargets(env, [])).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });
});

describe("cursor batching respects the D1 parameter cap", () => {
  it("chunks large target lists instead of one over-limit IN clause", async () => {
    const targetIds = Array.from({ length: 240 }, (_, index) => `target-${index}`);
    const { env, statements } = createMockDb({
      allResults: [{ sqlIncludes: "FROM presence_poll_cursor", results: [] }],
    });

    await listPollCursorsForTargets(env, targetIds);

    expect(statements.length).toBe(3);
    for (const statement of statements) {
      expect(statement.bindings.length).toBeLessThanOrEqual(90);
    }
  });
});
