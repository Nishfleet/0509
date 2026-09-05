-- Durable activation baselines prevent a newly enabled schedule from
-- paging before it has had one full cadence in which to produce evidence.
-- State is aggregate-only and cannot contain customer or provider data.
-- WP-50: '37 */12 * * *' (brand-page refresh) is added to the allowed cron
-- set so the dedicated 12-hourly /ads/:domain refresh gets the same
-- one-cadence grace window every other workload schedule gets before the
-- gap-check starts paging on a missed run.
CREATE TABLE IF NOT EXISTS scheduled_observation_health_state (
  cron TEXT PRIMARY KEY NOT NULL CHECK (
    cron IN ('17 */6 * * *', '37 */12 * * *', '0 */3 * * *', '0 4 * * *', '0 5 * * MON')
  ),
  baseline_at TEXT NOT NULL,
  had_observation INTEGER NOT NULL DEFAULT 0 CHECK (had_observation IN (0, 1)),
  updated_at TEXT NOT NULL
);

-- Seed activation baselines during migration so every subsequent health read
-- is side-effect free. Replaying the migration preserves the original grace
-- window rather than renewing it.
INSERT OR IGNORE INTO scheduled_observation_health_state (
  cron, baseline_at, had_observation, updated_at
)
SELECT cron, activated_at, 0, activated_at
FROM (
  SELECT '17 */6 * * *' AS cron, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS activated_at
  UNION ALL SELECT '37 */12 * * *', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  UNION ALL SELECT '0 */3 * * *', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  UNION ALL SELECT '0 4 * * *', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  UNION ALL SELECT '0 5 * * MON', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE INDEX IF NOT EXISTS idx_release_scheduled_observation_cron_scheduled
  ON release_scheduled_observation(cron, scheduled_at);

-- Aggregate-only throttle state for the gap alert. The bitmask identifies
-- which of the fixed workload schedules were unhealthy at the last
-- accepted page; it cannot contain customer or provider data.
-- WP-50: 5 crons now → mask supports up to 31.
CREATE TABLE IF NOT EXISTS scheduled_observation_alert_state (
  alert_key TEXT PRIMARY KEY NOT NULL CHECK (alert_key = 'scheduled_observation_gap'),
  last_alerted_at TEXT,
  unhealthy_mask INTEGER NOT NULL CHECK (unhealthy_mask BETWEEN 1 AND 31),
  last_attempted_at TEXT NOT NULL,
  last_attempt_outcome TEXT NOT NULL CHECK (
    last_attempt_outcome IN ('accepted', 'rejected', 'provider_unknown')
  )
);
