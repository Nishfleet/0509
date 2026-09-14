import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0104_widen_source_target_connector_appstore.sql?raw";

/**
 * Issue #3210 — migration 0104 widens source_target.connector_id CHECK to
 * accept 'appstore'. The widen MUST carry the LIVE prior union: 0102_podcast
 * was applied to production D1 before its code revert, then restored as live
 * history, and 0103_youtube landed on main while this slice was in flight —
 * so production's CHECK accepts 'podcast' AND 'youtube' today. An 0104 CHECK
 * without either would fail the INSERT..SELECT copy on any live row holding
 * it — or, with zero such rows, silently narrow the CHECK and break that
 * connector's reland. Same collision class as 0101_pinterest/0101_appstore;
 * this test is the regression pin.
 *
 * Same table-rebuild convention as 0093/0103: snapshots the three child
 * tables, rebuilds source_target, restores children inside the transaction.
 * These assertions run the REAL migration statements against the REAL local
 * D1 (the workers project already applied the chain in setup; 0104 re-runs
 * idempotently here because it drops its own backup tables) and assert:
 *   - preservation: 'podcast' AND 'youtube' targets written under the live
 *     CHECK — the exact rows the widened copy must not reject — survive, as
 *     do the child rows (presence_item, presence_poll_cursor,
 *     presence_item_revision);
 *   - the WRITE path: 'podcast', 'youtube' AND 'appstore' inserts are all
 *     accepted by the post-rebuild CHECK.
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

describe("migration 0104 — source_target CHECK widened for 'appstore'", () => {
  it("preserves live 'podcast' and 'youtube' rows through the rebuild and accepts 'podcast', 'youtube' and 'appstore' writes after", async () => {
    const db = env.DB;
    const id = Math.floor(Math.random() * 1e9).toString();
    const user = `u_${id}`;
    const entity = `te_${id}`;
    const target = `st_${id}`;
    const podcastTarget = `stp_${id}`;
    const youtubeTarget = `sty_${id}`;
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
      // The live-CHECK rows: production already accepts 'podcast' (0102 is
      // applied history) and 'youtube' (0103 is live on main), so these
      // inserts stand for real production rows.
      db.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'podcast', 'pk', 1, 'c', 'u')`,
      ).bind(podcastTarget, entity, user),
      db.prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'youtube', 'yk', 1, 'c', 'u')`,
      ).bind(youtubeTarget, entity, user),
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

    // apply the real migration statements
    await db.batch(statements.map((sql) => db.prepare(sql)));

    // READ + preservation: the rebuilt table kept every row — including the
    // 'podcast' and 'youtube' rows a CHECK missing either would have rejected.
    expect(await count(db, "source_target", `WHERE id = '${target}' AND connector_id = 'website'`)).toBe(1);
    expect(await count(db, "source_target", `WHERE id = '${podcastTarget}' AND connector_id = 'podcast'`)).toBe(1);
    expect(await count(db, "source_target", `WHERE id = '${youtubeTarget}' AND connector_id = 'youtube'`)).toBe(1);
    expect(await count(db, "presence_item", `WHERE id = '${item}'`)).toBe(1);
    expect(await count(db, "presence_poll_cursor", `WHERE source_target_id = '${target}'`)).toBe(1);
    expect(await count(db, "presence_item_revision", `WHERE id = '${rev}'`)).toBe(1);

    // WRITE: the post-rebuild CHECK accepts 'appstore' (this widen) plus the
    // still-live 'podcast' (0102) and 'youtube' (0103) values.
    await db
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'appstore', 'k', 1, 'c', 'u')`,
      )
      .bind(`sta_${id}`, entity, user)
      .run();
    expect(await count(db, "source_target", `WHERE id = 'sta_${id}' AND connector_id = 'appstore'`)).toBe(1);
    await db
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'podcast', 'pk2', 1, 'c', 'u')`,
      )
      .bind(`stp2_${id}`, entity, user)
      .run();
    expect(await count(db, "source_target", `WHERE id = 'stp2_${id}' AND connector_id = 'podcast'`)).toBe(1);
    await db
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at) VALUES (?, ?, ?, 'youtube', 'yk2', 1, 'c', 'u')`,
      )
      .bind(`sty2_${id}`, entity, user)
      .run();
    expect(await count(db, "source_target", `WHERE id = 'sty2_${id}' AND connector_id = 'youtube'`)).toBe(1);
  });
});
