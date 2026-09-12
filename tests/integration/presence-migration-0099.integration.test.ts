import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0099_widen_source_target_connector_gdelt.sql?raw";

/**
 * Issue #3178 — migration 0099 (source_target.connector_id CHECK widened to
 * accept 'gdelt'). Same table-rebuild-with-child-snapshot pattern as 0093;
 * these assertions run the REAL migration statements against the REAL local
 * D1 and assert both:
 *   - the WRITE path: existing rows (including 'rss' from 0093) copy through
 *     unchanged and a 'gdelt' row is now accepted;
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

describe("migration 0099 — source_target CHECK widened for 'gdelt'", () => {
  it("preserves child rows and accepts 'gdelt' after the rebuild", async () => {
    const db = env.DB;
    const id = Math.floor(Math.random() * 1e9).toString();
    const user = `u_${id}`;
    const entity = `te_${id}`;
    const websiteTarget = `stw_${id}`;
    const rssTarget = `str_${id}`;
    const gdeltTarget = `stg_${id}`;
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
      ).bind(websiteTarget, entity, user),
      db.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'rss', 'k', 1, 'c', 'u')`,
      ).bind(rssTarget, entity, user),
      db.prepare(
        `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, canonical_url, url_hash, title, content_hash, revision, observed_at, created_at) VALUES (?, ?, ?, ?, 'website', 'https://x.test', 'h', 't', 'ch', 1, 'o', 'c')`,
      ).bind(item, websiteTarget, entity, user),
      db.prepare(
        `INSERT INTO presence_poll_cursor (source_target_id, updated_at) VALUES (?, 'u')`,
      ).bind(websiteTarget),
      db.prepare(
        `INSERT INTO presence_item_revision (id, presence_item_id, revision, content_hash, title, observed_at, created_at) VALUES (?, ?, 1, 'ch', 't', 'o', 'c')`,
      ).bind(rev, item),
    ]);

    const before = {
      items: await count(db, "presence_item", `WHERE id = '${item}'`),
      cursors: await count(db, "presence_poll_cursor", `WHERE source_target_id = '${websiteTarget}'`),
      revisions: await count(db, "presence_item_revision", `WHERE id = '${rev}'`),
      targets: await count(db, "source_target", `WHERE id IN ('${websiteTarget}', '${rssTarget}')`),
    };
    expect(before.targets).toBe(2);
    expect(before.items).toBe(1);
    expect(before.cursors).toBe(1);
    expect(before.revisions).toBe(1);

    // Apply the real migration statements (the workers-project setup applied
    // the chain through 0099 already in some runs; statements are re-runnable
    // because the rebuild copies current data back).
    await db.batch(statements.map((sql) => db.prepare(sql)));

    // READ + preservation: the rebuilt table kept every row...
    expect(await count(db, "source_target", `WHERE id = '${websiteTarget}' AND connector_id = 'website'`)).toBe(1);
    // ...and every cascaded child row set was snapshotted and restored —
    // without these the rebuild would have wiped presence data.
    expect(await count(db, "presence_item", `WHERE id = '${item}'`)).toBe(1);
    expect(await count(db, "presence_poll_cursor", `WHERE source_target_id = '${websiteTarget}'`)).toBe(1);
    expect(await count(db, "presence_item_revision", `WHERE id = '${rev}'`)).toBe(1);

    // WRITE: 'gdelt' is now accepted by the widened CHECK — this is the
    // mention store WRITE path for mainstream news (issue #3178).
    await db.batch([
      db.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'gdelt', 'acme robotics', 1, 'c', 'u')`,
      ).bind(gdeltTarget, entity, user),
    ]);
    expect(await count(db, "source_target", `WHERE id = '${gdeltTarget}' AND connector_id = 'gdelt'`)).toBe(1);

    // The mention READ path: a gdelt source_target row lists alongside the
    // created presence_items for the same entity.
    const stored = await db
      .prepare(
        `SELECT st.connector_id, te.label FROM source_target st
         JOIN tracked_entity te ON te.id = st.tracked_entity_id
         WHERE st.id = ?`,
      )
      .bind(gdeltTarget)
      .first<{ connector_id: string; label: string }>();
    expect(stored?.connector_id).toBe("gdelt");
    expect(stored?.label).toBe("Fixture");
  });

  it("rejects connector ids outside the widened CHECK", async () => {
    const db = env.DB;
    const id = `rej_${Math.floor(Math.random() * 1e9)}`;
    const user = `u_${id}`;
    const entity = `te_${id}`;
    await db.batch([
      db.prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'U', ?, 1, 'c', 'u')`,
      ).bind(user, `${user}@example.test`),
      db.prepare(
        `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, is_active, created_at, updated_at) VALUES (?, ?, 'competitor', 'Fixture', 1, 'c', 'u')`,
      ).bind(entity, user),
    ]);
    let rejected = false;
    try {
      await db
        .prepare(
          `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'pinterest', 'k', 1, 'c', 'u')`,
        )
        .bind(`st_${id}`, entity, user)
        .run();
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
