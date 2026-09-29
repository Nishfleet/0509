-- 0018_source_canary.sql — per-source canary columns (parent #4003, slice 1/6).
--
-- docs/engines/mentions.md P5.4: every source poll also runs its registry canary
-- query and stores the count on the snapshot row beside item_count. A canary of
-- zero marks the source degraded with a reason and a last-good timestamp, so a
-- dead source never renders as "0 mentions". A non-null canary_query on the
-- source row IS the expected-nonzero flag — no separate flag column.
-- app/components/source-pill.tsx already reads degraded_reason, last_good_at and
-- snapshot.canary_count; this migration is the schema those reads need.
--
-- Expand-only, in the order D1 requires: nullable columns first, seed last, so
-- the previous Worker version (which has no canary code yet) keeps reading this
-- schema unchanged. No DROP, no rename, no NOT NULL — a code rollback stays
-- safe.

ALTER TABLE source ADD COLUMN canary_query TEXT;
ALTER TABLE source ADD COLUMN degraded_reason TEXT;
ALTER TABLE source ADD COLUMN last_good_at TEXT;
ALTER TABLE snapshot ADD COLUMN canary_count INTEGER;
UPDATE source SET canary_query = 'google' WHERE key IN ('gdelt.doc', 'hn.algolia');
