import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("cron failure alert migration", () => {
  it("adds a dedicated throttle table for per-task operator alerts", () => {
    const migration = readFileSync("migrations/0064_cron_failure_alert_throttle.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS cron_failure_alert_throttle");
    expect(migration).toContain("task_key TEXT PRIMARY KEY NOT NULL");
    expect(migration).toContain("last_alerted_at TEXT NOT NULL");
  });
});
