-- 0005_scoring_weight_seed.sql — v1 scoring_weight rows and the signal counting index.
-- Issue #4414 (engine 6, P6.1).
--
-- Weights live in scoring_weight, not in code. effective_from is the version:
-- a later change applies from the next rollover and never rewrites a week
-- already scored. The index is the one the trailing-7-day count reads:
-- workspace, entity, then observed_at.

INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES
  ('sw-v1-mention_matters', 'mention_matters', 3, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-mention_normal', 'mention_normal', 1, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-site_change_noteworthy', 'site_change_noteworthy', 4, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-ad_new_creative', 'ad_new_creative', 2, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-ad_copy_change', 'ad_copy_change', 3, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-hiring_new_role', 'hiring_new_role', 1, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-reliability_official_api', 'reliability_official_api', 1.0, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-reliability_rss', 'reliability_rss', 0.9, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-reliability_scraped_page', 'reliability_scraped_page', 0.6, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-reliability_best_effort', 'reliability_best_effort', 0.5, '2026-01-01T00:00:00.000Z'),
  ('sw-v1-weights_version', 'weights_version', 1, '2026-01-01T00:00:00.000Z');

CREATE INDEX idx_signal_ws_entity_time ON signal(workspace_id, entity_id, observed_at);
