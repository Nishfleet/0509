-- Reconciliation reports redispatch failures as a bounded scheduled metric.
-- Recreate only the aggregate allowlist triggers; the observation table and
-- its retained evidence stay untouched.
DROP TRIGGER IF EXISTS trg_release_scheduled_observation_safe_metrics_insert;
DROP TRIGGER IF EXISTS trg_release_scheduled_observation_safe_metrics_update;

CREATE TRIGGER trg_release_scheduled_observation_safe_metrics_insert
BEFORE INSERT ON release_scheduled_observation
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.metrics_json)
  WHERE key NOT IN (
    'scanned', 'claimed', 'sent', 'alerted', 'digests', 'attempted', 'succeeded',
    'failed', 'failures', 'providerUnknown', 'superseded', 'conflicts',
    'skipped', 'recovered', 'cancelled', 'redispatched', 'redispatchFailures',
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

CREATE TRIGGER trg_release_scheduled_observation_safe_metrics_update
BEFORE UPDATE OF metrics_json ON release_scheduled_observation
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.metrics_json)
  WHERE key NOT IN (
    'scanned', 'claimed', 'sent', 'alerted', 'digests', 'attempted', 'succeeded',
    'failed', 'failures', 'providerUnknown', 'superseded', 'conflicts',
    'skipped', 'recovered', 'cancelled', 'redispatched', 'redispatchFailures',
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
