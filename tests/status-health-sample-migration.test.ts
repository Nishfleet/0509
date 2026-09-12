import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("status health sample migration (0097)", () => {
  it("creates the sample table with its index and CHECK shape", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0097_status_health_sample.sql");

    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'status_health_sample'
    `).all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_status_health_sample_checked_at'
    `).all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);

    // The writer prunes past 7 days in the same batch as the insert, so the
    // checked_at index is what keeps both statements bounded.
    db.prepare(`
      INSERT INTO status_health_sample (id, checked_at, d1_ok, cron_name)
      VALUES (?, ?, ?, ?)
    `).run("s1", "2026-09-12T04:00:00.000Z", 1, "13 * * * *");

    const row = db.prepare(`
      SELECT id, checked_at, d1_ok, cron_name
      FROM status_health_sample WHERE id = 's1'
    `).get() as { id: string; checked_at: string; d1_ok: number; cron_name: string };
    expect(row).toEqual({
      id: "s1",
      checked_at: "2026-09-12T04:00:00.000Z",
      d1_ok: 1,
      cron_name: "13 * * * *",
    });
  });

  it("rejects a d1_ok value outside the 0/1 CHECK", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0097_status_health_sample.sql");

    expect(() =>
      db.prepare(`
        INSERT INTO status_health_sample (id, checked_at, d1_ok, cron_name)
        VALUES (?, ?, ?, ?)
      `).run("bad", "2026-09-12T04:00:00.000Z", 2, "13 * * * *"),
    ).toThrow();
  });

  it("is idempotent via IF NOT EXISTS", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0097_status_health_sample.sql");
    expect(() => applyMigration(db, "migrations/0097_status_health_sample.sql")).not.toThrow();
  });
});
