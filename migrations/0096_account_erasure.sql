-- Issue #2982: self-serve GDPR/CCPA erasure. Two additive tables:
--
--   account_erasure_request — the live clock. A signed-in user files a
--   request; the daily scheduled rail erases every row keyed to that user
--   once `execute_after` (the grace window) passes. The row is deleted with
--   the rest of the user's data, so no live state outlives erasure.
--
--   account_erasure_audit — the durable proof. Written in the same batch as
--   the deletes. It carries a one-way hash of the user id (never the id or
--   email), the request/completion timestamps, and the per-table delete
--   counts, so "the erasure ran" is auditable without retaining a live key.
--
-- One-way by design: CREATE TABLE is additive; nothing here breaks the
-- previous code version.

CREATE TABLE IF NOT EXISTS account_erasure_request (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'failed')),
  requested_at TEXT NOT NULL,
  execute_after TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One live request per user. Partial so a cancelled/failed row never blocks
-- a fresh request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_erasure_request_pending_user
  ON account_erasure_request (user_id) WHERE status = 'pending';

-- The daily sweep's due-work lookup.
CREATE INDEX IF NOT EXISTS idx_account_erasure_request_due
  ON account_erasure_request (status, execute_after);

CREATE TABLE IF NOT EXISTS account_erasure_audit (
  id TEXT PRIMARY KEY NOT NULL,
  user_id_hash TEXT NOT NULL,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  execute_after TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  requested_via TEXT,
  deleted_counts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_erasure_audit_user_hash
  ON account_erasure_audit (user_id_hash);
