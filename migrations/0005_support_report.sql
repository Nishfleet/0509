-- 0005_support_report.sql — support inbox reports table. Issue #4229.

CREATE TABLE support_report (
  id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL,
  from_domain TEXT NOT NULL,
  subject_sha256 TEXT NOT NULL,
  raw TEXT NOT NULL
);

CREATE INDEX idx_support_report_received_at ON support_report (received_at);
