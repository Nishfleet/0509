-- Engine 6: scoring weights are rows, and the nightly count uses a
-- (workspace, entity, observed_at) index. Nullable brief columns remember the
-- UTC instant the rollover workflow is sleeping until.

CREATE INDEX idx_signal_ws_entity_time ON signal(workspace_id, entity_id, observed_at);

ALTER TABLE workspace ADD COLUMN next_brief_at TEXT;
ALTER TABLE workspace ADD COLUMN standing_instance_id TEXT;

INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES
  ('sw-mention-matters', 'mention_matters', 3, '1970-01-01T00:00:00.000Z'),
  ('sw-mention-normal', 'mention_normal', 1, '1970-01-01T00:00:00.000Z'),
  ('sw-site-change-noteworthy', 'site_change_noteworthy', 4, '1970-01-01T00:00:00.000Z'),
  ('sw-ad-new-creative', 'ad_new_creative', 2, '1970-01-01T00:00:00.000Z'),
  ('sw-ad-copy-change', 'ad_copy_change', 3, '1970-01-01T00:00:00.000Z'),
  ('sw-hiring-new-role', 'hiring_new_role', 1, '1970-01-01T00:00:00.000Z'),
  ('sw-reliability-official-api', 'reliability_official_api', 1.0, '1970-01-01T00:00:00.000Z'),
  ('sw-reliability-rss', 'reliability_rss', 0.9, '1970-01-01T00:00:00.000Z'),
  ('sw-reliability-scraped-page', 'reliability_scraped_page', 0.6, '1970-01-01T00:00:00.000Z'),
  ('sw-reliability-best-effort', 'reliability_best_effort', 0.5, '1970-01-01T00:00:00.000Z'),
  ('sw-weights-version', 'weights_version', 1, '1970-01-01T00:00:00.000Z');
