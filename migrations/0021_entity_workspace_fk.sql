-- 0021_entity_workspace_fk.sql — a child row cannot pair workspace A with
-- an entity that belongs to workspace B. Issue #4707.
--
-- entity.id is already the primary key, so (workspace_id, id) cannot
-- duplicate. SQLite still requires a UNIQUE index on those exact columns
-- before a composite foreign key may reference them. The index avoids
-- rebuilding entity. Rebuilding it would drop the parent of almost every
-- tenant table, and D1 does not honour PRAGMA foreign_keys = OFF
-- (migrations/0001_rebuild.sql): DROP TABLE's implicit DELETE would
-- cascade the tree away.
--
-- defer_foreign_keys defers checks, not ON DELETE actions. DROP TABLE
-- signal still cascades into jev_verdict, user_decision, signal_delivery
-- and alert. DROP TABLE incident still cascades into incident_notice.
-- Those children are copied into hold tables and dropped first. Their
-- definitions are unchanged. mention and change are views over signal,
-- so they are dropped and recreated with the same SQL. The takedown
-- triggers sit on takedown, entity and suggestion and are not dropped.
--
-- An existing cross-workspace pair aborts this file before any drop. A
-- hold-count check aborts it if the copy is short. An id check aborts it
-- if a restored row is missing. No row is deleted. Do not apply this to
-- remote D1 from a worker.

PRAGMA defer_foreign_keys = true;

CREATE UNIQUE INDEX idx_entity_workspace_id ON entity(workspace_id, id);

CREATE TABLE _fk_phase_guard (
  name TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_signal', CASE WHEN EXISTS (
  SELECT 1 FROM signal AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_incident', CASE WHEN EXISTS (
  SELECT 1 FROM incident AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_alert', CASE WHEN EXISTS (
  SELECT 1 FROM alert AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE child.entity_id IS NOT NULL AND parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_standing', CASE WHEN EXISTS (
  SELECT 1 FROM standing AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_jev_verdict', CASE WHEN EXISTS (
  SELECT 1 FROM jev_verdict AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE child.entity_id IS NOT NULL AND parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

CREATE TABLE _fk_row_guard (
  name TEXT PRIMARY KEY NOT NULL,
  n INTEGER NOT NULL
);

INSERT INTO _fk_row_guard (name, n) SELECT 'signal', COUNT(*) FROM signal;
INSERT INTO _fk_row_guard (name, n) SELECT 'incident', COUNT(*) FROM incident;
INSERT INTO _fk_row_guard (name, n) SELECT 'alert', COUNT(*) FROM alert;
INSERT INTO _fk_row_guard (name, n) SELECT 'standing', COUNT(*) FROM standing;
INSERT INTO _fk_row_guard (name, n) SELECT 'jev_verdict', COUNT(*) FROM jev_verdict;
INSERT INTO _fk_row_guard (name, n) SELECT 'user_decision', COUNT(*) FROM user_decision;
INSERT INTO _fk_row_guard (name, n) SELECT 'signal_delivery', COUNT(*) FROM signal_delivery;
INSERT INTO _fk_row_guard (name, n) SELECT 'incident_notice', COUNT(*) FROM incident_notice;

CREATE TABLE signal_hold AS SELECT * FROM signal;
CREATE TABLE incident_hold AS SELECT * FROM incident;
CREATE TABLE alert_hold AS SELECT * FROM alert;
CREATE TABLE standing_hold AS SELECT * FROM standing;
CREATE TABLE jev_verdict_hold AS SELECT * FROM jev_verdict;
CREATE TABLE user_decision_hold AS SELECT * FROM user_decision;
CREATE TABLE signal_delivery_hold AS SELECT * FROM signal_delivery;
CREATE TABLE incident_notice_hold AS SELECT * FROM incident_notice;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_signal', CASE WHEN (SELECT COUNT(*) FROM signal_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'signal') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_incident', CASE WHEN (SELECT COUNT(*) FROM incident_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'incident') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_alert', CASE WHEN (SELECT COUNT(*) FROM alert_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'alert') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_standing', CASE WHEN (SELECT COUNT(*) FROM standing_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'standing') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_jev_verdict', CASE WHEN (SELECT COUNT(*) FROM jev_verdict_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'jev_verdict') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_user_decision', CASE WHEN (SELECT COUNT(*) FROM user_decision_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'user_decision') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_signal_delivery', CASE WHEN (SELECT COUNT(*) FROM signal_delivery_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'signal_delivery') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_incident_notice', CASE WHEN (SELECT COUNT(*) FROM incident_notice_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'incident_notice') THEN 1 ELSE 0 END;

DROP TABLE incident_notice;
DROP TABLE jev_verdict;
DROP TABLE user_decision;
DROP TABLE signal_delivery;
DROP TABLE alert;
DROP VIEW IF EXISTS mention;
DROP VIEW IF EXISTS change;
DROP TABLE signal;
DROP TABLE incident;
DROP TABLE standing;

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
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE CASCADE,
  FOREIGN KEY (watch_id) REFERENCES watch(id) ON DELETE SET NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshot(id) ON DELETE SET NULL,
  UNIQUE (source_id, dedup_key),
  CHECK (kind <> 'mention' OR (canonical_url IS NOT NULL AND url_hash IS NOT NULL)),
  CHECK (kind <> 'change' OR aspect IS NOT NULL)
);
CREATE INDEX idx_signal_ws_time ON signal(workspace_id, observed_at);
CREATE INDEX idx_signal_entity_kind ON signal(entity_id, kind, observed_at);
CREATE INDEX idx_signal_ws_entity_time ON signal(workspace_id, entity_id, observed_at);

