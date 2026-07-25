import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

// @ts-ignore JavaScript release helper is intentionally imported as a runtime module.
import { runLocalD1ScratchRestore } from "../scripts/e2e-local-restore-drill.mjs";

describe("local D1 scratch restore drill", () => {
  it("dumps, transforms, restores, compares, and removes the scratch database", () => {
    const root = mkdtempSync(join(tmpdir(), "0509-e2e-restore-test-"));
    const persistPath = join(root, "persist");
    const databaseDirectory = join(persistPath, "v3/d1/miniflare-D1DatabaseObject");
    mkdirSync(databaseDirectory, { recursive: true });
    const databasePath = join(databaseDirectory, "fixture.sqlite");
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
        CREATE TABLE user_plan (
          user_id TEXT PRIMARY KEY,
          plan TEXT NOT NULL,
          dodo_payment_id TEXT,
          dodo_subscription_id TEXT,
          dodo_customer_id TEXT
        );
        CREATE TABLE proof (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES user_plan(user_id),
          body TEXT NOT NULL
        );
        INSERT INTO d1_migrations VALUES (1, '0001_fixture.sql', '2026-07-15T00:00:00.000Z');
        INSERT INTO user_plan VALUES ('user-1', 'starter', 'pay-1', 'sub-1', 'cus-1');
        INSERT INTO proof VALUES ('proof-1', 'user-1', 'before and after');
      `);
    } finally {
      database.close();
    }

    try {
      const evidence = runLocalD1ScratchRestore({ persistPath, outputRoot: root });
      expect(evidence).toMatchObject({
        integrity: "ok",
        foreignKeyViolations: 0,
        exactRowCounts: true,
        dodoLinkagePreserved: true,
        scratchDatabaseRemoved: true,
        migrations: 1,
        latestMigrationId: 1,
        planRows: 1,
        linkedPlanRows: 1,
      });
      expect(evidence.tableCount).toBe(3);
      expect(evidence.totalRows).toBe(3);
      expect(evidence.maximumStatementBytes).toBeLessThanOrEqual(90_000);
      expect(evidence.sourceDumpSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(evidence.transformedSqlSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
