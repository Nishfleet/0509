-- REBUILD 0001_init.sql — the whole schema, issue #3846, umbrella #3842.
-- Authored by the deputy orchestrator 2026-09-21. Replaces the 106-file pre-rebuild chain.
-- Design and rationale: docs/REBUILD-SCHEMA.md. Jev contract: docs/REBUILD-JEV.md.

-- ---------------------------------------------------------------------------
-- 1. Drop the pre-rebuild schema.
-- Derived by applying the 106 pre-rebuild migrations to a local D1 and reading
-- sqlite_master (2026-09-21): 97 tables. Not derived by grepping the old files —
-- that chain has 200 CREATE TABLE and 96 DROP TABLE statements because of
-- SQLite's rebuild-and-copy pattern, so parsing overcounts.
-- Ordered children-first from PRAGMA foreign_key_list: D1 does not honour
-- PRAGMA foreign_keys = OFF inside a migration, so dropping a parent before its
-- child fails with "no such table". This order is topological, not alphabetical.
-- The names the new schema reuses are dropped too: CREATE TABLE IF NOT EXISTS
-- silently keeps an existing table, which would preserve the old definitions.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "passkey";
DROP TABLE IF EXISTS "saved_query";
DROP TABLE IF EXISTS "collection_item_tag";
DROP TABLE IF EXISTS "collection_item";
DROP TABLE IF EXISTS "collection";
DROP TABLE IF EXISTS "tag";
DROP TABLE IF EXISTS "ad_observation";
DROP TABLE IF EXISTS "website_page_observation";
DROP TABLE IF EXISTS "watch_event";
DROP TABLE IF EXISTS "proof_capture";
DROP TABLE IF EXISTS "proof_target";
DROP TABLE IF EXISTS "event_candidate";
DROP TABLE IF EXISTS "ad";
DROP TABLE IF EXISTS "website_site_scan_page";
DROP TABLE IF EXISTS "website_site_scan";
DROP TABLE IF EXISTS "watchlist_run";
DROP TABLE IF EXISTS "digest_item";
DROP TABLE IF EXISTS "watchlist_delivery_config";
DROP TABLE IF EXISTS "web_mention_observation";
DROP TABLE IF EXISTS "web_mention_target";
DROP TABLE IF EXISTS "agent_memory";
DROP TABLE IF EXISTS "delivery_attempt";
DROP TABLE IF EXISTS "delivery_target";
DROP TABLE IF EXISTS "source_snapshot";
DROP TABLE IF EXISTS "watchlist";
DROP TABLE IF EXISTS "landing_page_snapshot";
DROP TABLE IF EXISTS "analysis_field";
DROP TABLE IF EXISTS "digest_delivery";
DROP TABLE IF EXISTS "digest_run";
DROP TABLE IF EXISTS "meta_integration_log";
DROP TABLE IF EXISTS "workspace_delivery_config";
DROP TABLE IF EXISTS "discovery_cache_entry";
DROP TABLE IF EXISTS "discovery_query_lease";
DROP TABLE IF EXISTS "customer_meta_connection";
DROP TABLE IF EXISTS "rate_limit_events";
DROP TABLE IF EXISTS "proof_usage_credit";
DROP TABLE IF EXISTS "share_link";
DROP TABLE IF EXISTS "agent_action_audit";
DROP TABLE IF EXISTS "customer_api_key";
DROP TABLE IF EXISTS "dodo_webhook_event";
DROP TABLE IF EXISTS "workspace_branding";
DROP TABLE IF EXISTS "workspace_member";
DROP TABLE IF EXISTS "client_room_resource";
DROP TABLE IF EXISTS "client_room";
DROP TABLE IF EXISTS "support_case_event";
DROP TABLE IF EXISTS "support_case";
DROP TABLE IF EXISTS "better_auth_magic_link_ticket";
DROP TABLE IF EXISTS "monitoring_concurrency_slot";
DROP TABLE IF EXISTS "evidence_usage_reservation";
DROP TABLE IF EXISTS "evidence_usage_period";
DROP TABLE IF EXISTS "evidence_top_up_adjustment";
DROP TABLE IF EXISTS "evidence_top_up_ledger_entry";
DROP TABLE IF EXISTS "proof_usage_credit_migration";
DROP TABLE IF EXISTS "evidence_top_up_grant";
DROP TABLE IF EXISTS "search_domain_identity_cache";
DROP TABLE IF EXISTS "source_connection";
DROP TABLE IF EXISTS "presence_item_revision";
DROP TABLE IF EXISTS "presence_item";
DROP TABLE IF EXISTS "presence_entity_link";
DROP TABLE IF EXISTS "presence_alert_cursor";
DROP TABLE IF EXISTS "presence_domain_verification";
DROP TABLE IF EXISTS "presence_poll_cursor";
DROP TABLE IF EXISTS "source_target";
DROP TABLE IF EXISTS "tracked_entity";
DROP TABLE IF EXISTS "presence_oauth_transaction";
DROP TABLE IF EXISTS "presence_pilot_workspace";
DROP TABLE IF EXISTS "user_plan";
DROP TABLE IF EXISTS "cron_failure_alert_throttle";
DROP TABLE IF EXISTS "digest_schedule_job";
DROP TABLE IF EXISTS "release_scheduled_observation";
DROP TABLE IF EXISTS "scheduled_observation_health_state";
DROP TABLE IF EXISTS "scheduled_observation_alert_state";
DROP TABLE IF EXISTS "cron_failure_alert_accepted_window";
DROP TABLE IF EXISTS "discovery_fetch_log";
DROP TABLE IF EXISTS "discovery_provider_state";
DROP TABLE IF EXISTS "browser_job_telemetry";
DROP TABLE IF EXISTS "cta_pipeline_stage_counts";
DROP TABLE IF EXISTS "retention_sweep_state";
DROP TABLE IF EXISTS "cta_pipeline_bail_reason_counts";
DROP TABLE IF EXISTS "org";
DROP TABLE IF EXISTS "competitor_suggestion_dismissal";
DROP TABLE IF EXISTS "member";
DROP TABLE IF EXISTS "invitation";
DROP TABLE IF EXISTS "user";
DROP TABLE IF EXISTS "signup_source_pending";
DROP TABLE IF EXISTS "demo_brand_proof_hole_state";
DROP TABLE IF EXISTS "ads_domain_publisher_state";
DROP TABLE IF EXISTS "e2e_test_mode";
DROP TABLE IF EXISTS "email_suppression";
DROP TABLE IF EXISTS "error_report";
DROP TABLE IF EXISTS "status_probe_samples";
DROP TABLE IF EXISTS "email_delivery_canary";
DROP TABLE IF EXISTS "competitor_graph";
DROP TABLE IF EXISTS "organization";

