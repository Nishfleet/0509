-- 0048_support_issue.sql — support inbox issue ledger. Issue #7223.
-- Expand-only: one row per GitHub issue the inbox actually opened, so the daily
-- cap counts opened issues instead of stored support reports. A row is deleted
-- again when the GitHub create fails, which is what keeps a failed create from
-- burning a slot.
CREATE TABLE support_issue (
  report_id TEXT PRIMARY KEY NOT NULL,
  from_domain TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_support_issue_from_domain_created_at ON support_issue (from_domain, created_at);
