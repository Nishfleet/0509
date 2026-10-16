-- 0069_send_attempt_kind.sql — every email kind leaves one send_attempt row
-- that says what it was, what subject went out and which provider id the
-- send returned. Sign-in and change-email mail has no workspace yet, so
-- workspace_id becomes nullable; those rows hold no address at all.
--
-- SQLite cannot drop NOT NULL in place, so send_attempt is rebuilt. Its only
-- child is signal_delivery (send_attempt_id ON DELETE SET NULL), and
-- defer_foreign_keys defers checks, not ON DELETE actions (0021): the child is
-- copied to a hold table and dropped first, then restored. A count guard
-- aborts the file if either copy is short. Existing rows get kind from the
-- idempotency key prefix. No row is deleted.

PRAGMA defer_foreign_keys = true;

CREATE TABLE _send_attempt_guard (
  name TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE send_attempt_hold AS SELECT * FROM send_attempt;
CREATE TABLE signal_delivery_hold AS SELECT * FROM signal_delivery;

INSERT INTO _send_attempt_guard (name, ok)
SELECT 'held', CASE WHEN
  (SELECT COUNT(*) FROM send_attempt_hold) = (SELECT COUNT(*) FROM send_attempt)
  AND (SELECT COUNT(*) FROM signal_delivery_hold) = (SELECT COUNT(*) FROM signal_delivery)
THEN 1 ELSE 0 END;

DROP TABLE signal_delivery;
DROP TABLE send_attempt;

CREATE TABLE send_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT,
  send_target_id TEXT,
  digest_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'unknown',
  subject TEXT,
  provider_message TEXT,
  status TEXT NOT NULL,
  error TEXT,
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (send_target_id) REFERENCES send_target(id) ON DELETE SET NULL,
  FOREIGN KEY (digest_id) REFERENCES digest(id) ON DELETE SET NULL
);
CREATE INDEX idx_send_attempt_digest ON send_attempt(digest_id, attempted_at DESC);
CREATE INDEX idx_send_attempt_workspace ON send_attempt(workspace_id);
CREATE INDEX idx_send_attempt_status_digest ON send_attempt(status, digest_id);
CREATE INDEX idx_send_attempt_target ON send_attempt(send_target_id);
CREATE INDEX idx_send_attempt_kind ON send_attempt(kind, attempted_at DESC);

CREATE TABLE signal_delivery (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  send_attempt_id TEXT,
  delivered_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channel(id) ON DELETE CASCADE,
  FOREIGN KEY (send_attempt_id) REFERENCES send_attempt(id) ON DELETE SET NULL,
  UNIQUE (signal_id, channel_id)
);
CREATE INDEX idx_signal_delivery_workspace ON signal_delivery(workspace_id);
CREATE INDEX idx_signal_delivery_channel ON signal_delivery(channel_id);
CREATE INDEX idx_signal_delivery_attempt ON signal_delivery(send_attempt_id);

INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, kind, status, error, attempted_at)
SELECT id, workspace_id, send_target_id, digest_id, idempotency_key,
  CASE
    WHEN idempotency_key LIKE 'digest:%' THEN 'brief'
    WHEN idempotency_key LIKE 'brief-slack:%' THEN 'brief_slack'
    WHEN idempotency_key LIKE 'incident:%' THEN 'incident'
    WHEN idempotency_key LIKE 'change-overflow:%' THEN 'change_overflow'
    WHEN idempotency_key LIKE 'change-slack:%' THEN 'change_slack'
    WHEN idempotency_key LIKE 'change:%' THEN 'change'
    WHEN idempotency_key LIKE 'welcome:%' THEN 'welcome'
    WHEN idempotency_key LIKE 'trial-ending:%' THEN 'trial_ending'
    WHEN idempotency_key LIKE 'rivalnudge:%' THEN 'rival_nudge'
    WHEN idempotency_key LIKE 'winback:%' THEN 'winback'
    WHEN idempotency_key LIKE 'recap:%' THEN 'recap'
    WHEN idempotency_key LIKE 'monthly:%' THEN 'monthly'
    ELSE 'unknown'
  END,
  status, error, attempted_at
FROM send_attempt_hold;

INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at)
SELECT id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at
FROM signal_delivery_hold;

INSERT INTO _send_attempt_guard (name, ok)
SELECT 'restored', CASE WHEN
  (SELECT COUNT(*) FROM send_attempt) = (SELECT COUNT(*) FROM send_attempt_hold)
  AND (SELECT COUNT(*) FROM signal_delivery) = (SELECT COUNT(*) FROM signal_delivery_hold)
THEN 1 ELSE 0 END;

DROP TABLE signal_delivery_hold;
DROP TABLE send_attempt_hold;
DROP TABLE _send_attempt_guard;
