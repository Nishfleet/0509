-- Competitor-site monitoring storage foundation.
--
-- Scope: three durable concepts owned by the run-level scan lifecycle:
--
--   1. website_site_scan — the run-level manifest, exactly one row per
--      watchlist_run. Carries owner (derived from watchlist.user_id), root
--      URL, lifecycle status (running|complete|partial|failed), the explicit
--      inventory_complete flag, discovered/sitemap-document/fetched counts,
--      the bounded page policy/cursor/inventory-hash fields, failure code,
--      started/finalized timestamps, and the processing-token fence that
--      created it.
--
--   2. website_site_scan_page — the full page inventory for a scan, unique
--      by scan + canonical URL. A complete manifest plus these rows is the
--      only removal/addition inventory baseline. An empty complete scan is
--      still a complete baseline through the manifest alone.
--
--   3. website_page_observation — one row per canonical URL actually fetched
--      by the rotating batch, unique by run + canonical URL. Content hash and
--      structured signals are nullable so failed/skipped fetches remain
--      representable; fetched observations carry the versioned snapshot.
--
-- No crawler, orchestration, delivery, or AI behavior lives here. Event
-- vocabulary: watch_event and event_candidate are rebuilt with three new
-- website_page_* event types, preserving every existing column, value, and
-- row (repository table-rebuild convention, PRAGMA foreign_keys = OFF/ON as
-- established by 0002/0007/0008/0009/0019; 0007 rebuilt these same tables).
-- The rebuild is proven safe by the populated-chain test in
-- tests/competitor-site-monitoring-migration.test.ts: legacy rows survive
-- with identical values and PRAGMA foreign_key_check is clean, so the
-- established foreign_keys = OFF/ON convention is preferred over
-- defer_foreign_keys here.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- watch_event: extend the confirmed-event vocabulary.
-- ---------------------------------------------------------------------------

CREATE TABLE watch_event_site_monitoring_next (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ad_new',
      'ad_inactive',
      'landing_page_url_changed',
      'landing_page_headline_changed',
      'landing_page_offer_changed',
      'landing_page_cta_changed',
      'landing_page_form_changed',
      'website_page_added',
      'website_page_removed',
      'website_page_changed'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'detected',
      'proof_pending',
      'confirmed',
      'proof_failed',
      'suppressed',
      'invalidated'
    )
  ) DEFAULT 'confirmed',
  importance_score INTEGER NOT NULL DEFAULT 0,
  ad_id TEXT,
  baseline_from_run_id TEXT,
  candidate_id TEXT,
  proof_capture_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  confirmed_at TEXT,
  suppressed_at TEXT,
  invalidated_at TEXT,
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL,
  FOREIGN KEY (baseline_from_run_id) REFERENCES watchlist_run(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_id) REFERENCES event_candidate(id) ON DELETE SET NULL,
  FOREIGN KEY (proof_capture_id) REFERENCES proof_capture(id) ON DELETE SET NULL
);

INSERT INTO watch_event_site_monitoring_next (
  id,
  watchlist_id,
  run_id,
  event_type,
  status,
  importance_score,
  ad_id,
  baseline_from_run_id,
  candidate_id,
  proof_capture_id,
  title,
  summary,
  metadata_json,
  confirmed_at,
  suppressed_at,
  invalidated_at,
  last_evaluated_at,
  created_at
)
SELECT
  id,
  watchlist_id,
  run_id,
  event_type,
  status,
  importance_score,
  ad_id,
  baseline_from_run_id,
  candidate_id,
  proof_capture_id,
  title,
  summary,
  metadata_json,
  confirmed_at,
  suppressed_at,
  invalidated_at,
  last_evaluated_at,
  created_at
FROM watch_event;

DROP TABLE watch_event;
ALTER TABLE watch_event_site_monitoring_next RENAME TO watch_event;

CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_created
  ON watch_event(watchlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_status_created
  ON watch_event(watchlist_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_event_run ON watch_event(run_id);
CREATE INDEX IF NOT EXISTS idx_watch_event_baseline_run
  ON watch_event(baseline_from_run_id) WHERE baseline_from_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- event_candidate: same vocabulary extension so candidates and confirmed
-- events stay in sync (candidates feed confirmed events via watch_event).
-- ---------------------------------------------------------------------------

CREATE TABLE event_candidate_site_monitoring_next (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ad_new',
      'ad_inactive',
      'landing_page_url_changed',
      'landing_page_headline_changed',
      'landing_page_offer_changed',
      'landing_page_cta_changed',
      'landing_page_form_changed',
      'website_page_added',
      'website_page_removed',
      'website_page_changed'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'detected',
      'proof_pending',
      'confirmed',
      'proof_failed',
      'suppressed',
      'invalidated'
    )
  ) DEFAULT 'detected',
  importance_score INTEGER NOT NULL DEFAULT 0,
  ad_id TEXT,
  proof_target_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  proof_required INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT CHECK (
    skip_reason IN (
      'skipped_due_to_budget',
      'skipped_due_to_rate_limit',
      'skipped_due_to_dedupe'
    )
  ),
  dedupe_reason TEXT CHECK (
    dedupe_reason IN (
      'candidate_duplicate',
      'proof_duplicate',
      'delivery_duplicate'
    )
  ),
  detected_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL
);

INSERT INTO event_candidate_site_monitoring_next (
  id,
  watchlist_id,
  run_id,
  event_type,
  status,
  importance_score,
  ad_id,
  proof_target_id,
  title,
  summary,
  metadata_json,
  proof_required,
  skip_reason,
  dedupe_reason,
  detected_at,
  last_evaluated_at,
  created_at,
  updated_at
)
SELECT
  id,
  watchlist_id,
  run_id,
  event_type,
  status,
  importance_score,
  ad_id,
  proof_target_id,
  title,
  summary,
  metadata_json,
  proof_required,
  skip_reason,
  dedupe_reason,
  detected_at,
  last_evaluated_at,
  created_at,
  updated_at
FROM event_candidate;

DROP TABLE event_candidate;
ALTER TABLE event_candidate_site_monitoring_next RENAME TO event_candidate;

CREATE INDEX IF NOT EXISTS idx_event_candidate_watchlist_status_detected
  ON event_candidate(watchlist_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_candidate_run ON event_candidate(run_id);

-- ---------------------------------------------------------------------------
-- website_site_scan: one manifest per watchlist_run.
--
-- workspace_id is derived from watchlist.user_id (this repo has no separate
-- workspace table; the user account IS the workspace) and is never accepted
-- from callers. processing_token is the durable lease fence: every write
-- executes only while the owning watchlist_run is running with this exact
-- token, and a stale/reclaimed token fails with no mutation.
-- ---------------------------------------------------------------------------

CREATE TABLE website_site_scan (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  watchlist_id TEXT NOT NULL,
  watchlist_run_id TEXT NOT NULL UNIQUE,
  root_url TEXT NOT NULL CHECK (length(root_url) <= 2048),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'complete', 'partial', 'failed')
  ),
  inventory_complete INTEGER NOT NULL DEFAULT 0 CHECK (inventory_complete IN (0, 1)),
  discovered_page_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_page_count >= 0),
  sitemap_document_count INTEGER NOT NULL DEFAULT 0 CHECK (sitemap_document_count >= 0),
  fetched_page_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_page_count >= 0),
  page_budget INTEGER NOT NULL CHECK (page_budget >= 1 AND page_budget <= 5000),
  scan_cursor TEXT CHECK (scan_cursor IS NULL OR length(scan_cursor) <= 512),
  inventory_hash TEXT CHECK (inventory_hash IS NULL OR length(inventory_hash) <= 128),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) <= 64),
  processing_token TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  CHECK ((status = 'running') = (finalized_at IS NULL)),
  CHECK (status != 'complete' OR inventory_complete = 1),
  CHECK (status = 'complete' OR inventory_complete = 0),
  CHECK (status != 'failed' OR failure_code IS NOT NULL),
  CHECK (status = 'failed' OR failure_code IS NULL)
);

-- Baseline lookups: latest complete manifest per watchlist by run start.
CREATE INDEX IF NOT EXISTS idx_website_site_scan_watchlist_status_started
  ON website_site_scan(watchlist_id, status, started_at DESC);

-- FK-support index (user retention sweeps delete user rows).
CREATE INDEX IF NOT EXISTS idx_website_site_scan_workspace
  ON website_site_scan(workspace_id);

