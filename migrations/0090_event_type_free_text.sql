-- Decouple the event vocabulary from the schema (issue #2334).
--
-- Every queued source ships new event types. Today both `event_candidate`
-- and `watch_event` hard-CHECK `event_type` against a closed vocabulary
-- (migrations/0007_proof_first_change_alerts.sql:11 and :258), so adding
-- website events in 0077 required recreating the whole `watch_event` table
-- as `watch_event_site_monitoring_next`. From now on `event_type` is
-- unconstrained free text validated in code via the source adapter registry
-- (issue #2333, R1), and a new `source_kind` column records where an event
-- came from. A new event type is purely an adapter-file change — no migration.
--
-- This is the final table rebuild. Both tables are recreated once more with
-- the `_next` -> `INSERT ... SELECT` -> `DROP` -> `RENAME` convention
-- established by 0007 and 0077 (0077:40-135 and 0077:146-250), preserving
-- every existing column, value, and row. `source_kind` has no value to copy
-- from, so it is NULL for legacy rows and is populated by new sources going
-- forward.
--
-- Rollback rolls back code, never data: the event types already written by
-- the pre-0090 vocabulary remain valid free text, so reverting the code does
-- not depend on re-imposing a CHECK.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- watch_event: drop the event_type CHECK, add source_kind.
-- ---------------------------------------------------------------------------

CREATE TABLE watch_event_free_text_next (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_kind TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'detected',
      'proof_pending',
      'confirmed',
      'proof_failed',
      'suppressed',
      'invalidated'
    )
  ) DEFAULT 'confirmed',
  importance_score INTEGER NOT NULL DEFAULT 0,
  ad_id TEXT,
  baseline_from_run_id TEXT,
  candidate_id TEXT,
  proof_capture_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  confirmed_at TEXT,
  suppressed_at TEXT,
  invalidated_at TEXT,
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL,
  FOREIGN KEY (baseline_from_run_id) REFERENCES watchlist_run(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_id) REFERENCES event_candidate(id) ON DELETE SET NULL,
  FOREIGN KEY (proof_capture_id) REFERENCES proof_capture(id) ON DELETE SET NULL
);

INSERT INTO watch_event_free_text_next (
  id,
  watchlist_id,
  run_id,
  source_kind,
  event_type,
  status,
  importance_score,
  ad_id,
  baseline_from_run_id,
  candidate_id,
  proof_capture_id,
  title,
  summary,
  metadata_json,
  confirmed_at,
  suppressed_at,
  invalidated_at,
  last_evaluated_at,
  created_at
)
SELECT
  id,
  watchlist_id,
  run_id,
  NULL,
  event_type,
  status,
  importance_score,
  ad_id,
  baseline_from_run_id,
  candidate_id,
  proof_capture_id,
  title,
  summary,
  metadata_json,
  confirmed_at,
  suppressed_at,
  invalidated_at,
  last_evaluated_at,
  created_at
FROM watch_event;

DROP TABLE watch_event;
ALTER TABLE watch_event_free_text_next RENAME TO watch_event;

CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_created
  ON watch_event(watchlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_status_created
  ON watch_event(watchlist_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_event_run ON watch_event(run_id);
CREATE INDEX IF NOT EXISTS idx_watch_event_baseline_run
  ON watch_event(baseline_from_run_id) WHERE baseline_from_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- event_candidate: same decoupling so candidates and confirmed events stay
-- in sync (candidates feed confirmed events via watch_event).
-- ---------------------------------------------------------------------------

CREATE TABLE event_candidate_free_text_next (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_kind TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'detected',
      'proof_pending',
      'confirmed',
      'proof_failed',
      'suppressed',
      'invalidated'
    )
  ) DEFAULT 'detected',
  importance_score INTEGER NOT NULL DEFAULT 0,
  ad_id TEXT,
  proof_target_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  proof_required INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT CHECK (
    skip_reason IN (
      'skipped_due_to_budget',
      'skipped_due_to_rate_limit',
      'skipped_due_to_dedupe'
    )
  ),
  dedupe_reason TEXT CHECK (
    dedupe_reason IN (
      'candidate_duplicate',
      'proof_duplicate',
      'delivery_duplicate'
    )
  ),
  detected_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL
);

INSERT INTO event_candidate_free_text_next (
  id,
  watchlist_id,
  run_id,
  source_kind,
  event_type,
  status,
  importance_score,
  ad_id,
  proof_target_id,
  title,
  summary,
  metadata_json,
  proof_required,
  skip_reason,
  dedupe_reason,
  detected_at,
  last_evaluated_at,
  created_at,
  updated_at
)
SELECT
  id,
  watchlist_id,
  run_id,
  NULL,
  event_type,
  status,
  importance_score,
  ad_id,
  proof_target_id,
  title,
  summary,
  metadata_json,
  proof_required,
  skip_reason,
  dedupe_reason,
  detected_at,
  last_evaluated_at,
  created_at,
  updated_at
FROM event_candidate;

DROP TABLE event_candidate;
ALTER TABLE event_candidate_free_text_next RENAME TO event_candidate;

CREATE INDEX IF NOT EXISTS idx_event_candidate_watchlist_status_detected
  ON event_candidate(watchlist_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_candidate_run ON event_candidate(run_id);

PRAGMA foreign_keys = ON;