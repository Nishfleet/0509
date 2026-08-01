import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("cron failure alert migration", () => {
  it("adds a dedicated throttle table for per-task operator alerts", () => {
    const migration = readFileSync("migrations/0064_cron_failure_alert_throttle.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS cron_failure_alert_throttle");
    expect(migration).toContain("task_key TEXT PRIMARY KEY NOT NULL");
    expect(migration).toContain("last_alerted_at TEXT NOT NULL");
  });

  it("keeps rejected-page evidence separate from accepted throttle state", () => {
    const migration = readFileSync(
      "migrations/0073_cron_failure_alert_attempt_evidence.sql",
      "utf8",
    );
    expect(migration).toContain("ADD COLUMN last_failed_at TEXT");
    expect(migration).toContain("ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0");
  });

  it("moves legacy rejected-page counts out of accepted alert evidence", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0064_cron_failure_alert_throttle.sql");
    db.prepare(`
      INSERT INTO cron_failure_alert_throttle (
        task_key, last_alerted_at, last_error, alert_count
      ) VALUES (?, ?, 'operator_alert_not_sent', ?)
    `).run("scheduled_monitoring", "2026-07-12T06:00:00.000Z", 4);

    applyMigration(db, "migrations/0073_cron_failure_alert_attempt_evidence.sql");

    expect(
      db.prepare(`
        SELECT last_alerted_at, last_failed_at, alert_count, failed_count
        FROM cron_failure_alert_throttle
        WHERE task_key = ?
      `).get("scheduled_monitoring"),
    ).toMatchObject({
      last_alerted_at: "2026-07-12T06:00:00.000Z",
      last_failed_at: "2026-07-12T06:00:00.000Z",
      alert_count: 0,
      failed_count: 4,
    });
  });
});