CREATE TABLE incident (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES page(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_incident_one_open_per_page ON incident(page_id) WHERE closed_at IS NULL;

CREATE TABLE standing (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  week_start_at TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER,
  movement INTEGER,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, entity_id, week_start_at)
);
CREATE INDEX idx_standing_week ON standing(workspace_id, week_start_at, rank);

CREATE TABLE jev_verdict (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  signal_id TEXT,
  entity_id TEXT,
  p REAL,
  choice TEXT,
  score REAL,
  reason TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (question_id, input_hash)
);
CREATE INDEX idx_jev_verdict_ws ON jev_verdict(workspace_id, decided_at);

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

CREATE TABLE alert (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT,
  signal_id TEXT,
  page_id TEXT,
  incident_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'unread',
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id) REFERENCES signal(id) ON DELETE SET NULL,
  FOREIGN KEY (page_id) REFERENCES page(id) ON DELETE SET NULL,
  FOREIGN KEY (incident_id) REFERENCES incident(id) ON DELETE SET NULL
);
CREATE INDEX idx_alert_ws_status ON alert(workspace_id, status, created_at);

CREATE TABLE incident_notice (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  sent_on TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  is_resolution INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (incident_id) REFERENCES incident(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES page(id) ON DELETE CASCADE,
  UNIQUE (page_id, sent_on, is_resolution)
);

INSERT INTO signal (
  id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
  url, canonical_url, url_hash, author, aspect, evidence_url, engagement_json, payload_json,
  dedup_key, published_at, observed_at, last_seen_at, is_tombstoned
)
SELECT
  id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
  url, canonical_url, url_hash, author, aspect, evidence_url, engagement_json, payload_json,
  dedup_key, published_at, observed_at, last_seen_at, is_tombstoned
FROM signal_hold;

INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at, closed_at)
SELECT id, workspace_id, entity_id, page_id, kind, opened_at, closed_at
FROM incident_hold;

INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
SELECT id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at
FROM standing_hold;

INSERT INTO jev_verdict (
  id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, score, reason, decided_at
)
SELECT
  id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, score, reason, decided_at
FROM jev_verdict_hold;

INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
SELECT id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at
FROM user_decision_hold;

INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at)
SELECT id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at
FROM signal_delivery_hold;

