-- 0054_support_issue.sql — support inbox issue ledger. Issue #7223.
-- Expand-only: one row per GitHub issue the inbox actually opened, so the cap
-- counts opened issues instead of stored support reports. A row is deleted
-- again when the GitHub create fails or throws (fetchOutbound times out at 8s).
-- The cap window is 24 hours sliding from created_at, the same window the
-- per-domain cap already used, not a calendar day. idx_support_issue_created_at
-- covers the global count in that window.
CREATE TABLE support_issue (
  report_id TEXT PRIMARY KEY NOT NULL,
  from_domain TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_support_issue_from_domain_created_at ON support_issue (from_domain, created_at);
CREATE INDEX idx_support_issue_created_at ON support_issue (created_at);
