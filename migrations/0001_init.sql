PRAGMA foreign_keys = ON;

-- REBUILD P1 init schema (issue #3846, umbrella #3842). Design record:
-- docs/REBUILD-SCHEMA.md. This file coexists with the pre-rebuild migration
-- chain on its own branch; the P2 cut deletes the old files.
--
-- Shape: one tracked entity (self brand + competitors), one signal spine
-- every view reads, sources as a registry table (new source = a row + a
-- plugin, never a migration), competitor state machine on the entity row.

-- --------------------------------------------------------------------------
-- Auth (better-auth owned — verbatim from the proven schema; the magic-link
-- path is the launch sign-in)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(userId);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session(expiresAt);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_lookup ON account(providerId, accountId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);
CREATE INDEX IF NOT EXISTS idx_verification_expires_at ON verification(expiresAt);

CREATE TABLE IF NOT EXISTS better_auth_magic_link_ticket (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('login', 'signup')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_better_auth_magic_link_ticket_expires
  ON better_auth_magic_link_ticket(expires_at);

-- --------------------------------------------------------------------------
-- Workspace + plan
-- --------------------------------------------------------------------------

-- One workspace per user at launch; owner_user_id is the proven `org` shape.
-- Multi-seat defers to the better-auth organization plugin (it regenerates
-- its own tables when enabled — no schema cost now).
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_owner ON workspace(owner_user_id);

CREATE TABLE IF NOT EXISTS plan (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'agency')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  provider TEXT NOT NULL DEFAULT 'dodo',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_end TEXT,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Entity: the self brand and every competitor share one table (role column).
-- The tracking state machine lives on the row: on | off | dismissed, with
-- changed_at + reason + who. `off` keeps history and stops collection;
-- `dismissed` is the never-re-suggest memory; self is pinned `on`.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('self', 'competitor')),
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'auto', 'seed')),
  state TEXT NOT NULL DEFAULT 'on' CHECK (state IN ('on', 'off', 'dismissed')),
  state_changed_at TEXT,
  state_reason TEXT,
  state_changed_by TEXT CHECK (state_changed_by IN ('user', 'jev', 'auto')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (role = 'competitor' OR state = 'on'),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_workspace_domain
  ON entity(workspace_id, domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_one_self_per_workspace
  ON entity(workspace_id) WHERE role = 'self';
-- FK target for the composite (workspace_id, entity_id) foreign keys on
-- signal/alert — makes cross-workspace leakage a constraint
-- error instead of plugin-code discipline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_workspace_id
  ON entity(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_entity_workspace_role_state
  ON entity(workspace_id, role, state);

-- The judge queue + pre-entity dismissal memory. Every sweep candidate and
-- every "still a competitor?" review writes a row; p>=0.9 auto-applies,
-- below that it stays pending for the user. A partial unique index on
-- status='dismissed' makes dismissed-never-re-suggested a constraint while
-- still allowing repeat verdicts for the same domain.
CREATE TABLE IF NOT EXISTS suggestion (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'retire')),
  candidate_domain TEXT NOT NULL,
  candidate_name TEXT,
  verdict_p REAL,
  verdict_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'auto_on', 'accepted', 'dismissed')),
  decided_by TEXT CHECK (decided_by IN ('user', 'jev', 'auto')),
  decided_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  -- Deliberately single-column + SET NULL, not the composite pair: a
  -- hard-deleted entity must not take its dismissed-suggestion memory with
  -- it (never-re-suggest lives on candidate_domain).
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE SET NULL
);

