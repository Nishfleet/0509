-- Reverse artifact-key lookups for R2-backed proof and landing-page storage.
-- Normal reads start from user/watchlist records, but these indexes make
-- operational cleanup and support lookup by known R2 object key instant.

CREATE INDEX IF NOT EXISTS idx_landing_page_snapshot_artifact_key
  ON landing_page_snapshot(artifact_key)
  WHERE artifact_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proof_capture_html_artifact_key
  ON proof_capture(html_artifact_key)
  WHERE html_artifact_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proof_capture_screenshot_artifact_key
  ON proof_capture(screenshot_artifact_key)
  WHERE screenshot_artifact_key IS NOT NULL;
