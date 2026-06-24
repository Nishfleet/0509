-- Bounded cache for SSRF-safe website identity resolution (search v2).
CREATE TABLE IF NOT EXISTS search_domain_identity_cache (
  registrable_domain TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_domain_identity_expires
  ON search_domain_identity_cache(expires_at);
