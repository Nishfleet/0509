-- 0028_signal_state.sql — 0509#6076 (part 1 of #5368): a mention whose Jev
-- judgment never ran is stored, not dropped. `state` is NULL on every row
-- written before this file; new mention rows carry 'judged' or 'unjudged'.
-- Expand-only: an additive nullable ALTER, no DROP of a table or column, no
-- rename, no NOT NULL without a DEFAULT. The mention view is recreated with
-- the same WHERE so the feed read path can see `state` without a later
-- migration (parts 2 and 3 carry none).
ALTER TABLE signal ADD COLUMN state TEXT CHECK (state IS NULL OR state IN ('judged', 'unjudged'));

DROP VIEW IF EXISTS mention;

CREATE VIEW mention AS
  SELECT id, workspace_id, entity_id, source_id, state, title, summary, canonical_url,
         url_hash, author, engagement_json, published_at, observed_at
  FROM signal WHERE kind = 'mention' AND is_tombstoned = 0;
