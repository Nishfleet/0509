PRAGMA foreign_keys = OFF;

-- Before applying this migration on the live D1 database, take a backup/export first.
-- Roll-forward is preferred. The paired rollback file exists only for emergency/manual recovery.
-- D1 applies migrations without explicit BEGIN/COMMIT statements here.

CREATE TABLE IF NOT EXISTS event_candidate (
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
      'landing_page_form_changed'
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

CREATE INDEX IF NOT EXISTS idx_event_candidate_watchlist_status_detected
  ON event_candidate(watchlist_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS proof_target (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  ad_id TEXT,
  landing_page_url TEXT,
  canonical_page_identity TEXT NOT NULL,
  proof_target_identity TEXT NOT NULL,
  last_capture_attempt_at TEXT,
  last_successful_proof_at TEXT,
  last_successful_capture_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_target_identity
  ON proof_target(proof_target_identity);
CREATE INDEX IF NOT EXISTS idx_proof_target_watchlist_canonical
  ON proof_target(watchlist_id, canonical_page_identity);

CREATE TABLE IF NOT EXISTS proof_capture (
  id TEXT PRIMARY KEY NOT NULL,
  proof_target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'succeeded',
      'failed',
      'skipped_due_to_budget',
      'skipped_due_to_rate_limit',
      'skipped_due_to_dedupe'
    )
  ),
  skip_reason TEXT CHECK (
    skip_reason IN (
      'skipped_due_to_budget',
      'skipped_due_to_rate_limit',
      'skipped_due_to_dedupe'
    )
  ),
  failure_code TEXT,
  failure_reason TEXT,
  screenshot_artifact_key TEXT,
  html_artifact_key TEXT,
  extracted_fields_json TEXT NOT NULL DEFAULT '{}',
  field_confidence_json TEXT,
  extraction_warnings_json TEXT,
  capture_metadata_json TEXT NOT NULL DEFAULT '{}',
  render_mode TEXT NOT NULL DEFAULT 'mobile',
  device_profile TEXT NOT NULL DEFAULT 'mobile_default',
  extractor_version TEXT NOT NULL,
  idempotency_key TEXT,
  attempted_at TEXT NOT NULL,
  succeeded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (proof_target_id) REFERENCES proof_target(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proof_capture_target_attempted
  ON proof_capture(proof_target_id, attempted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_capture_idempotency
  ON proof_capture(idempotency_key);

CREATE TABLE IF NOT EXISTS workspace_delivery_config (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  sensitivity_mode TEXT NOT NULL CHECK (
    sensitivity_mode IN ('quiet', 'balanced', 'aggressive', 'auto')
  ) DEFAULT 'balanced',
  instant_enabled INTEGER NOT NULL DEFAULT 0,
  digest_enabled INTEGER NOT NULL DEFAULT 1,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_hours_json TEXT,
  timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_delivery_config_user
  ON workspace_delivery_config(user_id);

CREATE TABLE IF NOT EXISTS watchlist_delivery_config (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  sensitivity_mode TEXT NOT NULL CHECK (
    sensitivity_mode IN ('quiet', 'balanced', 'aggressive', 'auto')
  ) DEFAULT 'balanced',
  instant_enabled INTEGER NOT NULL DEFAULT 0,
  digest_enabled INTEGER NOT NULL DEFAULT 1,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_hours_json TEXT,
  timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_delivery_config_user
  ON watchlist_delivery_config(user_id);

CREATE TABLE IF NOT EXISTS delivery_target (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  watchlist_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
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

CREATE TABLE IF NOT EXISTS delivery_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  watchlist_id TEXT,
  digest_run_id TEXT,
  delivery_target_id TEXT,
  lane TEXT NOT NULL CHECK (lane IN ('internal', 'customer')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
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

CREATE INDEX IF NOT EXISTS idx_delivery_attempt_target_channel_created
  ON delivery_attempt(target_value, channel, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempt_idempotency
  ON delivery_attempt(idempotency_key);

CREATE TABLE watch_event_next (
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
      'landing_page_form_changed'
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

INSERT INTO watch_event_next (
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
  'confirmed',
  CASE event_type
    WHEN 'landing_page_url_changed' THEN 85
    WHEN 'landing_page_headline_changed' THEN 75
    WHEN 'ad_new' THEN 65
    WHEN 'ad_inactive' THEN 60
    ELSE 0
  END,
  ad_id,
  baseline_from_run_id,
  NULL,
  NULL,
  title,
  summary,
  metadata_json,
  created_at,
  NULL,
  NULL,
  created_at,
  created_at
FROM watch_event;

DROP TABLE watch_event;
ALTER TABLE watch_event_next RENAME TO watch_event;

CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_created
  ON watch_event(watchlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_status_created
  ON watch_event(watchlist_id, status, created_at DESC);

INSERT INTO workspace_delivery_config (
  id,
  user_id,
  sensitivity_mode,
  instant_enabled,
  digest_enabled,
  email_enabled,
  whatsapp_enabled,
  quiet_hours_json,
  timezone,
  created_at,
  updated_at
)
SELECT
  lower(hex(randomblob(16))),
  user.id,
  'balanced',
  0,
  1,
  CASE WHEN user.email IS NOT NULL AND user.email != '' THEN 1 ELSE 0 END,
  0,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
FROM user
WHERE NOT EXISTS (
  SELECT 1
  FROM workspace_delivery_config
  WHERE workspace_delivery_config.user_id = user.id
);

INSERT INTO delivery_attempt (
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
  lower(hex(randomblob(16))),
  digest_run.user_id,
  NULL,
  digest_delivery.digest_run_id,
  NULL,
  'customer',
  'email',
  digest_delivery.provider,
  CASE digest_delivery.status
    WHEN 'sent' THEN 'sent'
    WHEN 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  'legacy_unknown',
  digest_delivery.recipient_email,
  digest_delivery.external_message_id,
  digest_delivery.delivered_at,
  NULL,
  '[]',
  json_object(
    'legacyDigestDeliveryId', digest_delivery.id,
    'digestRunId', digest_delivery.digest_run_id,
    'status', digest_delivery.status,
    'recipientEmail', digest_delivery.recipient_email
  ),
  'legacy-digest:' || digest_delivery.digest_run_id,
  digest_delivery.error_message,
  digest_delivery.delivered_at,
  CASE WHEN digest_delivery.status = 'failed' THEN digest_delivery.updated_at ELSE NULL END,
  digest_delivery.created_at,
  digest_delivery.updated_at
FROM digest_delivery
INNER JOIN digest_run ON digest_run.id = digest_delivery.digest_run_id
WHERE NOT EXISTS (
  SELECT 1
  FROM delivery_attempt
  WHERE delivery_attempt.idempotency_key = 'legacy-digest:' || digest_delivery.digest_run_id
);

PRAGMA foreign_keys = ON;
