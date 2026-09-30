-- 0032_user_decision_suggestion_workspace_fk.sql — a user_decision or
-- suggestion row cannot pair workspace A with an entity that belongs to
-- workspace B. Issue #4965 finishes what #4707 started: those two tables
-- kept a bare entity_id foreign key while every other tenant child moved
-- to the composite (workspace_id, entity_id) key.
--
-- The UNIQUE index on entity(workspace_id, id) already exists
-- (idx_entity_workspace_id, from 0021); a phase-guard row aborts this file
-- if it is missing. Nothing references user_decision(id) or suggestion(id),
-- so only these two tables are rebuilt, and no other table is copied.
--
-- user_decision keeps CASCADE: deleting the entity deletes the decision,
-- exactly what the bare entity_id CASCADE did.
--
-- suggestion keeps SET NULL. A composite (workspace_id, entity_id)
-- ON DELETE SET NULL would also null workspace_id and violate NOT NULL, so
-- the rebuilt table carries both clauses: the bare entity_id SET NULL
-- (declared before the composite — SQLite runs parent-side foreign key
-- actions in declaration order, so the row's entity_id is cleared before
-- the composite check looks) and the composite pair check, which rejects a
-- cross-workspace insert and is not consulted once entity_id is NULL.
-- Do not reorder the two clauses.
--
-- takedown_blocks_suggestion is BEFORE INSERT ON suggestion and dies with
-- the table; it is recreated with the same body from 0009_takedown.sql.
-- D1 does not honour PRAGMA foreign_keys = OFF (migrations/0001_rebuild.sql),
-- so the same guard pattern as 0021 applies: an existing cross-workspace
-- pair aborts the file before any drop, a hold-count check aborts it if the
-- copy is short, and an id check aborts it if a restored row is missing.
-- No row is deleted. Do not apply this to remote D1 from a worker.

PRAGMA defer_foreign_keys = true;

CREATE TABLE _fk_phase_guard (
  name TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_entity_workspace_id', CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_entity_workspace_id'
) THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_user_decision', CASE WHEN EXISTS (
  SELECT 1 FROM user_decision AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE child.entity_id IS NOT NULL AND parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'mismatch_suggestion', CASE WHEN EXISTS (
  SELECT 1 FROM suggestion AS child
  JOIN entity AS parent ON parent.id = child.entity_id
  WHERE child.entity_id IS NOT NULL AND parent.workspace_id <> child.workspace_id
) THEN 0 ELSE 1 END;

CREATE TABLE _fk_row_guard (
  name TEXT PRIMARY KEY NOT NULL,
  n INTEGER NOT NULL
);

INSERT INTO _fk_row_guard (name, n) SELECT 'user_decision', COUNT(*) FROM user_decision;
INSERT INTO _fk_row_guard (name, n) SELECT 'suggestion', COUNT(*) FROM suggestion;

CREATE TABLE user_decision_hold AS SELECT * FROM user_decision;
CREATE TABLE suggestion_hold AS SELECT * FROM suggestion;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_user_decision', CASE WHEN (SELECT COUNT(*) FROM user_decision_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'user_decision') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'held_suggestion', CASE WHEN (SELECT COUNT(*) FROM suggestion_hold) = (SELECT n FROM _fk_row_guard WHERE name = 'suggestion') THEN 1 ELSE 0 END;

DROP TABLE user_decision;
DROP TABLE suggestion;

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
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_user_decision_ws ON user_decision(workspace_id, decided_at);
CREATE INDEX idx_user_decision_user ON user_decision(user_id);

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
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id),
  UNIQUE (workspace_id, candidate_domain)
);

CREATE TRIGGER takedown_blocks_suggestion BEFORE INSERT ON suggestion
WHEN EXISTS (SELECT 1 FROM takedown WHERE subject = NEW.candidate_domain)
BEGIN
  SELECT RAISE(IGNORE);
END;

INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
SELECT id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at
FROM user_decision_hold;

INSERT INTO suggestion (
  id, workspace_id, entity_id, kind, candidate_domain, candidate_name, evidence_json,
  verdict_p, verdict_reason, status, decided_by, decided_at, created_at
)
SELECT
  id, workspace_id, entity_id, kind, candidate_domain, candidate_name, evidence_json,
  verdict_p, verdict_reason, status, decided_by, decided_at, created_at
FROM suggestion_hold;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_user_decision', CASE WHEN NOT EXISTS (
  SELECT 1 FROM user_decision_hold AS h LEFT JOIN user_decision AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM user_decision) = (SELECT n FROM _fk_row_guard WHERE name = 'user_decision') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'restored_suggestion', CASE WHEN NOT EXISTS (
  SELECT 1 FROM suggestion_hold AS h LEFT JOIN suggestion AS s ON s.id = h.id WHERE s.id IS NULL
) AND (SELECT COUNT(*) FROM suggestion) = (SELECT n FROM _fk_row_guard WHERE name = 'suggestion') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'fk_check', CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_user_decision_ws', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_decision_ws') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'idx_user_decision_user', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_decision_user') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_blocks_suggestion', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_blocks_suggestion') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_fan_out', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_fan_out') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_blocks_entity', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_blocks_entity') THEN 1 ELSE 0 END;

INSERT INTO _fk_phase_guard (name, ok)
SELECT 'trigger_takedown_blocks_revival', CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'takedown_blocks_revival') THEN 1 ELSE 0 END;

DROP TABLE user_decision_hold;
DROP TABLE suggestion_hold;
DROP TABLE _fk_phase_guard;
DROP TABLE _fk_row_guard;

PRAGMA defer_foreign_keys = false;
