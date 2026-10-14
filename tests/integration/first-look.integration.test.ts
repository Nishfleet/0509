import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readFirstLook } from "../../app/lib/data/first_look.server";

const WS = "ws-look";

describe("first look reader", () => {
  beforeEach(async () => {
    for (const table of ["snapshot", "page", "watch", "entity", "source", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES ('u-look', 'U', 'look@example.test', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
         VALUES (?, 'W', 'u-look', 'UTC', '2026-10-01T00:00:00Z')`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-look', 'look-site', 'site', 'web', 'site', 'scraped_page')`,
      ),
      ...[
        ["ent-a", "competitor", "Acme", "on", "2026-10-02T00:00:00Z"],
        ["ent-b", "competitor", "", "on", "2026-10-03T00:00:00Z"],
        ["ent-off", "competitor", "Paused", "off", "2026-10-04T00:00:00Z"],
        ["ent-self", "self", "Me", "on", "2026-10-01T00:00:00Z"],
      ].map(([id, role, name, state, createdAt]) =>
        env.DB.prepare(
          `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
           VALUES (?1, ?2, ?3, ?1 || '.example', ?4, '{}', 'manual', ?5, ?6)`,
        ).bind(id, WS, role, name, state, createdAt),
      ),
      env.DB.prepare(
        `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-a', 'ent-a', 'src-look', 'home')`,
      ),
      env.DB.prepare(
        `INSERT INTO page (id, entity_id, url, discovered_at) VALUES ('pg-1', 'ent-a', 'https://a.example/', '2026-10-14T10:00:00Z'), ('pg-2', 'ent-a', 'https://a.example/pricing', '2026-10-14T10:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES
         ('sn-1', 'w-a', 'pg-1', '2026-10-14T10:00:00Z', 'h1'),
         ('sn-2', 'w-a', 'pg-2', '2026-10-14T10:05:00Z', 'h2'),
         ('sn-3', 'w-a', 'pg-2', '2026-10-14T11:00:00Z', 'h3')`,
      ),
    ]);
  });

  it("lists each tracked rival once with distinct pages read and the latest read", async () => {
    expect(await readFirstLook(WS)).toEqual([
      { id: "ent-a", name: "Acme", pages: 2, checkedAt: "2026-10-14T11:00:00Z", blocked: false },
      { id: "ent-b", name: "ent-b.example", pages: 0, checkedAt: null, blocked: false },
    ]);
  });

  it("marks a rival whose home page was refused a read", async () => {
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at, deferred_at) VALUES ('pg-b', 'ent-b', 'https://b.example/', 'home', '2026-10-14T10:00:00Z', '2026-10-14T10:30:00Z')`,
    ).run();
    const rows = await readFirstLook(WS);
    expect(rows.find((row) => row.id === "ent-b")?.blocked).toBe(true);
    expect(rows.find((row) => row.id === "ent-a")?.blocked).toBe(false);
  });

  it("never lists another workspace's rivals", async () => {
    expect(await readFirstLook("ws-other")).toEqual([]);
  });
});
