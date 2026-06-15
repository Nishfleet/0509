ALTER TABLE watchlist ADD COLUMN tracking_role TEXT NOT NULL DEFAULT 'competitor' CHECK (tracking_role IN ('competitor', 'self'));

DROP INDEX IF EXISTS idx_watchlist_user_fingerprint_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_user_role_fingerprint_active
  ON watchlist(user_id, tracking_role, target_fingerprint)
  WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_watchlist_user_active_updated
  ON watchlist(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_role_active_updated
  ON watchlist(user_id, tracking_role, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_query_user_updated
  ON saved_query(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_observation_seen
  ON ad_observation(seen_at DESC);

CREATE TABLE IF NOT EXISTS web_mention_target (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  watchlist_id TEXT,
  tracking_role TEXT NOT NULL DEFAULT 'competitor' CHECK (tracking_role IN ('competitor', 'self')),
  label TEXT NOT NULL,
  query_text TEXT NOT NULL,
  domain TEXT,
  sources_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_web_mention_target_user_active
  ON web_mention_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_mention_target_watchlist
  ON web_mention_target(watchlist_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_mention_target_watchlist_unique
  ON web_mention_target(watchlist_id)
  WHERE watchlist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_web_mention_target_role
  ON web_mention_target(user_id, tracking_role, is_active);

INSERT OR IGNORE INTO web_mention_target (
  id,
  user_id,
  watchlist_id,
  tracking_role,
  label,
  query_text,
  domain,
  sources_json,
  is_active,
  last_checked_at,
  created_at,
  updated_at
)
SELECT
  'webmention_' || id,
  user_id,
  id,
  tracking_role,
  target_label,
  target_label,
  NULL,
  '["reddit","x","blog","youtube","substack","web"]',
  is_active,
  last_scanned_at,
  created_at,
  updated_at
FROM watchlist;

CREATE TABLE IF NOT EXISTS web_mention_observation (
  id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('reddit', 'x', 'blog', 'youtube', 'substack', 'web')),
  source_id TEXT,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  excerpt TEXT,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  sentiment TEXT,
  engagement_json TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (target_id) REFERENCES web_mention_target(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_mention_observation_unique
  ON web_mention_observation(target_id, source, url_hash);

CREATE INDEX IF NOT EXISTS idx_web_mention_observation_target_seen
  ON web_mention_observation(target_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_mention_observation_user_source_seen
  ON web_mention_observation(user_id, source, observed_at DESC);
