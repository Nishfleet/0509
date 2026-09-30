-- 0030_signal_state.sql — 0509#6076 (part 1 of #5368): a mention whose Jev
-- judgment never ran is stored, not dropped. `state` is NULL on every row
-- written before this file; new mention rows carry 'judged' or 'unjudged'.
-- The mention view is recreated here, with the same WHERE, because the parts
-- that read `state` (#6077, #6078) carry no migrations: part 1 owns all of it.
ALTER TABLE signal ADD COLUMN state TEXT CHECK (state IS NULL OR state IN ('judged', 'unjudged'));

DROP VIEW IF EXISTS mention;

CREATE VIEW mention AS
  SELECT id, workspace_id, entity_id, source_id, title, summary, canonical_url,
         url_hash, author, engagement_json, published_at, observed_at, state
  FROM signal WHERE kind = 'mention' AND is_tombstoned = 0;
