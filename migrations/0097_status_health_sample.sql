-- Issue: /status must measure uptime, not confess it cannot.
--
-- The public status page needs a real uptime figure. The service already runs
-- five cron schedules; each invocation now drops one tiny health sample row
-- here (edge ran, D1 answered SELECT 1). Hourly-plus cadence gives ~25-35
-- samples/day, and retention is 7 days (the writer deletes older rows in the
-- same batch), so the table stays a few hundred rows at most.
--
-- Read-only consumers: app/lib/public-status-counters.server.ts
-- (readStatusUptime) renders the "Uptime (last 24h)" row on /status. No
-- tenant data is ever written here: only the cron name, a timestamp, and a
-- boolean.

CREATE TABLE IF NOT EXISTS status_health_sample (
  id TEXT PRIMARY KEY NOT NULL,
  checked_at TEXT NOT NULL,
  d1_ok INTEGER NOT NULL CHECK (d1_ok IN (0, 1)),
  cron_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_health_sample_checked_at
  ON status_health_sample(checked_at);
