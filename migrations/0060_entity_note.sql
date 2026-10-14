-- 0060_entity_note.sql — one private note per competitor, written by the workspace.
-- Additive. Deleting the competitor or the workspace deletes the note (cascade),
-- so "Remove and forget" and account delete need no extra code.
CREATE TABLE entity_note (
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, entity_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
