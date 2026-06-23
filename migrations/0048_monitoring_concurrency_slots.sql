-- Atomic concurrency permits for monitoring fan-out (one row per slot).
CREATE TABLE monitoring_concurrency_slot (
  slot_index INTEGER PRIMARY KEY,
  holder_run_id TEXT,
  holder_token TEXT,
  leased_at TEXT
);

WITH RECURSIVE slots(n) AS (
  SELECT 0
  UNION ALL
  SELECT n + 1 FROM slots WHERE n < 63
)
INSERT OR IGNORE INTO monitoring_concurrency_slot (slot_index, holder_run_id, holder_token, leased_at)
SELECT n, NULL, NULL, NULL FROM slots;
