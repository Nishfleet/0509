-- 0033_signal_duplicate.sql — Jev decision D8 `duplicate_signal`: a mention
-- that is the same event seen twice (syndication, repost, re-crawl) points at
-- the older row through `duplicate_of`; both rows stay. `title_hash` and
-- `norm_url_hash` are the stored normalized-title and normalized-URL hashes
-- that find the one candidate Jev is asked about (docs/REBUILD-JEV.md, D8).
-- Rows written before this file keep NULL hashes and are never candidates.
-- The mention view is recreated with the three new columns and the same WHERE.
ALTER TABLE signal ADD COLUMN title_hash TEXT;
ALTER TABLE signal ADD COLUMN norm_url_hash TEXT;
ALTER TABLE signal ADD COLUMN duplicate_of TEXT REFERENCES signal(id) ON DELETE SET NULL;

CREATE INDEX idx_signal_dup_title ON signal(entity_id, title_hash, observed_at) WHERE kind = 'mention';
CREATE INDEX idx_signal_dup_url ON signal(entity_id, norm_url_hash, observed_at) WHERE kind = 'mention';
CREATE INDEX idx_signal_duplicate_of ON signal(duplicate_of) WHERE duplicate_of IS NOT NULL;

DROP VIEW IF EXISTS mention;

CREATE VIEW mention AS
  SELECT id, workspace_id, entity_id, source_id, title, summary, canonical_url,
         url_hash, author, engagement_json, published_at, observed_at, state,
         title_hash, norm_url_hash, duplicate_of
  FROM signal WHERE kind = 'mention' AND is_tombstoned = 0;
