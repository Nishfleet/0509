import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

// Gate C (api.launch-readiness.canary) asserts on every production deploy that
// the e2e test-mode sentinel is OFF, and since #2354 an unreadable sentinel
// fails closed. The table only ever existed in the local e2e fixture, so every
// deploy after #2354 deployed, failed Gate C on
// e2e_test_mode_sentinel_unreadable and rolled back (run 34581070289,
// 2026-09-11). Migration 0094 gives production the row the canary reads.
const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("e2e_test_mode sentinel migration (0094)", () => {
  it("creates the sentinel row the launch-readiness canary reads, with test mode OFF", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0094_e2e_test_mode_sentinel.sql");

    // The exact query the canary and e2e-auth guards run in production.
    const row = db
      .prepare("SELECT enabled FROM e2e_test_mode WHERE id = ? LIMIT 1")
      .get("local-authenticated") as { enabled: number } | undefined;
    expect(row).toEqual({ enabled: 0 });
  });

  it("is idempotent and never flips an existing sentinel", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0094_e2e_test_mode_sentinel.sql");
    // A local e2e database carries the fixture's enabled = 1; re-applying the
    // migration must not overwrite it (INSERT OR IGNORE), and must not fail.
    db.prepare("UPDATE e2e_test_mode SET enabled = 1 WHERE id = ?").run("local-authenticated");
    applyMigration(db, "migrations/0094_e2e_test_mode_sentinel.sql");
    const row = db
      .prepare("SELECT enabled FROM e2e_test_mode WHERE id = ?")
      .get("local-authenticated") as { enabled: number };
    expect(row.enabled).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM e2e_test_mode").get() as { n: number }).n,
    ).toBe(1);
  });

  it("matches the local fixture's schema exactly so both databases answer the same query", () => {
    const migration = readFileSync("migrations/0094_e2e_test_mode_sentinel.sql", "utf8");
    const fixture = readFileSync("e2e/fixtures/e2e-local.sql", "utf8");
    for (const column of ["id TEXT PRIMARY KEY", "enabled INTEGER NOT NULL", "created_at TEXT NOT NULL"]) {
      expect(migration).toContain(column);
      expect(fixture).toContain(column);
    }
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS e2e_test_mode");
    expect(migration).toContain("INSERT OR IGNORE INTO e2e_test_mode");
  });
});
