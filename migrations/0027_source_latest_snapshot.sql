-- 0027_source_latest_snapshot.sql — per-source latest snapshot facts (parent #5722, slice 1).
--
-- The source registry read must not recompute the latest fetched_at, item_count
-- and canary_count with a correlated subquery on every request. This slice adds
-- three denormalised columns to source, seeds them from the snapshots already
-- stored, and the snapshot writer maintains them from now on.
--
-- Expand-only, in the order D1 requires: nullable columns first, seed last, so
-- the previous Worker version (which does not read these columns yet) keeps
-- reading this schema unchanged. No DROP, no rename, no NOT NULL — a code
-- rollback stays safe.
--
-- Historical facts, not a mirror: the rows they summarise cascade away with a
-- deleted entity (0001_rebuild.sql) and are never restored, so these three
-- columns keep reporting the last fetch a source made.
--
-- A tie on fetched_at is not resolved exactly. The seed takes MAX(fetched_at)
-- for the timestamp and the newest row the scan reaches for the counts, and the
-- runtime writer keeps the first committed set (its guard is a strict `<`).
-- These columns record one real fetch per source, not a tie-broken winner.
--
-- Multi-statement atomicity inside one D1 migration is not documented, so this
-- file assumes none: if the seed fails after the ALTERs commit, a retry stops
-- on duplicate column name and the recovery is a corrective migration — the
-- same contract 0018_source_canary.sql runs under.

ALTER TABLE source ADD COLUMN latest_fetched_at TEXT;
ALTER TABLE source ADD COLUMN latest_item_count INTEGER;
ALTER TABLE source ADD COLUMN latest_canary_count INTEGER;
UPDATE source SET
  latest_fetched_at = (SELECT MAX(sn.fetched_at) FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.source_id = source.id),
  latest_item_count = (SELECT sn.item_count FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.source_id = source.id ORDER BY sn.fetched_at DESC LIMIT 1),
  latest_canary_count = (SELECT sn.canary_count FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.source_id = source.id ORDER BY sn.fetched_at DESC LIMIT 1);
