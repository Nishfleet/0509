-- Org-scoped ownership foundation (Agency mode, issue #2176, phase 1).
--
-- The product data model is keyed by local user.id (README admits it), which
-- blocks multi-workspace organization membership. This migration introduces
-- the org concept and the nullable org_id columns that later phases dual-write
-- and read-switch to. Phase 1 only: add nullable columns + backfill personal
-- orgs. No data loss; reversible by dropping the added columns and the org
-- table (see the rollback note in the PR body).

-- Every user gets a personal org. The org is the unit of ownership that
-- watchlists, rooms, share links and API keys will be keyed to.
CREATE TABLE IF NOT EXISTS org (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_owner_user ON org(owner_user_id);

-- Backfill: every existing user gets a personal org. Deterministic id
-- ('org_' || user.id) so re-running is idempotent and the mapping is stable.
-- No data loss: this only inserts new rows.
INSERT OR IGNORE INTO org (id, name, owner_user_id, created_at, updated_at)
SELECT 'org_' || id, name, id, createdAt, updatedAt FROM user;

-- Nullable org_id columns (phase 1: add nullable column; dual-write follows in
-- a later phase). Nullable with no default so the previous code keeps working
-- the instant this lands — the expand/contract rule.
ALTER TABLE watchlist ADD COLUMN org_id TEXT;
ALTER TABLE share_link ADD COLUMN org_id TEXT;
ALTER TABLE customer_api_key ADD COLUMN org_id TEXT;
ALTER TABLE client_room ADD COLUMN org_id TEXT;

CREATE INDEX IF NOT EXISTS idx_watchlist_org_id ON watchlist(org_id);
CREATE INDEX IF NOT EXISTS idx_share_link_org_id ON share_link(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_api_key_org_id ON customer_api_key(org_id);
CREATE INDEX IF NOT EXISTS idx_client_room_org_id ON client_room(org_id);
