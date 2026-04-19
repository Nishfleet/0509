PRAGMA foreign_keys = OFF;

-- D1 applies migrations without explicit BEGIN/COMMIT statements here.

CREATE TABLE IF NOT EXISTS discovery_fetch_log (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan')),
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

CREATE INDEX IF NOT EXISTS idx_discovery_fetch_log_provider_created
  ON discovery_fetch_log(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_fetch_log_route_status_created
  ON discovery_fetch_log(route_context, status, created_at DESC);

CREATE TABLE IF NOT EXISTS discovery_cache_entry (
  cache_key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan')),
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

CREATE INDEX IF NOT EXISTS idx_discovery_cache_provider_fetched
  ON discovery_cache_entry(provider, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_cache_query_country
  ON discovery_cache_entry(query_fingerprint, country, updated_at DESC);

CREATE TABLE IF NOT EXISTS discovery_provider_state (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'cache_only', 'demo', 'disabled')),
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
  summary TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL
);
