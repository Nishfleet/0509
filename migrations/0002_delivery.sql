-- Delivery keys for engine 7.
-- unsubscribe_token is nullable: existing send_target rows keep working,
-- and a partial unique index allows many unset tokens.
-- incident_notice uniqueness widens to (page_id, sent_on, is_resolution) so a
-- same-day "fixed" notice can sit beside the open notice. SQLite cannot change
-- a table UNIQUE in place, so the table is copied and renamed. The old pair
-- key is stricter than the new triple, so every existing row still fits.

ALTER TABLE send_target ADD COLUMN unsubscribe_token TEXT;

CREATE UNIQUE INDEX idx_send_target_unsubscribe_token
  ON send_target(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

INSERT INTO channel (id, key, is_enabled, config_json)
VALUES ('email', 'email', 1, '{}');

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
