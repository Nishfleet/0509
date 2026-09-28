-- 0509#5755 (audit §V26): five hot or scheduled statements full-scan their
-- table because the column they filter on has no child index. Each of the five
-- statements below is a nightly job or a request-path read; the plan was SCAN
-- before this file and SEARCH ... USING INDEX after it.
--   onboarding_run(workspace_id) — the /app landing read, ordered by started_at
--   signal(watch_id)             — the hiring read and the watch delete cascade
--   send_attempt(digest_id)      — the dead-letter reader, ordered by attempted_at
--   session(expiresAt)           — the nightly expired-session delete
--   digest(status)               — the nightly pending-brief sweep, ranged by period_end
-- Expand-only: CREATE INDEX only, no DROP, no ALTER, no rename, no NOT NULL, so
-- the previous Worker version keeps working unchanged.

CREATE INDEX idx_onboarding_run_workspace ON onboarding_run(workspace_id, started_at);
CREATE INDEX idx_signal_watch_kind ON signal(watch_id, kind);
CREATE INDEX idx_send_attempt_digest ON send_attempt(digest_id, attempted_at DESC);
CREATE INDEX idx_session_expires ON session(expiresAt);
CREATE INDEX idx_digest_status_period ON digest(status, period_end);
