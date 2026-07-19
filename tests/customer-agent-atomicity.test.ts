import { afterEach, describe, expect, it, vi } from "vitest";

import { runAtomicAgentAction } from "~/lib/agent-actions.server";
import { prepareAtomicClientRoomUpsert } from "~/lib/data/customer-api-rooms.server";
import { prepareAtomicShareLinkInsert } from "~/lib/data/shares.server";
import { createApprovedReportSnapshot, isApprovedReportSnapshot } from "~/lib/report-approval";
import type { ReportDocument } from "~/lib/report";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

type Harness = ReturnType<typeof createSqliteD1>;
const fixtures: Harness[] = [];

function env(harness: Harness) {
  return { DB: harness.db } as never;
}

function migrate(harness: Harness) {
  harness.sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE customer_api_key (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      revoked_at TEXT,
      actions_write_enabled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE workspace_member (
      id TEXT PRIMARY KEY NOT NULL,
      owner_user_id TEXT NOT NULL,
      member_user_id TEXT,
      status TEXT NOT NULL
    );
  `);
  applyMigration(harness.sqlite, "migrations/0035_agent_action_audit.sql");
  applyMigration(harness.sqlite, "migrations/0037_client_rooms.sql");
  harness.sqlite.exec(`
    CREATE TABLE share_link (
      id TEXT PRIMARY KEY NOT NULL,
      token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      is_snapshot INTEGER NOT NULL DEFAULT 0,
      snapshot_payload_json TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE atomic_effect (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      action_name TEXT NOT NULL
    );
    CREATE TABLE collection (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE watchlist (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
    INSERT INTO user (id) VALUES ('owner-1'), ('member-2');
    INSERT INTO customer_api_key (id, user_id, actions_write_enabled)
    VALUES ('key-1', 'owner-1', 1), ('key-2', 'member-2', 1);
    INSERT INTO workspace_member (id, owner_user_id, member_user_id, status)
    VALUES ('membership-1', 'owner-1', 'member-2', 'active');
    INSERT INTO collection (id, user_id) VALUES ('collection-1', 'owner-1'), ('collection-2', 'member-2');
    INSERT INTO watchlist (id, user_id) VALUES ('watchlist-1', 'owner-1');
  `);
}

function shareEffect(
  db: D1Database,
  input: {
    auditId: string;
    userId: string;
    actionName: "share.create" | "report.share";
    idempotencyKey: string;
    requestFingerprint: string;
    shareId: string;
    token: string;
  },
) {
  return db
    .prepare(`
      INSERT INTO share_link (
        id, token, user_id, resource_type, resource_id, is_snapshot,
        snapshot_payload_json, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM agent_action_audit
        WHERE id = ?
          AND user_id = ?
          AND action_name = ?
          AND idempotency_key = ?
          AND status = 'started'
          AND json_extract(metadata_json, '$.requestFingerprint') = ?
      )
    `)
    .bind(
      input.shareId,
      input.token,
      input.userId,
      input.actionName === "report.share" ? "report" : "collection",
      input.actionName === "report.share" ? "report-1" : "collection-1",
      input.actionName === "report.share" ? 1 : 0,
      input.actionName === "report.share" ? '{"reportId":"shared-report"}' : null,
      "2026-07-15T10:00:00.000Z",
      input.auditId,
      input.userId,
      input.actionName,
      input.idempotencyKey,
      input.requestFingerprint,
    );
}

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

describe("Journey 4 atomic customer-agent effects", () => {
  it("commits an approved report share, replays it, and rejects an altered fingerprint", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const payload = createApprovedReportSnapshot({
      kind: "report",
      reportId: "collection:collection-1",
      resourceType: "collection",
      resourceId: "collection-1",
      title: "Client proof",
      subtitle: "Current evidence",
      summary: "One saved item.",
      generatedAt: "2026-07-15T00:00:00.000Z",
      stats: [],
      insightDepth: {} as ReportDocument["insightDepth"],
      rows: [{
        id: "row-1",
        advertiser: "Competitor",
        previewHeadline: "Saved item",
        offer: null,
        cta: null,
        formatLabel: "Image",
        languageLabel: null,
        previewImageUrl: null,
        creativeText: null,
        translatedText: null,
        landingPage: {
          url: "https://example.com/offer",
          headline: "Current offer",
          captureLabel: "Browser rendered",
          capturedAt: "2026-07-15T00:00:00.000Z",
          signals: [],
        },
        analysisFields: [],
        tags: [],
        note: "Saved evidence",
      }],
    });
    expect(payload).not.toBeNull();

    const prepare = vi.fn((db: D1Database, auditId: string) => ({
      statement: prepareAtomicShareLinkInsert(db, {
        auditId,
        apiKeyId: "key-1",
        userId: "owner-1",
        actionName: "report.share",
        idempotencyKey: "journey4-approved-report",
        requestFingerprint: "fp-approved-report",
        resourceType: "report",
        resourceId: "collection:collection-1",
        ownerResourceType: "collection",
        isSnapshot: true,
        snapshotPayload: payload as unknown as Record<string, unknown>,
        shareId: "approved-share-1",
        token: "approved-token-1",
        createdAt: "2026-07-15T10:00:00.000Z",
        expiresAt: "2026-10-13T10:00:00.000Z",
      }),
      result: {
        ok: true,
        action: "report.share",
        share: { id: "approved-share-1", token: "approved-token-1" },
      },
    }));

    const first = await runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", apiKeyId: "key-1", actionName: "report.share", idempotencyKey: "journey4-approved-report" },
      { requestFingerprint: "fp-approved-report", prepare },
    );
    const stored = harness.sqlite.prepare("SELECT snapshot_payload_json FROM share_link").get() as {
      snapshot_payload_json: string;
    };
    expect(isApprovedReportSnapshot(JSON.parse(stored.snapshot_payload_json))).toBe(true);

    const retry = await runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", apiKeyId: "key-1", actionName: "report.share", idempotencyKey: "journey4-approved-report" },
      { requestFingerprint: "fp-approved-report", prepare: vi.fn() },
    );
    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(prepare).toHaveBeenCalledTimes(1);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", apiKeyId: "key-1", actionName: "report.share", idempotencyKey: "journey4-approved-report" },
        { requestFingerprint: "fp-altered-report", prepare: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AgentActionIdempotencyConflictError" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 1 });
  });

  it("commits share.create once and replays the original share id and token", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const prepare = vi.fn(async (db: D1Database, auditId: string) => {
      const result = {
        ok: true,
        action: "share.create",
        share: { id: "share-1", token: "token-original" },
      };
      return {
        statement: prepareAtomicShareLinkInsert(db, {
          auditId,
          apiKeyId: null,
          userId: "owner-1",
          actionName: "share.create",
          idempotencyKey: "journey4-share-1",
          requestFingerprint: "fp-share-1",
          resourceType: "collection",
          resourceId: "collection-1",
          ownerResourceType: "collection",
          isSnapshot: false,
          shareId: "share-1",
          token: "token-original",
          createdAt: "2026-07-15T10:00:00.000Z",
          expiresAt: "2026-10-13T10:00:00.000Z",
        }),
        resourceType: "collection",
        resourceId: "collection-1",
        metadata: { requestFingerprint: "attempted-overwrite" },
        result,
      };
    });

    const first = await runAtomicAgentAction(
      env(harness),
      {
        userId: "owner-1",
        apiKeyId: null,
        actionName: "share.create",
        idempotencyKey: "journey4-share-1",
        metadata: { source: "mcp" },
      },
      { requestFingerprint: "fp-share-1", prepare },
    );
    const retry = await runAtomicAgentAction(
      env(harness),
      {
        userId: "owner-1",
        actionName: "share.create",
        idempotencyKey: "journey4-share-1",
      },
      {
        requestFingerprint: "fp-share-1",
        prepare: vi.fn(),
      },
    );

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT id, token, user_id FROM share_link").all()).toEqual([
      { id: "share-1", token: "token-original", user_id: "owner-1" },
    ]);
    expect(harness.sqlite.prepare("SELECT status, action_name, result_json, metadata_json FROM agent_action_audit").get()).toMatchObject({
      status: "succeeded",
      action_name: "share.create",
      result_json: JSON.stringify(first.result),
      metadata_json: expect.stringContaining('"requestFingerprint":"fp-share-1"'),
    });
  });

  it("keeps a member audit actor while persisting a share for the workspace owner", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const prepare = vi.fn((db: D1Database, auditId: string) => ({
      statement: prepareAtomicShareLinkInsert(db, {
        auditId,
        auditUserId: "member-2",
        apiKeyId: "key-2",
        userId: "owner-1",
        actionName: "share.create",
        idempotencyKey: "member-owner-share",
        requestFingerprint: "fp-member-owner-share",
        resourceType: "collection",
        resourceId: "collection-1",
        ownerResourceType: "collection",
        isSnapshot: false,
        shareId: "member-owner-share-id",
        token: "member-owner-token",
        createdAt: "2026-07-15T10:00:00.000Z",
        expiresAt: "2026-10-13T10:00:00.000Z",
      }),
      result: { ok: true, action: "share.create", share: { id: "member-owner-share-id", token: "member-owner-token" } },
    }));

    const first = await runAtomicAgentAction(
      env(harness),
      { userId: "member-2", apiKeyId: "key-2", actionName: "share.create", idempotencyKey: "member-owner-share" },
      { requestFingerprint: "fp-member-owner-share", prepare },
    );
    const retry = await runAtomicAgentAction(
      env(harness),
      { userId: "member-2", apiKeyId: "key-2", actionName: "share.create", idempotencyKey: "member-owner-share" },
      { requestFingerprint: "fp-member-owner-share", prepare: vi.fn() },
    );

    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT user_id FROM share_link").get()).toEqual({ user_id: "owner-1" });
    expect(harness.sqlite.prepare("SELECT user_id FROM agent_action_audit").get()).toEqual({ user_id: "member-2" });
  });

  it("requires the API key to remain active when the share commits", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", apiKeyId: "key-1", actionName: "share.create", idempotencyKey: "revoked-key-share" },
        {
          requestFingerprint: "fp-revoked-key-share",
          prepare: (db, auditId) => {
            harness.sqlite.prepare("UPDATE customer_api_key SET revoked_at = datetime('now') WHERE id = 'key-1'").run();
            return {
              statement: prepareAtomicShareLinkInsert(db, {
                auditId,
                auditUserId: "owner-1",
                apiKeyId: "key-1",
                userId: "owner-1",
                actionName: "share.create",
                idempotencyKey: "revoked-key-share",
                requestFingerprint: "fp-revoked-key-share",
                resourceType: "collection",
                resourceId: "collection-1",
                ownerResourceType: "collection",
                isSnapshot: false,
                shareId: "revoked-key-share-id",
                token: "revoked-key-token",
                createdAt: "2026-07-15T10:00:00.000Z",
                expiresAt: "2026-10-13T10:00:00.000Z",
              }),
              result: { ok: true, action: "share.create", share: { id: "revoked-key-share-id", token: "revoked-key-token" } },
            };
          },
        },
      ),
    ).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code, api_key_id FROM agent_action_audit").get()).toEqual({
      status: "failed",
      error_code: "atomic_batch_failed",
      api_key_id: "key-1",
    });
  });

  it("does not treat a deleted API key as an internal share action", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", apiKeyId: "key-1", actionName: "share.create", idempotencyKey: "deleted-key-share" },
        {
          requestFingerprint: "fp-deleted-key-share",
          prepare: (db, auditId) => {
            harness.sqlite.prepare("DELETE FROM customer_api_key WHERE id = 'key-1'").run();
            return {
              statement: prepareAtomicShareLinkInsert(db, {
                auditId,
                auditUserId: "owner-1",
                apiKeyId: "key-1",
                userId: "owner-1",
                actionName: "share.create",
                idempotencyKey: "deleted-key-share",
                requestFingerprint: "fp-deleted-key-share",
                resourceType: "collection",
                resourceId: "collection-1",
                ownerResourceType: "collection",
                isSnapshot: false,
                shareId: "deleted-key-share-id",
                token: "deleted-key-token",
                createdAt: "2026-07-15T10:00:00.000Z",
                expiresAt: "2026-10-13T10:00:00.000Z",
              }),
              result: { ok: true, action: "share.create", share: { id: "deleted-key-share-id", token: "deleted-key-token" } },
            };
          },
        },
      ),
    ).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code, api_key_id FROM agent_action_audit").get()).toEqual({
      status: "failed",
      error_code: "atomic_batch_failed",
      api_key_id: null,
    });
  });

  it("requires a member to remain active when the owner's share commits", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "member-2", apiKeyId: "key-2", actionName: "share.create", idempotencyKey: "removed-member-share" },
        {
          requestFingerprint: "fp-removed-member-share",
          prepare: (db, auditId) => {
            harness.sqlite.prepare("UPDATE workspace_member SET status = 'revoked' WHERE id = 'membership-1'").run();
            return {
              statement: prepareAtomicShareLinkInsert(db, {
                auditId,
                auditUserId: "member-2",
                apiKeyId: "key-2",
                userId: "owner-1",
                actionName: "share.create",
                idempotencyKey: "removed-member-share",
                requestFingerprint: "fp-removed-member-share",
                resourceType: "collection",
                resourceId: "collection-1",
                ownerResourceType: "collection",
                isSnapshot: false,
                shareId: "removed-member-share-id",
                token: "removed-member-token",
                createdAt: "2026-07-15T10:00:00.000Z",
                expiresAt: "2026-10-13T10:00:00.000Z",
              }),
              result: { ok: true, action: "share.create", share: { id: "removed-member-share-id", token: "removed-member-token" } },
            };
          },
        },
      ),
    ).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code, api_key_id FROM agent_action_audit").get()).toEqual({
      status: "failed",
      error_code: "atomic_batch_failed",
      api_key_id: "key-2",
    });
  });

  it("aborts when an early required effect changes zero even if a later effect changes one", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "client_room.upsert", idempotencyKey: "journey4-early-zero" },
        {
          requestFingerprint: "fp-early-zero",
          prepare: (db) => ({
            statement: [
              db.prepare("INSERT INTO atomic_effect (id, user_id, action_name) SELECT ?, ?, ? WHERE 0")
                .bind("early-zero", "owner-1", "client_room.upsert"),
              db.prepare("INSERT INTO atomic_effect (id, user_id, action_name) VALUES (?, ?, ?)")
                .bind("later-one", "owner-1", "client_room.upsert"),
            ],
            result: { ok: true, action: "client_room.upsert", resourceId: "early-zero" },
          }),
        },
      ),
    ).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code FROM agent_action_audit WHERE idempotency_key = 'journey4-early-zero'").get())
      .toMatchObject({ status: "failed", error_code: "atomic_batch_failed" });
  });

  it.each(["report.share", "client_room.upsert"] as const)(
    "supports the narrow atomic primitive for %s",
    async (actionName) => {
      const harness = createSqliteD1();
      fixtures.push(harness);
      migrate(harness);

      const key = `journey4-${actionName}`;
      const fingerprint = `fp-${actionName}`;
      const result = { ok: true, action: actionName, resourceId: `${actionName}-1` };
      const outcome = await runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName, idempotencyKey: key },
        {
          requestFingerprint: fingerprint,
          prepare: async (db, auditId) => ({
            statement: db
              .prepare(`
                INSERT INTO atomic_effect (id, user_id, action_name)
                SELECT ?, ?, ?
                WHERE EXISTS (
                  SELECT 1 FROM agent_action_audit
                  WHERE id = ? AND user_id = ? AND action_name = ?
                    AND idempotency_key = ? AND status = 'started'
                    AND json_extract(metadata_json, '$.requestFingerprint') = ?
                )
              `)
              .bind(`${actionName}-1`, "owner-1", actionName, auditId, "owner-1", actionName, key, fingerprint),
            result,
          }),
        },
      );

      expect(outcome.result).toEqual(result);
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect").get()).toEqual({ count: 1 });
      expect(harness.sqlite.prepare("SELECT action_name, status FROM agent_action_audit").get()).toEqual({
        action_name: actionName,
        status: "succeeded",
      });
    },
  );

  it("commits client-room refs atomically and rolls back a partial owner miss", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const prepare = vi.fn((db: D1Database, auditId: string) => {
      const prepared = prepareAtomicClientRoomUpsert(db, {
        auditId,
        userId: "owner-1",
        idempotencyKey: "journey4-room-atomic",
        requestFingerprint: "fp-room-atomic",
        roomId: "room-atomic",
        name: "Beauty client",
        clientLabel: "Nykaa",
        status: "active",
        notesJson: '{"goal":"Weekly proof review"}',
        hasNotes: true,
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:00:00.000Z",
        isUpdate: false,
        resourceRefs: [
          {
            resourceType: "collection",
            resourceId: "collection-1",
            ownerResourceType: "collection",
            ownerResourceId: "collection-1",
          },
          {
            resourceType: "watchlist",
            resourceId: "watchlist-1",
            ownerResourceType: "watchlist",
            ownerResourceId: "watchlist-1",
          },
        ],
      });
      return {
        statement: prepared.statements,
        effectExpectations: prepared.effectExpectations,
        resourceType: "client_room",
        resourceId: "room-atomic",
        result: {
          ok: true,
          action: "client_room.upsert",
          room: { id: "room-atomic", resourceRefs: ["collection-1", "watchlist-1"] },
        },
      };
    });

    const first = await runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", actionName: "client_room.upsert", idempotencyKey: "journey4-room-atomic" },
      { requestFingerprint: "fp-room-atomic", prepare },
    );
    const retry = await runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", actionName: "client_room.upsert", idempotencyKey: "journey4-room-atomic" },
      { requestFingerprint: "fp-room-atomic", prepare: vi.fn() },
    );
    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT id, user_id, name FROM client_room").all()).toEqual([
      { id: "room-atomic", user_id: "owner-1", name: "Beauty client" },
    ]);
    expect(harness.sqlite.prepare("SELECT resource_type, resource_id FROM client_room_resource ORDER BY resource_type").all())
      .toEqual([
        { resource_type: "collection", resource_id: "collection-1" },
        { resource_type: "watchlist", resource_id: "watchlist-1" },
      ]);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "member-2", actionName: "client_room.upsert", idempotencyKey: "journey4-room-member" },
        {
          requestFingerprint: "fp-room-member",
          prepare: (db, auditId) => {
            const prepared = prepareAtomicClientRoomUpsert(db, {
              auditId,
              userId: "member-2",
              idempotencyKey: "journey4-room-member",
              requestFingerprint: "fp-room-member",
              roomId: "room-member",
              name: "Member room",
              clientLabel: null,
              status: "active",
              notesJson: "{}",
              hasNotes: false,
              createdAt: "2026-07-15T10:00:00.000Z",
              updatedAt: "2026-07-15T10:00:00.000Z",
              isUpdate: false,
              resourceRefs: [
                {
                  resourceType: "collection",
                  resourceId: "collection-2",
                  ownerResourceType: "collection",
                  ownerResourceId: "collection-2",
                },
                {
                  resourceType: "collection",
                  resourceId: "collection-1",
                  ownerResourceType: "collection",
                  ownerResourceId: "collection-1",
                },
              ],
            });
            return {
              statement: prepared.statements,
              effectExpectations: prepared.effectExpectations,
              result: { ok: true, action: "client_room.upsert", room: { id: "room-member" } },
            };
          },
        },
      ),
    ).rejects.toThrow();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM client_room WHERE id = 'room-member'").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code FROM agent_action_audit WHERE idempotency_key = 'journey4-room-member'").get())
      .toMatchObject({ status: "failed", error_code: "atomic_batch_failed" });
  });

  it("keeps a member audit actor while persisting a client room for the workspace owner", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const prepare = vi.fn((db: D1Database, auditId: string) => {
      const prepared = prepareAtomicClientRoomUpsert(db, {
        auditId,
        auditUserId: "member-2",
        userId: "owner-1",
        idempotencyKey: "member-owner-room",
        requestFingerprint: "fp-member-owner-room",
        roomId: "member-owner-room-id",
        name: "Beauty client",
        clientLabel: "Nykaa",
        status: "active",
        notesJson: "{}",
        hasNotes: true,
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:00:00.000Z",
        isUpdate: false,
        resourceRefs: [{
          resourceType: "collection",
          resourceId: "collection-1",
          ownerResourceType: "collection",
          ownerResourceId: "collection-1",
        }],
      });
      return {
        statement: prepared.statements,
        effectExpectations: prepared.effectExpectations,
        result: { ok: true, action: "client_room.upsert", room: { id: "member-owner-room-id" } },
      };
    });

    const first = await runAtomicAgentAction(
      env(harness),
      { userId: "member-2", actionName: "client_room.upsert", idempotencyKey: "member-owner-room" },
      { requestFingerprint: "fp-member-owner-room", prepare },
    );
    const retry = await runAtomicAgentAction(
      env(harness),
      { userId: "member-2", actionName: "client_room.upsert", idempotencyKey: "member-owner-room" },
      { requestFingerprint: "fp-member-owner-room", prepare: vi.fn() },
    );

    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT user_id FROM client_room").get()).toEqual({ user_id: "owner-1" });
    expect(harness.sqlite.prepare("SELECT user_id FROM client_room_resource").get()).toEqual({ user_id: "owner-1" });
    expect(harness.sqlite.prepare("SELECT user_id FROM agent_action_audit").get()).toEqual({ user_id: "member-2" });
  });

  it("rolls back stale/member-scoped owner misses and terminalizes the audit", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "client_room.upsert", idempotencyKey: "stale" },
        {
          requestFingerprint: "fp-stale",
          prepare: (db, auditId) => ({
            statement: db
              .prepare(`
                INSERT INTO atomic_effect (id, user_id, action_name)
                SELECT ?, ?, ?
                WHERE EXISTS (
                  SELECT 1 FROM agent_action_audit
                  WHERE id = ? AND user_id = ? AND action_name = ?
                    AND idempotency_key = ? AND status = 'started'
                    AND json_extract(metadata_json, '$.requestFingerprint') = ?
                ) AND ? = 'member-2'
              `)
              .bind("stale-effect", "owner-1", "client_room.upsert", auditId, "owner-1", "client_room.upsert", "stale", "fp-stale", "owner-1"),
            result: { ok: true },
          }),
        },
      ),
    ).rejects.toThrow();

    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect WHERE user_id = 'member-2'").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT status, error_code FROM agent_action_audit").get()).toEqual({
      status: "failed",
      error_code: "atomic_batch_failed",
    });
  });

  it("rejects altered fingerprints and does not run a retry effect", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const key = "altered";

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "share.create", idempotencyKey: key },
        {
          requestFingerprint: "fp-one",
          prepare: (db, auditId) => ({
            statement: shareEffect(db, {
              auditId,
              userId: "owner-1",
              actionName: "share.create",
              idempotencyKey: key,
              requestFingerprint: "fp-other",
              shareId: "share-altered",
              token: "token-altered",
            }),
            result: { ok: true, share: { id: "share-altered", token: "token-altered" } },
          }),
        },
      ),
    ).rejects.toThrow();

    const retryPrepare = vi.fn();
    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "share.create", idempotencyKey: key },
        { requestFingerprint: "fp-two", prepare: retryPrepare },
      ),
    ).rejects.toMatchObject({ name: "AgentActionIdempotencyConflictError" });
    expect(retryPrepare).not.toHaveBeenCalled();
  });

  it.each(["share.create", "report.share", "client_room.upsert"] as const)(
    "returns the committed %s result without a fallible post-batch audit read",
    async (actionName) => {
      const harness = createSqliteD1();
      fixtures.push(harness);
      migrate(harness);
      let batchCommitted = false;
      const db = {
        prepare(sql: string) {
          if (batchCommitted && /SELECT\s+\*\s+FROM\s+agent_action_audit/iu.test(sql)) {
            throw new Error("injected post-commit audit read failure");
          }
          return harness.db.prepare(sql);
        },
        async batch(statements: D1PreparedStatement[]) {
          const result = await harness.db.batch(statements as never);
          batchCommitted = true;
          return result;
        },
      } as D1Database;
      const key = `post-commit-${actionName}`;
      const fingerprint = `fp-${key}`;
      const prepare = vi.fn((database: D1Database, auditId: string) => ({
        statement: database
          .prepare(
            `INSERT INTO atomic_effect (id, user_id, action_name)
             SELECT ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM agent_action_audit
               WHERE id = ? AND user_id = ? AND action_name = ?
                 AND idempotency_key = ? AND status = 'started'
                 AND json_extract(metadata_json, '$.requestFingerprint') = ?
             )`,
          )
          .bind(key, "owner-1", actionName, auditId, "owner-1", actionName, key, fingerprint),
        resourceType: actionName === "client_room.upsert" ? "client_room" : "share_link",
        resourceId: key,
        metadata: { ownerUserId: "owner-1" },
        result: { ok: true, action: actionName, resourceId: key },
      }));

      const first = await runAtomicAgentAction(
        { DB: db } as never,
        { userId: "owner-1", actionName, idempotencyKey: key },
        { requestFingerprint: fingerprint, prepare },
      );

      expect(first).toMatchObject({
        replayed: false,
        audit: {
          status: "succeeded",
          resourceId: key,
          metadata: expect.objectContaining({
            ownerUserId: "owner-1",
            requestFingerprint: fingerprint,
          }),
        },
        result: { ok: true, action: actionName, resourceId: key },
      });
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect").get()).toEqual({ count: 1 });
      expect(harness.sqlite.prepare("SELECT status, resource_id FROM agent_action_audit").get()).toEqual({
        status: "succeeded",
        resource_id: key,
      });

      const retry = await runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName, idempotencyKey: key },
        { requestFingerprint: fingerprint, prepare: vi.fn() },
      );
      expect(retry.replayed).toBe(true);
      expect(retry.result).toEqual(first.result);
      expect(prepare).toHaveBeenCalledTimes(1);
    },
  );

  it("fails before preparing the effect when D1 batch is unavailable", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const prepare = vi.fn();
    const dbWithoutBatch = { ...harness.db, batch: undefined } as never;

    await expect(
      runAtomicAgentAction(
        { DB: dbWithoutBatch } as never,
        { userId: "owner-1", actionName: "share.create", idempotencyKey: "journey4-no-batch" },
        { requestFingerprint: "fp-no-batch", prepare },
      ),
    ).rejects.toMatchObject({ name: "AtomicCustomerAgentActionBatchUnavailableError" });
    expect(prepare).not.toHaveBeenCalled();
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 0 });
  });

  it("terminalizes a failed preparation without persisting its internal error", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "report.share", idempotencyKey: "prepare-failure" },
        {
          requestFingerprint: "fp-prepare-failure",
          prepare: async () => {
            throw new Error("internal provider target customer@example.invalid");
          },
        },
      ),
    ).rejects.toThrow("internal provider target");

    const audit = harness.sqlite.prepare(
      "SELECT status, error_code, error_message, result_json FROM agent_action_audit",
    ).get() as Record<string, unknown>;
    expect(audit).toEqual({
      status: "failed",
      error_code: "atomic_prepare_failed",
      error_message: "The action did not complete. Use a new idempotency key to retry.",
      result_json: null,
    });
    expect(JSON.stringify(audit)).not.toContain("customer@example.invalid");
  });

  it("terminalizes invalid post-claim effect assembly as a preparation failure", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "client_room.upsert", idempotencyKey: "invalid-effects" },
        {
          requestFingerprint: "fp-invalid-effects",
          prepare: () => ({
            statement: [],
            result: { ok: true },
          }),
        },
      ),
    ).rejects.toThrow("bounded non-empty statement list");

    expect(harness.sqlite.prepare(
      "SELECT status, error_code, result_json FROM agent_action_audit",
    ).get()).toEqual({
      status: "failed",
      error_code: "atomic_prepare_failed",
      result_json: null,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM atomic_effect").get()).toEqual({ count: 0 });
  });

  it("fails closed when the same idempotency key crosses API-key actors", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const key = "api-key-actor-bound";
    const fingerprint = "fp-api-key-actor-bound";

    await runAtomicAgentAction(
      env(harness),
      {
        userId: "owner-1",
        apiKeyId: "key-1",
        actionName: "share.create",
        idempotencyKey: key,
      },
      {
        requestFingerprint: fingerprint,
        prepare: (db, auditId) => ({
          statement: shareEffect(db, {
            auditId,
            userId: "owner-1",
            actionName: "share.create",
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            shareId: "actor-bound-share",
            token: "actor-bound-token",
          }),
          result: { ok: true, share: { id: "actor-bound-share", token: "actor-bound-token" } },
        }),
      },
    );

    await expect(
      runAtomicAgentAction(
        env(harness),
        {
          userId: "owner-1",
          apiKeyId: "key-2",
          actionName: "share.create",
          idempotencyKey: key,
        },
        { requestFingerprint: fingerprint, prepare: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AgentActionIdempotencyConflictError" });
    expect(harness.sqlite.prepare("SELECT api_key_id, status FROM agent_action_audit").get()).toEqual({
      api_key_id: "key-1",
      status: "succeeded",
    });
  });

  it("terminalizes only a stale started action and never steals a fresh owner", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const stale = new Date(Date.now() - 16 * 60 * 1_000).toISOString();
    const fresh = new Date().toISOString();
    harness.sqlite.prepare(`
      INSERT INTO agent_action_audit (
        id, user_id, api_key_id, action_name, resource_type, resource_id,
        idempotency_key, status, result_json, error_code, error_message,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `).run("stale-audit", "owner-1", "share.create", "stale-key", '{"requestFingerprint":"stale-fp"}', stale, stale);
    harness.sqlite.prepare(`
      INSERT INTO agent_action_audit (
        id, user_id, api_key_id, action_name, resource_type, resource_id,
        idempotency_key, status, result_json, error_code, error_message,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `).run("fresh-audit", "owner-1", "share.create", "fresh-key", '{"requestFingerprint":"fresh-fp"}', fresh, fresh);

    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "share.create", idempotencyKey: "stale-key" },
        { requestFingerprint: "stale-fp", prepare: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AgentActionReplayUnavailableError" });
    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "share.create", idempotencyKey: "fresh-key" },
        { requestFingerprint: "fresh-fp", prepare: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AgentActionReplayUnavailableError" });

    expect(harness.sqlite.prepare(
      "SELECT id, status, error_code FROM agent_action_audit ORDER BY id",
    ).all()).toEqual([
      { id: "fresh-audit", status: "started", error_code: null },
      { id: "stale-audit", status: "failed", error_code: "atomic_stale_started" },
    ]);
  });

  it("re-reads and replays when a stale terminalization loses to concurrent success", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const stale = new Date(Date.now() - 16 * 60 * 1_000).toISOString();
    const result = { ok: true, share: { id: "stale-race-share", token: "stale-race-token" } };
    harness.sqlite.prepare(`
      INSERT INTO agent_action_audit (
        id, user_id, api_key_id, action_name, resource_type, resource_id,
        idempotency_key, status, result_json, error_code, error_message,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `).run(
      "stale-race-audit",
      "owner-1",
      "share.create",
      "stale-race-key",
      '{"requestFingerprint":"stale-race-fp"}',
      stale,
      stale,
    );
    const db = {
      prepare(sql: string) {
        const prepared = harness.db.prepare(sql);
        return {
          bind(...bindings: unknown[]) {
            const bound = prepared.bind(...bindings);
            return {
              async run() {
                if (/SET status = 'failed'/u.test(sql)) {
                  harness.sqlite.prepare(`
                    UPDATE agent_action_audit
                    SET status = 'succeeded', result_json = ?, updated_at = ?
                    WHERE id = 'stale-race-audit' AND status = 'started'
                  `).run(JSON.stringify(result), new Date().toISOString());
                  return { success: true, meta: { changes: 0 } };
                }
                return bound.run();
              },
              all<T>() {
                return bound.all<T>();
              },
              first<T>() {
                return bound.first<T>();
              },
            };
          },
        };
      },
      batch: harness.db.batch,
    } as unknown as D1Database;

    const replay = await runAtomicAgentAction(
      { DB: db } as never,
      { userId: "owner-1", actionName: "share.create", idempotencyKey: "stale-race-key" },
      { requestFingerprint: "stale-race-fp", prepare: vi.fn() },
    );

    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(result);
    expect(harness.sqlite.prepare("SELECT status, error_code FROM agent_action_audit").get()).toEqual({
      status: "succeeded",
      error_code: null,
    });
  });

  it.each(["prepare", "batch"] as const)(
    "retries transient audit terminalization after a %s failure",
    async (failureStage) => {
      const harness = createSqliteD1();
      fixtures.push(harness);
      migrate(harness);
      let terminalizeAttempts = 0;
      const db = {
        prepare(sql: string) {
          const prepared = harness.db.prepare(sql);
          return {
            bind(...bindings: unknown[]) {
              const bound = prepared.bind(...bindings);
              return {
                async run() {
                  if (/SET status = 'failed'/u.test(sql)) {
                    terminalizeAttempts += 1;
                    if (terminalizeAttempts < 3) {
                      throw new Error("injected terminalization outage");
                    }
                  }
                  return bound.run();
                },
                all<T>() {
                  return bound.all<T>();
                },
                first<T>() {
                  return bound.first<T>();
                },
              };
            },
          };
        },
        async batch(statements: D1PreparedStatement[]) {
          if (failureStage === "batch") {
            throw new Error("injected batch failure");
          }
          return harness.db.batch(statements as never);
        },
      } as unknown as D1Database;

      await expect(
        runAtomicAgentAction(
          { DB: db } as never,
          {
            userId: "owner-1",
            actionName: "share.create",
            idempotencyKey: `terminalize-${failureStage}`,
          },
          {
            requestFingerprint: `fp-terminalize-${failureStage}`,
            prepare: (database, auditId) => {
              if (failureStage === "prepare") {
                throw new Error("injected prepare failure");
              }
              return {
                statement: shareEffect(database, {
                  auditId,
                  userId: "owner-1",
                  actionName: "share.create",
                  idempotencyKey: "terminalize-batch",
                  requestFingerprint: "fp-terminalize-batch",
                  shareId: "terminalize-batch-share",
                  token: "terminalize-batch-token",
                }),
                result: { ok: true },
              };
            },
          },
        ),
      ).rejects.toThrow(`injected ${failureStage} failure`);

      expect(terminalizeAttempts).toBe(3);
      expect(harness.sqlite.prepare(
        "SELECT status, error_code FROM agent_action_audit",
      ).get()).toEqual({
        status: "failed",
        error_code: failureStage === "prepare" ? "atomic_prepare_failed" : "atomic_batch_failed",
      });
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 0 });
    },
  );

  it("surfaces bounded recovery and later closes a stranded started audit", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    let terminalizeAttempts = 0;
    const db = {
      prepare(sql: string) {
        const prepared = harness.db.prepare(sql);
        return {
          bind(...bindings: unknown[]) {
            const bound = prepared.bind(...bindings);
            return {
              async run() {
                if (/SET status = 'failed'/u.test(sql)) {
                  terminalizeAttempts += 1;
                  throw new Error("persistent terminalization outage");
                }
                return bound.run();
              },
              all<T>() {
                return bound.all<T>();
              },
              first<T>() {
                return bound.first<T>();
              },
            };
          },
        };
      },
      batch: harness.db.batch,
    } as unknown as D1Database;

    await expect(
      runAtomicAgentAction(
        { DB: db } as never,
        { userId: "owner-1", actionName: "report.share", idempotencyKey: "recovery-pending" },
        {
          requestFingerprint: "fp-recovery-pending",
          prepare: async () => {
            throw new Error("internal prepare failure");
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "AgentActionReplayUnavailableError",
      message: "Action recovery is temporarily unavailable. Retry with the same idempotency key.",
    });
    expect(terminalizeAttempts).toBe(3);
    expect(harness.sqlite.prepare("SELECT status FROM agent_action_audit").get()).toEqual({ status: "started" });

    harness.sqlite.prepare(
      "UPDATE agent_action_audit SET updated_at = ? WHERE idempotency_key = 'recovery-pending'",
    ).run(new Date(Date.now() - 16 * 60 * 1_000).toISOString());
    await expect(
      runAtomicAgentAction(
        env(harness),
        { userId: "owner-1", actionName: "report.share", idempotencyKey: "recovery-pending" },
        { requestFingerprint: "fp-recovery-pending", prepare: vi.fn() },
      ),
    ).rejects.toMatchObject({ name: "AgentActionReplayUnavailableError" });
    expect(harness.sqlite.prepare("SELECT status, error_code FROM agent_action_audit").get()).toEqual({
      status: "failed",
      error_code: "atomic_stale_started",
    });
  });

  it("replays the committed result when the batch response is lost", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const key = "batch-response-loss";
    const fingerprint = "fp-batch-response-loss";
    const db = {
      prepare: harness.db.prepare,
      async batch(statements: D1PreparedStatement[]) {
        await harness.db.batch(statements as never);
        throw new Error("injected batch response loss");
      },
    } as unknown as D1Database;

    const recovered = await runAtomicAgentAction(
      { DB: db } as never,
      { userId: "owner-1", actionName: "share.create", idempotencyKey: key },
      {
        requestFingerprint: fingerprint,
        prepare: (database, auditId) => ({
          statement: shareEffect(database, {
            auditId,
            userId: "owner-1",
            actionName: "share.create",
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            shareId: "response-loss-share",
            token: "response-loss-token",
          }),
          result: { ok: true, share: { id: "response-loss-share", token: "response-loss-token" } },
        }),
      },
    );

    expect(harness.sqlite.prepare("SELECT status FROM agent_action_audit").get()).toEqual({ status: "succeeded" });
    expect(recovered.replayed).toBe(true);
    const replay = await runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", actionName: "share.create", idempotencyKey: key },
      { requestFingerprint: fingerprint, prepare: vi.fn() },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual({
      ok: true,
      share: { id: "response-loss-share", token: "response-loss-token" },
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 1 });
  });

  it("allows one concurrent same-key effect and replays its original result", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const key = "concurrent-same-key";
    const fingerprint = "fp-concurrent-same-key";
    const prepare = vi.fn((db: D1Database, auditId: string) => ({
      statement: shareEffect(db, {
        auditId,
        userId: "owner-1",
        actionName: "share.create",
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        shareId: "concurrent-share",
        token: "concurrent-token",
      }),
      result: { ok: true, share: { id: "concurrent-share", token: "concurrent-token" } },
    }));
    const runAction = () => runAtomicAgentAction(
      env(harness),
      { userId: "owner-1", actionName: "share.create", idempotencyKey: key },
      { requestFingerprint: fingerprint, prepare },
    );

    const concurrent = await Promise.allSettled([runAction(), runAction()]);
    expect(concurrent.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM share_link").get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 1 });

    const replay = await runAction();
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual({
      ok: true,
      share: { id: "concurrent-share", token: "concurrent-token" },
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
