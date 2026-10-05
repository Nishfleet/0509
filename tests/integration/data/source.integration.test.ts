import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readSourceLastGood, readSourceTicks, readWorkspacesWatchingSource } from "../../../app/lib/data/source.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

function insertEntity(id: string, workspaceId: string, domain: string) {
  return env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES (?, ?, 'competitor', ?, 'on', ?)`,
  ).bind(id, workspaceId, domain, NOW);
}

function insertSource(id: string, key: string, kind: string, platform: string) {
  return env.DB.prepare(`INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?, ?, ?, ?, ?)`).bind(
    id,
    key,
    kind,
    platform,
    `plugin-${key}`,
  );
}

function insertWatch(id: string, entityId: string, sourceId: string, isActive = 1) {
  return env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, entityId, sourceId, `${id}.example`, isActive);
}

function insertSnapshot(id: string, watchId: string, fetchedAt: string, itemCount: number) {
  return env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash, item_count) VALUES (?, ?, NULL, ?, ?, ?)`,
  ).bind(id, watchId, fetchedAt, `hash-${id}`, itemCount);
}

beforeEach(async () => {
  for (const table of ["snapshot", "watch", "source", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
  await seedWorkspace("ws-b");
});

describe("readWorkspacesWatchingSource", () => {
  it("returns the workspace ids of active watches, ordered", async () => {
    await env.DB.batch([
      insertEntity("ent-a", "ws-a", "a.example"),
      insertEntity("ent-b", "ws-b", "b.example"),
      insertSource("src-1", "hn", "mentions", "hn"),
      insertWatch("watch-b", "ent-b", "src-1"),
      insertWatch("watch-a", "ent-a", "src-1"),
      insertWatch("watch-off", "ent-a", "src-1", 0),
    ]);
    expect(await readWorkspacesWatchingSource("src-1")).toEqual(["ws-a", "ws-b"]);
    expect(await readWorkspacesWatchingSource("src-none")).toEqual([]);
  });
});

describe("readSourceTicks", () => {
  it("maps the two latest snapshots of each enabled watch into ticks", async () => {
    await env.DB.batch([
      insertEntity("ent-a", "ws-a", "a.example"),
      insertSource("src-1", "hn", "mentions", "hn"),
      insertWatch("watch-a", "ent-a", "src-1"),
      insertSnapshot("sn-1", "watch-a", "2026-09-23T00:00:00Z", 3),
      insertSnapshot("sn-2", "watch-a", "2026-09-24T00:00:00Z", 5),
      insertSnapshot("sn-3", "watch-a", "2026-09-25T00:00:00Z", 7),
    ]);
    expect(await readSourceTicks()).toEqual([
      {
        sourceId: "src-1",
        sourceKey: "hn",
        kind: "mentions",
        platform: "hn",
        watchId: "watch-a",
        fetchedAt: "2026-09-25T00:00:00Z",
        itemCount: 7,
      },
      {
        sourceId: "src-1",
        sourceKey: "hn",
        kind: "mentions",
        platform: "hn",
        watchId: "watch-a",
        fetchedAt: "2026-09-24T00:00:00Z",
        itemCount: 5,
      },
    ]);
  });
});

describe("readSourceLastGood", () => {
  it("returns the latest snapshot with items per source", async () => {
    await env.DB.batch([
      insertEntity("ent-a", "ws-a", "a.example"),
      insertSource("src-1", "hn", "mentions", "hn"),
      insertWatch("watch-a", "ent-a", "src-1"),
      insertSnapshot("sn-1", "watch-a", "2026-09-23T00:00:00Z", 3),
      insertSnapshot("sn-2", "watch-a", "2026-09-24T00:00:00Z", 5),
      insertSnapshot("sn-0", "watch-a", "2026-09-25T00:00:00Z", 0),
    ]);
    expect(await readSourceLastGood()).toEqual(new Map([["src-1", "2026-09-24T00:00:00Z"]]));
  });
});
