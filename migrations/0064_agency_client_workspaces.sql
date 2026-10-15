-- 0064_agency_client_workspaces.sql — several client brands under one Agency account.
-- active_workspace remembers which of an owner's workspaces they are looking at;
-- readers fall back to the oldest when the row is missing or not theirs.
-- parent_workspace_id marks a client workspace; it has no plan row of its own and
-- follows the plan of the workspace it names.
ALTER TABLE workspace ADD COLUMN parent_workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE;

CREATE TABLE active_workspace (
  user_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
CREATE INDEX idx_workspace_parent ON workspace(parent_workspace_id);
CREATE INDEX idx_active_workspace_workspace ON active_workspace(workspace_id);