-- ---------------------------------------------------------------------------
-- website_site_scan_page: the full inventory of a scan.
--
-- Unique by scan + canonical URL. Stable order keeps listings deterministic
-- across retries. A complete manifest plus these rows is the only
-- removal/addition inventory baseline; zero rows is a valid complete
-- inventory.
--
-- Discovery sources are the small deterministic vocabulary: seed/high-signal
-- (watchlist_seed), robots-declared sitemap (robots_declared_sitemap),
-- conventional sitemap (conventional_sitemap), and sitemap content
-- (sitemap_content).
-- ---------------------------------------------------------------------------

CREATE TABLE website_site_scan_page (
  id TEXT PRIMARY KEY NOT NULL,
  site_scan_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) <= 2048),
  discovery_source TEXT NOT NULL CHECK (
    discovery_source IN (
      'watchlist_seed',
      'robots_declared_sitemap',
      'conventional_sitemap',
      'sitemap_content'
    )
  ),
  page_kind TEXT NOT NULL CHECK (
    page_kind IN (
      'home',
      'pricing',
      'changelog',
      'landing',
      'product',
      'blog',
      'docs',
      'about',
      'contact',
      'other'
    )
  ),
  stable_order INTEGER NOT NULL CHECK (stable_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_scan_id) REFERENCES website_site_scan(id) ON DELETE CASCADE
);

-- One canonical inventory row per scan: retries converge on a single row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_website_site_scan_page_scan_url
  ON website_site_scan_page(site_scan_id, canonical_url);

-- Deterministic inventory listing order (stable_order, then URL).
CREATE INDEX IF NOT EXISTS idx_website_site_scan_page_scan_order
  ON website_site_scan_page(site_scan_id, stable_order, canonical_url);

-- ---------------------------------------------------------------------------
-- website_page_observation: one row per canonical URL actually fetched by the
-- rotating batch, unique by run + canonical URL.
--
-- content_hash, excerpt, normalizer_version, and signals_json are nullable so
-- failed/skipped fetches remain representable without fabricated content; a
-- fetched observation must carry a content hash (schema-enforced) and the
-- versioned structured snapshot (data-layer enforced). Signals_json is the
-- bounded versioned structured snapshot: title, meta, visible-text
-- hash/excerpt, offer/price, CTA, and form state. The discovery_source
-- vocabulary matches website_site_scan_page.
-- ---------------------------------------------------------------------------

CREATE TABLE website_page_observation (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  watchlist_id TEXT NOT NULL,
  watchlist_run_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) <= 2048),
  discovery_source TEXT NOT NULL CHECK (
    discovery_source IN (
      'watchlist_seed',
      'robots_declared_sitemap',
      'conventional_sitemap',
      'sitemap_content'
    )
  ),
  page_kind TEXT NOT NULL CHECK (
    page_kind IN (
      'home',
      'pricing',
      'changelog',
      'landing',
      'product',
      'blog',
      'docs',
      'about',
      'contact',
      'other'
    )
  ),
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) <= 128),
  excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 1000),
  proof_capture_id TEXT,
  fetch_status TEXT NOT NULL CHECK (
    fetch_status IN ('fetched', 'redirected', 'fetch_failed', 'skipped')
  ),
  http_status INTEGER CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
  fetch_error_code TEXT CHECK (fetch_error_code IS NULL OR length(fetch_error_code) <= 64),
  normalizer_version TEXT CHECK (normalizer_version IS NULL OR length(normalizer_version) <= 64),
  signals_json TEXT CHECK (signals_json IS NULL OR length(signals_json) <= 12000),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (proof_capture_id) REFERENCES proof_capture(id) ON DELETE SET NULL,
  -- A successful fetch must have content to hash; failed/skipped fetches may
  -- have none.
  CHECK (fetch_status != 'fetched' OR content_hash IS NOT NULL)
);

-- One canonical observation per watchlist run: retries and re-fetches within
-- the same run must converge on a single row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_website_page_observation_run_url
  ON website_page_observation(watchlist_id, watchlist_run_id, canonical_url);

-- FK-support indexes (retention sweeps delete watchlist_run / user rows).
CREATE INDEX IF NOT EXISTS idx_website_page_observation_run
  ON website_page_observation(watchlist_run_id);
CREATE INDEX IF NOT EXISTS idx_website_page_observation_workspace
  ON website_page_observation(workspace_id);
CREATE INDEX IF NOT EXISTS idx_website_page_observation_proof
  ON website_page_observation(proof_capture_id) WHERE proof_capture_id IS NOT NULL;

PRAGMA foreign_keys = ON;
