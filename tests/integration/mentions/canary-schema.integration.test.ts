import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Canary columns on `source` and `snapshot` (#4003 slice 1/6, migration
 * 0018 / docs/engines/mentions.md P5.4), proven against real D1 with the real
 * migrations applied — not a mocked binding, which cannot see the schema.
 *
 * The schema-only slice: `source` gains canary_query (the expected-nonzero
 * flag — a non-null value, not a separate flag column), degraded_reason and
 * last_good_at; `snapshot` gains canary_count. The writers and readers that
 * fill them are later slices of the parent; app/components/source-pill.tsx
 * already reads all three columns.
 *
 * Write/read round trips below run on dedicated test rows and are cleaned up
 * in `finally` — D1 rejects SQL BEGIN/SAVEPOINT (it requires the Durable
 * Object JS transaction API), so an explicit rollback is not available.
 */

describe("canary columns on source and snapshot (#4003 1/6)", () => {
  it("adds canary_query, degraded_reason and last_good_at to source", async () => {
    const info = await env.DB.prepare("PRAGMA table_info(source)").all<{
      name: string;
      type: string;
    }>();
    const columns = new Map((info.results ?? []).map((c) => [c.name, c]));

    for (const name of ["canary_query", "degraded_reason", "last_good_at"]) {
      const column = columns.get(name);
      if (!column) throw new Error(`source is missing the ${name} column`);
      // Nullable TEXT by design: a code rollback must stay safe, so no
      // NOT NULL and no DEFAULT is allowed on this slice.
      expect(column.type, `${name} must be TEXT`).toBe("TEXT");
      expect(column.notnull, `${name} must be nullable`).toBe(0);
    }

    // The flag IS the value: no separate expected-nonzero boolean column may
    // sneak in beside it.
    expect(columns.has("canary_expected")).toBe(false);
  });

  it("adds a nullable canary_count to snapshot", async () => {
    const info = await env.DB.prepare("PRAGMA table_info(snapshot)").all<{
      name: string;
      type: string;
    }>();
    const column = (info.results ?? []).find((c) => c.name === "canary_count");
    if (!column) throw new Error("snapshot is missing the canary_count column");

    expect(column.type).toBe("INTEGER");
    expect(column.notnull, "canary_count must be nullable").toBe(0);

    // The pre-existing snapshot columns are unmoved — the migration only
    // appends.
    const names = (info.results ?? []).map((c) => c.name);
    for (const name of ["id", "watch_id", "fetched_at", "payload_hash", "item_count"]) {
      expect(names).toContain(name);
    }
  });

  it("seeds canary_query = 'google' on the two live mentions sources", async () => {
    // Scoped to the exact keys so ads' parked rows (and any other packet's
    // rows) cannot redden this — and so a stray other-row seed would still
    // be caught by the count.
    const rows = await env.DB.prepare(
      `SELECT key, canary_query FROM source WHERE key IN ('gdelt.doc', 'hn.algolia')`,
    ).all<{ key: string; canary_query: string | null }>();
    const seeded = rows.results ?? [];
    expect(seeded).toHaveLength(2);
    for (const row of seeded) {
      expect(row.canary_query, `${row.key} must carry the seeded canary query`).toBe("google");
    }

    // And exactly those two: every other source row must have the flag left
    // null, because null means "no canary expected".
    const others = await env.DB.prepare(
      `SELECT count(*) AS n FROM source
       WHERE canary_query IS NOT NULL AND key NOT IN ('gdelt.doc', 'hn.algolia')`,
    ).first<{ n: number }>();
    expect(others?.n).toBe(0);
  });

  it("takes a write and a read on the new columns", async () => {
    // Dedicated rows, never the shipped ones, so a failed expectation cannot
    // leak state into the rows the other tests assert against. The chain is
    // user -> workspace -> entity -> watch -> snapshot, because snapshot
    // reaches its canary_count through watch.
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
    // A canary-carrying source row, in the shape 0017 seeds the live ones.
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
      // The write path a later slice implements: a snapshot lands with its
      // canary count beside item_count.
      await env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count, canary_count)
         VALUES (?, ?, ?, 'hash', 3, 2)`,
      )
        .bind("snap-canary-schema", watchId, NOW)
        .run();

      const snap = await env.DB.prepare(
        `SELECT item_count, canary_count FROM snapshot WHERE id = ?`,
      )
        .bind("snap-canary-schema")
        .first<{ item_count: number; canary_count: number }>();
      expect(snap?.item_count).toBe(3);
      expect(snap?.canary_count).toBe(2);

      // Degradation state on the source row: reason plus last-good timestamp,
      // the columns source-pill.tsx reads.
      await env.DB.prepare(
        `UPDATE source SET degraded_reason = 'canary zero', last_good_at = ? WHERE id = ?`,
      )
        .bind(NOW, sourceId)
        .run();

      const source = await env.DB.prepare(
        `SELECT canary_query, degraded_reason, last_good_at FROM source WHERE id = ?`,
      )
        .bind(sourceId)
        .first<{
          canary_query: string | null;
          degraded_reason: string | null;
          last_good_at: string | null;
        }>();
      expect(source?.canary_query).toBe("google");
      expect(source?.degraded_reason).toBe("canary zero");
      expect(source?.last_good_at).toBe(NOW);

      // Null round trip: a fresh snapshot row with no canary taken yet must
      // read back as NULL, not 0 — 0 is "answered, nothing there".
      await env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count)
         VALUES (?, ?, ?, 'hash', 0)`,
      )
        .bind("snap-canary-schema-null", watchId, NOW)
        .run();
      const nullSnap = await env.DB.prepare(
        `SELECT canary_count FROM snapshot WHERE id = ?`,
      )
        .bind("snap-canary-schema-null")
        .first<{ canary_count: number | null }>();
      expect(nullSnap?.canary_count).toBeNull();
    } finally {
      await env.DB.prepare("DELETE FROM snapshot WHERE watch_id = ?").bind(watchId).run();
      await env.DB.prepare("DELETE FROM watch WHERE id = ?").bind(watchId).run();
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
      await env.DB.prepare("DELETE FROM entity WHERE id = ?").bind(entityId).run();
      await env.DB.prepare("DELETE FROM workspace WHERE id = ?").bind(workspaceId).run();
      await env.DB.prepare("DELETE FROM \"user\" WHERE id = ?").bind(userId).run();
    }
  });
});
