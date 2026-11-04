-- 0072_one_onboarding_run_per_workspace.sql — a workspace has one onboarding run. Until now only
-- the writer's WHERE NOT EXISTS held that rule (app/lib/data/onboarding_run.server.ts), so a
-- second writer could add another run and every reader had to pick the earliest. This deletes
-- any later run per workspace (readers never saw them: both read the earliest started_at), then
-- the unique index makes a second run an error for every writer
-- (https://www.sqlite.org/lang_createindex.html#unique_indexes). The old (workspace_id, started_at)
-- index then has nothing left to sort, so it goes. Undo: D1 Time Travel.

DELETE FROM onboarding_run
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY started_at ASC, id ASC) AS rank
    FROM onboarding_run
  )
  WHERE rank > 1
);

CREATE UNIQUE INDEX onboarding_run_one_per_workspace ON onboarding_run(workspace_id);

DROP INDEX idx_onboarding_run_workspace;
