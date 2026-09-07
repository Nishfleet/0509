PRAGMA defer_foreign_keys = ON;

CREATE TABLE discovery_fetch_log_provider_failure_new (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  route_context TEXT NOT NULL CHECK (route_context IN ('public_search', 'watchlist_scan', 'scheduled_warmup')),
  query_fingerprint TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  cache_status TEXT NOT NULL CHECK (cache_status IN ('miss', 'hit', 'stale', 'none')),
  failure_class TEXT CHECK (
    failure_class IN (
      'provider_unavailable',
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

INSERT INTO discovery_fetch_log_provider_failure_new (
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
ALTER TABLE discovery_fetch_log_provider_failure_new RENAME TO discovery_fetch_log;

CREATE INDEX idx_discovery_fetch_log_provider_created
  ON discovery_fetch_log(provider, created_at DESC);
CREATE INDEX idx_discovery_fetch_log_route_status_created
  ON discovery_fetch_log(route_context, status, created_at DESC);
CREATE INDEX idx_discovery_fetch_log_status_created
  ON discovery_fetch_log(status, created_at DESC);

CREATE TABLE discovery_provider_state_provider_failure_new (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('meta_api', 'meta_library_browser', 'demo')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'cache_only', 'demo', 'disabled')),
  failure_class TEXT CHECK (
    failure_class IN (
      'provider_unavailable',
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

INSERT INTO discovery_provider_state_provider_failure_new (
  provider,
  status,
  failure_class,
  summary,
  last_success_at,
  last_failure_at,
  metadata_json,
  updated_at
)
SELECT
  provider,
  status,
  failure_class,
  summary,
  last_success_at,
  last_failure_at,
  metadata_json,
  updated_at
FROM discovery_provider_state;

DROP TABLE discovery_provider_state;
ALTER TABLE discovery_provider_state_provider_failure_new RENAME TO discovery_provider_state;

PRAGMA defer_foreign_keys = OFF;
