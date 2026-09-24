import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { insertBoardSnapshot, latestBoardSnapshot } from "../../../app/lib/data/snapshot.server";

const USER = "user-snap-hiring";
const WS = "ws-snap-hiring";
const ENTITY = "ent-a";
const SOURCE = "test-snap-hiring";
const WATCH = "w-a";
const PAGE = "p-a";
const NOW = "2026-09-24T02:00:00Z";

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', 'snap-hiring@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Snapshots', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WS, USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', 'a.com', '{}', 'manual', 'on', ?)`,
  )
    .bind(ENTITY, WS, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key)
     VALUES (?, 'test.snap.hiring', 'hiring', 'greenhouse', ?)`,
  )
    .bind(SOURCE, SOURCE)
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key)
     VALUES (?, ?, ?, 'https://boards.greenhouse.io/a')`,
  )
    .bind(WATCH, ENTITY, SOURCE)
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, 'https://a.com/', '2026-09-01T00:00:00Z')`,
  )
    .bind(PAGE, ENTITY)
    .run();
};

const snapshotRows = async () => {
  const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshot WHERE id = ?1")
    .bind("s1")
    .first<{ n: number }>();
  return rows?.n ?? 0;
};

describe("board snapshot reads and writes", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'test-snap-%'");
    await seed();
  });

  it("returns the latest board snapshot before the cutoff and ignores site snapshots", async () => {
    await insertBoardSnapshot({
      id: "s1",
      watchId: WATCH,
      fetchedAt: "2026-09-20T00:00:00Z",
      r2Key: "snapshot/hiring/w-a/s1.json",
      hash: "hash-s1",
      itemCount: 3,
    });
    await insertBoardSnapshot({
      id: "s2",
      watchId: WATCH,
      fetchedAt: "2026-09-22T00:00:00Z",
      r2Key: null,
      hash: "hash-s2",
      itemCount: 5,
    });

    expect(await latestBoardSnapshot(WATCH, "2026-09-23T00:00:00Z")).toEqual({
      id: "s2",
      hash: "hash-s2",
      r2Key: null,
      itemCount: 5,
    });
    expect(await latestBoardSnapshot(WATCH, "2026-09-21T00:00:00Z")).toEqual({
      id: "s1",
      hash: "hash-s1",
      r2Key: "snapshot/hiring/w-a/s1.json",
      itemCount: 3,
    });
    expect(await latestBoardSnapshot(WATCH, "2026-09-19T00:00:00Z")).toBeNull();

    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash)
       VALUES ('s-site', ?1, ?2, '2026-09-22T12:00:00Z', 'h')`,
    )
      .bind(WATCH, PAGE)
      .run();
    expect(await latestBoardSnapshot(WATCH, "2026-09-23T00:00:00Z")).toEqual({
      id: "s2",
      hash: "hash-s2",
      r2Key: null,
      itemCount: 5,
    });
  });

  it("inserting the same board snapshot id twice leaves one row", async () => {
    const row = {
      id: "s1",
      watchId: WATCH,
      fetchedAt: "2026-09-20T00:00:00Z",
      r2Key: "snapshot/hiring/w-a/s1.json",
      hash: "hash-s1",
      itemCount: 3,
    };
    await insertBoardSnapshot(row);
    await insertBoardSnapshot({ ...row, itemCount: 9 });

    expect(await snapshotRows()).toBe(1);
    expect(await latestBoardSnapshot(WATCH, "2026-09-23T00:00:00Z")).toEqual({
      id: "s1",
      hash: "hash-s1",
      r2Key: "snapshot/hiring/w-a/s1.json",
      itemCount: 3,
    });
  });
});
