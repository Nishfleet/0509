-- Landing-page CTA-change detector pipeline bail-out reason-code counters.
--
-- Issue #2157: cta_pipeline_stage_counts (migration 0083) records per-stage
-- funnel COUNTS (how many checks reached each stage) but carries no bail
-- reason, so "top 5 bail-out reasons by frequency" is still not queryable from
-- D1. The bail-out reason codes (landing_rate_limited, landing_blocked,
-- empty_after_strip, no_anchors, no_cta_candidates, no_price_pattern, ...)
-- only lived in the `lp_run_audit` log lines as `outcome: "bailed:<reason>"`,
-- and the deploy token cannot reach the Logpush / Logs Engine APIs.
--
-- This new table makes the bail-out reason-code frequency queryable so #1538's
-- Gate 1 (top-5 bail-out reasons by frequency) lands without a Logpush sink:
--
--   SELECT reason, SUM(count) FROM cta_pipeline_bail_reason_counts
--   WHERE day >= date('now','-7 days') GROUP BY reason ORDER BY 2 DESC LIMIT 5;
--
-- One row per (day, stage, reason). The `stage` is one of the six funnel
-- stages from cta_pipeline_stage_counts (checks_started, page_fetch_succeeded,
-- validity_passed, dom_extracted, diff_computed, event_emitted); `reason` is
-- the bail-out reason code the recorder carries from the pipeline counters
-- (the same vocabulary the lp_run_audit lines emit). A check that bailed at
-- fetch writes (day, 'page_fetch_succeeded', <fetch reason>); a check that
-- reached the end and emitted an event writes nothing (it did not bail).
--
-- Additive and one-way (expand/contract): a new table, no existing column or
-- table is dropped or renamed, no NOT NULL is added without a DEFAULT.
-- Rolling back the PR simply drops the writes; the table itself is inert if
-- unused. The existing cta_pipeline_stage_counts table is NOT modified.
CREATE TABLE IF NOT EXISTS cta_pipeline_bail_reason_counts (
  day TEXT NOT NULL,
  stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, stage, reason)
);

CREATE INDEX IF NOT EXISTS idx_cta_pipeline_bail_reason_counts_day
  ON cta_pipeline_bail_reason_counts(day);
