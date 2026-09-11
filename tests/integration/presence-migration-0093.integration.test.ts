import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0093_widen_source_target_connector_rss.sql?raw";

/**
 * Issue #2461 — migration 0093 (source_target.connector_id CHECK widened to
 * accept 'rss'). SQLite cannot ALTER a CHECK, so the table is rebuilt; D1
 * cascades away child rows on DROP TABLE and honors neither
 * PRAGMA foreign_keys = OFF nor defer_foreign_keys for that cascade, so the
 * migration snapshots the three child tables first and restores them after.
 *
 * These assertions run the REAL migration statements against the REAL local
 * D1 (the workers project already applied the chain in setup; 0093 re-runs
 * idempotently here) and assert both:
 *   - the WRITE path: the old CHECK's rows copy through unchanged and an
 *     'rss' row is now accepted;
 *   - the READ path and data preservation: child rows (presence_item,
 *     presence_poll_cursor, presence_item_revision) survive the rebuild.
 */
const statements = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

async function count(db: typeof env.DB, table: string, where = "") {
  const row = await db.prepare(`SELECT count(*) AS c FROM ${table} ${where}`).first<{ c: number }>();
  return row?.c ?? 0;
}

describe("migration 0093 — source_target CHECK widened for 'rss'", () => {
  it("preserves child rows and accepts 'rss' after the rebuild", async () => {
    const db = env.DB;
    const id = Math.floor(Math.random() * 1e9).toString();
    const user = `u_${id}`;
    const entity = `te_${id}`;
    const target = `st_${id}`;
    const item = `pi_${id}`;
    const rev = `pir_${id}`;
    await db.batch([
      db.prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'U', ?, 1, 'c', 'u')`,
      ).bind(user, `${user}@example.test`),
      db.prepare(
        `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, is_active, created_at, updated_at) VALUES (?, ?, 'competitor', 'Fixture', 1, 'c', 'u')`,
      ).bind(entity, user),
      db.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'website', 'k', 1, 'c', 'u')`,
      ).bind(target, entity, user),
      db.prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at) VALUES (?, ?, ?, ?, 'website', 'https://x.test', 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(item, target, entity, user),
      db.prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, updated_at) VALUES (?, 'u')`,
      ).bind(target),
      db.prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at) VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(rev, item),
    ]);

    const before = {
      items: await count(db, "presence_item", `WHERE id = '${item}'`),
      cursors: await count(db, "presence_poll_cursor", `WHERE source_target_id = '${target}'`),
      revisions: await count(db, "presence_item_revision", `WHERE id = '${rev}'`),
      targets: await count(db, "source_target", `WHERE id = '${target}'`),
    };
    expect(before.targets).toBe(1);
    expect(before.items).toBe(1);
    expect(before.cursors).toBe(1);
    expect(before.revisions).toBe(1);

    // apply the real migration statements
    await db.batch(statements.map((sql) => db.prepare(sql)));

    // READ + preservation: the rebuilt table kept every row...
    expect(await count(db, "source_target", `WHERE id = '${target}' AND connector_id = 'website'`)).toBe(1);
    // ...and every cascaded child row set was restored
    expect(await count(db, "presence_item", `WHERE id = '${item}'`)).toBe(1);
    expect(await count(db, "presence_poll_cursor", `WHERE source_target_id = '${target}'`)).toBe(1);
    expect(await count(db, "presence_item_revision", `WHERE id = '${rev}'`)).toBe(1);

    // WRITE: 'rss' is now accepted by the widened CHECK
    await db
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'rss', 'k', 1, 'c', 'u')`,
      )
      .bind(`str_${id}`, entity, user)
      .run();
    expect(await count(db, "source_target", `WHERE id = 'str_${id}' AND connector_id = 'rss'`)).toBe(1);
  });
});
