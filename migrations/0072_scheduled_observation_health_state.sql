-- Durable activation baselines prevent a newly enabled schedule from
-- paging before it has had one full cadence in which to produce evidence.
-- State is aggregate-only and cannot contain customer or provider data.
CREATE TABLE IF NOT EXISTS scheduled_observation_health_state (
  cron TEXT PRIMARY KEY NOT NULL CHECK (
    cron IN ('17 */6 * * *', '0 */3 * * *', '0 4 * * *', '0 5 * * MON')
  ),
  baseline_at TEXT NOT NULL,
  had_observation INTEGER NOT NULL DEFAULT 0 CHECK (had_observation IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_scheduled_observation_cron_scheduled
  ON release_scheduled_observation(cron, scheduled_at);
