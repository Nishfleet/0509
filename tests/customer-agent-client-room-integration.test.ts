import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getClientRoom, upsertClientRoom } from "~/lib/data.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

type Harness = ReturnType<typeof createSqliteD1>;
const fixtures: Harness[] = [];

function createHarness() {
  const harness = createSqliteD1();
  fixtures.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE customer_api_key (id TEXT PRIMARY KEY NOT NULL);
  `);
  applyMigration(harness.sqlite, "migrations/0035_agent_action_audit.sql");
  applyMigration(harness.sqlite, "migrations/0037_client_rooms.sql");
  harness.sqlite.exec(`
    CREATE TABLE collection (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE watchlist (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
    INSERT INTO user (id) VALUES ('owner-1');
    INSERT INTO customer_api_key (id) VALUES ('key-1');
    INSERT INTO collection (id, user_id) VALUES ('collection-1', 'owner-1');
    INSERT INTO watchlist (id, user_id) VALUES ('watchlist-1', 'owner-1');
  `);
  return harness;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-16T02:55:00.000Z");
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspaceDataUserId: vi.fn().mockResolvedValue("owner-1"),
  }));
  vi.doMock("~/lib/plan-feature-gate.server", () => ({
    requireCustomerAgentActionFeature: vi.fn().mockResolvedValue({ ok: true, plan: "agency" }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/workspace.server");
  vi.doUnmock("~/lib/plan-feature-gate.server");
  while (fixtures.length > 0) fixtures.pop()?.close();
});

async function seedApprovedRoom(harness: Harness) {
  const approval = {
    evidenceFingerprint: "approved-fingerprint",
    reviewedAt: "2026-07-16T02:50:00.000Z",
  };
  const room = await upsertClientRoom({ DB: harness.db } as never, "owner-1", {
    name: "Beauty client",
    resourceRefs: [{
      resourceType: "collection",
      resourceId: "collection-1",
      label: "Current report",
    }],
    notes: {
      goal: "Weekly proof review",
      reportApprovals: {
        "collection:collection-1": approval,
      },
    },
  });
  expect(room).not.toBeNull();
  return { room: room!, approval };
}

describe("customer-agent client-room approval replay", () => {
  it("preserves the legacy same-name upsert contract without creating a second room", async () => {
    const harness = createHarness();
    const { room } = await seedApprovedRoom(harness);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const context = {
      userId: "owner-1",
      apiKeyId: "key-1",
      idempotencyKey: "room-same-name",
      source: "api_v1" as const,
    };
    const input = {
      name: room.name,
      clientLabel: "Nykaa growth",
      resourceRefs: [{
        resourceType: "watchlist" as const,
        resourceId: "watchlist-1",
        label: "New watch",
      }],
    };

    const first = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const replay = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const stored = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);
    const result = first.result as { room: { id: string; notes: Record<string, unknown> } };

    expect(result.room.id).toBe(room.id);
    expect(result.room.notes).toEqual({ goal: "Weekly proof review" });
    expect(first.audit.result).toEqual(first.result);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(stored).toMatchObject({
      id: room.id,
      clientLabel: "Nykaa growth",
      resourceRefs: input.resourceRefs,
      notes: result.room.notes,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM client_room").get()).toEqual({ count: 1 });
  });

  it("preserves approval when supplied refs are unchanged and advances the CAS timestamp", async () => {
    const harness = createHarness();
    const { room, approval } = await seedApprovedRoom(harness);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const context = {
      userId: "owner-1",
      apiKeyId: "key-1",
      idempotencyKey: "room-same-refs",
      source: "api_v1" as const,
    };
    const input = {
      roomId: room.id,
      expectedUpdatedAt: room.updatedAt,
      name: "Beauty client renamed",
      resourceRefs: room.resourceRefs,
    };

    const first = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const replay = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const stored = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);
    const result = first.result as { room: { notes: Record<string, unknown>; updatedAt: string } };

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(result.room.notes).toEqual({
      goal: "Weekly proof review",
      reportApprovals: {
        "collection:collection-1": approval,
      },
    });
    expect(Date.parse(result.room.updatedAt)).toBeGreaterThan(Date.parse(room.updatedAt));
    expect(first.audit.result).toEqual(first.result);
    expect(replay.result).toEqual(first.result);
    expect(stored?.notes).toEqual(result.room.notes);
    expect(stored?.updatedAt).toBe(result.room.updatedAt);
  });

  it("preserves approval when ordinary notes change without changing refs", async () => {
    const harness = createHarness();
    const { room, approval } = await seedApprovedRoom(harness);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const first = await runCustomerAgentAction(
      { DB: harness.db } as never,
      {
        userId: "owner-1",
        apiKeyId: "key-1",
        idempotencyKey: "room-notes-only",
        source: "api_v1" as const,
      },
      "client_room.upsert",
      {
        roomId: room.id,
        expectedUpdatedAt: room.updatedAt,
        name: room.name,
        notes: { goal: "Monthly evidence review" },
      },
    );
    const stored = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);
    const result = first.result as { room: { notes: Record<string, unknown> } };

    expect(result.room.notes).toEqual({
      goal: "Monthly evidence review",
      reportApprovals: {
        "collection:collection-1": approval,
      },
    });
    expect(stored?.notes).toEqual(result.room.notes);
  });

  it("treats reordered identical refs as the same approved evidence set", async () => {
    const harness = createHarness();
    const { room, approval } = await seedApprovedRoom(harness);
    const withTwoRefs = await upsertClientRoom({ DB: harness.db } as never, "owner-1", {
      roomId: room.id,
      expectedUpdatedAt: room.updatedAt,
      name: room.name,
      resourceRefs: [
        ...room.resourceRefs,
        { resourceType: "watchlist", resourceId: "watchlist-1", label: "Watch" },
      ],
    });
    expect(withTwoRefs).not.toBeNull();
    const reapproved = await upsertClientRoom({ DB: harness.db } as never, "owner-1", {
      roomId: room.id,
      expectedUpdatedAt: withTwoRefs!.updatedAt,
      name: room.name,
      notes: {
        ...withTwoRefs!.notes,
        reportApprovals: {
          "collection:collection-1": approval,
        },
      },
    });
    expect(reapproved).not.toBeNull();
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");

    const first = await runCustomerAgentAction(
      { DB: harness.db } as never,
      {
        userId: "owner-1",
        apiKeyId: "key-1",
        idempotencyKey: "room-reordered-refs",
        source: "api_v1" as const,
      },
      "client_room.upsert",
      {
        roomId: room.id,
        expectedUpdatedAt: reapproved!.updatedAt,
        name: room.name,
        resourceRefs: [...reapproved!.resourceRefs].reverse(),
      },
    );
    const result = first.result as { room: { notes: Record<string, unknown> } };

    expect(result.room.notes).toMatchObject({
      reportApprovals: {
        "collection:collection-1": approval,
      },
    });
  });

  it("routes direct same-name upserts through existing-aware approval and timestamp logic", async () => {
    const harness = createHarness();
    const { room, approval } = await seedApprovedRoom(harness);

    const first = await upsertClientRoom({ DB: harness.db } as never, "owner-1", {
      name: room.name,
      clientLabel: "Nykaa growth",
      resourceRefs: room.resourceRefs,
    });
    const second = await upsertClientRoom({ DB: harness.db } as never, "owner-1", {
      name: room.name,
      clientLabel: "Nykaa monthly",
      resourceRefs: room.resourceRefs,
    });

    expect(first).toMatchObject({
      id: room.id,
      notes: {
        reportApprovals: {
          "collection:collection-1": approval,
        },
      },
    });
    expect(second?.id).toBe(room.id);
    expect(Date.parse(first!.updatedAt)).toBeGreaterThan(Date.parse(room.updatedAt));
    expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM client_room").get()).toEqual({ count: 1 });
  });

  it("invalidates approval when refs genuinely change in the first result, audit, replay, and D1", async () => {
    const harness = createHarness();
    const { room } = await seedApprovedRoom(harness);
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const context = {
      userId: "owner-1",
      apiKeyId: "key-1",
      idempotencyKey: "room-changed-refs",
      source: "api_v1" as const,
    };
    const input = {
      roomId: room.id,
      expectedUpdatedAt: room.updatedAt,
      name: room.name,
      resourceRefs: [{
        resourceType: "watchlist" as const,
        resourceId: "watchlist-1",
        label: "New watch",
      }],
    };

    const first = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const replay = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const stored = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);
    const result = first.result as { room: { notes: Record<string, unknown> } };

    expect(result.room.notes).toEqual({ goal: "Weekly proof review" });
    expect(first.audit.result).toEqual(first.result);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(stored?.notes).toEqual(result.room.notes);
    expect(stored?.resourceRefs).toEqual(input.resourceRefs);
  });

  it("maps a true atomic CAS race to stable stale_write recovery", async () => {
    const harness = createHarness();
    const { room } = await seedApprovedRoom(harness);
    let injectConcurrentWrite = true;
    const racingDb = {
      prepare: harness.db.prepare,
      async batch(statements: D1PreparedStatement[]) {
        if (injectConcurrentWrite) {
          injectConcurrentWrite = false;
          harness.sqlite.prepare("UPDATE client_room SET updated_at = ? WHERE id = ?")
            .run("2026-07-16T02:55:01.000Z", room.id);
        }
        return harness.db.batch(statements as never);
      },
    } as unknown as D1Database;
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const input = {
      roomId: room.id,
      expectedUpdatedAt: room.updatedAt,
      name: "Beauty client concurrently renamed",
      resourceRefs: room.resourceRefs,
    };
    const context = {
      userId: "owner-1",
      apiKeyId: "key-1",
      idempotencyKey: "room-cas-race",
      source: "api_v1" as const,
    };

    await expect(runCustomerAgentAction(
      { DB: racingDb } as never,
      context,
      "client_room.upsert",
      input,
    )).rejects.toMatchObject({ code: "stale_write", status: 409 });
    expect(harness.sqlite.prepare(
      "SELECT status, error_code FROM agent_action_audit WHERE idempotency_key = ?",
    ).get(context.idempotencyKey)).toEqual({ status: "failed", error_code: "stale_write" });

    await expect(runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    )).rejects.toMatchObject({ code: "stale_write", status: 409 });

    const latest = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);
    expect(latest?.name).toBe(room.name);
    const recovered = await runCustomerAgentAction(
      { DB: harness.db } as never,
      { ...context, idempotencyKey: "room-cas-race-recovered" },
      "client_room.upsert",
      {
        ...input,
        expectedUpdatedAt: latest?.updatedAt,
      },
    );
    expect((recovered.result as { room: { id: string; name: string } }).room).toMatchObject({
      id: room.id,
      name: "Beauty client concurrently renamed",
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM client_room").get()).toEqual({ count: 1 });
  });

  it("replays a committed client-room CAS update when the D1 batch response is lost", async () => {
    const harness = createHarness();
    const { room } = await seedApprovedRoom(harness);
    let loseResponse = true;
    const responseLossDb = {
      prepare: harness.db.prepare,
      async batch(statements: D1PreparedStatement[]) {
        const results = await harness.db.batch(statements as never);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("simulated response loss after commit");
        }
        return results;
      },
    } as unknown as D1Database;
    const { runCustomerAgentAction } = await import("~/lib/customer-agent-actions.server");
    const context = {
      userId: "owner-1",
      apiKeyId: "key-1",
      idempotencyKey: "room-response-loss",
      source: "api_v1" as const,
    };
    const input = {
      roomId: room.id,
      expectedUpdatedAt: room.updatedAt,
      name: "Beauty client recovered",
      resourceRefs: room.resourceRefs,
    };

    const recovered = await runCustomerAgentAction(
      { DB: responseLossDb } as never,
      context,
      "client_room.upsert",
      input,
    );
    const replay = await runCustomerAgentAction(
      { DB: harness.db } as never,
      context,
      "client_room.upsert",
      input,
    );
    const stored = await getClientRoom({ DB: harness.db } as never, "owner-1", room.id);

    expect(recovered.replayed).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(recovered.result).toEqual(replay.result);
    expect(stored?.name).toBe("Beauty client recovered");
    expect(harness.sqlite.prepare(
      "SELECT status, error_code FROM agent_action_audit WHERE idempotency_key = ?",
    ).get(context.idempotencyKey)).toEqual({ status: "succeeded", error_code: null });
  });
});
