-- Workspace membership invariants.
--
-- Preflight before applying on an existing database (this migration must not
-- repair or delete duplicate rows):
-- SELECT member_user_id, COUNT(*) AS active_count
-- FROM workspace_member
-- WHERE status = 'active' AND member_user_id IS NOT NULL
-- GROUP BY member_user_id
-- HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_active_member
  ON workspace_member(member_user_id)
  WHERE status = 'active' AND member_user_id IS NOT NULL;
