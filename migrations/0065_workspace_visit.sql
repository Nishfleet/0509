CREATE TABLE workspace_visit (
  workspace_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (workspace_id, day),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX idx_workspace_visit_day ON workspace_visit(day);
