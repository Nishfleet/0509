import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CRON_FAILURE_ALERT_THROTTLE_MS } from "~/lib/cron-failure-alert.server";

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
    expect(migration).toContain("ADD COLUMN last_alert_window INTEGER");
    expect(migration).toContain("ADD COLUMN last_pending_at TEXT");
    expect(migration).toContain("ADD COLUMN pending_alert_window INTEGER");
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

  it("backfills the accepted alert idempotency window", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0064_cron_failure_alert_throttle.sql");
    db.prepare(`
      INSERT INTO cron_failure_alert_throttle (
        task_key, last_alerted_at, last_error, alert_count
      ) VALUES (?, ?, 'operator_alert_sent', 1)
    `).run("scheduled_monitoring", "2026-07-12T06:00:00.000Z");

    applyMigration(db, "migrations/0073_cron_failure_alert_attempt_evidence.sql");

    const row = db.prepare(`
      SELECT last_alert_window
      FROM cron_failure_alert_throttle
      WHERE task_key = ?
    `).get("scheduled_monitoring") as { last_alert_window: number };
    expect(row.last_alert_window).toBe(
      Math.floor(Date.parse("2026-07-12T06:00:00.000Z") / CRON_FAILURE_ALERT_THROTTLE_MS),
    );
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM cron_failure_alert_accepted_window
      WHERE task_key = ? AND alert_window = ?
    `).get("scheduled_monitoring", row.last_alert_window)).toEqual({ count: 1 });
  });

  it("preserves older accepted counts as a baseline for unique future windows", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0064_cron_failure_alert_throttle.sql");
    db.prepare(`
      INSERT INTO cron_failure_alert_throttle (
        task_key, last_alerted_at, last_error, alert_count
      ) VALUES (?, ?, 'operator_alert_sent', 4)
    `).run("scheduled_monitoring", "2026-07-12T06:00:00.000Z");

    applyMigration(db, "migrations/0073_cron_failure_alert_attempt_evidence.sql");

    expect(db.prepare(`
      SELECT alert_count, accepted_count_baseline
      FROM cron_failure_alert_throttle
      WHERE task_key = ?
    `).get("scheduled_monitoring")).toEqual({
      alert_count: 4,
      accepted_count_baseline: 3,
    });
  });

  it("does not promote future-dated legacy rows into throttle evidence", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0064_cron_failure_alert_throttle.sql");
    db.exec(`
      INSERT INTO cron_failure_alert_throttle (
        task_key, last_alerted_at, last_error, alert_count
      ) VALUES
        ('future-sent', '2999-01-01T00:00:00.000Z', 'operator_alert_sent', 4),
        ('future-failed', '2999-01-01T00:00:00.000Z', 'operator_alert_not_sent', 3);
    `);

    applyMigration(db, "migrations/0073_cron_failure_alert_attempt_evidence.sql");

    expect(db.prepare(`
      SELECT last_alert_window, accepted_count_baseline
      FROM cron_failure_alert_throttle
      WHERE task_key = 'future-sent'
    `).get()).toEqual({
      last_alert_window: null,
      accepted_count_baseline: 0,
    });
    expect(db.prepare(`
      SELECT last_failed_at, failed_count, alert_count
      FROM cron_failure_alert_throttle
      WHERE task_key = 'future-failed'
    `).get()).toEqual({
      last_failed_at: null,
      failed_count: 0,
      alert_count: 0,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM cron_failure_alert_accepted_window
    `).get()).toEqual({ count: 0 });
  });
});
