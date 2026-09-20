-- Jev advisory digest scoring (Nishfleet/0509#3539; epic #3530): one row per
-- scored digest candidate, written only while the JEV_ALERTS var is on.
--
-- Expand/contract phase 1 — ADD ONLY. New table, no drops, no renames, no
-- NOT NULL added to an existing table. The previous Worker version neither
-- reads nor writes this table, so a code rollback leaves it harmless.
--
-- Rows are keyed (digest_run_id, event_id): event_id is the watch_event id the
-- digest item was built from (digest_item keeps it inside metadata_json), so a
-- score row joins back to the persisted digest item and to the watch_event
-- itself. Retried runs upsert the same key — a row reflects the latest
-- advisory call for that run, never a duplicate.
--
-- Nothing here gates delivery. worth_telling_p / worth_alert are evidence for
-- the Nishfleet/0509#3531 benchmark; would_suppress is the code's own
-- provisional "the selected cohort would have dropped this item" flag,
-- computed from stored columns at write time, not a model verdict. No row is
-- ever read by the cohort, ordering, or delivery paths.
CREATE TABLE IF NOT EXISTS digest_item_jev_score (
  id TEXT PRIMARY KEY NOT NULL,
  digest_run_id TEXT NOT NULL,
  -- watch_event.id the digest item was built from; no FK because digest_item
  -- itself carries it only inside metadata_json.
  event_id TEXT NOT NULL,
  watchlist_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  -- 1 when the existing priorityScore cohort selected the item for delivery;
  -- 0 for scored candidates outside the cohort (the would-rescue side).
  in_cohort INTEGER NOT NULL CHECK (in_cohort IN (0, 1)),
  -- The heuristic priorityScore the cohort ranked on, stored beside Jev's
  -- answers so the benchmark compares like for like without re-deriving it.
  priority_score REAL,
  -- Noul probability that this item is worth telling the customer about.
  worth_telling_p REAL NOT NULL CHECK (worth_telling_p >= 0 AND worth_telling_p <= 1),
  -- Ordinal significance, the issue's worth_alert band.
  worth_alert INTEGER NOT NULL CHECK (worth_alert BETWEEN 0 AND 3),
  worth_alert_confidence REAL,
  -- Provisional would-suppress flag: an in-cohort item whose worth_telling_p
  -- fell below DIGEST_ALERTS_WOULD_SUPPRESS_BELOW. Advisory only.
  would_suppress INTEGER NOT NULL DEFAULT 0 CHECK (would_suppress IN (0, 1)),
  -- SHA-256 of the exact state sent to the model (stable-json), so a row is
  -- traceable to its input.
  state_sha256 TEXT NOT NULL,
  -- Model id the binding reported answering with.
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (digest_run_id) REFERENCES digest_run(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  UNIQUE (digest_run_id, event_id)
);

-- The benchmark read shape is "every scored item for one run".
CREATE INDEX IF NOT EXISTS idx_digest_item_jev_score_run
  ON digest_item_jev_score (digest_run_id);
