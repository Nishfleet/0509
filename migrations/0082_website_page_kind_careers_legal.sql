-- Expand the website_site_scan_page and website_page_observation page_kind
-- CHECK constraints to accept the new first-class kinds 'careers' and 'legal'
-- (EPIC #1367, Q4 — #1385). This is an expand-only change: every previously
-- accepted value is still accepted, so the running old code (which never
-- writes the new kinds) is unaffected. SQLite cannot ALTER a CHECK in place,
-- so each table is rebuilt with the established rename/create/copy/drop
-- pattern (see 0017_share_link_report_resource.sql for the precedent).

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- website_site_scan_page: rebuild with the expanded page_kind vocabulary.
-- ---------------------------------------------------------------------------

ALTER TABLE website_site_scan_page RENAME TO website_site_scan_page_old;

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
      'careers',
      'legal',
      'contact',
      'other'
    )
  ),
  stable_order INTEGER NOT NULL CHECK (stable_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_scan_id) REFERENCES website_site_scan(id) ON DELETE CASCADE
);

INSERT INTO website_site_scan_page (
  id,
  site_scan_id,
  canonical_url,
  discovery_source,
  page_kind,
  stable_order,
  created_at,
  updated_at
)
SELECT
  id,
  site_scan_id,
  canonical_url,
  discovery_source,
  page_kind,
  stable_order,
  created_at,
  updated_at
FROM website_site_scan_page_old;

DROP TABLE website_site_scan_page_old;

CREATE UNIQUE INDEX IF NOT EXISTS idx_website_site_scan_page_scan_url
  ON website_site_scan_page(site_scan_id, canonical_url);

CREATE INDEX IF NOT EXISTS idx_website_site_scan_page_scan_order
  ON website_site_scan_page(site_scan_id, stable_order, canonical_url);

-- ---------------------------------------------------------------------------
-- website_page_observation: rebuild with the expanded page_kind vocabulary.
-- ---------------------------------------------------------------------------

ALTER TABLE website_page_observation RENAME TO website_page_observation_old;

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
      'careers',
      'legal',
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

INSERT INTO website_page_observation (
  id,
  workspace_id,
  watchlist_id,
  watchlist_run_id,
  canonical_url,
  discovery_source,
  page_kind,
  content_hash,
  excerpt,
  proof_capture_id,
  fetch_status,
  http_status,
  fetch_error_code,
  normalizer_version,
  signals_json,
  observed_at,
  created_at,
  updated_at
)
SELECT
  id,
  workspace_id,
  watchlist_id,
  watchlist_run_id,
  canonical_url,
  discovery_source,
  page_kind,
  content_hash,
  excerpt,
  proof_capture_id,
  fetch_status,
  http_status,
  fetch_error_code,
  normalizer_version,
  signals_json,
  observed_at,
  created_at,
  updated_at
FROM website_page_observation_old;

DROP TABLE website_page_observation_old;

CREATE UNIQUE INDEX IF NOT EXISTS idx_website_page_observation_run_url
  ON website_page_observation(watchlist_id, watchlist_run_id, canonical_url);

CREATE INDEX IF NOT EXISTS idx_website_page_observation_run
  ON website_page_observation(watchlist_run_id);
CREATE INDEX IF NOT EXISTS idx_website_page_observation_workspace
  ON website_page_observation(workspace_id);
CREATE INDEX IF NOT EXISTS idx_website_page_observation_proof
  ON website_page_observation(proof_capture_id) WHERE proof_capture_id IS NOT NULL;

PRAGMA foreign_keys = ON;
