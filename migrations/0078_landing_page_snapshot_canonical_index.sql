CREATE INDEX IF NOT EXISTS idx_landing_page_snapshot_canonical_captured
  ON landing_page_snapshot(canonical_url, captured_at);
