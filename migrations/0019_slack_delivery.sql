ALTER TABLE workspace_delivery_config
  ADD COLUMN slack_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE watchlist_delivery_config
  ADD COLUMN slack_enabled INTEGER NOT NULL DEFAULT 0;

PRAGMA foreign_keys = OFF;

CREATE TABLE delivery_target_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  watchlist_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'slack')),
  target_value TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('pending', 'validated', 'invalid', 'provider_rejected')
  ) DEFAULT 'pending',
  is_validated INTEGER NOT NULL DEFAULT 0,
  is_opted_in INTEGER NOT NULL DEFAULT 0,
  opt_in_source TEXT,
  opted_in_at TEXT,
  is_paused INTEGER NOT NULL DEFAULT 0,
  paused_at TEXT,
  opted_out_at TEXT,
  template_eligible INTEGER NOT NULL DEFAULT 0,
  last_successful_delivery_at TEXT,
  last_successful_attempt_id TEXT,
  provider_identifier TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

INSERT INTO delivery_target_next (
  id,
  user_id,
  watchlist_id,
  channel,
  target_value,
  validation_status,
  is_validated,
  is_opted_in,
  opt_in_source,
  opted_in_at,
  is_paused,
  paused_at,
  opted_out_at,
  template_eligible,
  last_successful_delivery_at,
  last_successful_attempt_id,
  provider_identifier,
  metadata_json,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  watchlist_id,
  channel,
  target_value,
  validation_status,
  is_validated,
  is_opted_in,
  opt_in_source,
  opted_in_at,
  is_paused,
  paused_at,
  opted_out_at,
  template_eligible,
  last_successful_delivery_at,
  last_successful_attempt_id,
  provider_identifier,
  metadata_json,
  created_at,
  updated_at
FROM delivery_target;

DROP TABLE delivery_target;
ALTER TABLE delivery_target_next RENAME TO delivery_target;

CREATE INDEX IF NOT EXISTS idx_delivery_target_user_watchlist_channel
  ON delivery_target(user_id, watchlist_id, channel, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_target_channel_value
  ON delivery_target(channel, target_value);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_target_unique_workspace
  ON delivery_target(user_id, channel, target_value)
  WHERE watchlist_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_target_unique_watchlist
  ON delivery_target(user_id, watchlist_id, channel, target_value)
  WHERE watchlist_id IS NOT NULL;

CREATE TABLE delivery_attempt_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  watchlist_id TEXT,
  digest_run_id TEXT,
  delivery_target_id TEXT,
  lane TEXT NOT NULL CHECK (lane IN ('internal', 'customer')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'slack')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'sent',
      'failed',
      'skipped_due_to_quiet_hours',
      'skipped_due_to_dedupe'
    )
  ),
  webhook_status TEXT NOT NULL CHECK (
    webhook_status IN ('pending', 'delivered', 'failed', 'legacy_unknown', 'provider_unknown')
  ) DEFAULT 'pending',
  target_value TEXT NOT NULL,
  provider_message_id TEXT,
  provider_status_last_seen_at TEXT,
  template_name TEXT,
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  error_message TEXT,
  sent_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (digest_run_id) REFERENCES digest_run(id) ON DELETE SET NULL,
  FOREIGN KEY (delivery_target_id) REFERENCES delivery_target(id) ON DELETE SET NULL
);

INSERT INTO delivery_attempt_next (
  id,
  user_id,
  watchlist_id,
  digest_run_id,
  delivery_target_id,
  lane,
  channel,
  provider,
  status,
  webhook_status,
  target_value,
  provider_message_id,
  provider_status_last_seen_at,
  template_name,
  event_ids_json,
  payload_snapshot_json,
  idempotency_key,
  error_message,
  sent_at,
  failed_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  watchlist_id,
  digest_run_id,
  delivery_target_id,
  lane,
  channel,
  provider,
  status,
  webhook_status,
  target_value,
  provider_message_id,
  provider_status_last_seen_at,
  template_name,
  event_ids_json,
  payload_snapshot_json,
  idempotency_key,
  error_message,
  sent_at,
  failed_at,
  created_at,
  updated_at
FROM delivery_attempt;

DROP TABLE delivery_attempt;
ALTER TABLE delivery_attempt_next RENAME TO delivery_attempt;

CREATE INDEX IF NOT EXISTS idx_delivery_attempt_target_channel_created
  ON delivery_attempt(target_value, channel, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempt_idempotency
  ON delivery_attempt(idempotency_key);

PRAGMA foreign_keys = ON;
