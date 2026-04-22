PRAGMA foreign_keys = OFF;

CREATE TABLE discovery_fetch_log_new (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan', 'scheduled_warmup')),
  query_fingerprint TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  cache_status TEXT NOT NULL CHECK (cache_status IN ('miss', 'hit', 'stale', 'none')),
  failure_class TEXT CHECK (
    failure_class IN (
      'browser_unavailable',
      'browser_launch_failed',
      'timeout',
      'login_wall',
      'rate_limited',
      'selector_drift',
      'empty_result'
    )
  ),
  browser_ms_used INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO discovery_fetch_log_new (
  id,
  provider,
  route_context,
  query_fingerprint,
  country,
  status,
  cache_status,
  failure_class,
  browser_ms_used,
  metadata_json,
  created_at
)
SELECT
  id,
  provider,
  route_context,
  query_fingerprint,
  country,
  status,
  cache_status,
  failure_class,
  browser_ms_used,
  metadata_json,
  created_at
FROM discovery_fetch_log;

DROP TABLE discovery_fetch_log;
ALTER TABLE discovery_fetch_log_new RENAME TO discovery_fetch_log;

CREATE INDEX idx_discovery_fetch_log_provider_created
  ON discovery_fetch_log(provider, created_at DESC);
CREATE INDEX idx_discovery_fetch_log_route_status_created
  ON discovery_fetch_log(route_context, status, created_at DESC);

CREATE TABLE discovery_cache_entry_new (
  cache_key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan', 'scheduled_warmup')),
  query_fingerprint TEXT NOT NULL,
  country TEXT NOT NULL,
  cursor TEXT,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  browser_ms_used INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO discovery_cache_entry_new (
  cache_key,
  provider,
  route_context,
  query_fingerprint,
  country,
  cursor,
  payload_json,
  fetched_at,
  expires_at,
  browser_ms_used,
  created_at,
  updated_at
)
SELECT
  cache_key,
  provider,
  route_context,
  query_fingerprint,
  country,
  cursor,
  payload_json,
  fetched_at,
  expires_at,
  browser_ms_used,
  created_at,
  updated_at
FROM discovery_cache_entry;

DROP TABLE discovery_cache_entry;
ALTER TABLE discovery_cache_entry_new RENAME TO discovery_cache_entry;

CREATE INDEX idx_discovery_cache_provider_fetched
  ON discovery_cache_entry(provider, fetched_at DESC);
CREATE INDEX idx_discovery_cache_query_country
  ON discovery_cache_entry(query_fingerprint, country, updated_at DESC);

CREATE TABLE IF NOT EXISTS discovery_query_lease (
  cache_key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan', 'scheduled_warmup')),
  holder_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_query_lease_expires
  ON discovery_query_lease(lease_expires_at);
