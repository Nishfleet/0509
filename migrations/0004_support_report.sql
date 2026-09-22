-- 0004_support_report.sql — raw support mail, issue #4229 (parent #4226).
-- Contract: docs/USER-REPORTS.md.
--
-- Expand-only: a new table. The Worker already running does not read it, so
-- applying this file does not change that version. D1 has no down-migration.
-- There is no DROP of an existing table here.

CREATE TABLE support_report (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  from_domain TEXT NOT NULL,
  subject_sha256 TEXT NOT NULL,
  raw TEXT NOT NULL
);

-- The nightly delete and the 90-day read both filter on received_at.
CREATE INDEX idx_support_report_received_at ON support_report(received_at);
