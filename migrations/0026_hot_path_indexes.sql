-- 0509#5755 (audit §V26): five hot or scheduled statements full-scanned their
-- table because the column they filter on had no child index. Each index carries
-- the column the statement orders or ranges by, so the two that sorted through a
-- temp B-tree no longer do.
--   onboarding_run(workspace_id, started_at) — the /app landing read
--   signal(watch_id, kind)                    — the hiring read, the watch cascade
--   send_attempt(digest_id, attempted_at)     — the dead-letter reader
--   digest(status, period_end)                — the nightly pending-brief sweep
-- The class gate the issue asked for found a sixth in the same nightly auth
-- sweep as the session delete, so verification(expiresAt) is indexed here too.
-- Still scanning on purpose: the sweeper's second read filters
-- send_attempt(status, attempted_at), not a child column, and belongs to the
-- pending-sweeper issue (#4008).
-- Expand-only: CREATE INDEX only, no DROP, no ALTER, no rename, no NOT NULL, so
-- the previous Worker version keeps working unchanged and a rollback is a code
-- rollback.

CREATE INDEX idx_onboarding_run_workspace ON onboarding_run(workspace_id, started_at);
CREATE INDEX idx_signal_watch_kind ON signal(watch_id, kind);
CREATE INDEX idx_send_attempt_digest ON send_attempt(digest_id, attempted_at DESC);
CREATE INDEX idx_session_expires ON session(expiresAt);
CREATE INDEX idx_verification_expires ON verification(expiresAt);
CREATE INDEX idx_digest_status_period ON digest(status, period_end);