-- ---------------------------------------------------------------------------
-- 2. Auth — better-auth owned. Magic link is the proven sign-in path.
-- ---------------------------------------------------------------------------

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_session_user ON session(userId);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE (providerId, accountId)
);
CREATE INDEX idx_account_user ON account(userId);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_verification_identifier ON verification(identifier);

-- ---------------------------------------------------------------------------
-- 3. Tenancy and billing.
-- ---------------------------------------------------------------------------

CREATE TABLE workspace (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_workspace_owner ON workspace(owner_user_id);

CREATE TABLE plan (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','starter','agency')),
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'dodo',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_end TEXT,
  limits_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE dodo_webhook_event (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

-- ---------------------------------------------------------------------------
-- 4. Entities — you and your competition are the same kind of thing.
-- ---------------------------------------------------------------------------

CREATE TABLE entity (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('self','competitor')),
  domain TEXT NOT NULL,
  name TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','auto','seed')),
  confirmed_at TEXT,
  state TEXT NOT NULL DEFAULT 'on' CHECK (state IN ('on','off','dismissed')),
  state_changed_at TEXT,
  state_reason TEXT,
  state_changed_by TEXT CHECK (state_changed_by IS NULL OR state_changed_by IN ('user','jev','auto')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, domain),
  CHECK (role = 'competitor' OR state = 'on')
);
CREATE UNIQUE INDEX idx_entity_one_self ON entity(workspace_id) WHERE role = 'self';
CREATE INDEX idx_entity_ws_state ON entity(workspace_id, state);

CREATE TABLE suggestion (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('add','retire')),
  candidate_domain TEXT NOT NULL,
  candidate_name TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  verdict_p REAL,
  verdict_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('auto_on','pending','accepted','dismissed')),
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, candidate_domain)
);

-- ---------------------------------------------------------------------------
-- 5. Sources — a new source is a row plus a plugin, never a migration.
-- No workspace column by design; that is what makes the rule true.
-- ---------------------------------------------------------------------------

