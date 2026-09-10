-- Per-domain state for the hourly demo-brand proof-hole catch-up (issue #2364).
--
-- `runDemoBrandProofHoleCatchUp` fires a Browser Rendering capture pass on the
-- hourly cron whenever any demo brand has zero public proof rows. Before this
-- table a persistently blocked domain spent up to 24 capture passes per day
-- indefinitely with only a console.log outcome — nobody was paged when the hole
-- never closed. This table gives the catch-up durable state to:
--
--   1. Cap capture attempts at 3 per domain per UTC day, so a blocked brand
--      cannot re-spend Browser Run minutes all day long.
--   2. Track consecutive fully-failed UTC days per domain, so after 3 such days
--      the domain stops capturing entirely and the worker routes one throttled
--      operator alert through the existing cron-failure mechanism
--      (`alertScheduledTaskFailure`, table `cron_failure_alert_throttle`).
--
-- A "failed day" is a UTC day where the domain had at least one capture attempt
-- and every attempt that day failed (`attempts_today > 0 AND day_succeeded = 0`
-- at day rollover). A day with a success resets the streak to zero. Days with
-- no attempt leave the streak unchanged.
--
-- The row is finalized (day rollover + streak increment) by the worker code in
-- `app/lib/demo-brand-backfill.server.ts`; this migration only supplies the
-- schema. Rollback rolls back code, never data: if the code reverts, the extra
-- rows are inert and harmless until a future run of the new path consumes them.
CREATE TABLE IF NOT EXISTS demo_brand_proof_hole_state (
  domain TEXT PRIMARY KEY NOT NULL,
  -- The last UTC-day bucket the catch-up recorded for this domain.
  day TEXT NOT NULL,
  -- Capture attempts already spent within `day` (the 3/day cap).
  attempts_today INTEGER NOT NULL DEFAULT 0,
  -- 1 once any attempt within `day` succeeded (used to finalize the failed-day
  -- verdict at the next UTC-day rollover).
  day_succeeded INTEGER NOT NULL DEFAULT 0,
  -- Consecutive fully-failed UTC days, counted at each day rollover.
  consecutive_failed_days INTEGER NOT NULL DEFAULT 0,
  -- 1 once `consecutive_failed_days` reached the stop threshold; the domain is
  -- then skipped on every subsequent pass (no further capture, no re-alert).
  stopped INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);