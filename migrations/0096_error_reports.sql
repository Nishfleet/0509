-- issue #2988: error-reporting sink for degrade-to-honest-state catches.
--
-- Before this table the only failure evidence was Worker logs (console) and
-- the cron-failure email page; a context.catcher (degrade-to-honest-state)
-- that swallowed an error left no durable product-side record. This sink is
-- Worker-native: a plain D1 table written by app/lib/error-report.server.ts,
-- read back by the `/api/observability/error-reports` judge count line (route
-- + reason_code roll-up).
--
-- Additive only (expand): no column drops, no renames. Rollback rolls back
-- code, never data — if the writer code is reverted the table simply goes
-- unread.
CREATE TABLE IF NOT EXISTS error_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  route TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_sample TEXT,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS error_report_created_at_idx
  ON error_report (created_at);

CREATE INDEX IF NOT EXISTS error_report_reason_code_idx
  ON error_report (reason_code, created_at);