INSERT INTO alert (
  id, workspace_id, entity_id, signal_id, page_id, incident_id, kind, severity, title, body,
  status, read_at, created_at
)
SELECT
  id, workspace_id, entity_id, signal_id, page_id, incident_id, kind, severity, title, body,
  status, read_at, created_at
FROM alert_hold;

INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution)
SELECT id, incident_id, page_id, sent_on, sent_at, is_resolution
FROM incident_notice_hold;

CREATE VIEW mention AS
  SELECT id, workspace_id, entity_id, source_id, title, summary, canonical_url,
         url_hash, author, engagement_json, published_at, observed_at
  FROM signal WHERE kind = 'mention' AND is_tombstoned = 0;

CREATE VIEW change AS
  SELECT id, workspace_id, entity_id, source_id, snapshot_id, aspect, title,
         summary, evidence_url, observed_at
  FROM signal WHERE kind = 'change' AND is_tombstoned = 0;

SELECT COUNT(*) FROM mention;
SELECT COUNT(*) FROM change;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_signal', CASE WHEN NOT EXISTS (
  SELECT 1 FROM signal_hold AS h LEFT JOIN signal AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM signal) = (SELECT n FROM _fk_row_guard WHERE name = 'signal') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_incident', CASE WHEN NOT EXISTS (
  SELECT 1 FROM incident_hold AS h LEFT JOIN incident AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM incident) = (SELECT n FROM _fk_row_guard WHERE name = 'incident') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_alert', CASE WHEN NOT EXISTS (
  SELECT 1 FROM alert_hold AS h LEFT JOIN alert AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM alert) = (SELECT n FROM _fk_row_guard WHERE name = 'alert') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_standing', CASE WHEN NOT EXISTS (
  SELECT 1 FROM standing_hold AS h LEFT JOIN standing AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM standing) = (SELECT n FROM _fk_row_guard WHERE name = 'standing') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_jev_verdict', CASE WHEN NOT EXISTS (
  SELECT 1 FROM jev_verdict_hold AS h LEFT JOIN jev_verdict AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM jev_verdict) = (SELECT n FROM _fk_row_guard WHERE name = 'jev_verdict') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_user_decision', CASE WHEN NOT EXISTS (
  SELECT 1 FROM user_decision_hold AS h LEFT JOIN user_decision AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM user_decision) = (SELECT n FROM _fk_row_guard WHERE name = 'user_decision') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_signal_delivery', CASE WHEN NOT EXISTS (
  SELECT 1 FROM signal_delivery_hold AS h LEFT JOIN signal_delivery AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM signal_delivery) = (SELECT n FROM _fk_row_guard WHERE name = 'signal_delivery') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_incident_notice', CASE WHEN NOT EXISTS (
  SELECT 1 FROM incident_notice_hold AS h LEFT JOIN incident_notice AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM incident_notice) = (SELECT n FROM _fk_row_guard WHERE name = 'incident_notice') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'fk_check', CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_entity_workspace_id', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_entity_workspace_id') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_signal_ws_time', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_ws_time') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_signal_entity_kind', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_entity_kind') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_signal_ws_entity_time', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_ws_entity_time') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_incident_one_open_per_page', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_incident_one_open_per_page') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_standing_week', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_standing_week') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_jev_verdict_ws', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_jev_verdict_ws') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_user_decision_ws', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_decision_ws') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_alert_ws_status', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_alert_ws_status') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_fan_out', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_fan_out') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_blocks_entity', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_blocks_entity') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_blocks_revival', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_blocks_revival') THEN 1 ELSE 0 END;

DROP TABLE signal_hold;
DROP TABLE incident_hold;
DROP TABLE alert_hold;
DROP TABLE standing_hold;
DROP TABLE jev_verdict_hold;
DROP TABLE user_decision_hold;
DROP TABLE signal_delivery_hold;
DROP TABLE incident_notice_hold;
DROP TABLE _fk_phase_guard;
DROP TABLE _fk_row_guard;

PRAGMA defer_foreign_keys = false;
