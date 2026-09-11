-- e2e_test_mode sentinel row for production (Gate C, api.launch-readiness.canary).
--
-- The launch-readiness canary asserts, on every production deploy, that the
-- e2e test-mode sentinel is OFF: `SELECT enabled FROM e2e_test_mode WHERE
-- id = 'local-authenticated'`. Since #2354 (2026-09-10) an unreadable
-- sentinel fails closed (blocker e2e_test_mode_sentinel_unreadable) — the
-- correct rule: a canary that cannot prove test mode is off must not go
-- green. But the table only ever existed in the local e2e fixture
-- (e2e/fixtures/e2e-local.sql, where it is created with enabled = 1); no
-- migration created it in production, so every Deploy production run after
-- #2354 deployed and then failed Gate C on this blocker and rolled back
-- (run 34581070289, 2026-09-11 14:45 IST, with every product fix merged).
--
-- This gives production the row the canary asserts on: present, enabled = 0.
-- Idempotent and additive (no rows touched elsewhere). Local e2e keeps its
-- own DROP + CREATE with enabled = 1 in the fixture, applied after migrations.
CREATE TABLE IF NOT EXISTS e2e_test_mode (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO e2e_test_mode (id, enabled, created_at)
VALUES ('local-authenticated', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
