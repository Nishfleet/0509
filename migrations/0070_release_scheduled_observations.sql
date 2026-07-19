-- Sanitized, version-bound evidence for the production scheduled-workload soak.
-- Rows intentionally contain no workspace, user, customer, provider, message,
-- payment, URL, payload, or raw-error identifiers. Platform retries remain
-- separate rows so duplicate scheduled invocations cannot be hidden.
CREATE TABLE IF NOT EXISTS release_scheduled_observation (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  worker_version_id TEXT NOT NULL CHECK (length(worker_version_id) BETWEEN 1 AND 128),
  cron TEXT NOT NULL CHECK (cron IN ('17 */6 * * *', '0 */3 * * *', '0 4 * * *', '0 5 * * MON')),
  task_name TEXT NOT NULL CHECK (task_name IN (
    'billing_lifecycle_email_recovery',
    'weekly_business_numbers',
    'digest_schedule_exhaustion_recovery',
    'digest_schedule_recovery',
    'discovery_warmup',
    'monitoring_fanout_reconciliation',
    'instant_alert_flush',
    'retention_sweep',
    'presence_polling_batch',
    'scheduled_monitoring',
    'customer_at_risk_alert'
  )),
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 900000),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'no_work', 'degraded', 'threw')),
  failure_category TEXT CHECK (
    failure_category IS NULL OR failure_category IN ('timeout', 'runtime_error', 'non_error_throw')
  ),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json) AND length(metrics_json) <= 2048),
  created_at TEXT NOT NULL,
  CHECK (
    (outcome = 'threw' AND failure_category IS NOT NULL) OR
    (outcome <> 'threw' AND failure_category IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_release_scheduled_observation_version_window
  ON release_scheduled_observation(worker_version_id, scheduled_at, task_name);

CREATE INDEX IF NOT EXISTS idx_release_scheduled_observation_retention
  ON release_scheduled_observation(completed_at);

-- Defense in depth: even another future writer cannot put identifiers or
-- arbitrary strings into the aggregate-only metrics object.
CREATE TRIGGER IF NOT EXISTS trg_release_scheduled_observation_safe_metrics_insert
BEFORE INSERT ON release_scheduled_observation
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.metrics_json)
  WHERE key NOT IN (
    'scanned', 'claimed', 'sent', 'alerted', 'digests', 'attempted', 'succeeded',
    'failed', 'failures', 'providerUnknown', 'superseded', 'conflicts',
    'skipped', 'recovered', 'cancelled', 'redispatched',
    'firstScanRedispatched', 'firstScanCancelled', 'firstScanFailures',
    'groups', 'attempts', 'deleted', 'failedSteps', 'polled',
    'skippedRollout', 'spentUnits', 'queued', 'duplicates', 'inlineRuns',
    'inlineFailures', 'skippedForBudget', 'skippedForBilling',
    'dispatchFailures', 'digestAttempts', 'digestFailures', 'signals'
  ) OR type NOT IN ('integer', 'true', 'false')
)
BEGIN
  SELECT RAISE(ABORT, 'unsafe_release_scheduled_metrics');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_scheduled_observation_safe_metrics_update
BEFORE UPDATE OF metrics_json ON release_scheduled_observation
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.metrics_json)
  WHERE key NOT IN (
    'scanned', 'claimed', 'sent', 'alerted', 'digests', 'attempted', 'succeeded',
    'failed', 'failures', 'providerUnknown', 'superseded', 'conflicts',
    'skipped', 'recovered', 'cancelled', 'redispatched',
    'firstScanRedispatched', 'firstScanCancelled', 'firstScanFailures',
    'groups', 'attempts', 'deleted', 'failedSteps', 'polled',
    'skippedRollout', 'spentUnits', 'queued', 'duplicates', 'inlineRuns',
    'inlineFailures', 'skippedForBudget', 'skippedForBilling',
    'dispatchFailures', 'digestAttempts', 'digestFailures', 'signals'
  ) OR type NOT IN ('integer', 'true', 'false')
)
BEGIN
  SELECT RAISE(ABORT, 'unsafe_release_scheduled_metrics');
END;