-- Only the dismissed half needs to be a constraint: an entity that already
-- owns a suggestion row (auto_on) must still accept later retire/re-review
-- verdicts for the same domain. Plain index for the lookup; the partial
-- unique makes double-dismissal races impossible.
CREATE INDEX IF NOT EXISTS idx_suggestion_workspace_domain
  ON suggestion(workspace_id, candidate_domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestion_dismissed_domain
  ON suggestion(workspace_id, candidate_domain) WHERE status = 'dismissed';
CREATE INDEX IF NOT EXISTS idx_suggestion_status ON suggestion(status);

-- --------------------------------------------------------------------------
-- Source registry — a new source is a row here + a plugin, never a migration.
-- Seeded from the keep-list verdicts and the mentions scout (#3849): proven
-- routes enabled, credential/approval-gated ones parked (enabled=0).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'ads', 'site', 'hiring')),
  display_name TEXT NOT NULL,
  plugin_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO source (id, key, kind, display_name, plugin_key, enabled, config_json, created_at) VALUES
  ('src_meta_ads',    'meta-ads',    'ads',     'Meta Ad Library (browser)', 'meta-library-browser', 1, '{}', datetime('now')),
  ('src_google_ads',  'google-ads',  'ads',     'Google Ads Transparency',   'google-ads',           1, '{}', datetime('now')),
  ('src_tiktok_ads',  'tiktok-ads',  'ads',     'TikTok Creative Center',    'tiktok-ads',           0, '{"needs":"DECODO_SCRAPER_AUTH","note":"prod showed zero captures; re-probe with key before enabling"}', datetime('now')),
  ('src_linkedin_ads','linkedin-ads','ads',     'LinkedIn Ad Library',       'linkedin-ads',         0, '{"needs":"DECODO_SCRAPER_AUTH"}', datetime('now')),
  ('src_subdomains',  'subdomains',  'site',    'Subdomain discovery (crt.sh)','subdomains',         1, '{}', datetime('now')),
  ('src_website',     'website',     'site',    'Website change watch',      'website',              1, '{}', datetime('now')),
  ('src_hiring',      'hiring',      'hiring',  'Job boards',                'hiring',               1, '{"needs":"stored board slug; homepage discovery bot-gated"}', datetime('now')),
  ('src_gnews',       'gnews',       'mention', 'Google News RSS',           'gnews-rss',            1, '{}', datetime('now')),
  ('src_gdelt',       'gdelt',       'mention', 'GDELT DOC 2.0',             'gdelt',                1, '{"rate":"one request per 5s"}', datetime('now')),
  ('src_hn',          'hn',          'mention', 'Hacker News (Algolia)',     'hn-algolia',           1, '{}', datetime('now')),
  ('src_x',           'x',           'mention', 'X via SuperGrok x_search',  'x-supergrok',          1, '{"needs":"SuperGrok seat; token refresh lane + client-version headers"}', datetime('now')),
  ('src_blog_rss',    'blog-rss',    'mention', 'Publisher/blog RSS',        'rss-feed',             1, '{}', datetime('now')),
  ('src_substack',    'substack',    'mention', 'Substack feeds',            'rss-feed',             1, '{}', datetime('now')),
  ('src_medium',      'medium',      'mention', 'Medium feeds',              'rss-feed',             1, '{}', datetime('now')),
  ('src_youtube',     'youtube',     'mention', 'YouTube channel feeds',     'youtube-feed',         1, '{}', datetime('now')),
  ('src_bluesky',     'bluesky',     'mention', 'Bluesky searchPosts',       'bluesky',              0, '{"needs":"BSKY app-password session"}', datetime('now')),
  ('src_reddit',      'reddit',      'mention', 'Reddit Data API',           'reddit',               0, '{"needs":"REDDIT_COMMERCIAL_ACCESS approval"}', datetime('now')),
  ('src_pinterest',   'pinterest',   'mention', 'Pinterest',                 'pinterest',            0, '{"needs":"no free public mention-search surface"}', datetime('now'));

