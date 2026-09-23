-- 0004_incident_notice_resolution.sql — widen incident_notice uniqueness.
-- Issue #4357 (engine 7, P7.5).
--
-- Why: the shipped key is UNIQUE (page_id, sent_on). A same-day "fixed"
-- notice shares that key with the open notice, so the insert conflicts and
-- the follow-up is dropped. docs/engines/delivery.md §4 requires the
-- follow-up, and resolves it by including is_resolution in the uniqueness.
-- SQLite cannot drop a table-level UNIQUE, and nothing references
-- incident_notice by foreign key, so this file rebuilds the table. The
-- previous code keeps working: same six columns, same types, same defaults,
-- same foreign keys. Do not apply this to remote D1 from a worker.

PRAGMA defer_foreign_keys = true;

CREATE TABLE incident_notice_new (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  sent_on TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  is_resolution INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (incident_id) REFERENCES incident(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES page(id) ON DELETE CASCADE,
  UNIQUE (page_id, sent_on, is_resolution)
);

INSERT INTO incident_notice_new (id, incident_id, page_id, sent_on, sent_at, is_resolution)
SELECT id, incident_id, page_id, sent_on, sent_at, is_resolution FROM incident_notice;

DROP TABLE incident_notice;

ALTER TABLE incident_notice_new RENAME TO incident_notice;

PRAGMA defer_foreign_keys = false;
