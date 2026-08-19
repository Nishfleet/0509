-- Append-only browser-job attribution telemetry (0509 browser attribution first).
--
-- One row per browser-capable job attempt (or cache/API serve that replaced a
-- browser run). The existing discovery_fetch_log cannot carry this contract:
-- its CHECKs pin provider/route_context/status to the discovery surface, and
-- landing_snapshot / report_pdf jobs never touch it. This table is write-only
-- from the product path; queries live in the operator surface. Retention is
-- aligned with discovery_fetch_log: the retention sweep deletes rows older
-- than 30 days via the created_at index (see app/lib/retention.server.ts).
--
-- Bounds: every persisted text field is length/format CHECKed here and again
-- fail-closed in the writer (app/lib/browser-job-telemetry.server.ts), so raw
-- cursors, URLs, tokens, query text, or oversized values cannot be stored.

CREATE TABLE IF NOT EXISTS browser_job_telemetry (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 8 AND 64),
  -- Correlation id for one job (chain of attempts). Random per top-level
  -- request; never a raw token/URL.
  job_id TEXT NOT NULL CHECK (length(job_id) BETWEEN 8 AND 64),
  -- Stable SHA-256 fingerprint used for idempotent correlation; documented
  -- scope in app/lib/browser-job-telemetry.server.ts. Never a raw token/URL/
  -- cursor (writer rejects anything outside the bounded format below).
  idempotency_key TEXT CHECK (
    idempotency_key IS NULL
    OR (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key GLOB '[A-Za-z0-9:_-]*'
    )
  ),
  job_kind TEXT NOT NULL CHECK (
    job_kind IN ('meta_discovery', 'landing_snapshot', 'report_pdf')
  ),
  actual_provider TEXT NOT NULL CHECK (
    actual_provider IN (
      'plain_http',
      'customer_meta_api',
      'cloudflare_browser_run',
      'cloudflare_quick_actions',
      'browserless_bql',
      'cache'
    )
  ),
  route_context TEXT NOT NULL CHECK (
    length(route_context) BETWEEN 1 AND 64
    AND route_context IN (
      'public_search',
      'watchlist_scan',
      'scheduled_warmup',
      'selection_enrichment',
      'proof_capture',
      'share_pdf'
    )
  ),
  plan_tier TEXT CHECK (plan_tier IS NULL OR plan_tier IN ('free', 'scout', 'starter', 'agency')),
  source TEXT NOT NULL CHECK (source IN ('scheduled', 'manual', 'background', 'api', 'unknown')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  started_at TEXT NOT NULL CHECK (length(started_at) BETWEEN 20 AND 40),
  ended_at TEXT CHECK (ended_at IS NULL OR length(ended_at) BETWEEN 20 AND 40),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- Provider-reported browser milliseconds (e.g. X-Browser-Ms-Used) when the
  -- provider reports one; otherwise null.
  browser_ms_used INTEGER CHECK (browser_ms_used IS NULL OR browser_ms_used >= 0),
  cache_status TEXT CHECK (cache_status IS NULL OR cache_status IN ('miss', 'hit', 'stale', 'none')),
  cache_age_ms INTEGER CHECK (cache_age_ms IS NULL OR cache_age_ms >= 0),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('succeeded', 'empty', 'blocked', 'rate_limited', 'timeout', 'failed', 'degraded')
  ),
  result_count INTEGER CHECK (result_count IS NULL OR result_count >= 0),
  result_bytes INTEGER CHECK (result_bytes IS NULL OR result_bytes >= 0),
  worker_version TEXT CHECK (worker_version IS NULL OR length(worker_version) BETWEEN 1 AND 128),
  cron_task TEXT CHECK (cron_task IS NULL OR (length(cron_task) BETWEEN 1 AND 64 AND cron_task GLOB '[A-Za-z0-9._-]*')),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40)
);

CREATE INDEX idx_browser_job_telemetry_kind_provider_created
  ON browser_job_telemetry(job_kind, actual_provider, created_at DESC);
CREATE INDEX idx_browser_job_telemetry_kind_created
  ON browser_job_telemetry(job_kind, created_at DESC);
CREATE INDEX idx_browser_job_telemetry_created
  ON browser_job_telemetry(created_at DESC);
