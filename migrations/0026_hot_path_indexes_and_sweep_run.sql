-- 0509#5755 (audit §V26): five hot or scheduled statements full-scanned their
-- table because the column they filter on had no child index. Each index carries
-- the column the statement orders or ranges by, so the two that sorted through a
-- temp B-tree no longer do.
--   onboarding_run(workspace_id, started_at) — the /app landing read
--   signal(watch_id, kind)                    — the hiring read, the watch cascade
--   send_attempt(digest_id, attempted_at)     — the dead-letter reader
--   session(expiresAt)                        — the nightly auth-expiry sweep
--   digest(status, period_end)                — the nightly pending-brief sweep
-- The class gate the issue asked for found two more in the same nightly
-- sweeps: verification(expiresAt) sits next to the session delete, and the
-- sweeper's second read filters send_attempt(status, attempted_at) — not a
-- child column, so it was left to the pending-sweeper epic #4008, but #4008's
-- implementation children are closed and nobody owned the index. It is here
-- as send_attempt(status, digest_id): with the DISTINCT on digest_id the index
-- covers the whole statement — SEARCH with no temp B-tree; the narrower
-- (status, attempted_at) shape reintroduces one.
-- The gate's allowlist audit also found five FK children with no index on the
-- account-delete cascade, proven with EXPLAIN QUERY PLAN on the applied chain:
-- `DELETE FROM "user"` scans onboarding_run and user_decision, and deleting
-- the cascaded workspace row scans incident, send_attempt and signal_delivery
-- (`DELETE FROM workspace` shows the three). The audit named
-- idx_onboarding_run_user for the first of these. The nineteen FK children
-- whose parent is never deleted on a live path stay allowlisted in the gate;
-- they are tracked by #5938.
--
-- Same migration, audit §V8: PR #5326 added sweep_run and was closed unmerged
-- over a migration-number collision, so the table never landed while #5304,
-- #4118 and #4042 build on it. Every finished site sweep writes one row —
-- planned time, finish time, wall clock in ms, page count and failed count —
-- so a cap decision starts with arithmetic. wall_ms runs from workflow-instance
-- create to finish, so it holds queue wait and step retries too, not just the
-- sweep's own compute. app/lib/data/sweep_run.server.ts writes the row from
-- workers/workflows/site-sweep.ts.
--
-- Expand-only: CREATE INDEX and CREATE TABLE only, no DROP, no ALTER, no
-- rename, no NOT NULL added to an existing table, so the previous Worker
-- version (which never reads sweep_run) keeps working unchanged and a rollback
-- is a code rollback.

CREATE INDEX idx_onboarding_run_workspace ON onboarding_run(workspace_id, started_at);
CREATE INDEX idx_signal_watch_kind ON signal(watch_id, kind);
CREATE INDEX idx_send_attempt_digest ON send_attempt(digest_id, attempted_at DESC);
CREATE INDEX idx_session_expires ON session(expiresAt);
CREATE INDEX idx_verification_expires ON verification(expiresAt);
CREATE INDEX idx_digest_status_period ON digest(status, period_end);

CREATE INDEX idx_onboarding_run_user ON onboarding_run(user_id);
CREATE INDEX idx_user_decision_user ON user_decision(user_id);
CREATE INDEX idx_incident_workspace ON incident(workspace_id);
CREATE INDEX idx_send_attempt_workspace ON send_attempt(workspace_id);
CREATE INDEX idx_signal_delivery_workspace ON signal_delivery(workspace_id);
CREATE INDEX idx_send_attempt_status_digest ON send_attempt(status, digest_id);

CREATE TABLE sweep_run (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, planned_at TEXT NOT NULL, finished_at TEXT NOT NULL, wall_ms INTEGER NOT NULL, pages INTEGER NOT NULL, failed INTEGER NOT NULL);
CREATE INDEX idx_sweep_run_kind_time ON sweep_run(kind, finished_at);
