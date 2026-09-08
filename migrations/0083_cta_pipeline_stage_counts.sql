-- Landing-page CTA-change detector pipeline stage counters.
--
-- Issue #1565: the CTA detector was near-silent (4 events in 4 months across
-- 88 watchlists) and there was no per-stage counter to show which gate was
-- dropping the signal. The pipeline already emits a per-check JSON log line
-- (landing_page_pipeline_check) via
-- app/lib/landing-page-pipeline-instrumentation.server.ts, but that log is
-- not queryable in D1. This table makes the per-stage funnel queryable so an
-- operator (or the fleet) can run:
--
--   SELECT stage, SUM(count) FROM cta_pipeline_stage_counts
--   WHERE day >= date('now','-3 days') GROUP BY stage;
--
-- and see, per day, how many checks started, how many reached each stage, and
-- how many emitted an event. The six stages are the issue's accept-criteria
-- funnel:
--
--   checks_started        — every landing-page check that began
--   page_fetch_succeeded  — the page fetch (or replay) produced a snapshot
--   validity_passed       — the capture-validity gate classified the capture
--                           as a real page (not an error/challenge/cookie wall)
--   dom_extracted         — the DOM extraction stage ran and produced fields
--   diff_computed         — the change-diff stage ran against a prior capture
--   event_emitted         — the check confirmed at least one landing_page_* event
--
-- The table is additive and one-way (expand/contract): it is a new table, no
-- existing column or table is dropped or renamed, and no NOT NULL is added
-- without a DEFAULT. Rolling back the PR simply drops the writes; the table
-- itself is inert if unused.
CREATE TABLE IF NOT EXISTS cta_pipeline_stage_counts (
  day TEXT NOT NULL,
  stage TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, stage)
);

CREATE INDEX IF NOT EXISTS idx_cta_pipeline_stage_counts_day
  ON cta_pipeline_stage_counts(day);
