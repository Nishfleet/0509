CREATE TABLE IF NOT EXISTS support_case_event (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'case_opened',
      'support_notified',
      'support_notification_failed',
      'support_note',
      'status_changed'
    )
  ),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 1000),
  visible_to_customer INTEGER NOT NULL DEFAULT 1 CHECK (visible_to_customer IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES support_case(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_case_event_case_visible_created
  ON support_case_event(case_id, user_id, visible_to_customer, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_case_event_case_created
  ON support_case_event(case_id, created_at DESC);

UPDATE delivery_attempt
SET payload_snapshot_json = json_object(
  'kind', 'support_case_operator_alert',
  'caseId', substr(idempotency_key, length('support-case:') + 1)
)
WHERE idempotency_key LIKE 'support-case:%';
