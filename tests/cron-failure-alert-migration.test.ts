import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
});
