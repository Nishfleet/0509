-- Live synthetic probes for every public surface (status page truth rule).
-- One row per probe run, written by the 5-minute status-probe cron from
-- workers/app.ts via app/lib/status-probes.server.ts. `probe` uses the fixed
-- name set exported as STATUS_PROBE_NAMES; `ok` is 0/1 so the 24h ok-rate is
-- a plain AVG. Retention is 7 days and is pruned by the same cron (not by a
-- trigger) so the write path stays a plain INSERT.
CREATE TABLE IF NOT EXISTS status_probe_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probe TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  detail TEXT,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_probe_samples_probe_checked_at
  ON status_probe_samples (probe, checked_at);
