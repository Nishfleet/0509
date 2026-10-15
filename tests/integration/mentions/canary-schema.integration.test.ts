import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("canary columns on source and snapshot (#4003 1/6)", () => {
  it("adds canary_query, degraded_reason and last_good_at to source", async () => {
    const info = await env.DB.prepare("PRAGMA table_info(source)").all<{
      name: string;
      type: string;
      notnull: number;
    }>();
    const columns = new Map((info.results ?? []).map((c) => [c.name, c]));

    for (const name of ["canary_query", "degraded_reason", "last_good_at"]) {
      const column = columns.get(name);
      if (!column) throw new Error(`source is missing the ${name} column`);

      expect(column.type, `${name} must be TEXT`).toBe("TEXT");
      expect(column.notnull, `${name} must be nullable`).toBe(0);
    }

    expect(columns.has("canary_expected")).toBe(false);
  });

  it("adds a nullable canary_count to snapshot", async () => {
    const info = await env.DB.prepare("PRAGMA table_info(snapshot)").all<{
      name: string;
      type: string;
      notnull: number;
    }>();
    const column = (info.results ?? []).find((c) => c.name === "canary_count");
    if (!column) throw new Error("snapshot is missing the canary_count column");

    expect(column.type).toBe("INTEGER");
    expect(column.notnull, "canary_count must be nullable").toBe(0);

    const names = (info.results ?? []).map((c) => c.name);
    for (const name of ["id", "watch_id", "fetched_at", "payload_hash", "item_count"]) {
      expect(names).toContain(name);
    }
  });

  it("seeds canary_query = 'google' on the two live mentions sources", async () => {
    const rows = await env.DB.prepare(
      `SELECT key, canary_query FROM source WHERE key IN ('gdelt.doc', 'hn.algolia')`,
    ).all<{ key: string; canary_query: string | null }>();
    const seeded = rows.results ?? [];
    expect(seeded).toHaveLength(2);
    for (const row of seeded) {
      expect(row.canary_query, `${row.key} must carry the seeded canary query`).toBe("google");
    }

    const others = await env.DB.prepare(
      `SELECT count(*) AS n FROM source
       WHERE canary_query IS NOT NULL AND key NOT IN ('gdelt.doc', 'hn.algolia')`,
    ).first<{ n: number }>();
    expect(others?.n).toBe(0);
  });

  it("takes a write and a read on the new columns", async () => {
    const NOW = "2026-09-25T03:00:00.000Z";
    const userId = "user-canary-schema";
    const workspaceId = "ws-canary-schema";
    const entityId = "ent-canary-schema";
    const sourceId = "src_canary_schema";
    const watchId = "watch-canary-schema";

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'canary-schema@example.com', 1, ?, ?)`,
    )
      .bind(userId, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Owner', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(workspaceId, userId, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES (?, ?, 'competitor', 'canary-schema.example', 'Canary Schema', 'on', ?)`,
    )
      .bind(entityId, workspaceId, NOW)
      .run();

    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json, canary_query)
       VALUES (?, 'test.canary', 'mentions', 'test', 'test.canary', 'official_api', 1, '{}', 'google')`,
    )
      .bind(sourceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
       VALUES (?, ?, ?, 'canary-schema.example', 1, '{}')`,
    )
      .bind(watchId, entityId, sourceId)
      .run();

    try {
      await env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count, canary_count)
         VALUES (?, ?, ?, 'hash', 3, 2)`,
      )
        .bind("snap-canary-schema", watchId, NOW)
        .run();

      const snap = await env.DB.prepare(`SELECT item_count, canary_count FROM snapshot WHERE id = ?`)
        .bind("snap-canary-schema")
        .first<{ item_count: number; canary_count: number }>();
      expect(snap?.item_count).toBe(3);
      expect(snap?.canary_count).toBe(2);

      await env.DB.prepare(`UPDATE source SET degraded_reason = 'canary zero', last_good_at = ? WHERE id = ?`)
        .bind(NOW, sourceId)
        .run();

      const source = await env.DB.prepare(`SELECT canary_query, degraded_reason, last_good_at FROM source WHERE id = ?`)
        .bind(sourceId)
        .first<{
          canary_query: string | null;
          degraded_reason: string | null;
          last_good_at: string | null;
        }>();
      expect(source?.canary_query).toBe("google");
      expect(source?.degraded_reason).toBe("canary zero");
      expect(source?.last_good_at).toBe(NOW);

      await env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count)
         VALUES (?, ?, ?, 'hash', 0)`,
      )
        .bind("snap-canary-schema-null", watchId, NOW)
        .run();
      const nullSnap = await env.DB.prepare(`SELECT canary_count FROM snapshot WHERE id = ?`)
        .bind("snap-canary-schema-null")
        .first<{ canary_count: number | null }>();
      expect(nullSnap?.canary_count).toBeNull();
    } finally {
      await env.DB.prepare("DELETE FROM snapshot WHERE watch_id = ?").bind(watchId).run();
      await env.DB.prepare("DELETE FROM watch WHERE id = ?").bind(watchId).run();
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
      await env.DB.prepare("DELETE FROM entity WHERE id = ?").bind(entityId).run();
      await env.DB.prepare("DELETE FROM workspace WHERE id = ?").bind(workspaceId).run();
      await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId).run();
    }
  });
});