CREATE TABLE source (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  plugin_key TEXT NOT NULL,
  reliability TEXT NOT NULL DEFAULT 'best_effort'
    CHECK (reliability IN ('official_api','rss','scraped_page','best_effort')),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE watch (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  cursor TEXT,
  last_polled_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE CASCADE,
  UNIQUE (entity_id, source_id, target_key)
);
CREATE INDEX idx_watch_due ON watch(is_active, last_polled_at);

CREATE TABLE page (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  role TEXT CHECK (role IS NULL OR role IN ('home','pricing','product','blog','careers','legal','other')),
  role_decided_for_hash TEXT,
  discovered_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  UNIQUE (entity_id, url)
);

-- ---------------------------------------------------------------------------
-- 6. The cost boundary: one row per watch per tick, body in R2.
-- ---------------------------------------------------------------------------

CREATE TABLE snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  watch_id TEXT NOT NULL,
  page_id TEXT,
  fetched_at TEXT NOT NULL,
  payload_r2_key TEXT,
  payload_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (watch_id) REFERENCES watch(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES page(id) ON DELETE SET NULL
);
CREATE INDEX idx_snapshot_watch_time ON snapshot(watch_id, fetched_at);

-- ---------------------------------------------------------------------------
-- 7. The spine every view reads — curated, not raw.
-- ---------------------------------------------------------------------------

CREATE TABLE signal (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  watch_id TEXT,
  snapshot_id TEXT,
  kind TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  url TEXT,
  canonical_url TEXT,
  url_hash TEXT,
  author TEXT,
  aspect TEXT,
  evidence_url TEXT,
  engagement_json TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  last_seen_at TEXT,
  is_tombstoned INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE CASCADE,
  FOREIGN KEY (watch_id) REFERENCES watch(id) ON DELETE SET NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshot(id) ON DELETE SET NULL,
  UNIQUE (source_id, dedup_key),
  CHECK (kind <> 'mention' OR (canonical_url IS NOT NULL AND url_hash IS NOT NULL)),
  CHECK (kind <> 'change' OR aspect IS NOT NULL)
);
CREATE INDEX idx_signal_ws_time ON signal(workspace_id, observed_at);
CREATE INDEX idx_signal_entity_kind ON signal(entity_id, kind, observed_at);

CREATE VIEW mention AS
  SELECT id, workspace_id, entity_id, source_id, title, summary, canonical_url,
         url_hash, author, engagement_json, published_at, observed_at
  FROM signal WHERE kind = 'mention' AND is_tombstoned = 0;

CREATE VIEW change AS
  SELECT id, workspace_id, entity_id, source_id, snapshot_id, aspect, title,
         summary, evidence_url, observed_at
  FROM signal WHERE kind = 'change' AND is_tombstoned = 0;

-- ---------------------------------------------------------------------------
-- 8. Judgments — logged once, cached by input hash (docs/REBUILD-JEV.md).
-- ---------------------------------------------------------------------------

CREATE TABLE jev_verdict (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  signal_id TEXT,
  entity_id TEXT,
  p REAL,
  choice TEXT,
  score REAL,
  reason TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  UNIQUE (question_id, input_hash)
);

CREATE TABLE user_decision (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  signal_id TEXT,
  entity_id TEXT,
  verdict TEXT NOT NULL,
  note TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_decision_ws ON user_decision(workspace_id, decided_at);

-- ---------------------------------------------------------------------------
-- 9. Alerts, the weekly brief, and the email lane.
-- ---------------------------------------------------------------------------

CREATE TABLE alert (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT,
  signal_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'unread',
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE SET NULL
);
CREATE INDEX idx_alert_ws_status ON alert(workspace_id, status, created_at);

CREATE TABLE digest (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'weekly',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  subject TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE send_target (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  target_value TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, channel, target_value)
);

CREATE TABLE send_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  send_target_id TEXT,
  digest_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  error TEXT,
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (send_target_id) REFERENCES send_target(id) ON DELETE SET NULL,
  FOREIGN KEY (digest_id) REFERENCES digest(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 10. Platform.
-- ---------------------------------------------------------------------------

CREATE TABLE email_suppression (
  address TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limit_events (
  id TEXT PRIMARY KEY NOT NULL,
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_rate_limit_bucket ON rate_limit_events(bucket, subject, occurred_at);
