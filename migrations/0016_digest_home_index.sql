-- 0016_digest_home_index.sql — Home's newest weekly brief.
--
-- The loader reads one workspace's latest digest
-- (workspace_id, kind = 'weekly', ORDER BY period_end DESC LIMIT 1).
-- Without this index that statement scans digest. Billing is on rows scanned.

CREATE INDEX idx_digest_ws_kind_period ON digest(workspace_id, kind, period_end);
