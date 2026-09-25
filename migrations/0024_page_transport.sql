-- 0024_page_transport.sql — J5, #5343 (parent #4121): record which transport
-- each page's last successful read needed.
--
-- One additive statement. DEFAULT 'fetch' backfills every existing row as the
-- plain fetch path, and the CHECK pins the column to the two transports
-- app/lib/fetch/transport.server.ts returns. checkPage writes it after a
-- successful readUrl and never on a failed one, so the column always names a
-- read that actually completed. Additive only: one ALTER, nothing renamed or
-- deleted.

ALTER TABLE page ADD COLUMN transport TEXT NOT NULL DEFAULT 'fetch' CHECK (transport IN ('fetch','browser'));
