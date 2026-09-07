import { describe, expect, it } from "vitest";

import { db } from "./fixtures";

/**
 * Issue #1926: the R2 -> D1 orphan reconciliation persists its R2 list cursor
 * in the `retention_sweep_state` table (migration 0085). This suite applies the
 * repo's real migrations and asserts the new READ and WRITE path for that
 * table — a mocked D1 binding cannot see the real schema.
 */
describe("retention_sweep_state migration (0085)", () => {
  it("writes and reads the orphan-reconcile cursor row", async () => {
    const key = "r2_orphan_reconcile_cursor";

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "first-cursor", "2026-09-07T12:00:00.000Z")
      .run();

    const read = await db()
      .prepare(
        `SELECT cursor_value FROM retention_sweep_state WHERE state_key = ?`,
      )
      .bind(key)
      .all<{ cursor_value: string | null }>();

    expect(read.results[0]?.cursor_value).toBe("first-cursor");

    // Upsert overwrites the single row rather than inserting a duplicate.
    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "second-cursor", "2026-09-07T13:00:00.000Z")
      .run();

    const rows = await db()
      .prepare(`SELECT cursor_value FROM retention_sweep_state WHERE state_key = ?`)
      .bind(key)
      .all<{ cursor_value: string | null }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.cursor_value).toBe("second-cursor");
  });

  it("allows the cursor to be cleared back to null", async () => {
    const key = "r2_orphan_reconcile_cursor";

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           updated_at = excluded.updated_at`,
      )
      .bind(key, "some-cursor", "2026-09-07T12:00:00.000Z")
      .run();

    await db()
      .prepare(
        `INSERT INTO retention_sweep_state (state_key, cursor_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           updated_at = excluded.updated_at`,
      )
      .bind(key, null, "2026-09-07T13:00:00.000Z")
      .run();

    const read = await db()
      .prepare(`SELECT cursor_value FROM retention_sweep_state WHERE state_key = ?`)
      .bind(key)
      .all<{ cursor_value: string | null }>();

    expect(read.results[0]?.cursor_value).toBeNull();
  });
});