-- --------------------------------------------------------------------------
-- Watch: entity x source subscription. The refresh schedule polls
-- `watch JOIN entity WHERE entity.state = 'on'` — that join IS the
-- charter-addendum contract (off/dismissed entities stop collection).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS watch (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  cursor TEXT,
  last_polled_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_entity_source_target
  ON watch(entity_id, source_id, target_key);
CREATE INDEX IF NOT EXISTS idx_watch_source ON watch(source_id);

-- --------------------------------------------------------------------------
-- Signal: the one table every view reads. Envelope + promoted filter columns
-- + payload_json for the kind-specific remainder. kind is plugin-owned text
-- (mention|ad|change|job at launch); per-kind required fields are enforced by
-- the conditional CHECKs below. mention/change ship as views.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signal (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  watch_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  canonical_url TEXT,
  url_hash TEXT,
  author TEXT,
  aspect TEXT,
  evidence_url TEXT,
  engagement_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  last_seen_at TEXT,
  tombstoned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (kind <> 'mention' OR (canonical_url IS NOT NULL AND url_hash IS NOT NULL)),
  CHECK (kind <> 'change' OR aspect IS NOT NULL),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE CASCADE,
  FOREIGN KEY (watch_id) REFERENCES watch(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_source_dedup
  ON signal(source_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_signal_workspace_observed
  ON signal(workspace_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_signal_entity_kind_observed
  ON signal(entity_id, kind, observed_at);
CREATE INDEX IF NOT EXISTS idx_signal_url_hash ON signal(url_hash);

CREATE VIEW IF NOT EXISTS mention AS
SELECT
  id, workspace_id, entity_id, source_id, watch_id,
  title, summary, url, canonical_url, url_hash, author,
  engagement_json, payload_json, published_at, observed_at, last_seen_at,
  tombstoned, created_at,
  json_extract(payload_json, '$.external_id') AS external_id,
  json_extract(payload_json, '$.source_target') AS source_target,
  json_extract(payload_json, '$.match_class') AS match_class,
  json_extract(payload_json, '$.match_confirmed') AS match_confirmed,
  json_extract(payload_json, '$.excerpt') AS excerpt
FROM signal
WHERE kind = 'mention' AND tombstoned = 0;

CREATE VIEW IF NOT EXISTS change AS
SELECT
  id, workspace_id, entity_id, source_id, watch_id,
  aspect, title, summary, url, evidence_url,
  observed_at, created_at,
  json_extract(payload_json, '$.before') AS before_json,
  json_extract(payload_json, '$.after') AS after_json
FROM signal
WHERE kind = 'change' AND tombstoned = 0;

-- Raw per-watch poll payloads: diff input and proof/debug, bounded retention.
-- Pipeline state only — views never read this table.
CREATE TABLE IF NOT EXISTS snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  watch_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_hash TEXT,
  item_count INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watch_id) REFERENCES watch(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_watch_fetched
  ON snapshot(watch_id, fetched_at);

-- --------------------------------------------------------------------------
-- Alert feed + digest brief
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT,
  signal_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('signal', 'suggestion', 'system')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notable', 'major')),
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_workspace_status_created
  ON alert(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_entity ON alert(entity_id);

CREATE TABLE IF NOT EXISTS digest (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'failed', 'skipped')),
  subject TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (period_end >= period_start),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_digest_workspace_period
  ON digest(workspace_id, period_start, period_end);

-- --------------------------------------------------------------------------
-- Delivery + ops (keep-list machinery; delivery tables adapted to the new
-- schema — old FKs pointed at watchlist/digest_run which do not exist post-cut)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS send_target (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'teams', 'whatsapp')),
  target_value TEXT NOT NULL,
  is_validated INTEGER NOT NULL DEFAULT 0,
  is_opted_in INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, channel, target_value)
);

CREATE TABLE IF NOT EXISTS send_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  digest_id TEXT,
  send_target_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'teams', 'whatsapp')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  target_value TEXT NOT NULL,
  provider_message_id TEXT,
  idempotency_key TEXT,
  error_message TEXT,
  payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (digest_id) REFERENCES digest(id) ON DELETE SET NULL,
  FOREIGN KEY (send_target_id) REFERENCES send_target(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_send_attempt_idempotency
  ON send_attempt(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_send_attempt_workspace
  ON send_attempt(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS email_suppression (
  address TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint')),
  source TEXT NOT NULL,
  detail TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (address, reason)
);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dodo_webhook_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_timestamp TEXT,
  processed_at TEXT,
  outcome TEXT NOT NULL DEFAULT 'received',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
