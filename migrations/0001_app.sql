PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pricing_region_preference (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL CHECK (region IN ('india', 'rest_of_world')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_query (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('advertiser', 'keyword')),
  query_text TEXT NOT NULL,
  normalized_query_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_query_user_id ON saved_query(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_query_fingerprint ON saved_query(fingerprint);

CREATE TABLE IF NOT EXISTS collection (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_user_id ON collection(user_id);

CREATE TABLE IF NOT EXISTS tag (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_user_label ON tag(user_id, label);

CREATE TABLE IF NOT EXISTS ad (
  id TEXT PRIMARY KEY NOT NULL,
  advertiser TEXT NOT NULL,
  body TEXT NOT NULL,
  body_secondary TEXT,
  preview_headline TEXT NOT NULL,
  preview_subhead TEXT NOT NULL,
  hook TEXT NOT NULL,
  offer_text TEXT NOT NULL,
  cta TEXT NOT NULL,
  creative_format TEXT NOT NULL,
  language_label TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  landing_page_url TEXT,
  ad_snapshot_url TEXT,
  countries_json TEXT NOT NULL,
  platforms_json TEXT NOT NULL,
  first_seen_at TEXT,
  last_seen_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  research_summary TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_advertiser ON ad(advertiser);
CREATE INDEX IF NOT EXISTS idx_ad_last_seen ON ad(last_seen_at);

CREATE TABLE IF NOT EXISTS collection_item (
  id TEXT PRIMARY KEY NOT NULL,
  collection_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  note TEXT,
  ad_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES collection(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_item_unique_ad ON collection_item(collection_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_collection_item_collection ON collection_item(collection_id);

CREATE TABLE IF NOT EXISTS collection_item_tag (
  collection_item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (collection_item_id, tag_id),
  FOREIGN KEY (collection_item_id) REFERENCES collection_item(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('advertiser', 'saved_query')),
  target_id TEXT NOT NULL,
  target_fingerprint TEXT NOT NULL,
  target_label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_fingerprint ON watchlist(target_fingerprint);

CREATE TABLE IF NOT EXISTS watchlist_run (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  page_budget INTEGER NOT NULL DEFAULT 3,
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  baseline_from_run_id TEXT,
  summary_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_from_run_id) REFERENCES watchlist_run(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_run_watchlist_started ON watchlist_run(watchlist_id, started_at DESC);

CREATE TABLE IF NOT EXISTS landing_page_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  raw_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  raw_headline TEXT NOT NULL,
  normalized_headline TEXT NOT NULL,
  normalized_headline_hash TEXT NOT NULL,
  capture_method TEXT NOT NULL,
  artifact_key TEXT,
  metadata_json TEXT,
  cta_text TEXT,
  price_text TEXT,
  form_present INTEGER,
  ocr_text TEXT,
  translated_text TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_landing_page_hash ON landing_page_snapshot(normalized_headline_hash);

CREATE TABLE IF NOT EXISTS ad_observation (
  id TEXT PRIMARY KEY NOT NULL,
  ad_id TEXT NOT NULL,
  watchlist_run_id TEXT NOT NULL,
  landing_page_snapshot_id TEXT,
  seen_at TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  landing_page_url TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (landing_page_snapshot_id) REFERENCES landing_page_snapshot(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_observation_ad_run ON ad_observation(ad_id, watchlist_run_id);
CREATE INDEX IF NOT EXISTS idx_ad_observation_run ON ad_observation(watchlist_run_id);

CREATE TABLE IF NOT EXISTS analysis_field (
  id TEXT PRIMARY KEY NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ad', 'observation', 'landing_page')),
  scope_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT NOT NULL,
  provenance_source TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  confidence REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_scope ON analysis_field(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_analysis_field_key ON analysis_field(field_key);

CREATE TABLE IF NOT EXISTS watch_event (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ad_new',
      'ad_inactive',
      'landing_page_url_changed',
      'landing_page_headline_changed'
    )
  ),
  ad_id TEXT,
  baseline_from_run_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL,
  FOREIGN KEY (baseline_from_run_id) REFERENCES watchlist_run(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_created ON watch_event(watchlist_id, created_at DESC);

CREATE TABLE IF NOT EXISTS digest_run (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_digest_run_user_period ON digest_run(user_id, period_end DESC);

CREATE TABLE IF NOT EXISTS digest_item (
  id TEXT PRIMARY KEY NOT NULL,
  digest_run_id TEXT NOT NULL,
  watchlist_id TEXT NOT NULL,
  watchlist_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (digest_run_id) REFERENCES digest_run(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_digest_item_digest_run ON digest_item(digest_run_id);

CREATE TABLE IF NOT EXISTS digest_delivery (
  id TEXT PRIMARY KEY NOT NULL,
  digest_run_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  recipient_email TEXT NOT NULL,
  external_message_id TEXT,
  error_message TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (digest_run_id) REFERENCES digest_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_link (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('collection', 'watchlist', 'digest')),
  resource_id TEXT NOT NULL,
  is_snapshot INTEGER NOT NULL DEFAULT 0,
  snapshot_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_share_link_token ON share_link(token);

CREATE TABLE IF NOT EXISTS meta_integration_log (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded')),
  summary TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_created ON meta_integration_log(created_at DESC);
